alter table public.items
  add column if not exists dropfans_product_id text,
  add column if not exists dropfans_amount_cents integer;

alter table public.items
  drop constraint if exists items_dropfans_amount_cents_check;
alter table public.items
  add constraint items_dropfans_amount_cents_check
  check (dropfans_amount_cents is null or dropfans_amount_cents > 0);

create unique index if not exists items_dropfans_product_id_idx
  on public.items(dropfans_product_id)
  where dropfans_product_id is not null;

alter table public.dropfans_payments
  add column if not exists product_id text,
  add column if not exists currency text not null default 'USD',
  add column if not exists provider_transaction_id text,
  add column if not exists last_event_id text;

alter table public.dropfans_payments
  drop constraint if exists dropfans_payments_status_check;
alter table public.dropfans_payments
  add constraint dropfans_payments_status_check
  check (status in ('pending', 'confirmed', 'failed', 'refunded', 'chargeback'));

alter table public.dropfans_payments
  drop constraint if exists dropfans_payments_currency_check;
alter table public.dropfans_payments
  add constraint dropfans_payments_currency_check
  check (currency = 'USD');

create unique index if not exists dropfans_payments_transaction_id_idx
  on public.dropfans_payments(provider_transaction_id)
  where provider_transaction_id is not null;

alter table public.payments
  drop constraint if exists payments_status_check;
alter table public.payments
  add constraint payments_status_check
  check (status in ('pending', 'confirmed', 'rejected', 'cancelled', 'refunded', 'chargeback'));

create or replace function public.apply_dropfans_payment(
  p_reference text,
  p_product_id text,
  p_amount_cents integer,
  p_currency text,
  p_event_type text,
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
  payment_row public.dropfans_payments%rowtype;
  order_row public.orders%rowtype;
  next_status text;
  from_status text;
begin
  if p_reference is null or p_product_id is null or p_amount_cents is null or p_amount_cents <= 0
     or p_currency is distinct from 'USD'
     or p_event_type is null or p_event_type not in ('drop.paid', 'drop.refunded')
     or (p_event_type = 'drop.paid' and p_status is distinct from 'confirmed')
     or (p_event_type = 'drop.refunded' and (p_status is null or p_status not in ('refunded', 'chargeback')))
     or p_event_id is null or p_transaction_id is null then
    return false;
  end if;

  select * into payment_row
    from public.dropfans_payments
   where reference = p_reference
     and product_id = p_product_id
     and amount_cents = p_amount_cents
     and currency = p_currency
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

  if payment_row.last_event_id = p_event_id then
    return true;
  end if;

  if p_event_type = 'drop.paid' then
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
      'dropfans',
      'Pagamento confirmado pela integração DropFans (' || payment_row.reference || ')',
      'dropfans',
      p_auth_id
    ) then
      return false;
    end if;

    update public.dropfans_payments
       set status = 'confirmed',
           provider_transaction_id = p_transaction_id,
           last_event_id = p_event_id,
           external_reference = p_reference,
           confirmed_at = coalesce(confirmed_at, now()),
           updated_at = now()
     where id = payment_row.id;
    return true;
  end if;

  if payment_row.status in ('refunded', 'chargeback') then
    if payment_row.status = 'refunded' and p_status = 'chargeback' then
      update public.dropfans_payments
         set status = 'chargeback',
             last_event_id = p_event_id,
             updated_at = now()
       where id = payment_row.id;
      update public.payments
         set status = 'chargeback'
       where order_id = order_row.id
         and method = 'dropfans'
         and status = 'refunded';
    end if;
    return true;
  end if;

  next_status := p_status;

  if order_row.status in ('pending', 'paid') then
    from_status := order_row.status;
    update public.orders set status = 'revoked' where id = order_row.id;
    update public.authorizations
       set revoked_at = coalesce(revoked_at, now()),
           revoked_by = 'dropfans'
     where order_id = order_row.id
       and revoked_at is null;
    insert into public.order_events (order_id, from_status, to_status, by, note)
    values (order_row.id, from_status, 'revoked', 'dropfans', 'Reembolso ou chargeback DropFans');
  end if;

  update public.dropfans_payments
     set status = next_status,
         provider_transaction_id = p_transaction_id,
         last_event_id = p_event_id,
         external_reference = p_reference,
         updated_at = now()
   where id = payment_row.id;
  update public.payments
     set status = next_status
   where order_id = order_row.id
     and method = 'dropfans'
     and status in ('pending', 'confirmed');
  return true;
end;
$$;

revoke all on function public.apply_dropfans_payment(text, text, integer, text, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.apply_dropfans_payment(text, text, integer, text, text, text, text, text, text)
  to service_role;
