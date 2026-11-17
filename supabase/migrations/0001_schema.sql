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
