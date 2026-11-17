# Passo 4 · Hostinger (manter o site no ar)

> Antes de publicar, leia [PENDENCIAS-PUBLICACAO.md](PENDENCIAS-PUBLICACAO.md) (verificação de idade, consentimento, termos).

O GOLDREX é um app **Node.js**. Hospedagem compartilhada comum (só PHP) **não serve**: use uma **VPS** da Hostinger (Ubuntu 22.04 ou 24.04). O que aparece como "Hospedagem de apps Node" em alguns planos também funciona, mas o passo a passo abaixo é o da VPS.

> Antes de pagar, confirme com o suporte da Hostinger que o seu tipo de conteúdo é aceito e leia os Termos de Serviço atuais (regras de conduta). A página de ajuda deles sobre conteúdo adulto tem anos e pode ter mudado. Conteúdo ilegal e qualquer envolvimento de menores são proibidos em qualquer hospedagem.

O servidor **não guarda nada importante**: contas, fotos e compras ficam no Supabase. Reiniciar, atualizar ou trocar de VPS não perde nada.

## 1. Preparar a VPS
Entre por SSH (`ssh root@IP-DA-VPS`) e rode:

```bash
apt update && apt upgrade -y
adduser goldrex                      # usuário comum, para não rodar o site como root
usermod -aG sudo goldrex
# Node.js 22 (o projeto exige 20 ou mais)
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs nginx git ufw certbot python3-certbot-nginx
npm install -g pm2
# Firewall: só SSH e site
ufw allow OpenSSH && ufw allow "Nginx Full" && ufw --force enable
```

Daqui em diante, entre como o novo usuário: `su - goldrex`.

## 2. Domínio
No painel do domínio (Hostinger ou outro), crie um registro **A** apontando `seudominio.com.br` e `www` para o **IP da VPS**. Espere propagar (alguns minutos).

## 3. Subir o código
```bash
git clone https://github.com/SEU-USUARIO/goldrex.git ~/goldrex     # repositório privado: use um token ou chave SSH (docs/GITHUB.md)
cd ~/goldrex
npm ci --omit=dev
cp .env.example .env
nano .env
chmod 600 .env
```

No `.env` de produção preencha (modelo completo em `COMECE-AQUI.md`):

```
NODE_ENV=production
HTTPS=true
TRUST_PROXY=true
HOST=127.0.0.1
PORT=3000
SITE_URL=https://seudominio.com.br
ADMIN_PATH=/algo-que-so-voce-sabe
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
APP_SECRET=            # openssl rand -hex 32 (use SEMPRE o mesmo)
PIX_KEY=
PIX_RECEIVER_NAME=
PUSH_CONTACT=seu@email.com
```

`HOST=127.0.0.1` faz o app aceitar conexões só do Nginx (ninguém acessa a porta 3000 direto pela internet).

## 4. Ligar o site com PM2
```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup            # ele mostra UM comando "sudo env PATH=..." : copie e rode esse comando
curl http://127.0.0.1:3000/healthz     # deve responder {"ok":1}
pm2 logs goldrex       # mensagens de configuração (variável faltando, Supabase inacessível)
```
Mantenha **uma única instância**.

## 5. Nginx + HTTPS
```bash
sudo cp deploy/nginx-goldrex.conf /etc/nginx/sites-available/goldrex
sudo nano /etc/nginx/sites-available/goldrex        # troque SEUDOMINIO.com.br pelo seu domínio (3 lugares)
sudo ln -s /etc/nginx/sites-available/goldrex /etc/nginx/sites-enabled/goldrex
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d seudominio.com.br -d www.seudominio.com.br
```
O Certbot instala o certificado e renova sozinho. O arquivo do Nginx já traz o que o GOLDREX precisa: limite de envio de **64 MB** (vídeos; sem isso aparece o erro 413), prazos longos para envios e para o chat em tempo real, e repasse do IP real do visitante.
Se você aumentar `MAX_UPLOAD_MB` no `.env`, aumente também `client_max_body_size` no Nginx.

## 6. Conferir
Abra `https://seudominio.com.br`, passe pela tela 18+, crie uma conta de teste, depois abra o painel (`ADMIN_PATH`) e crie o acesso do administrador. Faça uma compra de teste e confirme em **Pedidos**. Quando estiver tudo certo, rode `supabase/LIMPAR-TUDO.sql` e apague os arquivos de teste.

## Atualizar o site sem perder dados
Na VPS, dentro da pasta do projeto:
```bash
bash deploy/atualizar.sh
```
Ele faz `git pull`, `npm install`, recarrega o PM2 e confere o `/healthz`. Se a atualização trouxer um arquivo novo em `supabase/migrations/`, rode-o no SQL Editor do Supabase.

## Supabase gratuito pausando
A VPS não "dorme". Mas o Supabase gratuito pode **pausar o projeto após cerca de uma semana sem uso**. Um monitor gratuito (UptimeRobot, por exemplo) acessando `https://seudominio.com.br/healthz?db=1` a cada 5 a 10 minutos evita isso e ainda avisa se o site cair. Confira as regras atuais do plano no site do Supabase.

## Pagamento
Só Pix manual: preencha `PIX_KEY` e `PIX_RECEIVER_NAME` no `.env`. O cliente paga, toca em "Já paguei" e você confirma em **Pedidos** (o celular recebe notificação).

## Se algo der errado
- **Site não abre / 502**: `pm2 status` e `pm2 logs goldrex`. Se estiver parado, leia a mensagem (normalmente falta uma variável).
- **"Faltam variáveis de ambiente"**: confira o passo 3 (o `.env` precisa estar na pasta do projeto).
- **Erro 413 ao enviar vídeo**: o `client_max_body_size` do Nginx está menor que o arquivo.
- **Certificado não sai**: o registro A do domínio ainda não propagou, ou a porta 80 está bloqueada no firewall da VPS.
- **Esqueceu a senha do painel**: no servidor, `npm run reset-admin` (digite SIM) e crie o acesso de novo.
- **Notificação não chega**: o site precisa estar em HTTPS; no iPhone, só funciona pelo ícone na Tela de Início.
- **Todos os visitantes aparecem com o mesmo IP** (bloqueio de tentativas pega todo mundo): `TRUST_PROXY` precisa ser `true` e o Nginx precisa estar na frente.
- Mexeu no `.env`? `pm2 restart goldrex --update-env`.
