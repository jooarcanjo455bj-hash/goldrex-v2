# Relatório Hostinger
**Só VPS** (ou Node gerenciado com 1 processo persistente). Não serve em hospedagem compartilhada.
- Instalar: `npm install --omit=dev` · Build: nenhum · Iniciar: `pm2 start ecosystem.config.js` (1 instância) ou `npm start`.
- Nginx na frente (`deploy/nginx-goldrex.conf`), HTTPS (Let's Encrypt), `client_max_body_size` ≥ `MAX_UPLOAD_MB`, `HOST=127.0.0.1`.
- Health: `GET /healthz` (`?db=1` testa o Supabase). Logs: `pm2 logs goldrex`.
- Variáveis (`.env` só na VPS): `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (rotacionada), `APP_SECRET` (≥32), `ADMIN_PATH`, `ADMIN_SETUP_CODE`, `SITE_URL=https://…`, `NODE_ENV=production`, `PORT`, `HTTPS=true`, `TRUST_PROXY=true`, `TRUSTED_PROXY_HOPS=1`, `MAX_UPLOAD_MB`, `PIX_KEY`, `PIX_RECEIVER_NAME`, `PIX_CITY`, `PUSH_CONTACT`.
- Web Push/PWA exigem HTTPS. DNS e domínio: por sua conta.
