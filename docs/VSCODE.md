# Passo 2 · Rodar no seu computador (VS Code)

Precisa do **Node.js 20 ou mais novo** (https://nodejs.org). O servidor usa APIs nativas do Node; para executar o teste de interface, instale a dependência de desenvolvimento com `npm install` (Playwright).

1. Extraia o ZIP e abra a pasta `goldrex` no VS Code (**File > Open Folder**).
2. Copie `.env.example` para `.env` (botão direito > Copy/Paste e renomeie) e preencha as linhas de **Supabase**, `APP_SECRET`, `PIX_KEY` e `PIX_RECEIVER_NAME` (veja COMECE-AQUI.md). Para gerar o `APP_SECRET`, no terminal do VS Code (**Terminal > New Terminal**):
   ```
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
3. Inicie: `node server.js` (ou `npm start`). Deve aparecer `GOLDREX em http://localhost:3000` e `Supabase: conexão OK.`
4. Abra http://localhost:3000 e o painel em http://localhost:3000/admin.
5. Para parar: `Ctrl + C`.

**Importante:** o banco e as fotos NÃO ficam no seu computador nem nesta pasta. Ficam no Supabase. Por isso você pode apagar a pasta, trocar de computador ou publicar de novo sem perder nada; basta ter o `.env` (ou o `.env` da VPS).

## Testes (opcional, não precisam de internet)
```
npm.cmd test         # 24 testes automáticos com um Supabase simulado
npm.cmd run test:ui  # smoke Playwright da interface móvel e painel
```
