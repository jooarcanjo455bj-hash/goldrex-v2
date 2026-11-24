/* GOLDREX · servidor
   Dados: Supabase (banco Postgres + Auth + Storage). Este servidor NÃO guarda nada importante no disco:
   pode ser reiniciado, atualizado ou trocado de máquina sem perder contas, fotos, compras ou pagamentos. */
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
require('./lib/env')(__dirname);
const { createSupa, SupaError, eq, lt, gt, isNull, inn } = require('./lib/supa');
const { verifyWebhookSignature, parseWebhookEvent, parsePaymentEvent, createCheckoutLink } = require('./lib/dropfans');
const createDomain = require('./lib/domain');
const { id: rid, hash, eq: teq } = require('./lib/util');
const H = require('./lib/http'), { J, bad, body, cookie, addCookie, mkCookie, limited, isBlocked, strike, clearStrike, MIME, sendFile, pipeUpstream } = H;

const E = process.env, PORT = +E.PORT || 3000, HOST = String(E.HOST || '').trim(), MAXUP = (+E.MAX_UPLOAD_MB || 50) * 1048576, SECURE = E.HTTPS === 'true';
const DROP_API_BASE = E.NODE_ENV === 'test' && E.DROPFANS_API_BASE ? E.DROPFANS_API_BASE : 'https://www.dropfans.io';
const STABLE_SECRET = typeof E.APP_SECRET === 'string' && E.APP_SECRET.length >= 32;
const ADMIN_PATH = '/' + (String(E.ADMIN_PATH || '/admin').replace(/^\/+|\/+$/g, '').replace(/[^\w\-\/]/g, '') || 'admin');
const PUB = path.join(__dirname, 'public'), TMP = path.join(os.tmpdir(), 'goldrex-uploads');
const logErr = (w, e) => console.error('[' + new Date().toISOString() + '] ' + w + ': ' + ((e && (e.stack || e.message)) || e));

/* ---------- configuração obrigatória ---------- */
const missing = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'].filter(k => !E[k]);
if (missing.length) { console.error('\nFaltam variáveis de ambiente: ' + missing.join(', ') + '\nCopie .env.example para .env (local) ou cadastre-as no .env da VPS. Veja docs/SUPABASE.md e docs/HOSTINGER.md.\n'); process.exit(1); }
if (E.NODE_ENV === 'production' && !/^https:\/\/[^/\s]+$/.test(String(E.SITE_URL || '').replace(/\/+$/, ''))) { console.error('\nEm produção, defina SITE_URL com o endereço público do site, começando com https:// (ex.: https://seudominio.com.br). Ele é usado nos links dos e-mails de confirmação e recuperação de senha.\n'); process.exit(1); }
let SECRET = E.APP_SECRET;
if (!SECRET || SECRET.length < 32) {
  if (E.NODE_ENV === 'production') { console.error('\nDefina APP_SECRET (mín. 32 caracteres) no ambiente de produção. Sem ele os links de conteúdo deixariam de valer a cada reinício.\n'); process.exit(1); }
  SECRET = rid(32); console.warn('AVISO: APP_SECRET não definido; usando um segredo temporário (links de conteúdo expiram ao reiniciar). Defina APP_SECRET no .env.');
}
fs.mkdirSync(TMP, { recursive: true });
try { fs.readdirSync(TMP).forEach(n => { try { fs.unlinkSync(path.join(TMP, n)); } catch { } }); } catch { }

const supa = createSupa({ url: E.SUPABASE_URL, anonKey: E.SUPABASE_ANON_KEY, serviceKey: E.SUPABASE_SERVICE_ROLE_KEY });
const T = supa.db, D = createDomain({ supa, env: E });
const { settings, setting, putSetting, audit, orderEvent, toProfile, prPub, toItem, iPub, toService, svPub, toOrder, toChat, brl, ms, iso } = D;
const sign = s => crypto.createHmac('sha256', SECRET).update(s).digest('hex').slice(0, 32);
const signedCookieSignature = (name, payload) => crypto.createHmac('sha256', SECRET).update(name + '.' + payload).digest('hex');
function setSignedCookie(res, name, value, maxAge) {
  const payload = Buffer.from(JSON.stringify(value)).toString('base64url');
  addCookie(res, mkCookie(name, payload + '.' + signedCookieSignature(name, payload), maxAge, SECURE));
}
function readSignedCookie(req, name) {
  const token = cookie(req, name);
  if (!token || token.length > 4096) return null;
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra !== undefined || !/^[a-f0-9]{64}$/i.test(signature)) return null;
  const expected = Buffer.from(signedCookieSignature(name, payload), 'hex'), actual = Buffer.from(signature, 'hex');
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;
  try {
    const value = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return value && Number.isSafeInteger(value.exp) && value.exp > Date.now() ? value : null;
  } catch { return null; }
}
const TERMS_COOKIE = 'age', TERMS_TTL = 30 * 86400;
const hasTermsConsent = req => {
  const consent = readSignedCookie(req, TERMS_COOKIE);
  return !!(consent && consent.purpose === 'terms-v1' && consent.accepted === true);
};
const setTermsConsent = res => setSignedCookie(res, TERMS_COOKIE, { purpose: 'terms-v1', accepted: true, exp: Date.now() + TERMS_TTL * 1000 }, TERMS_TTL);
const clearOAuthCookie = res => addCookie(res, mkCookie('gr_oauth', '', 0, SECURE));
const safeEqualText = (a, b) => {
  const left = Buffer.from(String(a || '')), right = Buffer.from(String(b || ''));
  return left.length === right.length && left.length > 0 && crypto.timingSafeEqual(left, right);
};
const ADMIN_COOKIE = 'gr_admin', ADMIN_TTL = 12 * 60 * 60, ADMIN_REMEMBER_TTL = 30 * 24 * 60 * 60;
const ADMIN_SCRYPT_PARAMS = Object.freeze({ N: 16384, r: 8, p: 1, keylen: 64 });
const usernamePattern = /^[a-z0-9._-]{3,32}$/;
const normalizeAdminUsername = value => {
  const username = String(value == null ? '' : value).trim().toLowerCase();
  return usernamePattern.test(username) ? username : '';
};
const deriveAdminHash = (password, salt, params = ADMIN_SCRYPT_PARAMS) => new Promise((resolve, reject) => {
  crypto.scrypt(password, Buffer.from(salt, 'hex'), params.keylen, {
    N: params.N, r: params.r, p: params.p, maxmem: 64 * 1024 * 1024
  }, (error, derived) => error ? reject(error) : resolve(derived));
});
const validAdminCredential = value => !!(
  value && typeof value === 'object' &&
  normalizeAdminUsername(value.user) === value.user &&
  /^[a-f0-9]{32}$/i.test(value.salt || '') &&
  /^[a-f0-9]{128}$/i.test(value.hash || '') &&
  value.params && value.params.N === ADMIN_SCRYPT_PARAMS.N &&
  value.params.r === ADMIN_SCRYPT_PARAMS.r &&
  value.params.p === ADMIN_SCRYPT_PARAMS.p &&
  value.params.keylen === ADMIN_SCRYPT_PARAMS.keylen &&
  typeof value.created_at === 'string' && Number.isFinite(Date.parse(value.created_at))
);
const makeAdminCredential = async (username, password, createdAt = new Date().toISOString()) => {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = await deriveAdminHash(password, salt);
  return { user: username, salt, hash: hash.toString('hex'), params: { ...ADMIN_SCRYPT_PARAMS }, created_at: createdAt };
};
async function verifyAdminCredential(credential, username, password) {
  if (!validAdminCredential(credential)) return false;
  const actual = await deriveAdminHash(password, credential.salt, credential.params);
  const expected = Buffer.from(credential.hash, 'hex');
  const hashMatches = actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  return hashMatches && username === credential.user;
}
const adminCredentialRow = () => T.one('settings', { key: eq('admin_credential') });
const adminSignature = payload => crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
function setAdminCookie(res, credential, remember = false) {
  const ttl = remember ? ADMIN_REMEMBER_TTL : ADMIN_TTL;
  const payload = Buffer.from(JSON.stringify({
    user: credential.user, version: credential.created_at, exp: Date.now() + ttl * 1000
  })).toString('base64url');
  addCookie(res, mkCookie(ADMIN_COOKIE, payload + '.' + adminSignature(payload), ttl, SECURE));
}
function clearAdminCookie(res) { addCookie(res, mkCookie(ADMIN_COOKIE, '', 0, SECURE)); }
function parseAdminCookie(req, credential) {
  if (!STABLE_SECRET || !validAdminCredential(credential)) return null;
  const token = cookie(req, ADMIN_COOKIE);
  if (!token || token.length > 2048) return null;
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra !== undefined || !/^[a-f0-9]{64}$/i.test(signature)) return null;
  const expected = Buffer.from(adminSignature(payload), 'hex'), actual = Buffer.from(signature, 'hex');
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (data.user !== credential.user || data.version !== credential.created_at ||
        !Number.isSafeInteger(data.exp) || data.exp <= Date.now()) return null;
    return { username: data.user, remember: data.exp - Date.now() > ADMIN_TTL * 1000 };
  } catch { return null; }
}
const signMedia = (itemId, orderId, e) => `/media/i/${itemId}?o=${orderId}&e=${e}&s=${sign(itemId + orderId + e)}`;
async function openPrivateMedia(bucket, key, range) {
  try { return await supa.storage.openPrivate(bucket, key, range); }
  catch (e) {
    if (e instanceof SupaError && e.status === 400 && /object not found/i.test(e.message)) return new Response(null, { status: 404 });
    throw e;
  }
}

