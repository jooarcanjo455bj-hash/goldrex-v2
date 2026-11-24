/* Regras de dados do GOLDREX: configurações, mapeadores (linha do banco -> formato que o site já usa), pedidos e contas. */
const { eq, isNull, inn } = require('./supa');
const { id: rid } = require('./util');

const SITE = { brand: 'GOLDREX', welcome: 'Explore o meu universo', cover: '', accent: '#8b3dff', gold: '#d4af37', bg: '#07030c', areas: { fotos: true, videos: true, live: false, chat: false }, counters: true,
  howto: '1. Escolha um item e toque em Comprar.\n2. Confira o valor e abra a página de pagamento.\n3. O conteúdo é liberado depois que o pagamento for confirmado.\n4. A página DropFans abre somente o cadastro de comerciante (KYC), não uma cobrança. A confirmação automática aguarda a documentação oficial.' };
const back = [{ label: 'Voltar ao início', next: 'start' }];
const ROBOT = { enabled: true, humanAvailable: false, start: 'start', msgPaid: 'Pagamento confirmado! Seu conteúdo foi liberado.', msgHuman: 'Conversa encaminhada para um atendente. Aguarde a resposta por aqui.', msgNoHuman: 'Nenhum atendente está disponível agora. Deixe sua mensagem aqui: ela fica registrada e será respondida assim que possível.', msgFallback: 'Não consegui entender. Escolha uma das opções abaixo ou fale com um atendente.',
  nodes: { start: { text: 'Olá! Eu sou o assistente automático da Goldrex. Como posso ajudar?', options: [{ label: 'Quero ver fotos', next: 'fotos' }, { label: 'Quero ver vídeos', next: 'videos' }, { label: 'Serviços ao vivo', next: 'live' }, { label: 'Ver preços', next: 'prices' }, { label: 'Falar com atendente', next: 'human' }] },
    fotos: { text: 'As fotos são vendidas uma a uma, cada uma com o seu preço e uma prévia borrada. Quer abrir o catálogo de fotos?', go: 'fotos', options: back },
    videos: { text: 'Os vídeos também têm preço individual e mostram uma prévia borrada antes da compra. Quer abrir o catálogo de vídeos?', go: 'videos', options: back },
    live: { text: 'As modalidades ao vivo ficam disponíveis enquanto estiverem ativas. Você escolhe uma, informa suas preferências e confere o valor antes de solicitar. Quer ver as modalidades?', go: 'live', options: back },
    prices: { type: 'prices', text: 'Estes são os valores cadastrados no momento:', options: back },
    human: { type: 'human', text: '', options: back } } };

const clone = o => JSON.parse(JSON.stringify(o));
const ms = t => t ? Date.parse(t) : null, iso = t => new Date(t).toISOString();

module.exports = function createDomain({ supa, env }) {
  const { db } = supa;

  /* ---------- configurações (tabela settings; cache curto só para aliviar leituras) ---------- */
  const DEFAULTS = () => ({ site_live: clone(SITE), site_draft: clone(SITE), robot: clone(ROBOT), live_loop: { url: '', on: true }, door: null });
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
  const toItem = r => ({ id: r.id, profileId: r.profile_id, type: r.type, file: r.original_file, createdAt: ms(r.created_at), title: r.title, price: r.price_cents, preview: r.preview, cover: r.cover, teaser: r.teaser, duration: r.duration, published: r.published, dropfansProductId: r.dropfans_product_id || '', dropfansAmountCents: r.dropfans_amount_cents || null });
  const iPub = i => ({ id: i.id, type: i.type, title: i.title, price: i.price, preview: i.preview, cover: i.cover, teaser: i.teaser, duration: i.duration, isNew: Date.now() - i.createdAt < 7 * 864e5 });
  const toService = (r, slots) => ({ id: r.id, name: r.name, desc: r.description, price: r.price_cents, duration: r.duration_min, conditions: r.conditions, active: r.active, slots: (slots || []).filter(s => s.service_id === r.id).map(s => ({ id: s.id, at: ms(s.at), orderId: s.order_id })) });
  const freeSlots = s => s.slots.filter(x => !x.orderId && x.at > Date.now()).sort((a, b) => a.at - b.at);
  const svPub = s => ({ id: s.id, name: s.name, desc: s.desc, price: s.price, duration: s.duration, conditions: s.conditions });
  const toOrder = r => ({ id: r.id, code: r.code, token: r.token, accountId: r.account_id, email: r.email, type: r.type, itemId: r.item_id, serviceId: r.service_id, slotId: r.slot_id, slotAt: ms(r.slot_at), notes: r.notes, price: r.price_cents, status: r.status, createdAt: ms(r.created_at), paidAt: ms(r.paid_at), by: r.paid_by, note: r.note });
  const toChat = r => ({ cid: r.cid, id: r.id, email: r.email, mode: r.mode, status: r.status, msgs: r.msgs || [], stack: r.stack || [], updated: ms(r.updated_at) });

  const brl = c => 'R$ ' + (c / 100).toFixed(2).replace('.', ',');
  const newCode = () => rid(6).toUpperCase();/* 12 caracteres (48 bits) */

  /* o pedido como o site o mostra ao cliente. */
  function orderOut(o, { item, service, authorized, signMedia }) {
    const title = o.type === 'item' ? (item ? item.title : '(item removido)') : (service ? service.name : 'Serviço ao vivo');
    const r = { code: o.code, token: o.token, type: o.type, status: o.status, title, price: o.price, createdAt: o.createdAt, kind: item ? item.type : 'live', preview: item ? item.preview : '', cover: item ? item.cover : '', paymentUrl: '/pagamento/' + o.token };
    if (o.type === 'live' && service) { r.slotAt = o.slotAt; r.duration = service.duration; r.conditions = service.conditions; r.notes = o.notes; }
    if (o.status === 'paid' && item && authorized) { const e = Date.now() + 4 * 3600e3; r.media = { url: signMedia(item.id, o.id, e), kind: item.type }; }
    return r;
  }

  /* ---------- contas ---------- */
  const confirmed = u => !!(u && (u.email_confirmed_at || u.confirmed_at));
  async function ensureAccount(user) {
    const email = String(user.email || '').toLowerCase();
    let a = await db.one('accounts', { id: eq(user.id) });
    if (!a) { [a] = await db.insert('accounts', [{ id: user.id, email }], { upsert: true, onConflict: 'id' }); }
    return a;
  }
  /* pedidos antigos (importados) feitos com o mesmo e-mail passam a aparecer na conta — só se o e-mail foi confirmado */
  const linkLegacyOrders = async (user, account) => {
    if (!confirmed(user)) return;
    const email = String(account.email || '').toLowerCase();
    if (!email) return;
    await db.patch('orders', { email: eq(email), account_id: isNull }, { account_id: account.id });
    const linked = await db.get('orders', { email: eq(email), account_id: eq(account.id), status: eq('paid'), type: eq('item') });
    for (const order of linked) {
      if (!order.item_id) continue;
      await db.patch('authorizations', { order_id: eq(order.id), account_id: isNull, item_id: eq(order.item_id), email: eq(email) }, { account_id: account.id });
    }
  };

  return { SITE, ROBOT, clone, ms, iso, brl, settings, setting, putSetting, audit, orderEvent, toProfile, prPub, toItem, iPub, toService, freeSlots, svPub, toOrder, toChat, newCode, orderOut, ensureAccount, linkLegacyOrders, confirmed };
};
