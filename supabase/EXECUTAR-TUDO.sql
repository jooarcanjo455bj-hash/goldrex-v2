-- GOLDREX · 0001 · Estrutura do banco (tabelas e relacionamentos)
-- Rode no Supabase: SQL Editor > New query > cole e execute (ou use a CLI do Supabase).
-- Todas as datas são "timestamptz" (UTC). Valores em dinheiro ficam em centavos (inteiro).

-- ---------------------------------------------------------------------------
-- CONTAS (usuários). O e-mail e a senha ficam no Supabase Auth (auth.users);
-- esta tabela guarda o papel (cliente, atendente, admin) e dados de perfil da conta.
-- ---------------------------------------------------------------------------
create table if not exists public.accounts (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text not null unique,
  role         text not null default 'cliente' check (role in ('cliente','atendente','admin')),
  display_name text,
  created_at   timestamptz not null default now()
);

-- Cria a conta automaticamente quando alguém se cadastra no Supabase Auth.
-- Sempre nasce como 'cliente': só o backend (service role) promove para admin.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.accounts (id, email) values (new.id, lower(new.email))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- PERFIS PÚBLICOS DA VITRINE (quem aparece no site) e seus conteúdos
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id         text primary key,
  name       text not null,
  username   text not null default '',
  bio        text not null default '',
  avatar     text not null default '',      -- caminho público, ex.: /uploads/abc.jpg
  verified   boolean not null default false,
  published  boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.items (
  id            text primary key,
  profile_id    text not null references public.profiles(id) on delete cascade,
  type          text not null check (type in ('photo','video')),
  title         text not null,
  price_cents   integer not null default 0 check (price_cents >= 0),
  original_file text not null,              -- nome do arquivo ORIGINAL no bucket privado "originals"
  preview       text not null default '',   -- prévia borrada (bucket privado "previews"), ex.: /uploads/x.jpg
  cover         text not null default '',
  teaser        text not null default '',
  duration      integer not null default 0,
  published     boolean not null default false,
  created_at    timestamptz not null default now()
);
create index if not exists items_profile_idx on public.items(profile_id, type, created_at desc);

-- ---------------------------------------------------------------------------
-- SERVIÇOS AO VIVO E HORÁRIOS
-- ---------------------------------------------------------------------------
create table if not exists public.live_services (
  id           text primary key,
  name         text not null,
  description  text not null default '',
  price_cents  integer not null default 0 check (price_cents >= 0),
  duration_min integer not null default 30 check (duration_min > 0),
  conditions   text not null default '',
  active       boolean not null default false,
  created_at   timestamptz not null default now()
);

create table if not exists public.live_slots (
  id         text primary key,
  service_id text not null references public.live_services(id) on delete cascade,
  at         timestamptz not null,
  order_id   text,                           -- preenchido quando o horário é reservado por um pedido
  unique (service_id, at)
);

-- ---------------------------------------------------------------------------
-- PEDIDOS, PAGAMENTOS, AUTORIZAÇÕES E HISTÓRICO
-- ---------------------------------------------------------------------------
create table if not exists public.orders (
  id          text primary key,
  code        text not null unique,          -- código curto do pedido (também vai no txid do Pix: GR<code>)
  token       text not null unique,          -- link de acesso /acesso/<token>
  account_id  uuid references public.accounts(id) on delete set null,
  email       text not null,
  type        text not null check (type in ('item','live')),
  item_id     text references public.items(id) on delete set null,
  service_id  text references public.live_services(id) on delete set null,
  slot_id     text,
  slot_at     timestamptz,
  notes       text not null default '',
  price_cents integer not null check (price_cents >= 0),
  status      text not null default 'pending' check (status in ('pending','paid','rejected','cancelled','revoked')),
  created_at  timestamptz not null default now(),
  paid_at     timestamptz,
  paid_by     text,
  note        text
);
create index if not exists orders_account_idx on public.orders(account_id, created_at desc);
create index if not exists orders_email_idx   on public.orders(email);
create index if not exists orders_status_idx  on public.orders(status, created_at);

alter table public.live_slots drop constraint if exists live_slots_order_fk;
alter table public.live_slots add constraint live_slots_order_fk
  foreign key (order_id) references public.orders(id) on delete set null;

create table if not exists public.payments (
  id           text primary key,
  order_id     text not null unique references public.orders(id) on delete cascade,
  method       text not null default 'pix',
  amount_cents integer not null check (amount_cents >= 0),
  status       text not null default 'pending' check (status in ('pending','confirmed','rejected','cancelled')),
  txid         text not null,
  source       text,                          -- 'webhook' ou 'admin'
  note         text,
  created_at   timestamptz not null default now(),
  confirmed_at timestamptz
);

-- Quem pode abrir o conteúdo ORIGINAL de um pedido. É criada ao confirmar o pagamento
-- (kind = 'payment') ou quando o administrador autoriza manualmente (kind = 'manual').
create table if not exists public.authorizations (
  id         text primary key,
  order_id   text not null references public.orders(id) on delete cascade,
  account_id uuid references public.accounts(id) on delete set null,
  email      text not null,
  item_id    text references public.items(id) on delete set null,
  kind       text not null check (kind in ('payment','manual')),
  granted_by text not null,                   -- 'webhook' ou e-mail do administrador
  note       text not null default '',
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by text
);
create index if not exists authorizations_order_idx on public.authorizations(order_id);
create index if not exists authorizations_account_idx on public.authorizations(account_id);

