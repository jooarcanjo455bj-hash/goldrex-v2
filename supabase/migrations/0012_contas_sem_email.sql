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
