/* Regras de dados do GOLDREX: configurações, mapeadores (linha do banco -> formato que o site já usa), pedidos e contas. */
const { inn } = require('./supa');
const { id: rid } = require('./util');

const SITE = { brand: 'GOLDREX', welcome: 'Explore o meu universo', cover: '', accent: '#8b3dff', gold: '#d4af37', bg: '#07030c', areas: { fotos: true, videos: true }, counters: false,
  howto: '1. Escolha uma foto ou vídeo e toque em Comprar.\n2. Pague o valor por Pix na chave que aparece.\n3. Toque em "Já paguei".\n4. Assim que o pagamento for conferido, o conteúdo aparece em Compras.' };
const clone = o => o === undefined ? undefined : JSON.parse(JSON.stringify(o));
const ms = t => t ? Date.parse(t) : null, iso = t => new Date(t).toISOString();

module.exports = function createDomain({ supa, env }) {
  const { db } = supa;

  /* ---------- configurações (tabela settings; cache curto só para aliviar leituras) ---------- */
  const DEFAULTS = () => ({ site_live: clone(SITE), site_draft: clone(SITE), pix: null, door: null });
  const cache = new Map(), TTL = 8000;
  async function settings(keys) {
    const need = keys.filter(k => { const c = cache.get(k); return !c || Date.now() - c.t > TTL; });
    if (need.length) {
      const rows = await db.get('settings', { key: inn(need) }), def = DEFAULTS();
      need.forEach(k => { const r = rows.find(x => x.key === k); cache.set(k, { v: r ? r.value : def[k], t: Date.now() }); });
    }
    const out = {}; keys.forEach(k => out[k] = clone(cache.get(k).v)); return out;
  }
  const setting = async k => (await settings([k]))[k];
  async function putSetting(key, value) {
    await db.insert('settings', [{ key, value, updated_at: new Date().toISOString() }], { upsert: true, onConflict: 'key' });
    cache.set(key, { v: clone(value), t: Date.now() });
  }

  /* ---------- histórico de operações ---------- */
  const audit = (actor, action, detail) => db.insert('audit_log', [{ actor: String(actor || 'sistema'), action, detail: String(detail || '').slice(0, 300) }])
    .catch(e => console.error('aviso: não foi possível gravar no histórico:', e.message));
  const orderEvent = (orderId, from, to, by, note) => db.insert('order_events', [{ order_id: orderId, from_status: from || null, to_status: to, by: by || '', note: String(note || '').slice(0, 200) }])
    .catch(e => console.error('aviso: evento do pedido não gravado:', e.message));

  /* ---------- mapeadores ---------- */
  const toProfile = r => ({ id: r.id, name: r.name, user: r.username, bio: r.bio, avatar: r.avatar, verified: r.verified, published: r.published });
  const prPub = p => ({ id: p.id, name: p.name, user: p.user, bio: p.bio, avatar: p.avatar, verified: p.verified });
  const toItem = r => ({ id: r.id, profileId: r.profile_id, type: r.type, file: String(r.original_file).split(',')[0], files: String(r.original_file).split(',').filter(Boolean), bio: r.bio || '', createdAt: ms(r.created_at), title: r.title, price: r.price_cents, preview: r.preview, cover: r.cover, teaser: r.teaser, duration: r.duration, published: r.published });
  const iPub = i => ({ id: i.id, type: i.type, title: i.title, bio: i.bio, count: i.files.length, price: i.price, preview: i.preview, cover: i.cover, teaser: i.teaser, duration: i.duration, isNew: Date.now() - i.createdAt < 7 * 864e5 });
  const toOrder = r => ({ id: r.id, code: r.code, token: r.token, accountId: r.account_id, email: r.email, type: r.type, itemId: r.item_id, serviceId: r.service_id, slotId: r.slot_id, slotAt: ms(r.slot_at), notes: r.notes, price: r.price_cents, status: r.status, createdAt: ms(r.created_at), paidAt: ms(r.paid_at), by: r.paid_by, note: r.note });

  const brl = c => 'R$ ' + (c / 100).toFixed(2).replace('.', ',');
  const newCode = () => rid(6).toUpperCase();/* 12 caracteres (48 bits) */

  /* o pedido como o site o mostra ao cliente. */
  function orderOut(o, { item, authorized, signMedia }) {
    const title = item ? item.title : '(item removido)';
    const r = { code: o.code, token: o.token, type: o.type, status: o.status, title, price: o.price, createdAt: o.createdAt, kind: item ? item.type : '', preview: item ? item.preview : '', cover: item ? item.cover : '', paymentUrl: '/pagamento/' + o.token };
    if (o.status === 'paid' && item && authorized) { const e = Date.now() + 4 * 3600e3; const mu = signMedia(item.id, o.id, e); r.media = { url: mu, urls: item.files.map((_, n) => mu + '&n=' + n), kind: item.type }; }
    return r;
  }

  return { SITE, clone, ms, iso, brl, settings, setting, putSetting, audit, orderEvent, toProfile, prPub, toItem, iPub, toOrder, newCode, orderOut };
};