/* ---------- tempo real (conexões abertas ficam na memória; é só um aviso, o dado real está no banco) ---------- */
const sse = { users: new Map(), admins: new Set() };
const push = (set, ev) => { if (set) set.forEach(r => { try { r.write('data: ' + JSON.stringify(ev) + '\n\n'); } catch { } }); };
const stream = (req, res, set, cap = 50, done) => { if (set.size >= cap) { res.writeHead(429, { 'Content-Type': 'text/plain' }); return res.end('429'); } res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' }); res.write(': ok\n\n'); set.add(res); const hb = setInterval(() => { try { res.write(': hb\n\n'); } catch { } }, 25000); let ended = false; const end = () => { if (ended) return; ended = true; clearInterval(hb); set.delete(res); if (done) done(); }; req.on('close', end); res.on('error', end); };

const HOPS = Math.max(1, Math.floor(+E.TRUSTED_PROXY_HOPS) || 1);
const ipOf = req => { const sock = req.socket.remoteAddress || ''; if (E.TRUST_PROXY !== 'true') return sock; const xs = String(req.headers['x-forwarded-for'] || '').split(',').map(x => x.trim()).filter(Boolean), v = xs.length ? xs[Math.max(0, xs.length - HOPS)] : ''; return /^[0-9a-f:.]{3,45}$/i.test(v) ? v : sock; };
const S = (v, n = 200) => String(v == null ? '' : v).trim().slice(0, n), mail = v => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), mask = e => { const [u, d] = String(e || '').split('@'); return d ? u.slice(0, 2) + '***@' + d : e; };
const adminUsername = normalizeAdminUsername;
const adminPassword = value => typeof value === 'string' ? value : '';
const sid = v => /^\w{1,40}$/.test(String(v)) ? String(v) : '';
const up = u => { u = S(u, 200); return /^\/uploads\/[\w.\-]{1,100}$/.test(u) && !u.includes('..') ? u : ''; };
const publicSite = input => {
  const x = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const color = /^#[0-9a-fA-F]{6}$/;
  const areas = x.areas && typeof x.areas === 'object' && !Array.isArray(x.areas) ? x.areas : {};
  return {
    brand: S(x.brand || 'GOLDREX', 120),
    welcome: S(x.welcome || 'Explore o meu universo', 120),
    cover: up(x.cover),
    accent: typeof x.accent === 'string' && color.test(x.accent) ? x.accent : '#8b3dff',
    gold: typeof x.gold === 'string' && color.test(x.gold) ? x.gold : '#d4af37',
    bg: typeof x.bg === 'string' && color.test(x.bg) ? x.bg : '#07030c',
    areas: {
      fotos: areas.fotos === true,
      videos: areas.videos === true,
      // desativados: o painel nao mostra clientes, entao nao ha tela para atender chat nem gerenciar ao vivo
      live: false,
      chat: false
    },
    counters: x.counters === true,
    howto: S(x.howto || '', 3000)
  };
};
const cl = v => { v = Math.round(+v || 0); return Number.isFinite(v) ? Math.min(Math.max(0, v), 1e8) : 0; };
const baseUrl = req => (E.SITE_URL || ((req.headers['x-forwarded-proto'] || (req.socket.encrypted ? 'https' : 'http')).toString().split(',')[0] + '://' + (req.headers.host || 'localhost'))).replace(/\/+$/, '');

/* ---------- mensagens de erro de login em português ---------- */
function authMsg(e) {
  const m = String(e.message || ''), c = (e.body && (e.body.error_code || e.body.code)) || '';
  if (/invalid login credentials/i.test(m) || c === 'invalid_credentials') return 'E-mail ou senha incorretos.';
  if (/not confirmed/i.test(m) || c === 'email_not_confirmed') return 'Confirme seu e-mail pelo link que enviamos antes de entrar.';
  if (/already registered/i.test(m) || c === 'user_already_exists' || c === 'email_exists') return 'Este e-mail já tem conta. Entre ou use "Esqueci a senha".';
  if (c === 'weak_password' || (/password/i.test(m) && /(short|least|weak|characters)/i.test(m))) return 'Senha fraca: use pelo menos 8 caracteres.';
  if (e.status === 429 || c === 'over_email_send_rate_limit') return 'Muitas tentativas. Aguarde alguns minutos.';
  return 'Não foi possível concluir. Tente novamente.';
}

/* ---------- sessão (Supabase Auth em cookies HttpOnly) ---------- */
const sess = new Map();/* access_token -> {user, account, exp}: cache curto para não consultar o Auth a cada requisição */
const setAuthCookies = (res, t) => { addCookie(res, mkCookie('gr_at', t.access_token, 7 * 864e2, SECURE)); addCookie(res, mkCookie('gr_rt', t.refresh_token, 30 * 864e2, SECURE)); };
const clearAuthCookies = res => { addCookie(res, mkCookie('gr_at', '', 0, SECURE)); addCookie(res, mkCookie('gr_rt', '', 0, SECURE)); };
async function adminSessionOf(req, credential) {
  const session = parseAdminCookie(req, credential);
  return session ? { ...session, role: 'admin' } : null;
}
async function sessionOf(req, res) {
  const at = cookie(req, 'gr_at'), rt = cookie(req, 'gr_rt'); if (!at && !rt) return null;
  const c = at && sess.get(at); if (c && c.exp > Date.now()) return c;
  let user = null, fresh = null;
  if (at) { try { user = await supa.auth.getUser(at); } catch (e) { if (!(e instanceof SupaError) || e.status === 0 || e.status >= 500) throw e; } }
  if (!user && rt) { try { fresh = await supa.auth.refresh(rt); user = fresh.user; } catch (e) { if (!(e instanceof SupaError) || e.status === 0 || e.status >= 500) throw e; } }
  if (!user) { clearAuthCookies(res); return null; }
  const account = await D.ensureAccount(user), s = { user, account, exp: Date.now() + 30e3 };
  if (fresh) { setAuthCookies(res, fresh); sess.set(fresh.access_token, s); } else sess.set(at, s);
  if (sess.size > 5000) sess.clear();
  return s;
}
/* ---------- pedidos ---------- */
async function ctxFor(orders) {
  const itemIds = [...new Set(orders.map(o => o.itemId).filter(Boolean))], svIds = [...new Set(orders.map(o => o.serviceId).filter(Boolean))], paidIds = orders.filter(o => o.status === 'paid').map(o => o.id), orderIds = orders.map(o => o.id);
  const [items, svs, auths] = await Promise.all([itemIds.length ? T.get('items', { id: inn(itemIds) }) : [], svIds.length ? T.get('live_services', { id: inn(svIds) }) : [], paidIds.length ? T.get('authorizations', { order_id: inn(paidIds), revoked_at: isNull }) : []]);
  const IT = new Map(items.map(r => [r.id, toItem(r)])), SV = new Map(svs.map(r => [r.id, toService(r, [])]));
  const AU = new Set(orders.filter(o => o.status === 'paid' && o.accountId && o.itemId && auths.some(a => a.order_id === o.id && a.account_id === o.accountId && a.item_id === o.itemId)).map(o => o.id));
  return { out: o => D.orderOut(o, { item: IT.get(o.itemId), service: SV.get(o.serviceId), authorized: AU.has(o.id), signMedia }), IT, SV };
}
const release = o => o.type === 'live' ? T.patch('live_slots', { order_id: eq(o.id) }, { order_id: null }) : Promise.resolve();
let lastSweep = 0;
async function sweep() {/* pedidos ao vivo pendentes há mais de 30 min voltam a liberar o horário */
  if (Date.now() - lastSweep < 30000) return; lastSweep = Date.now();
  const old = await T.get('orders', { type: eq('live'), status: eq('pending'), created_at: lt(iso(Date.now() - 30 * 60e3)) });
  for (const r of old) { const got = await T.patch('orders', { id: eq(r.id), status: eq('pending') }, { status: 'cancelled' }); if (got.length) { await release(toOrder(r)); orderEvent(r.id, 'pending', 'cancelled', 'sistema', 'expirou em 30 min'); } }
}
const liveOrderJobs = new Map();
const dropfansCheckoutLinks = new Map();
async function ensureDropFansPayment(order) {
  if (!order.accountId) throw new Error('O pedido precisa estar vinculado a uma conta para registrar o pagamento.');
  const existing = await T.one('dropfans_payments', { order_id: eq(order.id) });
  if (existing) return existing;
  const item = order.itemId && await T.one('items', { id: eq(order.itemId) });
  if (!item || !item.dropfans_product_id || !Number.isSafeInteger(item.dropfans_amount_cents) ||
      item.dropfans_amount_cents < 500 || item.dropfans_amount_cents > 75000) {
    throw new Error('Configure o produto e o valor em USD do Dropfans para este conteúdo.');
  }
  const row = {
    id: rid(8), order_id: order.id, account_id: order.accountId, reference: 'GR' + order.code,
    product_id: item.dropfans_product_id, amount_cents: item.dropfans_amount_cents, currency: 'USD'
  };
  try { const [created] = await T.insert('dropfans_payments', [row]); return created; }
  catch (error) {
    if (error.status !== 409) throw error;
    const raced = await T.one('dropfans_payments', { order_id: eq(order.id) });
    if (raced) return raced;
    throw error;
  }
}
  async function webhookBody(req, limit = 65536) {
    const chunks = [];
    let length = 0;
    for await (const chunk of req) {
      length += chunk.length;
      if (length > limit) {
        const error = new Error('Corpo do webhook excede o limite permitido.');
        error.status = 413;
        throw error;
      }
      chunks.push(chunk);
    }
    return Buffer.concat(chunks, length);
  }
  async function dropfansWebhook(req, res) {
    if (!E.DROPFANS_WEBHOOK_SECRET || E.DROPFANS_WEBHOOK_SECRET.startsWith('TODO_')) {
      req.resume();
      return bad(res, 'Webhook Dropfans não configurado.', 503);
    }
    const rawBody = await webhookBody(req);
    if (!verifyWebhookSignature(rawBody, req.headers['dropfans-signature'], E.DROPFANS_WEBHOOK_SECRET)) {
      return bad(res, 'Assinatura Dropfans inválida.', 401);
    }
    const event = parseWebhookEvent(rawBody, req.headers);
    if (!event) return bad(res, 'Envelope de webhook Dropfans inválido.', 400);
    const payment = parsePaymentEvent(event);
    if (!payment) return bad(res, 'Evento de pagamento Dropfans inválido.', 400);
    if (payment.ignored) return J(res, 200, { ok: 1, ignored: true });

    const applied = await T.rpc('apply_dropfans_payment', {
      p_reference: payment.reference,
      p_product_id: payment.productId,
      p_amount_cents: payment.amountCents,
      p_currency: payment.currency,
      p_event_type: payment.eventType,
      p_status: payment.status,
      p_event_id: payment.eventId,
      p_transaction_id: payment.transactionId,
      p_auth_id: rid(8)
    });
    if (!applied) {
      console.warn('Webhook Dropfans não aplicado: evento=' + payment.eventId + ' tipo=' + payment.eventType);
      return bad(res, 'Pagamento não corresponde a um pedido válido.', 409);
    }
    push(sse.admins, { t: 'order' });
    return J(res, 200, { ok: 1 });
  }
