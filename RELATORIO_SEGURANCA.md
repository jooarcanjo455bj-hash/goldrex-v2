# Relatório de Segurança
## Crítico
1. **Chaves reais em arquivos enviados** (`.env.bak-*` no ZIP anterior: service_role/secret e `APP_SECRET`). **Rotacionar** a chave no Supabase e gerar novo `APP_SECRET`; apagar esses arquivos.
2. **Criação do 1º admin é aberta** (`/api/admin/signup` sem código quando ainda não existe admin). Se o banco já tem `admin_credential`, só troca com `ADMIN_SETUP_CODE`/`APP_SECRET`. Em instalação nova: use `ADMIN_PATH` secreto e crie o admin imediatamente após subir, antes de divulgar o domínio; defina `ADMIN_SETUP_CODE`. Recomendado (não feito, exige mudança de UI): exigir o código também no 1º acesso.
## Verificado OK
service_role fora do front; arquivos sensíveis 404; CSP restritiva, `X-Frame-Options`, `nosniff`, `Permissions-Policy`, HSTS em HTTPS; CSRF por Origin (403); rate-limit/bloqueio em login/cadastro/admin; `timingSafeEqual`; scrypt; sem SQL concatenado; RLS em todas as tabelas no SQL; admin com `APP_SECRET` ≥ 32 exigido.
## Pendente
Revisão linha a linha de `innerHTML` (usa `esc()`; CSP bloqueia script inline); `style-src 'unsafe-inline'`; `npm audit` (sem deps de produção); teste dinâmico de upload malicioso/IDOR; RLS real no banco.
