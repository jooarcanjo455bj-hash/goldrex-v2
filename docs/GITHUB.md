# Passo 3 · GitHub (guardar o código)

> O workspace desta entrega não contém `.git`, remote nem repositório GitHub configurado. As etapas abaixo são instruções para depois; nenhum push foi feito. Crie o repositório como **privado** e não inclua arquivos `.env`, ZIPs de entrega ou backups.

O GitHub guarda **o código**, não os dados. Os dados ficam no Supabase.

1. Crie uma conta em https://github.com e clique em **New repository**. Nome: `goldrex`. Marque **Private** (privado). Não marque "Add README".
2. No VS Code, na pasta do projeto, abra o terminal e rode (troque SEU-USUARIO):
   ```
   git init
   git add .
   git commit -m "GOLDREX v2 com Supabase"
   git branch -M main
   git remote add origin https://github.com/SEU-USUARIO/goldrex.git
   git push -u origin main
   ```
3. **Antes do commit, confira:** o arquivo `.env` NÃO pode ir para o GitHub. O `.gitignore` já o bloqueia. Rode `git status` e confirme que `.env` não aparece na lista.
4. Se a chave `service_role` vazar (foi para o GitHub, mensagem, etc.): no Supabase, **Project Settings > API**, gere uma nova chave e atualize o `.env` (computador e VPS) e rode `pm2 restart goldrex --update-env`.
5. Atualizações futuras: `git add .` > `git commit -m "o que mudou"` > `git push`. Na VPS, rode `bash deploy/atualizar.sh` para publicar (veja docs/HOSTINGER.md).