async function newOrder(acc, f) {
  const key = [acc.id, f.service_id, f.price_cents, f.notes].join(':');
  if (liveOrderJobs.has(key)) return liveOrderJobs.get(key);
  const job = (async () => {
    const existing = await T.one('orders', { account_id: eq(acc.id), service_id: eq(f.service_id), type: eq('live'), status: eq('pending') });
    if (existing && existing.notes === f.notes && existing.price_cents === f.price_cents) return toOrder(existing);
    for (let i = 0; i < 3; i++) {
      let r; try { [r] = await T.insert('orders', [{ id: rid(8), token: rid(16), code: D.newCode(), account_id: acc.id, email: acc.email, ...f }]); } catch (e) { if (e.status === 409 && i < 2) continue; throw e; }
      try { await T.insert('payments', [{ id: rid(8), order_id: r.id, method: 'dropfans', amount_cents: r.price_cents, txid: 'GR' + r.code }]); } catch (e) { await T.del('orders', { id: eq(r.id) }).catch(() => { }); throw e; }
      orderEvent(r.id, null, 'pending', 'cliente', ''); return toOrder(r);
    }
  })();
  liveOrderJobs.set(key, job);
  try { return await job; }
  finally { liveOrderJobs.delete(key); }
}
async function newItemOrder(acc, item) {
  const id = await T.rpc('create_item_order', {
    p_order: rid(8),
    p_code: D.newCode(),
    p_token: rid(16),
    p_payment: rid(8),
    p_account: acc.id,
    p_email: acc.email,
    p_item: item.id,
    p_price: item.price_cents
  });
  const row = await T.one('orders', { id: eq(id) });
  if (!row) throw new Error('A criação atômica do pedido não retornou um pedido existente.');
  return toOrder(row);
}
/* ---------- chat e robô ---------- */
const chatOf = async cid => { cid = sid(cid); if (!cid) return null; const r = await T.one('chats', { cid: eq(cid) }); return r ? toChat(r) : null; };
async function pricesText() {
  const [items, svs] = await Promise.all([T.get('items', { published: eq(true) }), T.get('live_services', { active: eq(true) })]);
  const L = [], ph = items.filter(i => i.type === 'photo'), vd = items.filter(i => i.type === 'video'), rg = a => { const p = a.map(x => x.price_cents); return Math.min(...p) === Math.max(...p) ? brl(p[0]) : brl(Math.min(...p)) + ' a ' + brl(Math.max(...p)); };
  if (ph.length) L.push(`Fotos (${ph.length}): ${rg(ph)} cada, conforme a foto.`); if (vd.length) L.push(`Vídeos (${vd.length}): ${rg(vd)} cada, conforme o vídeo.`);
  svs.forEach(s => L.push(`Ao vivo · ${s.name}: ${brl(s.price_cents)} (${s.duration_min} min).`)); return L.length ? L.join('\n') : 'Ainda não há itens com preço cadastrado.';
}
async function bot(c, nid, R) {
  const n = R.nodes[nid]; if (!n) return; c.stack = c.stack || []; c.stack.push(nid); let text = n.text || '';
  if (n.type === 'prices') text += (text ? '\n' : '') + await pricesText();
  if (n.type === 'human') { c.mode = 'human'; text = R.humanAvailable ? R.msgHuman : R.msgNoHuman; push(sse.admins, { t: 'msg' }); }
  c.msgs.push({ from: 'bot', text, t: Date.now(), opts: (n.options || []).map(o => ({ label: o.label, next: o.next })), go: n.go || '', node: nid });
}
const chatOut = (c, R) => ({ msgs: c.msgs.slice(-300), mode: c.mode, humanAvailable: R.humanAvailable });
async function touch(c) {
  c.updated = Date.now(); if (c.msgs.length > 1000) c.msgs = c.msgs.slice(-1000);
  await T.patch('chats', { cid: eq(c.cid) }, { mode: c.mode, status: c.status, msgs: c.msgs, stack: c.stack || [], updated_at: iso(c.updated) });
  push(sse.users.get(c.cid), { t: 'msg' }); push(sse.admins, { t: 'msg' });
}

/* ---------- API pública e do cliente ---------- */
const originAllowed = req => {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const actual = new URL(origin);
    const expected = new URL(E.SITE_URL || baseUrl(req));
    if (actual.origin === expected.origin) return true;
    const alias = new URL(expected);
    alias.hostname = alias.hostname.startsWith('www.') ? alias.hostname.slice(4) : 'www.' + alias.hostname;
    if (actual.origin === alias.origin) return true;
    const forwardedProto = E.TRUST_PROXY === 'true'
      ? String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase()
      : '';
    const requestProto = forwardedProto || (req.socket.encrypted ? 'https' : 'http');
    if (/^https?$/.test(requestProto) && req.headers.host) {
      const requestOrigin = new URL(requestProto + '://' + req.headers.host);
      const secureOriginRequired = E.NODE_ENV === 'production' && expected.protocol === 'https:';
      if (requestOrigin.origin === actual.origin && (!secureOriginRequired || actual.protocol === 'https:')) return true;
      const requestAlias = new URL(requestOrigin);
      requestAlias.hostname = requestAlias.hostname.startsWith('www.')
        ? requestAlias.hostname.slice(4)
        : 'www.' + requestAlias.hostname;
      if (requestAlias.origin === actual.origin && (!secureOriginRequired || actual.protocol === 'https:')) return true;
    }
    const local = host => ['localhost', '127.0.0.1'].includes(host);
    return E.NODE_ENV !== 'production' &&
      actual.protocol === expected.protocol &&
      actual.port === expected.port &&
      local(actual.hostname) && local(expected.hostname);
  } catch {
    return false;
  }
};

