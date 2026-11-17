-- Um novo checkout deve corresponder ao preço atualmente publicado no item.
-- Pedidos pendentes com preço antigo são cancelados antes de criar a cobrança nova.
create or replace function public.create_item_order(
  p_order text,
  p_code text,
  p_token text,
  p_payment text,
  p_account uuid,
  p_email text,
  p_item text,
  p_price integer
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing text;
  v_existing_price integer;
  v_price integer;
begin
  if p_account is null
     or nullif(trim(p_email), '') is null
     or nullif(trim(p_item), '') is null
     or p_price is null
     or p_price <= 0 then
    raise exception 'Dados obrigatorios ausentes para criacao do pedido'
      using errcode = '23514';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_account::text || ':' || trim(p_item), 0)
  );

  select i.price_cents into v_price
    from public.items i
    join public.profiles p on p.id = i.profile_id
   where i.id = p_item
     and i.published
     and p.published
   for share of i, p;

  if not found or v_price is distinct from p_price then
    raise exception 'Item indisponivel ou preco alterado'
      using errcode = '23514';
  end if;

  perform 1
    from public.orders o
   where o.account_id = p_account
     and o.item_id = p_item
     and o.type = 'item'
     and o.status in ('pending', 'paid')
   for update;

  select o.id into v_existing
    from public.orders o
    join public.payments pay on pay.order_id = o.id
   where o.account_id = p_account
     and o.item_id = p_item
     and o.type = 'item'
     and o.status = 'paid'
     and pay.status = 'confirmed'
     and pay.method <> 'manual'
   order by o.created_at desc
   limit 1;

  if found then
    return v_existing;
  end if;

  select o.id, o.price_cents into v_existing, v_existing_price
    from public.orders o
   where o.account_id = p_account
     and o.item_id = p_item
     and o.type = 'item'
     and o.status = 'pending'
   order by o.created_at desc
   limit 1;

  if found and v_existing_price = p_price then
    return v_existing;
  end if;

  if found then
    update public.payments
       set status = 'cancelled',
           note = 'Pedido cancelado porque o preço publicado do item foi alterado.'
     where order_id = v_existing
       and status = 'pending';

    update public.orders
       set status = 'cancelled',
           note = 'Preço do item alterado; gere um novo pedido pelo valor atualizado.'
     where id = v_existing
       and status = 'pending';

    insert into public.order_events (
      order_id, from_status, to_status, by, note
    )
    values (
      v_existing, 'pending', 'cancelled', 'sistema',
      'Preço do item alterado; o próximo pedido usará o valor atualizado.'
    );
  end if;

  insert into public.orders (
    id, code, token, account_id, email, type, item_id, price_cents
  )
  values (
    p_order, p_code, p_token, p_account, lower(p_email), 'item', p_item, p_price
  );

  insert into public.payments (id, order_id, amount_cents, txid)
  values (p_payment, p_order, p_price, 'GR' || p_code);

  insert into public.order_events (
    order_id, from_status, to_status, by, note
  )
  values (p_order, null, 'pending', 'cliente', '');

  return p_order;
end;
$$;

revoke all on function public.create_item_order(text, text, text, text, uuid, text, text, integer)
  from public, anon, authenticated;
grant execute on function public.create_item_order(text, text, text, text, uuid, text, text, integer)
  to service_role;
