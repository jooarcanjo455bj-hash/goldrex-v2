-- Camada de pagamento neutra (qualquer provedor: manual/Pix, Cloud...).
-- Valores sempre em reais (BRL), em centavos.
alter table public.payments alter column method set default 'pix';

alter table public.payments
  drop constraint if exists payments_status_check;
alter table public.payments
  add constraint payments_status_check
  check (status in ('pending', 'confirmed', 'rejected', 'cancelled', 'refunded', 'chargeback'));

create table if not exists public.provider_payments (
  id text primary key,
  order_id text not null unique references public.orders(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  reference text not null unique,
  provider text not null default 'manual' check (provider in ('manual', 'cloud')),
  amount_cents integer not null check (amount_cents > 0),
  currency text not null default 'BRL' check (currency = 'BRL'),
  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'failed', 'refunded', 'chargeback')),
  provider_transaction_id text,
  last_event_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  confirmed_at timestamptz
);

create unique index if not exists provider_payments_transaction_id_idx
  on public.provider_payments(provider_transaction_id)
  where provider_transaction_id is not null;
create index if not exists provider_payments_account_idx
  on public.provider_payments(account_id, created_at desc);

create or replace function public.sync_provider_payment_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.provider_payments
     set status = case when new.status = 'paid' then 'confirmed' else 'failed' end,
         confirmed_at = case when new.status = 'paid' then coalesce(confirmed_at, now()) else confirmed_at end,
         updated_at = now()
   where order_id = new.id
     and status = 'pending';
  return new;
end;
$$;

drop trigger if exists orders_sync_provider_payment on public.orders;
create trigger orders_sync_provider_payment
  after update of status on public.orders
  for each row
  when (old.status = 'pending' and new.status in ('paid', 'rejected', 'cancelled'))
  execute function public.sync_provider_payment_status();

alter table public.provider_payments enable row level security;
drop policy if exists provider_payments_select_own on public.provider_payments;
create policy provider_payments_select_own on public.provider_payments
  for select using (account_id = auth.uid() or public.is_admin());

revoke all on public.provider_payments from public, anon, authenticated;
grant select on public.provider_payments to authenticated;
grant all on public.provider_payments to service_role;

-- O webhook só chama esta função DEPOIS de validar a assinatura do provedor.
-- p_status: 'confirmed' (pago), 'refunded' ou 'chargeback'.
create or replace function public.apply_provider_payment(
  p_reference text,
  p_amount_cents integer,
  p_status text,
  p_event_id text,
  p_transaction_id text,
  p_auth_id text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  payment_row public.provider_payments%rowtype;
  order_row public.orders%rowtype;
  from_status text;
begin
  if p_reference is null or p_amount_cents is null or p_amount_cents <= 0
     or p_status is null or p_status not in ('confirmed', 'refunded', 'chargeback')
     or p_event_id is null or p_transaction_id is null then
    return false;
  end if;

  select * into payment_row
    from public.provider_payments
   where reference = p_reference
     and amount_cents = p_amount_cents
   for update;
  if not found then
    return false;
  end if;

  select * into order_row
    from public.orders
   where id = payment_row.order_id
   for update;
  if not found then
    return false;
  end if;

  if payment_row.provider_transaction_id is not null
     and payment_row.provider_transaction_id is distinct from p_transaction_id then
    return false;
  end if;

  -- evento repetido: idempotente
  if payment_row.last_event_id = p_event_id then
    return true;
  end if;

  if p_status = 'confirmed' then
    if payment_row.status in ('refunded', 'chargeback', 'failed')
       or order_row.status in ('revoked', 'rejected', 'cancelled') then
      return true;
    end if;
    if payment_row.status = 'confirmed' then
      return payment_row.provider_transaction_id = p_transaction_id;
    end if;
    if order_row.status <> 'pending' or nullif(trim(p_auth_id), '') is null then
      return false;
    end if;

    if not public.confirm_order(
      order_row.id,
      'cloud',
      'Pagamento confirmado pelo provedor (' || payment_row.reference || ')',
      'webhook',
      p_auth_id
    ) then
      return false;
    end if;

    update public.provider_payments
       set status = 'confirmed',
           provider_transaction_id = p_transaction_id,
           last_event_id = p_event_id,
           confirmed_at = coalesce(confirmed_at, now()),
           updated_at = now()
     where id = payment_row.id;
    return true;
  end if;

  -- reembolso / chargeback
  if payment_row.status in ('refunded', 'chargeback') then
    if payment_row.status = 'refunded' and p_status = 'chargeback' then
      update public.provider_payments
         set status = 'chargeback', last_event_id = p_event_id, updated_at = now()
       where id = payment_row.id;
      update public.payments
         set status = 'chargeback'
       where order_id = order_row.id and status = 'refunded';
    end if;
    return true;
  end if;

  if order_row.status in ('pending', 'paid') then
    from_status := order_row.status;
    update public.orders set status = 'revoked' where id = order_row.id;
    update public.authorizations
       set revoked_at = coalesce(revoked_at, now()),
           revoked_by = 'cloud'
     where order_id = order_row.id
       and revoked_at is null;
    insert into public.order_events (order_id, from_status, to_status, by, note)
    values (order_row.id, from_status, 'revoked', 'cloud', 'Reembolso ou chargeback do provedor');
  end if;

  update public.provider_payments
     set status = p_status,
         provider_transaction_id = p_transaction_id,
         last_event_id = p_event_id,
         updated_at = now()
   where id = payment_row.id;
  update public.payments
     set status = p_status
   where order_id = order_row.id
     and status in ('pending', 'confirmed');
  return true;
end;
$$;

revoke all on function public.apply_provider_payment(text, integer, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.apply_provider_payment(text, integer, text, text, text, text)
  to service_role;