async function pubApi(req, res, u, p) {
  const m = req.method, ip = ipOf(req), isDropFansHook = p === '/api/webhook/dropfans', isHook = isDropFansHook;
  if (m !== 'GET' && !isHook && (req.headers['x-req'] !== '1' || !originAllowed(req))) return bad(res, 'Requisição inválida.', 403);
  if (p === '/api/site') {
    await sweep();
    const ss = cookie(req, 'gr_at') || cookie(req, 'gr_rt') ? await sessionOf(req, res) : null;
    const ageOk = hasTermsConsent(req);
    const wantPreview = ageOk && u.searchParams.get('preview') && ss && ['admin', 'atendente'].includes(ss.account.role);
    const [cfg, profs, svs] = await Promise.all([settings(['site_live', 'site_draft', 'robot', 'live_loop']), ageOk ? T.get('profiles', { published: eq(true), order: 'created_at.asc' }) : [], ageOk ? T.get('live_services', { active: eq(true), order: 'created_at.asc' }) : []]);
    const sel = profs.find(x => x.id === u.searchParams.get('p')) || profs[0];
    const its = sel ? await T.get('items', { profile_id: eq(sel.id), published: eq(true), order: 'created_at.desc' }) : [];
    const items = its.map(toItem), st = wantPreview ? cfg.site_draft : cfg.site_live;
    return J(res, 200, { ageOk, me: ss ? { email: ss.account.email, role: ss.account.role } : null, site: publicSite(st), profiles: profs.map(toProfile).map(prPub), profile: sel ? prPub(toProfile(sel)) : null,
      photos: items.filter(i => i.type === 'photo').map(iPub), videos: items.filter(i => i.type === 'video').map(iPub), live: { services: svs.map(r => svPub(toService(r, []))), loop: cfg.live_loop.on ? cfg.live_loop.url : '' },
      robot: { enabled: cfg.robot.enabled, humanAvailable: cfg.robot.humanAvailable },
      preview: !!wantPreview && JSON.stringify(cfg.site_draft) !== JSON.stringify(cfg.site_live) });
  }
  if (p === '/api/age' && m === 'POST') { if (limited(ip, 'age', 30)) return bad(res, 'Muitas tentativas.', 429); const b = await body(req); if (b.termsAccepted !== true) return bad(res, "Marque a caixa 'Li e aceito' para continuar.", 400); if (b.adult !== true) return bad(res, 'Confirme que você tem 18 anos ou mais.'); setTermsConsent(res); return J(res, 200, { ok: 1 }); }
  if (!hasTermsConsent(req) && !isHook) return bad(res, 'Marque a caixa \'Li e aceito\' para continuar.', 403);
  if (isDropFansHook) {
    if (m !== 'POST') { res.setHeader('Allow', 'POST'); return bad(res, 'Método não permitido.', 405); }
    if (limited(ip, 'dropfans-wh', 120)) return bad(res, 'Muitas requisições.', 429);
    return dropfansWebhook(req, res);
  }
  if (p === '/api/door' && m === 'POST') { if (limited(ip, 'door', 10, 15 * 60e3)) return bad(res, 'Aguarde alguns minutos.', 429); const b = await body(req), w = S(b.word, 60).toLowerCase(), d = await setting('door'); if (!d || !d.salt || !d.hash || !teq(hash(w, d.salt), d.hash)) return bad(res, 'Comando n?o reconhecido.', 401); return J(res, 200, { go: ADMIN_PATH }); }

  /* --- contas de clientes --- */
  if (p === '/api/auth/me') { const ss = await sessionOf(req, res); return J(res, 200, { me: ss ? { email: ss.account.email, role: ss.account.role } : null }); }
  if (p === '/api/auth/google/start' && m === 'POST') {
    if (limited(ip, 'google', 10, 15 * 60e3)) return bad(res, 'Muitas tentativas. Aguarde alguns minutos.', 429);
    const b = await body(req);
    if (b.termsAccepted !== true || !hasTermsConsent(req)) return bad(res, "Marque a caixa 'Li e aceito' para continuar.", 400);
    let site;
    try { site = new URL(E.SITE_URL || baseUrl(req)); } catch { return bad(res, 'A URL do site não está configurada corretamente.', 503); }
    if (site.protocol !== 'https:' && !(E.NODE_ENV !== 'production' && ['localhost', '127.0.0.1'].includes(site.hostname))) return bad(res, 'O login com Google exige SITE_URL HTTPS.', 503);
    const state = crypto.randomBytes(32).toString('hex'), verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const redirect = new URL('/api/auth/google/callback', site);
    redirect.searchParams.set('state', state);
    setSignedCookie(res, 'gr_oauth', { state, verifier, exp: Date.now() + 10 * 60 * 1000 }, 600);
    return J(res, 200, { authorizeUrl: supa.auth.googleAuthorizeUrl(redirect.toString(), challenge) });
  }
  if (p === '/api/auth/google/callback' && m === 'GET') {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
    const flow = readSignedCookie(req, 'gr_oauth');
    const state = u.searchParams.get('state'), code = u.searchParams.get('code');
    if (!flow || !safeEqualText(flow.state, state) || !hasTermsConsent(req) || !code || code.length > 4096 || u.searchParams.has('error')) {
      clearOAuthCookie(res);
      return bad(res, 'Retorno do Google inválido ou expirado. Tente novamente.', 400);
    }
    let session;
    try { session = await supa.auth.exchangePkce(code, flow.verifier); }
    catch (e) {
      clearOAuthCookie(res);
      if (!(e instanceof SupaError) || e.status === 0 || e.status >= 500) throw e;
      return bad(res, 'Não foi possível entrar com Google. Tente novamente.', 400);
    }
    if (!session || !session.access_token || !session.refresh_token || !session.user || !session.user.id || !mail(String(session.user.email || ''))) {
      clearOAuthCookie(res);
      return bad(res, 'O Google não retornou uma conta válida. Tente novamente.', 400);
    }
    const account = await D.ensureAccount(session.user);
    await D.linkLegacyOrders(session.user, account);
    setAuthCookies(res, session);
    clearOAuthCookie(res);
    res.writeHead(303, { Location: '/', 'Cache-Control': 'no-store' });
    return res.end();
  }
  if (p === '/api/auth/signup' && m === 'POST') {
    if (limited(ip, 'su', 8, 15 * 60e3)) return bad(res, 'Muitas tentativas. Aguarde alguns minutos.', 429);
    const b = await body(req);
    if (!hasTermsConsent(req) || b.termsAccepted !== true) return bad(res, "Marque a caixa 'Li e aceito' para continuar.", 400);
    const em = S(b.email, 120).toLowerCase(), pw = S(b.password, 100); if (!mail(em)) return bad(res, 'Informe um e-mail válido.'); if (pw.length < 8) return bad(res, 'A senha precisa ter pelo menos 8 caracteres.');
    let r; try { r = await supa.auth.signUp(em, pw, baseUrl(req) + '/'); } catch (e) { if (!(e instanceof SupaError) || e.status === 0 || e.status >= 500) throw e; return bad(res, authMsg(e), e.status === 429 ? 429 : 400); }
    if (r && r.access_token) { setAuthCookies(res, r); const acc = await D.ensureAccount(r.user); await D.linkLegacyOrders(r.user, acc); return J(res, 200, { ok: 1, me: { email: acc.email, role: acc.role } }); }
    return J(res, 200, { ok: 1, needsConfirm: true });
  }
  if (p === '/api/auth/login' && m === 'POST') {
    if (limited(ip, 'li', 20, 15 * 60e3)) return bad(res, 'Muitas tentativas. Aguarde alguns minutos.', 429);
    const b = await body(req); if (!hasTermsConsent(req) || b.termsAccepted !== true) return bad(res, "Marque a caixa 'Li e aceito' para continuar.", 400);
    const em = S(b.email, 120).toLowerCase(); if (isBlocked('acct:' + em)) return bad(res, 'Muitas tentativas. Aguarde 15 minutos.', 429);
    let r; try { r = await supa.auth.signIn(em, S(b.password, 100)); } catch (e) { if (!(e instanceof SupaError) || e.status === 0 || e.status >= 500) throw e; strike('acct:' + em, 10, 15 * 60e3, 15 * 60e3); return bad(res, authMsg(e), e.status === 429 ? 429 : 401); }
    clearStrike('acct:' + em); const acc = await D.ensureAccount(r.user); await D.linkLegacyOrders(r.user, acc); setAuthCookies(res, r); return J(res, 200, { ok: 1, me: { email: acc.email, role: acc.role } });
  }
  if (p === '/api/auth/logout' && m === 'POST') { const at = cookie(req, 'gr_at'); if (at) { sess.delete(at); supa.auth.logout(at); } clearAuthCookies(res); return J(res, 200, { ok: 1 }); }
  if (p === '/api/auth/recover' && m === 'POST') {
    if (limited(ip, 'rc', 5, 15 * 60e3)) return bad(res, 'Muitas tentativas. Aguarde alguns minutos.', 429);
    const b = await body(req), em = S(b.email, 120).toLowerCase(); if (!mail(em)) return bad(res, 'Informe um e-mail válido.');
    try { await supa.auth.recover(em, baseUrl(req) + '/recuperar'); } catch (e) { if (e.status === 429) return bad(res, 'Aguarde alguns minutos antes de pedir outro e-mail.', 429); if (!(e instanceof SupaError) || e.status === 0 || e.status >= 500) throw e; }
    return J(res, 200, { ok: 1 });/* resposta igual exista ou não a conta: não revela quem tem cadastro */
  }
  if (p === '/api/auth/reset' && m === 'POST') {
    if (limited(ip, 'rs', 10, 15 * 60e3)) return bad(res, 'Muitas tentativas. Aguarde alguns minutos.', 429);
    const b = await body(req), tk = S(b.token, 4000), pw = S(b.password, 100); if (!tk) return bad(res, 'Link inválido ou expirado. Peça um novo e-mail de recuperação.'); if (pw.length < 8) return bad(res, 'A senha precisa ter pelo menos 8 caracteres.');
    try { await supa.auth.updatePassword(tk, pw); } catch (e) { if (!(e instanceof SupaError) || e.status === 0 || e.status >= 500) throw e; return bad(res, e.status === 401 || e.status === 403 ? 'Link inválido ou expirado. Peça um novo e-mail de recuperação.' : authMsg(e), 400); }
    return J(res, 200, { ok: 1 });
  }

  /* --- pedidos --- */
  if (p === '/api/order' && m === 'POST') {
    if (limited(ip, 'co', 20)) return bad(res, 'Muitas tentativas. Aguarde um minuto.', 429); await sweep();
    const ss = await sessionOf(req, res); if (!ss) return bad(res, 'Entre na sua conta para comprar.', 401, { needLogin: true });
    const acc = ss.account, b = await body(req); let o;
    if (b.itemId) {
      const it = await T.one('items', { id: eq(sid(b.itemId)), published: eq(true) }), pr = it && await T.one('profiles', { id: eq(it.profile_id), published: eq(true) });
      if (!it || !pr) return bad(res, 'Item indisponível.', 404); if (!(it.price_cents > 0)) return bad(res, 'Este item ainda não tem preço definido.');
      if (!E.DROPFANS_API_KEY || !it.dropfans_product_id || !Number.isSafeInteger(it.dropfans_amount_cents) ||
          it.dropfans_amount_cents < 500 || it.dropfans_amount_cents > 75000) {
        return bad(res, 'Pagamento indisponível: configure o Dropfans e o produto deste conteúdo.', 503);
      }
      if (await T.count('orders', { account_id: eq(acc.id), status: eq('pending') }) >= 10) {
        const existing = await T.one('orders', { account_id: eq(acc.id), item_id: eq(it.id), type: eq('item'), status: eq('pending') });
        if (!existing) return bad(res, 'Há muitos pedidos pendentes. Conclua ou cancele algum antes de criar outro.', 429);
      }
      o = await newItemOrder(acc, it);
      if (o.status === 'paid') return bad(res, 'Você já comprou este item. Veja em Compra.', 409);
    } else if (b.serviceId) {
      return bad(res, 'O checkout Dropfans está disponível somente para fotos e vídeos.', 503);
    } else return bad(res, 'Pedido inválido.');
    if (o.status === 'pending') {
      try { await ensureDropFansPayment(o); }
      catch (e) {
        logErr('registro do pagamento DropFans do pedido ' + o.code, e);
        return bad(res, 'Seu pedido foi criado, mas não foi possível preparar a área de pagamento. Tente novamente em instantes.', 503, { retryable: true, token: o.token });
      }
    }
    push(sse.admins, { t: 'order' }); return J(res, 200, { token: o.token });
  }
  let mm;
  const tokenGuard = () => limited(ip, 'ot', 120) || isBlocked('tk:' + ip);
  if ((mm = p.match(/^\/api\/order\/(\w+)\/cancel$/)) && m === 'POST') {
    if (tokenGuard()) return bad(res, 'Muitas tentativas. Aguarde alguns minutos.', 429);
    const r = await T.one('orders', { token: eq(mm[1]) }); if (!r) { strike('tk:' + ip, 15, 10 * 60e3, 15 * 60e3); return bad(res, 'Pedido não encontrado.', 404); }
    const got = await T.patch('orders', { id: eq(r.id), status: eq('pending') }, { status: 'cancelled' }); if (!got.length) return bad(res, 'Só é possível cancelar pedidos pendentes.');
    await release(toOrder(r)); orderEvent(r.id, 'pending', 'cancelled', 'cliente', ''); audit('cliente', 'pedido cancelado pelo cliente', r.code); push(sse.admins, { t: 'order' }); return J(res, 200, { ok: 1 });
  }
  if ((mm = p.match(/^\/api\/order\/(\w+)$/))) {
    if (tokenGuard()) return bad(res, 'Muitas tentativas. Aguarde alguns minutos.', 429);
    const r = await T.one('orders', { token: eq(mm[1]) }); if (!r) { strike('tk:' + ip, 15, 10 * 60e3, 15 * 60e3); return bad(res, 'Pedido não encontrado.', 404); }
    const o = toOrder(r), c = await ctxFor([o]);
    return J(res, 200, c.out(o));
  }
  if ((mm = p.match(/^\/api\/dropfans\/(\w+)$/)) && m === 'GET') {
    if (tokenGuard()) return bad(res, 'Muitas tentativas. Aguarde alguns minutos.', 429);
    const row = await T.one('orders', { token: eq(mm[1]) });
    if (!row) { strike('tk:' + ip, 15, 10 * 60e3, 15 * 60e3); return bad(res, 'Pedido não encontrado.', 404); }
    const o = toOrder(row);
    let payment = await T.one('dropfans_payments', { order_id: eq(o.id) });
    if (!payment && o.status === 'pending') {
      if (!o.accountId) return bad(res, 'Entre na sua conta para preparar este pagamento.', 409);
      payment = await ensureDropFansPayment(o);
    }
    const status = payment && ['refunded', 'chargeback'].includes(payment.status) ? payment.status
      : o.status === 'paid' || payment && payment.status === 'confirmed' ? 'confirmed'
      : o.status !== 'pending' || payment && payment.status === 'failed' ? 'failed' : 'pending';
    let checkoutUrl = '';
    if (status === 'pending') {
      if (!E.DROPFANS_API_KEY || !payment || !payment.product_id) return bad(res, 'Checkout Dropfans indisponível; a integração ainda não está configurada.', 503);
      try {
        checkoutUrl = dropfansCheckoutLinks.get(payment.reference);
        if (!checkoutUrl) {
          checkoutUrl = await createCheckoutLink({
            apiKey: E.DROPFANS_API_KEY,
            productId: payment.product_id,
            externalRef: payment.reference,
            apiBase: DROP_API_BASE
          });
          dropfansCheckoutLinks.set(payment.reference, checkoutUrl);
          if (dropfansCheckoutLinks.size > 1000) dropfansCheckoutLinks.delete(dropfansCheckoutLinks.keys().next().value);
        }
      } catch (error) {
        console.error('Falha ao criar link de checkout Dropfans: ' + error.message);
        return bad(res, 'Não foi possível preparar o checkout Dropfans. Tente novamente.', 503);
      }
    }
    return J(res, 200, {
      status,
      reference: payment ? payment.reference : 'GR' + o.code,
      amountCents: o.price,
      providerAmountCents: payment && payment.amount_cents,
      providerCurrency: payment && payment.currency,
      checkoutUrl
    });
  }
  if (p === '/api/my' && m === 'POST') {
    if (limited(ip, 'my', 60)) return bad(res, 'Muitas tentativas. Aguarde alguns minutos.', 429); await sweep();
    const ss = await sessionOf(req, res); if (!ss) return J(res, 200, { orders: [], needLogin: true });
    const orders = (await T.get('orders', { account_id: eq(ss.account.id), order: 'created_at.desc', limit: 100 })).map(toOrder), c = await ctxFor(orders);
    return J(res, 200, { orders: orders.map(o => c.out(o)) });
  }

  /* --- chat --- */
  if (p === '/api/chat/open' && m === 'POST') {
    if (limited(ip, 'ch', 20)) return bad(res, 'Muitas tentativas.', 429); const b = await body(req); let c = await chatOf(b.cid);
    if (!c) { const R = await setting('robot'), em = S(b.email, 120).toLowerCase(); c = { cid: rid(16), id: rid(4), email: mail(em) ? em : '', mode: R.enabled ? 'bot' : 'human', status: 'open', msgs: [], stack: [] }; await T.insert('chats', [{ cid: c.cid, id: c.id, email: c.email, mode: c.mode, status: c.status }]); if (R.enabled) await bot(c, R.start, R); await touch(c); }
    return J(res, 200, { cid: c.cid });
  }
  if (p === '/api/chat/send' && m === 'POST') {
    if (limited(ip, 'ch', 30)) return bad(res, 'Muitas mensagens. Aguarde um minuto.', 429); const b = await body(req), c = await chatOf(b.cid); if (!c) return bad(res, 'Conversa não encontrada.', 404); const R = await setting('robot'); c.status = 'open';
    if (b.choice !== undefined) { const last = [...c.msgs].reverse().find(x => x.from === 'bot'), o = last && last.opts && last.opts[+b.choice]; if (!o) return bad(res, 'Opção inválida.'); c.msgs.push({ from: 'user', text: o.label, t: Date.now() }); c.mode = 'bot'; await bot(c, o.next, R); }
    else { const t = S(b.text, 1000); if (!t) return bad(res, 'Mensagem vazia.'); c.msgs.push({ from: 'user', text: t, t: Date.now(), read: false }); if (c.mode === 'bot' && R.enabled) c.msgs.push({ from: 'bot', text: R.msgFallback, t: Date.now(), opts: ((R.nodes[R.start] || {}).options || []).map(o => ({ label: o.label, next: o.next })), node: R.start }); }
    await touch(c); return J(res, 200, { ok: 1 });
  }
  if ((mm = p.match(/^\/api\/chat\/(\w+)\/back$/)) && m === 'POST') { const c = await chatOf(mm[1]); if (!c) return bad(res, 'Conversa não encontrada.', 404); const R = await setting('robot'); c.msgs.push({ from: 'user', text: 'Voltar', t: Date.now() }); c.mode = 'bot'; c.stack = c.stack || []; c.stack.pop(); const prev = c.stack.pop(); await bot(c, prev && R.nodes[prev] ? prev : R.start, R); await touch(c); return J(res, 200, { ok: 1 }); }
  if ((mm = p.match(/^\/api\/chat\/stream\/(\w+)$/))) { const cid = mm[1]; if (limited(ip, 'sse', 30) || !(await chatOf(cid))) return bad(res, 'Conversa não encontrada.', 404); if (!sse.users.has(cid)) sse.users.set(cid, new Set()); const set = sse.users.get(cid); return stream(req, res, set, 5, () => { if (!set.size && sse.users.get(cid) === set) sse.users.delete(cid); }); }
  if ((mm = p.match(/^\/api\/chat\/(\w+)$/))) {
    if (limited(ip, 'cg', 180)) return bad(res, 'Muitas requisições.', 429); const c = await chatOf(mm[1]); if (!c) return bad(res, 'Conversa não encontrada.', 404);
    if (c.msgs.some(x => x.from === 'admin' && !x.read)) { c.msgs.forEach(x => { if (x.from === 'admin') x.read = true; }); await T.patch('chats', { cid: eq(c.cid) }, { msgs: c.msgs }); }
    return J(res, 200, chatOut(c, await setting('robot')));
  }
  bad(res, 'Rota não encontrada.', 404);
}

