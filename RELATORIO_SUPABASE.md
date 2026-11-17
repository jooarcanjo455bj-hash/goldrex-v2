# Relatório Supabase
**Nada foi testado contra o Supabase real** (sem rede/credenciais). Análise de código/SQL + mock.
- Cliente `lib/supa.js` (REST/Storage, sem SDK). Exige `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`; service_role só no servidor. Falha de rede não derruba o servidor (testado).
- Auth: **não usa Supabase Auth** nesta versão (migration 0012). Senhas com scrypt; sessões por cookie assinado (`APP_SECRET`). Confirmação de e-mail/recuperação não existem por design.
- Tabelas: accounts, profiles, items, live_services, live_slots, orders, payments, authorizations, order_events, audit_log, settings, chats, leads, provider_payments. RLS habilitado no SQL para todas (0002 e 0010).
- Storage: buckets (0003), `previews` privado (0007); upload limitado por `MAX_UPLOAD_MB`. Teste real pendente.
- Rodar no SQL Editor para validar o banco real: `supabase/tests/rls_test.sql`, `rpc_test.sql` (se existirem) e conferir `0011`/`0012` aplicadas.
- Nenhuma migration aplicada, nenhum dado alterado.