create table if not exists public.order_events (
  id         bigint generated always as identity primary key,
  order_id   text not null references public.orders(id) on delete cascade,
  from_status text,
  to_status  text not null,
  by         text not null default '',
  note       text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists order_events_order_idx on public.order_events(order_id, created_at);

-- Histórico de operações administrativas e do sistema
create table if not exists public.audit_log (
  id         bigint generated always as identity primary key,
  actor      text not null default '',
  action     text not null,
  detail     text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists audit_log_created_idx on public.audit_log(created_at desc);

-- ---------------------------------------------------------------------------
-- CONFIGURAÇÕES, CHAT E E-MAILS DA TELA 18+
-- ---------------------------------------------------------------------------
-- Chaves usadas: site_live, site_draft, pix, robot, live_loop, door
create table if not exists public.settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.chats (
  cid        text primary key,
  id         text not null,
  email      text not null default '',
  mode       text not null default 'bot',
  status     text not null default 'open',
  msgs       jsonb not null default '[]'::jsonb,
  stack      jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);
create index if not exists chats_updated_idx on public.chats(updated_at desc);

create table if not exists public.leads (
  email      text primary key,
  created_at timestamptz not null default now()
);

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

-- GOLDREX · 0003 · Armazenamento de fotos e vídeos (Supabase Storage)
--   previews  : PRIVADO  - miniaturas borradas, capas, avatares e teasers borrados
--   originals : PRIVADO  - fotos/vídeos originais em qualidade integral; só o servidor lê,
--                          e entrega ao cliente depois que o pagamento é confirmado ou a liberação é manual.
-- Limite por arquivo: o plano gratuito do Supabase aceita até 50 MB por arquivo (ajuste se o seu plano permitir mais).

insert into storage.buckets (id, name, public, file_size_limit)
values
  ('previews',  'previews',  false, 52428800),
  ('originals', 'originals', false, 52428800)
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit;

-- Nenhuma política é criada em storage.objects: sem política, os buckets privados não podem ser
-- lidos nem escritos pelas chaves "anon"/"authenticated". O servidor usa service_role.

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

-- GOLDREX · 0006 · Compras concorrentes e privilégios por coluna

-- Remove qualquer privilégio concedido diretamente por coluna em items.
-- Depois, a vitrine recebe somente as colunas públicas explicitamente listadas.
revoke all (id, profile_id, type, title, price_cents, original_file, preview,
  cover, teaser, duration, published, created_at)
  on table public.items from public, anon, authenticated;

grant select (id, profile_id, type, title, price_cents, preview, cover,
  teaser, duration, published, created_at)
  on table public.items to anon, authenticated;

-- Serializa compra do mesmo item para a mesma conta. A checagem e a criação
-- do pedido, pagamento e evento ocorrem na mesma transação PostgreSQL.
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

  select o.id into v_existing
    from public.orders o
   where o.account_id = p_account
     and o.item_id = p_item
     and o.type = 'item'
     and o.status = 'pending'
   order by o.created_at desc
   limit 1;

  if found then
    return v_existing;
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

-- GOLDREX · 0007 · Previews privados
-- Não altera nem remove arquivos existentes. O servidor os entrega após a confirmação 18+.
update storage.buckets
   set public = false
 where id = 'previews';

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

-- Limpeza: remove tudo que sobrou da integração antiga (Dropfans).
-- Seguro em banco novo (nada a remover) e em banco que já tinha as migrations antigas.
drop trigger if exists orders_sync_dropfans_payment on public.orders;
drop function if exists public.sync_dropfans_order_status();
drop function if exists public.apply_dropfans_payment(text, integer, text, text, text);
drop function if exists public.apply_dropfans_payment(text, text, integer, text, text, text, text, text, text);
drop table if exists public.dropfans_payments;

drop index if exists public.items_dropfans_product_id_idx;
alter table public.items drop constraint if exists items_dropfans_amount_cents_check;
alter table public.items
  drop column if exists dropfans_product_id,
  drop column if exists dropfans_amount_cents;

update public.payments set method = 'pix' where method = 'dropfans';

-- GOLDREX · 0012 · Contas só com usuário e senha (sem e-mail, sem Supabase Auth, sem recuperação)
-- Seguro em banco novo e em banco existente. Pode ser rodado mais de uma vez.
-- A coluna "email" passa a guardar o NOME DE USUÁRIO (minúsculo). Não é um e-mail de verdade.

-- 1) A conta deixa de depender do Supabase Auth
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user();
alter table public.accounts drop constraint if exists accounts_id_fkey;
alter table public.accounts alter column id set default gen_random_uuid();

-- 2) Senha guardada só como hash (scrypt), feito pelo servidor
alter table public.accounts add column if not exists pass_salt text;
alter table public.accounts add column if not exists pass_hash text;
comment on column public.accounts.email is 'Nome de usuário (minúsculo). Não é e-mail.';

-- 3) Ninguém além do servidor (service_role) lê as senhas
revoke select on public.accounts from anon, authenticated;