/* ---------- API do painel administrativo ---------- */
const pf = b => ({ name: S(b.name, 60), username: S(b.user, 40).replace(/^@?/, '@'), bio: S(b.bio, 200), avatar: up(b.avatar), verified: !!b.verified, published: !!b.published });
const chatsList = (rows, full = true) => rows.map(toChat).map(c => ({ cid: c.cid, id: c.id, ...(full ? { email: c.email } : {}), emailM: mask(c.email), mode: c.mode, status: c.status, msgs: c.msgs, updated: c.updated, pending: c.status === 'open' && c.msgs.length && c.msgs[c.msgs.length - 1].from === 'user' })).sort((a, b) => b.updated - a.updated);
async function admData(a) {
  const [profiles, items, orderRows, dropfansRows] = await Promise.all([
    T.get('profiles', { order: 'created_at.asc' }),
    T.get('items', { order: 'created_at.desc' }),
    T.get('orders', { order: 'created_at.desc', limit: 1000 }),
    T.get('dropfans_payments', { order: 'created_at.desc', limit: 1000 })
  ]);
  const its = items.map(toItem), IT = new Map(its.map(i => [i.id, i]));
  const providerPayments = new Map(dropfansRows.map(payment => [payment.order_id, payment]));
  const safeOrders = orderRows.map(order => ({
    id: order.id,
    code: order.code,
    title: order.item_id ? (IT.get(order.item_id) || { title: '(conteúdo removido)' }).title : 'Conteúdo',
    price: order.price_cents,
    status: order.status,
    paymentStatus: (providerPayments.get(order.id) || {}).status || order.status
  }));
  return {
    role: 'admin',
    me: a.username,
    profiles: profiles.map(toProfile),
    items: its,
    orders: safeOrders,
    stats: {
      pending: safeOrders.filter(order => order.paymentStatus === 'pending').length,
      paid: safeOrders.filter(order => order.paymentStatus === 'confirmed').length
    }
  };
}
const EXT_SIG = { '.jpg': 'jpg', '.jpeg': 'jpg', '.png': 'png', '.webp': 'webp', '.mp4': 'mp4', '.webm': 'webm', '.mov': 'mov' }, EXT_MIME = { '.jpg': ['image/jpeg'], '.jpeg': ['image/jpeg'], '.png': ['image/png'], '.webp': ['image/webp'], '.mp4': ['video/mp4'], '.webm': ['video/webm'], '.mov': ['video/quicktime', 'video/mp4'] };
const L = (b, a, z) => b.toString('latin1', a, z), SIG = { jpg: b => b.length > 3 && b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF, png: b => b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])), webp: b => b.length >= 12 && L(b, 0, 4) === 'RIFF' && L(b, 8, 12) === 'WEBP', webm: b => b.length >= 4 && b[0] === 0x1A && b[1] === 0x45 && b[2] === 0xDF && b[3] === 0xA3, mp4: b => b.length >= 12 && L(b, 4, 8) === 'ftyp', mov: b => b.length >= 12 && (L(b, 4, 8) === 'ftyp' || ['moov', 'mdat', 'wide', 'free', 'skip', 'pnot'].includes(L(b, 4, 8))) };
const base = f => path.basename(String(f || ''));
async function delItem(x) {/* apaga o original (bucket privado), as prévias (bucket público) e a linha do banco */
  try { await supa.storage.remove('originals', [base(x.file)]); const pv = [x.preview, x.cover, x.teaser].filter(Boolean).map(base); if (pv.length) await supa.storage.remove('previews', pv); } catch (e) { logErr('aviso: arquivo não removido do Storage', e); }
  await T.del('items', { id: eq(x.id) });
}
const rmPub = async url => { if (url && String(url).startsWith('/uploads/')) try { await supa.storage.remove('previews', [base(url)]); } catch (e) { logErr('aviso: prévia não removida', e); } };

