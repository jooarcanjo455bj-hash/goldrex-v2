#!/usr/bin/env bash
# Atualiza o GOLDREX na VPS sem perder nada (os dados ficam no Supabase).
# Uso (dentro da pasta do projeto):  bash deploy/atualizar.sh
set -euo pipefail
cd "$(dirname "$0")/.."
git pull --ff-only
npm ci --omit=dev
pm2 startOrReload ecosystem.config.js --update-env
pm2 save
sleep 2
curl -fsS http://127.0.0.1:${PORT:-3000}/healthz && echo "  <- site respondeu OK"
echo "Se esta atualização trouxe um arquivo novo em supabase/migrations/, rode-o no SQL Editor do Supabase."
