-- GOLDREX · LIMPAR TUDO (use ANTES de publicar de verdade)
-- Apaga TODOS os dados de teste: contas de clientes, pedidos, pagamentos, perfis, fotos/vídeos cadastrados,
-- histórico e configurações (inclusive o acesso do administrador: você cria de novo ao abrir /admin).
-- NÃO apaga tabelas, funções, regras de segurança nem as pastas (buckets). NÃO dá para desfazer.
-- Rode no Supabase: SQL Editor > New query > cole tudo > Run.

begin;

truncate table
  public.order_events, public.audit_log, public.provider_payments, public.payments,
  public.authorizations, public.live_slots, public.orders, public.items, public.live_services,
  public.profiles, public.chats, public.leads, public.accounts
restart identity cascade;

delete from public.settings;   -- inclui acesso do admin, chaves de notificação e palavra do atalho

commit;

-- Arquivos (fotos e vídeos) guardados no Storage.
-- Opção 1 (recomendada): no painel do Supabase > Storage > bucket "originals" > selecione tudo > Delete; repita no bucket "previews".
-- Opção 2: no servidor, rode:  npm run limpar-arquivos   (pede para digitar SIM)
-- Opção 3: tente este SQL (o Supabase pode bloquear apagar arquivos por SQL; se der erro, use a opção 1 ou 2):
-- set storage.allow_delete_query = 'true';
-- delete from storage.objects where bucket_id in ('originals', 'previews');
