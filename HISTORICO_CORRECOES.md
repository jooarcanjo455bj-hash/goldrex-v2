# Histórico de Correções
- removido `public/recuperar.html` (órfão, script inexistente)
- removido `lib/dropfans.js` (sem uso após migration 0011)
- adicionado `public/icon-192.png`, `public/icon-512.png`
- recriado `.env.example` (variáveis atuais, sem DropFans)
- adicionado `tests/app.test.js`, `tests/mock-supabase.js`; `package.json`: script `test`
- teste: 3 expectativas desatualizadas ajustadas (texto de boot, 403 no 2º admin, ícone)
- `server.js`: sem alteração final (tentei exigir código no 1º admin; revertido porque a UI não pede o código nessa etapa)
Banco remoto: nenhuma operação.
