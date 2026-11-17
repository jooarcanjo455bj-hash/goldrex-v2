# Relatório de testes GOLDREX V2

Atualizado em 12/11/2026. Testes locais com Node.js no Windows.

## Resultados locais

| Teste | Resultado |
|---|---|
| `npm.cmd test` | 24/24 passaram com servidor local e Supabase simulado. |
| `npm.cmd run test:ui` | 34 verificações passaram em Chromium (viewport móvel 390 px e painel desktop 1100 px), sem erros de console. |
| `node --check` | Passou nos arquivos JavaScript alterados de servidor, frontend, testes e scripts. |
| SQL consolidado | Conferido contra as 9 migrations ativas (`0001`–`0007`, `0009`–`0010`); a `0008_asaas_pix.sql` histórica não é incluída no bundle. |

O Playwright foi instalado no `node_modules` existente. O shell bloqueia `npm.ps1`; os testes foram executados pelo `npm.cmd`, sem alterar a política do PowerShell.

## Cobertura exercitada

Cadastro/login/logout, recuperação/reset, sessões e papéis; gate 18+; perfil/foto e upload; prévias privadas; pedidos e preço por item; estados DropFans e webhook bloqueado; confirmação manual/revogação; ao vivo sem agenda; chat/robô; persistência após reinício; retry de leituras GET do Supabase sem repetir gravações; interface da vitrine, cadastro, pagamento, painel e ficha do cliente. O link de onboarding KYC da DropFans não gera uma cobrança.

O teste UI salva capturas em `tests/shots/`. Uma cópia está no pacote final em `ENTREGA-GOLDREX-V2/evidencias/playwright/`.

## Limitações

Os testes usam Supabase simulado. Não foram executados testes contra PostgreSQL/Supabase real, RLS real, Auth/SMTP real, API/pagamento/webhook DropFans, Hostinger, GitHub, DNS ou HTTPS. A migration 0010 não foi aplicada. O onboarding não processa pagamentos e a confirmação automática não está habilitada; o gate 18+ continua sendo autodeclaração, sem verificação real.

Veja os relatórios completos na pasta `relatorios/` da entrega e os bloqueios de publicação em `docs/PENDENCIAS-PUBLICACAO.md`.
