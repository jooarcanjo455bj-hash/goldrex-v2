# Relatório de Auditoria Completa — GOLDREX V2 (versão Pix/QR/Push, 16/11)
Escopo: código local. Sem acesso ao Supabase remoto nem à Hostinger.

## Arquitetura
Node ≥ 20, **zero dependências de produção**. `server.js` + `lib/` (supa, domain, http, util, env, payments, pix, push) + `public/` (site, painel, PWA `sw.js`, QR) + `supabase/` (migrations/EXECUTAR-TUDO). Contas de cliente só com usuário/senha (scrypt), sem Supabase Auth/e-mail. Pagamento: Pix com QR (chave em `PIX_KEY`/painel), admin confirma. Aviso ao admin por Web Push. Tempo real em memória → **1 processo**.

## Problemas encontrados e corrigidos
| # | Problema | Ação |
|---|---|---|
| 1 | `public/recuperar.html` órfão: carrega `/js/recuperar.js` inexistente; rota já devolve 404 | removido |
| 2 | `lib/dropfans.js` sem uso (integração removida pela migration 0011) | removido (cópia em `backups/`) |
| 3 | `icon-192.png`/`icon-512.png` ausentes de `public/` (usados por PWA/notificação; saíram do ZIP por causa do filtro `*.png`) | restaurados |
| 4 | `.env.example` ausente e desatualizado (DropFans/ADMIN_EMAILS) | recriado com as variáveis reais (`ADMIN_SETUP_CODE`, `PIX_*`, `PUSH_CONTACT`…) |
| 5 | Sem testes na árvore; `package.json` sem script de teste | `tests/app.test.js` + `mock-supabase.js` restaurados; `npm test` |
| 6 | Teste antigo desatualizado (texto de boot, 403×409, ícone) | expectativas ajustadas ao comportamento atual (sem enfraquecer validações) |

## Resultados
- `node --check` em todos os .js: OK; todos os `require` resolvem.
- `npm test`: **6/6** (páginas/18+, conta usuário+senha, compra Pix + confirmação + liberação, recusa/remoção de acesso, criptografia Web Push RFC 8291, inscrição push do admin).
- Boot em produção (env completo): OK; `/healthz` 200; `/.env`, `/lib`, `/supabase`, `/backups`, `/package.json` → 404; POST com Origin estranho → 403.
- Não executado: teste de UI no navegador; `npm audit` (sem rede, sem deps de produção); qualquer teste contra Supabase real.

## Pendências
- Migrations com numeração duplicada no histórico (`0010_dropfans`/`0010_pagamentos`, `0011_dropfans_webhooks`/`0011_remover_dropfans`). `EXECUTAR-TUDO.sql` já cria e remove o DropFans; em banco **novo** use só ele. Em banco **existente** não reaplique nada sem conferir.
- `0012_contas_sem_email.sql` e `0011_remover_dropfans.sql` precisam estar aplicados no banco remoto (verificar).
- Pasta `backups/` (dezenas de cópias) e `ENTREGA-GOLDREX-V2/` não devem ser publicadas.

Totais: 8 problemas/riscos · 6 corrigidos · 2 críticos pendentes (rotação de chaves; criar admin).
