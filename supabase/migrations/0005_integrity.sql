-- GOLDREX · 0005 · Integridade referencial e permissões explícitas

-- Mantém a referência do horário quando um pedido existe e limpa-a quando o
-- horário é excluído; o horário pode, por sua vez, ser removido sem apagar o pedido.
alter table public.orders
  drop constraint if exists orders_slot_fk;
alter table public.orders
  add constraint orders_slot_fk
  foreign key (slot_id) references public.live_slots(id) on delete set null;

-- Pedidos históricos podem perder a referência ao item/serviço, mas não devem
-- apontar simultaneamente para tipos de produto incompatíveis.
alter table public.orders
  drop constraint if exists orders_type_relations_check;
alter table public.orders
  add constraint orders_type_relations_check check (
    (type = 'item' and service_id is null and slot_id is null and slot_at is null)
    or (type = 'live' and item_id is null)
  );

-- O backend usa service_role; clientes só recebem SELECT nas tabelas protegidas
-- por RLS e a vitrine não recebe acesso à coluna original_file.
revoke all privileges on all tables in schema public
  from public, anon, authenticated;
revoke all privileges on all sequences in schema public
  from public, anon, authenticated;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;

grant select on public.profiles, public.live_services, public.live_slots
  to anon, authenticated;
grant select on public.accounts, public.orders, public.payments,
  public.authorizations, public.order_events, public.audit_log,
  public.settings, public.chats, public.leads
  to authenticated;
grant select (id, profile_id, type, title, price_cents, preview, cover,
  teaser, duration, published, created_at)
  on public.items to anon, authenticated;

grant all privileges on table public.accounts, public.profiles, public.items,
  public.live_services, public.live_slots, public.orders, public.payments,
  public.authorizations, public.order_events, public.audit_log,
  public.settings, public.chats, public.leads
  to service_role;
grant usage, select on all sequences in schema public to service_role;

revoke all on function public.is_admin() from public, anon, authenticated;
grant execute on function public.is_admin() to anon, authenticated, service_role;
