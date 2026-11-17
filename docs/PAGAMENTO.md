# Pagamento (GOLDREX)

Escolha pelo `.env`: `PAY_PROVIDER=manual` (padrão) ou `PAY_PROVIDER=cloud`.

## Modo manual (funciona já)
1. Preencha `PIX_KEY` (e `PIX_RECEIVER_NAME`, opcional) no `.env`.
2. O cliente toca em Comprar, vê o valor, a referência `GR<código>` e a chave Pix com botão **Copiar**.
3. Você confere o Pix recebido e confirma em **Compras** no painel. O conteúdo é liberado na hora.

## Modo cloud (confirmação automática)
Tudo que depende do contrato do app Cloud está em `lib/payments.js`, nos pontos marcados **CONTRATO CLOUD**:
1. **Assinatura do webhook** (`verifyWebhookSignature`): hoje HMAC-SHA256 hexadecimal do corpo bruto, no cabeçalho definido em `PAY_SIGNATURE_HEADER`.
2. **Formato do evento** (`parseWebhookEvent`): hoje `{ id, type, data: { reference, amountCents, transactionId } }` com `type` = `payment.paid`, `payment.refunded` ou `payment.chargeback`.
3. **Criação da cobrança** (`createCharge`): ainda não implementada; precisa do endpoint oficial. Sem ela, a página mostra a chave Pix e o webhook confirma o pagamento.

Para ativar:
1. Peça ao Cloud: chave de API, segredo do webhook, ambiente de teste e a documentação dos 3 pontos acima.
2. Ajuste `lib/payments.js` se o contrato for diferente do assumido.
3. No `.env` da VPS: `PAY_PROVIDER=cloud`, `PAY_API_KEY`, `PAY_WEBHOOK_SECRET`, `PAY_SIGNATURE_HEADER`.
4. Cadastre no painel do Cloud: `https://SEU-DOMINIO/api/webhook/pagamento`.
5. `pm2 restart goldrex`, faça uma compra de valor baixo e um reembolso de teste.

Segurança: o webhook rejeita assinatura inválida, valor diferente do pedido e evento repetido. Com `cloud` ativo, o administrador não confirma pagamento na mão (só o webhook).
