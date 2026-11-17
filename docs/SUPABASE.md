# Passo 1 · Supabase (banco, contas e fotos)

Tudo é feito pelo navegador, em https://supabase.com.

## 1. Criar o projeto
1. Crie uma conta e clique em **New project**. Escolha um nome (ex.: goldrex), uma **senha do banco** (guarde) e a região mais próxima (ex.: São Paulo).
2. Espere o projeto ficar pronto.

## 2. Criar as tabelas, regras de segurança e pastas de fotos
1. Menu **SQL Editor** > **New query**.
2. Abra o arquivo `supabase/EXECUTAR-TUDO.sql` deste projeto, copie tudo, cole e clique **Run**. Deve aparecer "Success".
   - Ele cria: contas, perfis, itens (fotos/vídeos), pedidos, pagamentos, autorizações, histórico, configurações, regras RLS, buckets e funções.
   - O consolidado contém **10 migrations ativas** (`0001`–`0007` e `0009`–`0011`). A `0008_asaas_pix.sql` permanece no histórico, mas é excluída do consolidado para que uma instalação nova não crie colunas exclusivas da integração Pix/Asaas. Para um projeto novo, use o consolidado uma vez. Em banco existente, confirme quais migrations já foram aplicadas e aplique apenas as pendentes, em ordem. Antes de qualquer mudança em banco real, faça backup e obtenha autorização; não execute SQL destrutivo. A `0005` adiciona constraints e pode falhar se os dados existentes forem incompatíveis. A `0006` serializa compras concorrentes e limita privilégios de leitura de `items`. A `0007` torna o bucket `previews` privado sem apagar arquivos. As estruturas criadas por migrations históricas já aplicadas, inclusive colunas antigas de pagamentos, permanecem intactas até que haja backup e autorização explícita para removê-las. A `0010` adiciona a tabela `provider_payments`, RLS e a função `apply_provider_payment`; a `0011` remove os restos do Dropfans.
   - Nenhum banco foi acessado ou alterado nesta tarefa. A remoção de colunas/tabelas antigas ligadas a integrações anteriores precisa de inventário, exportação/backup e confirmação explícita; não rode `DROP` por conta própria.
   - Se a importação legada for repetida, ela preserva pedidos `revoked` e grava a autorização histórica revogada. Quando o legado não tiver data/autor da revogação, o importador usa a data de pagamento/criação e o responsável já registrado no pedido; confira esses dados antes da importação.
3. Confira em **Table Editor** (tabelas) e **Storage** (os buckets `previews` e `originals` devem ser **privados**). O servidor valida o gate 18+ e faz o proxy dos arquivos; nenhum bucket de mídia deve ser público.

## 3. Login
Não há configuração de login no Supabase: as contas são do próprio site (usuário e senha), sem e-mail. Você **não precisa** mexer em Authentication.

## 4. Pegar as chaves (Project Settings > API)
| Variável | Onde achar |
|---|---|
| `SUPABASE_URL` | "Project URL" |
| `SUPABASE_SERVICE_ROLE_KEY` | chave **service_role / secret** (**secreta!**) |

Se o painel mostrar "Legacy API keys" (`anon` e `service_role`, começam com `eyJ`), elas são as mais testadas com este projeto. As chaves novas (`sb_publishable_...` / `sb_secret_...`) também são aceitas pelo código, mas **não foram testadas contra o Supabase real** (veja o relatório).
**Nunca** cole a `service_role` em chat, GitHub ou no código. Ela só vai no `.env` (computador) e no `.env` da VPS.

## 5. Administrador
Não usa e-mail. No primeiro acesso a `/ADMIN_PATH` o site pede usuário, senha e repetir a senha (uma vez só).

## 6. Limites do plano gratuito (confira os valores atuais no site do Supabase)
- Projetos sem atividade por cerca de uma semana são pausados (use o monitor `/healthz?db=1`, veja o README).
- Há limite de tamanho de banco, de espaço de arquivos e de tamanho por arquivo (costuma ser 50 MB; vídeos maiores exigem plano pago).
- Faça backup de vez em quando (Database > Backups / exportar as tabelas) e baixe as fotos originais importantes.

## Limpar tudo antes de publicar
`supabase/LIMPAR-TUDO.sql` apaga os dados de teste (contas, pedidos, perfis, fotos cadastradas, configurações). Depois apague os arquivos do Storage (instruções no final do SQL).
