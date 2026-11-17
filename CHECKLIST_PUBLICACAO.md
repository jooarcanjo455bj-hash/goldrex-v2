# Checklist de Publicação
- [ ] Rotacionar service_role e `APP_SECRET`; apagar `.env.bak*`.
- [ ] Conferir no Supabase que 0001–0007, 0009, 0010_pagamentos, 0011_remover_dropfans e 0012 estão aplicadas (banco novo: rodar só `EXECUTAR-TUDO.sql`). Rodar `rls_test.sql`.
- [ ] Criar `.env` na VPS (ver RELATORIO_HOSTINGER.md). `ADMIN_PATH` secreto, `ADMIN_SETUP_CODE` definido.
- [ ] `npm install --omit=dev` · `npm test` · subir com PM2 (1 instância) + Nginx + HTTPS.
- [ ] Criar o admin imediatamente; configurar chave Pix no painel; ativar notificações push.
- [ ] Teste real: cadastro → compra Pix/QR → "já paguei" → confirmação admin → acesso; upload/preview no Storage.
- [ ] `GET /healthz?db=1` ok. Só então apontar o DNS.
- [ ] Não publicar `backups/` e `ENTREGA-GOLDREX-V2/`.
