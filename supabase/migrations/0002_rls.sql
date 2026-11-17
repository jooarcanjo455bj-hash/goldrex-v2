-- GOLDREX · 0002 · Segurança em nível de linha (RLS)
-- O site NUNCA fala direto com o banco pelo navegador: só o servidor (chave service_role,
-- que ignora RLS) grava e lê. Mesmo assim, o RLS fica ligado em TODAS as tabelas como
-- segunda barreira: se alguém usar a chave "anon" por fora, só enxerga o que está abaixo.

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.accounts where id = auth.uid() and role = 'admin');
$$;

alter table public.accounts       enable row level security;
alter table public.profiles       enable row level security;
alter table public.items          enable row level security;
alter table public.live_services  enable row level security;
alter table public.live_slots     enable row level security;
alter table public.orders         enable row level security;
alter table public.payments       enable row level security;
alter table public.authorizations enable row level security;
alter table public.order_events   enable row level security;
alter table public.audit_log      enable row level security;
alter table public.settings       enable row level security;
alter table public.chats          enable row level security;
alter table public.leads          enable row level security;

-- Contas: cada pessoa vê só a própria; admin vê todas. Ninguém altera "role" pelo cliente
-- (não existe política de insert/update/delete para usuários comuns).
drop policy if exists accounts_select_own on public.accounts;
create policy accounts_select_own on public.accounts for select using (id = auth.uid() or public.is_admin());

-- Vitrine pública: só o que está publicado.
drop policy if exists profiles_select_published on public.profiles;
create policy profiles_select_published on public.profiles for select using (published or public.is_admin());

drop policy if exists items_select_published on public.items;
create policy items_select_published on public.items for select using (
  public.is_admin() or (published and exists (select 1 from public.profiles p where p.id = profile_id and p.published))
);

revoke select on public.items from public, anon, authenticated;
revoke select (original_file) on public.items from public, anon, authenticated;
grant select (id, profile_id, type, title, price_cents, preview, cover, teaser, duration, published, created_at)
  on public.items to anon, authenticated;
grant select, insert, update, delete on public.items to service_role;

drop policy if exists services_select_active on public.live_services;
create policy services_select_active on public.live_services for select using (active or public.is_admin());

drop policy if exists slots_select_free on public.live_slots;
create policy slots_select_free on public.live_slots for select using (
  public.is_admin() or (order_id is null and at > now()
    and exists (select 1 from public.live_services s where s.id = service_id and s.active))
);

-- Cliente vê apenas os próprios pedidos, pagamentos e autorizações.
drop policy if exists orders_select_own on public.orders;
create policy orders_select_own on public.orders for select using (account_id = auth.uid() or public.is_admin());

drop policy if exists payments_select_own on public.payments;
create policy payments_select_own on public.payments for select using (
  public.is_admin() or exists (select 1 from public.orders o where o.id = order_id and o.account_id = auth.uid())
);

drop policy if exists authorizations_select_own on public.authorizations;
create policy authorizations_select_own on public.authorizations for select using (account_id = auth.uid() or public.is_admin());

-- Somente o administrador pode ler estas (sem política = ninguém mais lê).
drop policy if exists events_admin on public.order_events;
create policy events_admin on public.order_events for select using (public.is_admin());
drop policy if exists audit_admin on public.audit_log;
create policy audit_admin on public.audit_log for select using (public.is_admin());
drop policy if exists chats_admin on public.chats;
create policy chats_admin on public.chats for select using (public.is_admin());
drop policy if exists leads_admin on public.leads;
create policy leads_admin on public.leads for select using (public.is_admin());

-- Configurações: só o visual PUBLICADO é legível sem ser admin (Pix, rascunho e atalho ficam protegidos).
drop policy if exists settings_public on public.settings;
create policy settings_admin on public.settings for select using (public.is_admin());

-- Escrita: nenhuma política de insert/update/delete é criada de propósito.
-- Todas as gravações passam pelo servidor com a service_role, depois de checar a permissão no backend.
