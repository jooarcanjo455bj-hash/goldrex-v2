-- DropFans preparation: only one-time purchase records are modeled until the
-- provider documents its subscription capabilities and callback contract.
alter table public.payments alter column method set default 'dropfans';

create table if not exists public.dropfans_payments (
  id text primary key,
  order_id text not null unique references public.orders(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  reference text not null unique,
  external_reference text,
  amount_cents integer not null check (amount_cents > 0),
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  confirmed_at timestamptz
);

create index if not exists dropfans_payments_account_idx
  on public.dropfans_payments(account_id, created_at desc);

create or replace function public.sync_dropfans_order_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.dropfans_payments
     set status = case when new.status = 'paid' then 'confirmed' else 'failed' end,
         confirmed_at = case when new.status = 'paid' then coalesce(confirmed_at, now()) else confirmed_at end,
         updated_at = now()
   where order_id = new.id
     and status = 'pending';
  return new;
end;
$$;

create trigger orders_sync_dropfans_payment
  after update of status on public.orders
  for each row
  when (old.status = 'pending' and new.status in ('paid', 'rejected', 'cancelled'))
  execute function public.sync_dropfans_order_status();

alter table public.dropfans_payments enable row level security;
create policy dropfans_payments_select_own on public.dropfans_payments
  for select using (account_id = auth.uid() or public.is_admin());

revoke all on public.dropfans_payments from public, anon, authenticated;
grant select on public.dropfans_payments to authenticated;
grant all on public.dropfans_payments to service_role;

-- A verified webhook adapter must call this function only after validating
-- DropFans' documented signature, event, reference, and amount.
create or replace function public.apply_dropfans_payment(
  p_reference text,
  p_amount_cents integer,
  p_status text,
  p_external_reference text,
  p_auth_id text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  payment_row public.dropfans_payments%rowtype;
  order_row public.orders%rowtype;
begin
  if p_status is null or p_status not in ('confirmed', 'failed')
     or p_amount_cents is null or p_amount_cents <= 0 then
    return false;
  end if;

  select * into payment_row
    from public.dropfans_payments
   where reference = p_reference
   for update;
  if not found or payment_row.amount_cents is distinct from p_amount_cents then
    return false;
  end if;

  select * into order_row
    from public.orders
   where id = payment_row.order_id
   for update;
  if not found then
    return false;
  end if;

  if p_status = 'failed' then
    if order_row.status <> 'pending' then
      return false;
    end if;
    update public.dropfans_payments
       set status = 'failed',
           external_reference = coalesce(p_external_reference, external_reference),
           updated_at = now()
     where id = payment_row.id;
    return true;
  end if;

  if order_row.status = 'paid' then
    update public.dropfans_payments
       set status = 'confirmed',
           external_reference = coalesce(p_external_reference, external_reference),
           confirmed_at = coalesce(confirmed_at, now()),
           updated_at = now()
     where id = payment_row.id;
    return true;
  end if;
  if order_row.status <> 'pending' or nullif(trim(p_auth_id), '') is null then
    return false;
  end if;

  if not public.confirm_order(
    order_row.id,
    'dropfans',
    'Pagamento confirmado pela integração DropFans (' || payment_row.reference || ')',
    'dropfans',
    p_auth_id
  ) then
    return false;
  end if;

  update public.dropfans_payments
     set status = 'confirmed',
         external_reference = coalesce(p_external_reference, external_reference),
         confirmed_at = coalesce(confirmed_at, now()),
         updated_at = now()
   where id = payment_row.id;
  return true;
end;
$$;

revoke all on function public.apply_dropfans_payment(text, integer, text, text, text)
  from public, anon, authenticated;
grant execute on function public.apply_dropfans_payment(text, integer, text, text, text)
  to service_role;