async function admApi(req, res, u, p) {
  const m = req.method, ip = ipOf(req);
  if (m !== 'GET' && (req.headers['x-req'] !== '1' || !originAllowed(req))) return bad(res, 'Requisição inválida.', 403);
  if (p === '/api/admin/state' && m === 'GET') {
    const row = await adminCredentialRow(), credential = row && row.value, a = await adminSessionOf(req, credential);
    return J(res, 200, { configured: !!row, authed: !!a, role: a && a.role, stableSecret: STABLE_SECRET });
  }
  if (p === '/api/admin/signup' && m === 'POST') {
    if (limited(ip, 'asup', 8, 15 * 60e3)) return bad(res, 'Muitas tentativas. Aguarde 15 minutos.', 429);
    if (!STABLE_SECRET) return bad(res, 'Configure um APP_SECRET estável com pelo menos 32 caracteres antes de criar o acesso.', 503);
    const b = await body(req), username = adminUsername(b.username), password = adminPassword(b.password);
    if (!username) return bad(res, 'Usuário inválido. Use de 3 a 32 letras, números, ponto, hífen ou underline.', 400);
    if (password.length < 8 || password.length > 128) return bad(res, 'A senha deve ter entre 8 e 128 caracteres.', 400);
    const existing = await adminCredentialRow();
    if (existing) return bad(res, 'Cadastro encerrado.', 409);
    const credential = await makeAdminCredential(username, password);
    try {
      await T.insert('settings', [{ key: 'admin_credential', value: credential, updated_at: new Date().toISOString() }]);
    } catch (e) {
      if (e instanceof SupaError && (e.status === 409 || (e.body && e.body.code === '23505'))) return bad(res, 'Cadastro encerrado.', 409);
      throw e;
    }
    await audit(username, 'acesso administrativo criado', '');
    return J(res, 200, { ok: 1 });
  }
  if (p === '/api/admin/login' && m === 'POST') {
    if (limited(ip, 'alog', 15, 15 * 60e3)) return bad(res, 'Muitas tentativas. Aguarde 15 minutos.', 429);
    const b = await body(req), username = adminUsername(b.username), password = adminPassword(b.password);
    const key = 'admin:' + (username || 'invalid');
    if (!STABLE_SECRET) return bad(res, 'A autenticação administrativa não está configurada corretamente.', 503);
    if (isBlocked(key)) return bad(res, 'Muitas tentativas. Aguarde 15 minutos.', 429);
    const row = await adminCredentialRow(), credential = row && row.value;
    const valid = await verifyAdminCredential(credential, username, password);
    if (!valid) { strike(key, 10, 15 * 60e3, 15 * 60e3); return bad(res, 'Usuário ou senha inválidos.', 401); }
    clearStrike(key);
    setAdminCookie(res, credential, b.remember === true);
    await audit(username, 'login no painel', '');
    return J(res, 200, { ok: 1 });
  }
  if (p === '/api/admin/logout' && m === 'POST') { clearAdminCookie(res); return J(res, 200, { ok: 1 }); }
  const row = await adminCredentialRow(), credential = row && row.value;
  const a = await adminSessionOf(req, credential);
  if (!a) return bad(res, 'Não autorizado.', 401);
  if (p === '/api/admin/stream') return stream(req, res, sse.admins);
  if (p === '/api/admin/data') return J(res, 200, await admData(a));
  let mm, b;
  if (p === '/api/admin/credentials' && m === 'POST') {
    if (limited(ip, 'cred', 6, 15 * 60e3)) return bad(res, 'Muitas tentativas.', 429);
    b = await body(req);
    const currentPassword = adminPassword(b.currentPassword), username = adminUsername(b.username), newPassword = adminPassword(b.newPassword);
    if (!await verifyAdminCredential(credential, a.username, currentPassword)) return bad(res, 'Senha atual incorreta.', 401);
    if (!username) return bad(res, 'Usuário inválido. Use de 3 a 32 letras, números, ponto, hífen ou underline.', 400);
    if (newPassword.length < 8 || newPassword.length > 128) return bad(res, 'A senha deve ter entre 8 e 128 caracteres.', 400);
    const versionTime = Math.max(Date.now(), Date.parse(credential.created_at) + 1);
    const updated = await makeAdminCredential(username, newPassword, new Date(versionTime).toISOString());
    await T.patch('settings', { key: eq('admin_credential') }, { value: updated, updated_at: new Date().toISOString() });
    clearAdminCookie(res);
    await audit(username, 'credenciais administrativas alteradas', '');
    return J(res, 200, { ok: 1 });
  }
  if (p === '/api/admin/available' && m === 'POST') { b = await body(req); const R = await setting('robot'); R.humanAvailable = !!b.on; await putSetting('robot', R); await audit(a.username, 'atendente ' + (b.on ? 'disponível' : 'indisponível'), ''); push(sse.admins, { t: 'msg' }); return J(res, 200, { ok: 1 }); }
  if (p === '/api/admin/chat-read' && m === 'POST') { b = await body(req); const c = await chatOf(b.cid); if (c) { c.msgs.forEach(x => x.read = true); await T.patch('chats', { cid: eq(c.cid) }, { msgs: c.msgs }); } return J(res, 200, { ok: 1 }); }
  if ((mm = p.match(/^\/api\/admin\/chat\/(\w+)\/(reply|close)$/)) && m === 'POST') { const c = await chatOf(mm[1]); if (!c) return bad(res, 'Conversa não encontrada.', 404); b = await body(req); if (mm[2] === 'reply') { if (!S(b.text)) return bad(res, 'Mensagem vazia.'); c.msgs.push({ from: 'admin', text: S(b.text, 1000), t: Date.now(), read: false }); c.status = 'open'; c.mode = 'human'; } else c.status = 'closed'; await touch(c); return J(res, 200, { ok: 1 }); }
  if (p === '/api/admin/door' && m === 'POST') { b = await body(req); const w = S(b.word, 60).toLowerCase(); if (w.length < 4) return bad(res, 'Use pelo menos 4 caracteres.'); const salt = rid(8); await putSetting('door', { salt, hash: hash(w, salt) }); await audit(a.username, 'palavra do atalho alterada', ''); return J(res, 200, { ok: 1 }); }

  /* arquivos originais (visualização no painel) */
  if ((mm = p.match(/^\/api\/admin\/file\/([\w.]+)$/)) && m === 'GET') { const f = base(mm[1]), ext = path.extname(f).toLowerCase(); return pipeUpstream(req, res, await openPrivateMedia('originals', f, req.headers.range), MIME[ext]); }

  /* perfis */
  if (p === '/api/admin/profile' && m === 'POST') {
    b = await body(req); const d = pf(b); if (!d.name) return bad(res, 'Informe o nome do perfil.'); const ex = b.id && await T.one('profiles', { id: eq(sid(b.id)) }); let r;
    if (ex) [r] = await T.patch('profiles', { id: eq(ex.id) }, d); else [r] = await T.insert('profiles', [{ id: rid(5), ...d }]);
    await audit(a.username, 'perfil salvo', r.name); return J(res, 200, toProfile(r));
  }
  if ((mm = p.match(/^\/api\/admin\/profile\/(\w+)$/)) && m === 'DELETE') {
    const x = await T.one('profiles', { id: eq(mm[1]) }); if (x) { for (const i of await T.get('items', { profile_id: eq(x.id) })) await delItem(toItem(i)); await T.del('profiles', { id: eq(x.id) }); await rmPub(x.avatar); await audit(a.username, 'perfil excluído', x.name); } return J(res, 200, { ok: 1 });
  }

  /* fotos e vídeos */
  if (p === '/api/admin/item' && m === 'POST') {
    b = await body(req);
    const dropfansProductId = S(b.dropfansProductId, 128).trim();
    const dropfansAmountCents = b.dropfansAmountCents == null || b.dropfansAmountCents === '' ? null : Math.round(+b.dropfansAmountCents);
    if ((dropfansProductId && !/^[A-Za-z0-9_-]{1,128}$/.test(dropfansProductId)) ||
        (dropfansProductId && (!Number.isSafeInteger(dropfansAmountCents) || dropfansAmountCents < 500 || dropfansAmountCents > 75000)) ||
        (!dropfansProductId && dropfansAmountCents != null)) {
      return bad(res, 'Configure um ID de produto Dropfans válido e o valor correspondente entre US$ 5 e US$ 750.');
    }
    const d = {
      title: S(b.title, 100), price_cents: cl(b.price), preview: up(b.preview), cover: up(b.cover),
      teaser: up(b.teaser), duration: Math.max(0, Math.round(+b.duration || 0)), published: !!b.published,
      dropfans_product_id: dropfansProductId || null, dropfans_amount_cents: dropfansProductId ? dropfansAmountCents : null
    };
    if (!d.title) return bad(res, 'Informe o título.'); if (d.published && !(d.price_cents > 0)) return bad(res, 'Defina um preço maior que zero para publicar.');
    const x0 = b.id && await T.one('items', { id: eq(sid(b.id)) });
    if (x0) { const [r] = await T.patch('items', { id: eq(x0.id) }, d); return J(res, 200, toItem(r)); }
    const type = b.type === 'video' ? 'video' : 'photo', file = base(S(b.file, 80)); if (!(await T.one('profiles', { id: eq(sid(b.profileId)) }))) return bad(res, 'Escolha o perfil.');
    if (!/^[\w.\-]{3,80}$/.test(file)) return bad(res, 'Envie o arquivo.'); try { await supa.storage.sign('originals', file, 30); } catch { return bad(res, 'Envie o arquivo.'); }
    const [r] = await T.insert('items', [{ id: rid(5), profile_id: sid(b.profileId), type, original_file: file, ...d }]); await audit(a.username, type === 'video' ? 'vídeo adicionado' : 'foto adicionada', d.title); return J(res, 200, toItem(r));
  }
  if ((mm = p.match(/^\/api\/admin\/item\/(\w+)$/)) && m === 'DELETE') { const x = await T.one('items', { id: eq(mm[1]) }); if (x) { await delItem(toItem(x)); await audit(a.username, 'item excluído', x.title); } return J(res, 200, { ok: 1 }); }

  /* pedidos, pagamentos e liberações */
  if ((mm = p.match(/^\/api\/admin\/order\/(\w+)\/(confirm|reject|revoke)$/)) && m === 'POST') {
    if (mm[2] === 'confirm') return bad(res, 'A confirmação de pagamento só é aceita pelo webhook Dropfans assinado.', 403);
    const r = await T.one('orders', { id: eq(mm[1]) }); if (!r) return bad(res, 'Pedido não encontrado.', 404); b = await body(req); const o = toOrder(r), note = S(b.note, 200);
    if (mm[2] === 'revoke') { if (o.status !== 'paid') return bad(res, 'Só é possível revogar pedidos pagos.'); if (!note) return bad(res, 'Informe o motivo da revogação.'); if (!(await T.rpc('revoke_access', { p_order: o.id, p_by: a.username, p_note: note }))) return bad(res, 'Não foi possível revogar.'); await audit(a.username, 'acesso revogado', o.code + ' ' + note); return J(res, 200, { ok: 1 }); }
    if (mm[2] !== 'reject') return bad(res, 'Operação inválida.', 400);
    if (o.status !== 'pending') return bad(res, 'Este pedido não está pendente.');
    const got = await T.patch('orders', { id: eq(o.id), status: eq('pending') }, { status: 'rejected', paid_by: a.username, note });
    if (got.length) {
      await T.patch('payments', { order_id: eq(o.id) }, { status: 'rejected', note });
      await T.patch('dropfans_payments', { order_id: eq(o.id), status: eq('pending') }, { status: 'failed', updated_at: iso(Date.now()) });
      await release(o); orderEvent(o.id, 'pending', 'rejected', a.username, note); await audit(a.username, 'pedido recusado', o.code);
    }
    return J(res, 200, { ok: 1 });
  }
  if (p === '/api/admin/authorize' && m === 'POST') return bad(res, 'A liberação manual foi desativada; o conteúdo só é liberado após webhook assinado.', 403);

  /* ao vivo */
  if (p === '/api/admin/service' && m === 'POST') {
    b = await body(req); const d = { name: S(b.name, 80), description: S(b.desc, 500), price_cents: cl(b.price), duration_min: Math.max(1, Math.round(+b.duration || 30)), conditions: S(b.conditions, 500), active: !!b.active }; if (!d.name) return bad(res, 'Informe o nome da modalidade.'); if (d.active && !(d.price_cents > 0)) return bad(res, 'Defina um preço maior que zero para ativar.');
    const ex = b.id && await T.one('live_services', { id: eq(sid(b.id)) }); let r; if (ex) [r] = await T.patch('live_services', { id: eq(ex.id) }, d); else [r] = await T.insert('live_services', [{ id: rid(5), ...d }]);
    await audit(a.username, 'modalidade salva', r.name); return J(res, 200, toService(r, [])); }
  if ((mm = p.match(/^\/api\/admin\/service\/(\w+)$/)) && m === 'DELETE') { const x = await T.one('live_services', { id: eq(mm[1]) }); if (x) { if ((await T.count('orders', { service_id: eq(x.id), status: eq('pending') })) > 0) return bad(res, 'Há pedidos pendentes nesta modalidade. Resolva-os antes de excluir.'); await T.del('live_services', { id: eq(x.id) }); await audit(a.username, 'modalidade excluída', x.name); } return J(res, 200, { ok: 1 }); }
  if ((mm = p.match(/^\/api\/admin\/service\/(\w+)\/slot$/)) && m === 'POST') { const x = await T.one('live_services', { id: eq(mm[1]) }); b = await body(req); if (!x) return bad(res, 'Modalidade não encontrada.', 404); const at = Math.round(+b.at); if (!(at > Date.now())) return bad(res, 'Escolha uma data e hora futuras.'); if (await T.one('live_slots', { service_id: eq(x.id), at: eq(iso(at)) })) return bad(res, 'Esse horário já existe.'); await T.insert('live_slots', [{ id: rid(4), service_id: x.id, at: iso(at) }]); return J(res, 200, { ok: 1 }); }
  if ((mm = p.match(/^\/api\/admin\/service\/(\w+)\/slot\/(\w+)$/)) && m === 'DELETE') { const s = await T.one('live_slots', { id: eq(mm[2]), service_id: eq(mm[1]) }); if (s) { if (s.order_id) return bad(res, 'Horário reservado por um pedido.'); await T.del('live_slots', { id: eq(s.id) }); } return J(res, 200, { ok: 1 }); }
  if (p === '/api/admin/live' && m === 'POST') { b = await body(req); const old = await setting('live_loop'), url = up(b.loop); await putSetting('live_loop', { url, on: !!b.loopOn }); if (old.url && old.url !== url) await rmPub(old.url); await audit(a.username, 'transmissão configurada', ''); return J(res, 200, { ok: 1 }); }
  if (p === '/api/admin/robot' && m === 'POST') {
    b = await body(req); const R = { enabled: !!b.enabled, humanAvailable: !!b.humanAvailable, start: S(b.start, 30), msgPaid: S(b.msgPaid, 300), msgHuman: S(b.msgHuman, 300), msgNoHuman: S(b.msgNoHuman, 300), msgFallback: S(b.msgFallback, 300), nodes: {} };
    Object.entries(b.nodes || {}).slice(0, 60).forEach(([k, n]) => { if (!/^[a-z0-9_]{1,30}$/.test(k)) return; R.nodes[k] = { text: S(n.text, 1500), type: ['prices', 'human'].includes(n.type) ? n.type : '', go: ['fotos', 'videos', 'live', 'chat', 'compra'].includes(n.go) ? n.go : '', options: (Array.isArray(n.options) ? n.options : []).slice(0, 8).map(o => ({ label: S(o.label, 60), next: S(o.next, 30) })).filter(o => o.label) }; });
    if (!R.nodes[R.start]) return bad(res, 'A mensagem inicial precisa existir.'); for (const n of Object.values(R.nodes)) for (const o of n.options) if (!R.nodes[o.next]) return bad(res, 'Uma resposta aponta para uma mensagem que não existe: ' + o.next);
    await putSetting('robot', R); await audit(a.username, 'robô configurado', ''); return J(res, 200, { ok: 1 });
  }

  /* envio de arquivos: validado em pasta temporária e só então enviado ao Storage */
  if (p === '/api/admin/upload' && m === 'PUT') {
    const k = u.searchParams.get('kind'), kind = ['photo', 'video', 'teaser', 'loop'].includes(k) ? k : 'cover', ext = path.extname(S(u.searchParams.get('name'), 100)).toLowerCase(), vx = ['.mp4', '.webm', '.mov'], ok = kind === 'video' ? vx : kind === 'teaser' || kind === 'loop' ? ['.webm', '.mp4'] : ['.jpg', '.jpeg', '.png', '.webp'];
    const len = +req.headers['content-length'] || 0, lim = kind === 'video' || kind === 'loop' ? MAXUP : kind === 'photo' ? Math.min(20 * 1048576, MAXUP) : kind === 'teaser' ? 8 * 1048576 : 10 * 1048576;
    const refuse = (msg, code) => { bad(res, msg, code); if (len > 50 * 1048576) res.once('finish', () => req.destroy()); else req.resume(); };
    if (!ok.includes(ext)) return refuse('Formato não permitido: ' + ok.join(' '), 400);
    const mime = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase(); if (mime && mime !== 'application/octet-stream' && !EXT_MIME[ext].includes(mime)) return refuse('O tipo do arquivo (' + mime + ') não corresponde à extensão ' + ext + '.', 415);
    if (len > lim) return refuse(`Arquivo maior que ${lim / 1048576} MB.`, 413);
    const fn = rid(10) + ext, bucket = kind === 'photo' || kind === 'video' ? 'originals' : 'previews', tmp = path.join(TMP, rid(12) + '.part'), ws = fs.createWriteStream(tmp, { mode: 0o600 }); let n = 0, over = false;
    const drop = () => { over = true; try { ws.destroy(); } catch { } fs.unlink(tmp, () => { }); };
    req.on('data', c => { n += c.length; if (n > lim && !over) { drop(); refuse('Arquivo excede o limite.', 413); } });
    req.on('close', () => { if (!req.complete && !over) drop(); }); req.on('error', () => { if (!over) drop(); }); req.pipe(ws);
    ws.on('error', e => { if (!over) { drop(); bad(res, 'Falha ao gravar o arquivo temporário: ' + e.code, 507); } });
    ws.on('finish', async () => {
      if (over) return; let head = Buffer.alloc(16), got = 0;
      try { const fd = fs.openSync(tmp, 'r'); try { got = fs.readSync(fd, head, 0, 16, 0); } finally { fs.closeSync(fd); } } catch { drop(); return bad(res, 'Falha ao ler o arquivo enviado.', 500); }
      if (!got) { drop(); return bad(res, 'Arquivo vazio.', 400); }
      if (!SIG[EXT_SIG[ext]](head.subarray(0, got))) { drop(); return bad(res, 'O conteúdo do arquivo não corresponde ao formato ' + ext + ' (arquivo recusado).', 415); }
      try { await supa.storage.putFile(bucket, fn, tmp, MIME[ext]); fs.unlink(tmp, () => { }); J(res, 200, kind === 'photo' || kind === 'video' ? { file: fn } : { url: '/uploads/' + fn }); }
      catch (e) { fs.unlink(tmp, () => { }); logErr('envio ao Storage', e); bad(res, 'Não foi possível guardar o arquivo no Supabase Storage (' + (e.status || 'rede') + '). Nada foi publicado.', 502); }
    });
    return;
  }
  if (p === '/api/admin/site' && m === 'POST') {
    b = await body(req); const cfg = await settings(['site_draft']), s = { ...cfg.site_draft }; ['brand', 'welcome'].forEach(k => { if (b[k] != null) s[k] = S(b[k], 120); }); if (b.howto != null) s.howto = S(b.howto, 3000); if (b.cover != null) s.cover = up(b.cover);
    if (b.areas) s.areas = { fotos: !!b.areas.fotos, videos: !!b.areas.videos, live: !!b.areas.live, chat: !!b.areas.chat }; if (b.counters != null) s.counters = !!b.counters; await putSetting('site_draft', s); await audit(a.username, 'rascunho visual salvo', ''); return J(res, 200, { ok: 1 });
  }
  if (p === '/api/admin/publish' && m === 'POST') { const cfg = await settings(['site_draft']); await putSetting('site_live', cfg.site_draft); await audit(a.username, 'site publicado', ''); return J(res, 200, { ok: 1 }); }
  if (p === '/api/admin/discard' && m === 'POST') { const cfg = await settings(['site_live']); await putSetting('site_draft', cfg.site_live); await audit(a.username, 'alterações canceladas', ''); return J(res, 200, { ok: 1 }); }
  bad(res, 'Rota não encontrada.', 404);
}

