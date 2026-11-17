-- GOLDREX · 0004 · Operações atômicas
-- Só o servidor (service_role) pode executá-las.

-- Confirma um pedido pendente somente se existir pagamento
-- correspondente, com valor e TXID interno coerentes.
create or replace function public.confirm_order(
  p_order text,
  p_by text,
  p_note text,
  p_source text,
  p_auth_id text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.orders%rowtype;
  pay public.payments%rowtype;
begin
  update public.orders
     set status = 'paid',
         paid_at = now(),
         paid_by = p_by,
         note = p_note
   where id = p_order
     and status = 'pending'
   returning * into o;

  if not found then
    return false;
  end if;

  select *
    into pay
    from public.payments
   where order_id = p_order
   for update;

  if not found then
    raise exception 'Pagamento não encontrado para o pedido %', p_order
      using errcode = '23514';
  end if;

  if pay.status is distinct from 'pending' then
    raise exception 'Pagamento nao esta pendente para o pedido %', p_order
      using errcode = '23514';
  end if;

  if pay.amount_cents is distinct from o.price_cents then
    raise exception 'Valor do pagamento diferente do valor do pedido %', p_order
      using errcode = '23514';
  end if;

  if pay.txid is distinct from ('GR' || o.code) then
    raise exception 'TXID interno inconsistente para o pedido %', p_order
      using errcode = '23514';
  end if;

  update public.payments
     set status = 'confirmed',
         source = p_source,
         note = p_note,
         confirmed_at = now()
   where id = pay.id;

  insert into public.authorizations (
    id, order_id, account_id, email, item_id,
    kind, granted_by, note
  )
  values (
    p_auth_id, o.id, o.account_id, o.email, o.item_id,
    'payment', p_by, coalesce(p_note, '')
  );

  insert into public.order_events (
    order_id, from_status, to_status, by, note
  )
  values (
    o.id, 'pending', 'paid', p_by, coalesce(p_note, '')
  );

  return true;
end;
$$;

-- Libera um conteúdo manualmente para uma conta.
create or replace function public.grant_manual_access(
  p_order text, p_code text, p_token text, p_payment text, p_auth text,
  p_account uuid, p_email text, p_item text, p_by text, p_note text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_active boolean;
begin
  if p_account is null
     or nullif(trim(p_item), '') is null
     or nullif(trim(p_email), '') is null then
    raise exception 'Dados obrigatorios ausentes para liberacao manual'
      using errcode = '23514';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_account::text || ':' || trim(p_item), 0)
  );

  select exists (
    select 1
      from public.authorizations a
     where a.account_id = p_account
       and a.item_id = p_item
       and a.revoked_at is null
  ) into v_active;

  if v_active then
    raise exception 'Cliente ja possui acesso ativo a este item'
      using errcode = '23505';
  end if;

  insert into public.orders (
    id, code, token, account_id, email, type, item_id,
    price_cents, status, paid_at, paid_by, note
  )
  values (
    p_order, p_code, p_token, p_account, lower(p_email), 'item',
    p_item, 0, 'paid', now(), p_by, p_note
  );

  insert into public.payments (
    id, order_id, method, amount_cents, status,
    txid, source, note, confirmed_at
  )
  values (
    p_payment, p_order, 'manual', 0, 'confirmed',
    'MANUAL' || p_code, 'admin', p_note, now()
  );

  insert into public.authorizations (
    id, order_id, account_id, email, item_id,
    kind, granted_by, note
  )
  values (
    p_auth, p_order, p_account, lower(p_email), p_item,
    'manual', p_by, coalesce(p_note, '')
  );

  insert into public.order_events (
    order_id, from_status, to_status, by, note
  )
  values (
    p_order, null, 'paid', p_by,
    'liberação manual: ' || coalesce(p_note, '')
  );

  return p_order;
end;
$$;

-- Revoga o acesso a um pedido pago, preservando o histórico.
create or replace function public.revoke_access(
  p_order text, p_by text, p_note text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.orders
     set status = 'revoked'
   where id = p_order
     and status = 'paid';

  if not found then
    return false;
  end if;

  update public.authorizations
     set revoked_at = now(),
         revoked_by = p_by
   where order_id = p_order
     and revoked_at is null;

  insert into public.order_events (
    order_id, from_status, to_status, by, note
  )
  values (
    p_order, 'paid', 'revoked', p_by, coalesce(p_note, '')
  );

  return true;
end;
$$;

revoke all on function public.confirm_order(text, text, text, text, text)
  from public, anon, authenticated;

revoke all on function public.grant_manual_access(text, text, text, text, text, uuid, text, text, text, text)
  from public, anon, authenticated;

revoke all on function public.revoke_access(text, text, text)
  from public, anon, authenticated;

grant execute on function public.confirm_order(text, text, text, text, text)
  to service_role;

grant execute on function public.grant_manual_access(text, text, text, text, text, uuid, text, text, text, text)
  to service_role;

grant execute on function public.revoke_access(text, text, text)
  to service_role;