'use strict';
/* Pagamento: somente Pix MANUAL. O cliente paga na chave Pix (PIX_KEY) e o administrador confere e confirma em Pedidos. */
const placeholder = v => { v = String(v || '').trim(); return !v || /^TODO_/i.test(v) ? '' : v; };
module.exports = { placeholder };