/* ---------- servidor ---------- */
const secHeaders = (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'same-origin'); res.setHeader('X-Frame-Options', 'DENY'); res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()');
  /* as imagens/vídeos passam sempre pelo próprio servidor; o navegador nunca fala direto com o Supabase */
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
  if (SECURE && (req.socket.encrypted || (E.TRUST_PROXY === 'true' && String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https'))) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
};
const srv = http.createServer(async (req, res) => {
  try {
    let u, p; try { u = new URL(req.url, 'http://x'); p = decodeURIComponent(u.pathname); } catch { secHeaders(req, res); return bad(res, 'Requisição inválida.', 400); }
    secHeaders(req, res);
    if (p === '/healthz') { if (u.searchParams.get('db')) { if (limited(ipOf(req), 'hz', 30)) return bad(res, 'Muitas requisições.', 429); try { await T.get('settings', { select: 'key', limit: 1 }); } catch (e) { return bad(res, 'banco indisponível', 503); } } return J(res, 200, { ok: 1 }); }/* use /healthz?db=1 num monitor gratuito para manter o Supabase ativo e avisar se o site cair */
    if (p.startsWith('/api/admin/')) return await admApi(req, res, u, p);
    if (p.startsWith('/api/')) return await pubApi(req, res, u, p);
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.setHeader('Allow', 'GET, HEAD'); return bad(res, 'Método não permitido.', 405); }
    let mm;
    if ((mm = p.match(/^\/uploads\/([\w.\-]{1,100})$/))) {/* previews privados: servidor entrega somente após a confirmação 18+ */
      if (!hasTermsConsent(req)) return bad(res, 'Confirme a maioridade e aceite os Termos de Uso.', 403);
      const ext = path.extname(mm[1]).toLowerCase(); return pipeUpstream(req, res, await openPrivateMedia('previews', mm[1], req.headers.range), MIME[ext], 'private, no-store');
    }
    if ((mm = p.match(/^\/media\/i\/(\w+)$/))) {/* conteúdo ORIGINAL: só com link assinado, pedido pago e autorização ativa */
      if (!hasTermsConsent(req)) return bad(res, 'Confirme a maioridade e aceite os Termos de Uso.', 403);
      const oid = sid(u.searchParams.get('o')), e = +u.searchParams.get('e');
      const deny = () => bad(res, 'Acesso negado ou link expirado.', 403);
      if (!oid || !Number.isFinite(e) || e < Date.now() || !teq(u.searchParams.get('s') || '', sign(mm[1] + oid + e))) return deny();
      const o = await T.one('orders', { id: eq(oid), item_id: eq(mm[1]), status: eq('paid') }); if (!o) return deny();
      const au = await T.one('authorizations', { order_id: eq(oid), account_id: eq(o.account_id), item_id: eq(o.item_id), revoked_at: isNull }); if (!au || !o.account_id || !o.item_id || String(au.email || '').toLowerCase() !== String(o.email || '').toLowerCase()) return deny();
      const it = await T.one('items', { id: eq(mm[1]) }); if (!it) return deny();
      return pipeUpstream(req, res, await openPrivateMedia('originals', base(it.original_file), req.headers.range), MIME[path.extname(it.original_file).toLowerCase()]);
    }
    let f = p === '/' ? 'index.html' : p === ADMIN_PATH || p === ADMIN_PATH + '/' ? 'admin.html' : p.startsWith('/acesso/') ? 'acesso.html' : p.startsWith('/pagamento/') ? 'pagamento.html' : p === '/privacidade' ? 'privacidade.html' : p === '/termos' ? 'termos.html' : p === '/recuperar' ? 'recuperar.html' : p.slice(1);
    if (f === 'admin.html' && !(p === ADMIN_PATH || p === ADMIN_PATH + '/')) return bad(res, 'Não encontrado.', 404);
    if (f === 'admin.html' || f === 'acesso.html' || f === 'pagamento.html' || f === 'recuperar.html') res.setHeader('X-Robots-Tag', 'noindex');
    const fp = path.join(PUB, f); if (!fp.startsWith(PUB + path.sep)) return bad(res, 'proibido', 403);
    sendFile(req, res, fp, MIME[path.extname(fp)] || 'application/octet-stream', 'no-cache');
  } catch (e) {
    logErr('erro na requisição ' + req.method + ' ' + String(req.url).split('?')[0], e); if (res.headersSent || !res.writable) return;
    if (e && [400, 408, 413].includes(e.status) && !(e instanceof SupaError)) return bad(res, e.message, e.status);
    if (e instanceof SupaError) return bad(res, 'Não foi possível acessar o banco de dados agora. Nada foi perdido; tente novamente em instantes.', 503);
    bad(res, 'Erro interno.', 500);
  }
});
srv.requestTimeout = 0;/* envios grandes (vídeos) precisam de tempo; leitura de JSON tem prazo próprio */
srv.on('error', e => { console.error(e.code === 'EADDRINUSE' ? 'A porta ' + PORT + ' já está em uso (talvez o GOLDREX já esteja rodando).' : 'Erro no servidor: ' + e.message); process.exit(1); });
srv.on('clientError', (e, sock) => { try { sock.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'); } catch { } });
let closing = false; const shutdown = (why, code) => { if (closing) return; closing = true; console.log('\nEncerrando (' + why + ')…'); try { srv.close(); } catch { } sse.users.forEach(x => x.forEach(r => { try { r.end(); } catch { } })); sse.admins.forEach(r => { try { r.end(); } catch { } }); setTimeout(() => { try { srv.closeAllConnections && srv.closeAllConnections(); } catch { } }, 1500).unref(); setTimeout(() => process.exit(code), 4000).unref(); srv.on('close', () => process.exit(code)); };
process.on('SIGINT', () => shutdown('SIGINT', 0)); process.on('SIGTERM', () => shutdown('SIGTERM', 0));
process.on('uncaughtException', e => { logErr('erro inesperado', e); shutdown('erro inesperado', 1); });
process.on('unhandledRejection', e => { logErr('promessa rejeitada', e); shutdown('promessa rejeitada', 1); });
srv.listen(...(HOST ? [PORT, HOST] : [PORT]), () => {
  console.log('GOLDREX em http://localhost:' + PORT + (ADMIN_PATH === '/admin' ? '  |  painel: http://localhost:' + PORT + '/admin' : '  |  painel: no endereço definido em ADMIN_PATH'));
  console.log('DropFans: integração aguardando documentação oficial; o onboarding não processa cobranças.');
  T.get('settings', { select: 'key', limit: 1 })
    .then(() => console.log('Supabase: conexão OK.'))
    .catch(e => {
      const detail = e && e.message ? e.message : 'erro desconhecido';
      console.error('AVISO: o servidor iniciou, mas a conexão de rede com o Supabase falhou (' + detail + '). Verifique a conectividade de saída/DNS da máquina e a disponibilidade do projeto. Este aviso, sozinho, não indica erro nas migrations nem nas chaves.');
    });
});
