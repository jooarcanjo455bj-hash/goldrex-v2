'use strict';
/* Pix "copia e cola" (BR Code estático, padrão do Banco Central). O QR Code é desenhado no navegador a partir deste texto. */
const clean = (v, n) => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9 .\-]/g, '').trim().toUpperCase().slice(0, n);
const f = (id, v) => id + String(v.length).padStart(2, '0') + v;
function crc16(s) {
  let c = 0xFFFF;
  for (let i = 0; i < s.length; i++) { c ^= s.charCodeAt(i) << 8; for (let k = 0; k < 8; k++) c = c & 0x8000 ? ((c << 1) ^ 0x1021) & 0xFFFF : (c << 1) & 0xFFFF; }
  return c.toString(16).toUpperCase().padStart(4, '0');
}
/* cfg: { key, receiver, city }; cents: valor em centavos; txid: código do pedido (letras e números) */
function payload(cfg, cents, txid) {
  const key = String(cfg.key || '').trim(); if (!key) return '';
  const amount = cents > 0 ? (cents / 100).toFixed(2) : '';
  const id = String(txid || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 25) || '***';
  const p = f('00', '01') + f('01', amount ? '12' : '11') + f('26', f('00', 'br.gov.bcb.pix') + f('01', key)) + f('52', '0000') + f('53', '986') + (amount ? f('54', amount) : '') + f('58', 'BR') + f('59', clean(cfg.receiver, 25) || 'RECEBEDOR') + f('60', clean(cfg.city, 15) || 'BRASIL') + f('62', f('05', id)) + '6304';
  return p + crc16(p);
}
module.exports = { payload, crc16 };
