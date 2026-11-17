# GOLDREX · Comece aqui (Hostinger VPS + Supabase)

O que mudou nesta versão:
- **Conta do cliente só com usuário e senha** (sem e-mail, sem confirmação, sem recuperação). Se esquecer a senha, cria outra conta.
- **Pix com QR Code automático**: você cadastra a chave na aba **Pix** do painel; cada pedido já mostra o QR Code e o Pix copia e cola com o valor certo. O cliente paga, toca em "Já paguei", e você confirma em **Pedidos**. O celular recebe **notificação** a cada pedido.
- Site leve, letra maior, poucos botões. Sem chat, sem ao vivo, sem login com Google.
- O nome continua **GOLDREX**.

## Passo a passo (ordem)
1. **Supabase** → SQL Editor → cole e rode `supabase/EXECUTAR-TUDO.sql` (projeto novo). Projeto que já tinha a versão antiga: rode só `supabase/migrations/0012_contas_sem_email.sql`.
2. **Limpar testes** (antes de publicar): rode `supabase/LIMPAR-TUDO.sql` e depois apague os arquivos (veja o final do próprio SQL, ou `npm run limpar-arquivos` no servidor).
3. **VPS Hostinger** (`docs/HOSTINGER.md`): instalar Node/PM2/Nginx, subir o código, criar o `.env` (modelo abaixo), `pm2 start ecosystem.config.js`, Nginx + HTTPS.
4. **Primeiro acesso ao painel**: abra `https://SEU-SITE/ENDERECO-DO-PAINEL` → "Criar acesso do administrador" → usuário, senha, repetir a senha → Criar. Só funciona **uma vez**.
5. **Celular do admin**: abra o painel no celular → **Pedidos** → "Ligar notificações neste aparelho" → Permitir. iPhone: antes, Compartilhar → Adicionar à Tela de Início, e abra pelo ícone.
6. Aba **Pix**: cadastre a chave, o nome de quem recebe e a cidade. Depois cadastre perfil, fotos e preços.
7. Monitor gratuito (UptimeRobot): `https://SEU-SITE/healthz?db=1` a cada 5 min (evita o Supabase pausar).

## Modelo do `.env` de produção (bloco de notas)
```
NODE_ENV=production
HTTPS=true
TRUST_PROXY=true
HOST=127.0.0.1
PORT=3000
SITE_URL=https://SEUDOMINIO.com.br
ADMIN_PATH=/painel-troque-isto
SUPABASE_URL=https://SEU-PROJETO.supabase.co
SUPABASE_SERVICE_ROLE_KEY=COLE_A_CHAVE_SECRETA
APP_SECRET=GERE_COM_openssl_rand_-hex_32
PIX_KEY=SUA_CHAVE_PIX
PIX_RECEIVER_NAME=NOME_DE_QUEM_RECEBE
PUSH_CONTACT=seu@email.com
MAX_UPLOAD_MB=50
```
Depois de editar o `.env`: `pm2 restart goldrex --update-env`.

## Atenção legal (leia)
Veja `docs/PENDENCIAS-PUBLICACAO.md`. O "Li e aceito / tenho 18 anos" é só **autodeclaração**; o ECA Digital (em vigor desde 17/03/2026) não aceita autodeclaração como único método de verificação de idade. Fale com um advogado antes de abrir ao público. Preencha também os campos `[ ... ]` em `public/termos.html`.

## Mapa
`server.js` servidor · `lib/` regras (`push.js` = notificação) · `public/` site e painel · `supabase/` SQL · `docs/` guias.
