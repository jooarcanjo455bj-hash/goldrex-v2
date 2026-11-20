/* GOLDREX · servidor
   Dados: Supabase (banco Postgres + Auth + Storage). Este servidor NÃO guarda nada importante no disco:
   pode ser reiniciado, atualizado ou trocado de máquina sem perder contas, fotos, compras ou pagamentos. */
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
require('./lib/env')(__dirname);
const { createSupa, SupaError, eq, lt, gt, isNull, inn } = require('./lib/supa');
const { placeholder } = require('./lib/payments');
const pix_ = require('./lib/pix');
const push_ = require('./lib/push');
const createDomain = require('./lib/domain');
const { id: rid, hash, eq: teq } = require('./lib/util');
const H = require('./lib/http'), { J, bad, body, cookie, addCookie, mkCookie, limited, isBlocked, strike, clearStrike, MIME, sendFile, pipeUpstream } = H;

const E = process.env, PORT = +E.PORT || 3000, HOST = String(E.HOST || '').trim(), MAXUP = (+E.MAX_UPLOAD_MB || 50) * 1048576, SECURE = E.HTTPS === 'true';
const STABLE_SECRET = typeof E.APP_SECRET === 'string' && E.APP_SECRET.length >= 32;
const ADMIN_PATH = '/' + (String(E.ADMIN_PATH || '/admin').replace(/^\/+|\/+$/g, '').replace(/[^\w\-\/]/g, '') || 'admin');
const PUB = path.join(__dirname, 'public'), TMP = path.join(os.tmpdir(), 'goldrex-uploads');
const logErr = (w, e) => console.error('[' + new Date().toISOString() + '] ' + w + ': ' + ((e && (e.stack || e.message)) || e));

/* ---------- configuração obrigatória ---------- */
const missing = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'].filter(k => !E[k]);
if (missing.length) { console.error('\nFaltam variáveis de ambiente: ' + missing.join(', ') + '\nCopie .env.example para .env (local) ou cadastre-as no .env da VPS. Veja docs/SUPABASE.md e docs/HOSTINGER.md.\n'); process.exit(1); }
if (E.NODE_ENV === 'production' && !/^https:\/\/[^/\s]+$/.test(String(E.SITE_URL || '').replace(/\/+$/, ''))) { console.error('\nEm produção, defina SITE_URL com o endereço público do site, começando com https:// (ex.: https://seudominio.com.br). Ele é usado para validar a origem dos pedidos.\n'); process.exit(1); }
let SECRET = E.APP_SECRET;
if (!SECRET || SECRET.length < 32) {
  if (E.NODE_ENV === 'production') { console.error('\nDefina APP_SECRET (mín. 32 caracteres) no ambiente de produção. Sem ele os links de conteúdo deixariam de valer a cada reinício.\n'); process.exit(1); }
  SECRET = rid(32); console.warn('AVISO: APP_SECRET não definido; usando um segredo temporário (links de conteúdo expiram ao reiniciar). Defina APP_SECRET no .env.');
}
fs.mkdirSync(TMP, { recursive: true });
try { fs.readdirSync(TMP).forEach(n => { try { fs.unlinkSync(path.join(TMP, n)); } catch { } }); } catch { }

const supa = createSupa({ url: E.SUPABASE_URL, anonKey: E.SUPABASE_ANON_KEY || E.SUPABASE_SERVICE_ROLE_KEY, serviceKey: E.SUPABASE_SERVICE_ROLE_KEY });
const SITE_MAIL = 'mailto:' + (E.PUSH_CONTACT || 'admin@example.com');
const T = supa.db, D = createDomain({ supa, env: E });
const { settings, setting, putSetting, audit, orderEvent, toProfile, prPub, toItem, iPub, toOrder, brl, ms, iso } = D;
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
const sse = { admins: new Set() };
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
      videos: areas.videos === true
    },
    colorsOn: x.colorsOn === true,
    counters: x.counters === true,
    howto: S(x.howto || '', 3000)
  };
};
const cl = v => { v = Math.round(+v || 0); return Number.isFinite(v) ? Math.min(Math.max(0, v), 1e8) : 0; };
const payProvider = () => 'manual';/* só Pix manual: o administrador confere e confirma no painel */
/* Pix: o que o administrador salva no painel vale; se estiver vazio, usa PIX_KEY / PIX_RECEIVER_NAME do .env */
const pixCfg = async () => { const c = await setting('pix') || {}; return { key: S(c.key, 140) || placeholder(E.PIX_KEY), receiver: S(c.receiver, 25) || placeholder(E.PIX_RECEIVER_NAME), city: S(c.city, 15) || placeholder(E.PIX_CITY) }; };
const baseUrl = req => (E.SITE_URL || ((req.headers['x-forwarded-proto'] || (req.socket.encrypted ? 'https' : 'http')).toString().split(',')[0] + '://' + (req.headers.host || 'localhost'))).replace(/\/+$/, '');

/* ---------- contas de clientes: só usuário + senha (sem e-mail, sem recuperação) ---------- */
const CLI_COOKIE = 'gr_s', CLI_TTL = 180 * 86400;
const cliUserOk = v => /^[a-z0-9._-]{3,20}$/.test(v);
const sess = new Map();/* id da conta -> {account, exp}: cache curto */
async function adminSessionOf(req, credential) {
  const session = parseAdminCookie(req, credential);
  return session ? { ...session, role: 'admin' } : null;
}
async function sessionOf(req) {
  const v = readSignedCookie(req, CLI_COOKIE); if (!v || typeof v.id !== 'string') return null;
  const c = sess.get(v.id); if (c && c.exp > Date.now()) return c;
  const account = await T.one('accounts', { id: eq(v.id) }); if (!account) return null;
  const s = { account, exp: Date.now() + 30e3 }; sess.set(v.id, s); if (sess.size > 5000) sess.clear(); return s;
}
const startSession = (res, account) => setSignedCookie(res, CLI_COOKIE, { id: account.id, exp: Date.now() + CLI_TTL * 1000 }, CLI_TTL);
const meOut = a => ({ user: a.email });
/* ---------- pedidos ---------- */
async function ctxFor(orders) {
  const itemIds = [...new Set(orders.map(o => o.itemId).filter(Boolean))], paidIds = orders.filter(o => o.status === 'paid').map(o => o.id);
  const [items, auths] = await Promise.all([itemIds.length ? T.get('items', { id: inn(itemIds) }) : [], paidIds.length ? T.get('authorizations', { order_id: inn(paidIds), revoked_at: isNull }) : []]);
  const IT = new Map(items.map(r => [r.id, toItem(r)]));
  const AU = new Set(orders.filter(o => o.status === 'paid' && o.accountId && o.itemId && auths.some(a => a.order_id === o.id && a.account_id === o.accountId && a.item_id === o.itemId)).map(o => o.id));
  return { out: o => D.orderOut(o, { item: IT.get(o.itemId), authorized: AU.has(o.id), signMedia }), IT };
}
let lastSweep = 0;
async function sweep() {/* pedidos pendentes há mais de 3 dias são cancelados (mantém o banco enxuto) */
  if (Date.now() - lastSweep < 600000) return; lastSweep = Date.now();
  const old = await T.get('orders', { status: eq('pending'), created_at: lt(iso(Date.now() - 3 * 864e5)), limit: 200 });
  for (const r of old) { const got = await T.patch('orders', { id: eq(r.id), status: eq('pending') }, { status: 'cancelled', note: 'expirou em 3 dias' }); if (got.length) { await T.patch('payments', { order_id: eq(r.id), status: eq('pending') }, { status: 'cancelled' }).catch(() => { }); orderEvent(r.id, 'pending', 'cancelled', 'sistema', 'expirou em 3 dias'); } }
}
async function notifyAdmin(title, text, orderId) {
  try {
    const subs = await setting('push_subs') || [], keep = [];
    if (!Array.isArray(subs) || !subs.length) return;
    const vapid = await getVapid(), payload = { title, body: text, url: ADMIN_PATH, orderId: orderId || '' };
    for (const s of subs) {
      try { await push_.send(s, payload, vapid, SITE_MAIL); keep.push(s); }
      catch (e) { if (e && (e.status === 404 || e.status === 410)) continue; keep.push(s); logErr('push', e); }
    }
    if (keep.length !== subs.length) await putSetting('push_subs', keep);
  } catch (e) { logErr('notificação ao administrador', e); }
}
async function getVapid() {
  let v = await setting('vapid');
  if (!v || !v.publicKey || !v.privateJwk) { v = push_.generateVapid(); await putSetting('vapid', v); }
  return v;
}
async function ensureProviderPayment(order) {
  if (!order.accountId) throw new Error('O pedido precisa estar vinculado a uma conta para registrar o pagamento.');
  const existing = await T.one('provider_payments', { order_id: eq(order.id) });
  if (existing) return existing;
  if (!(order.price > 0)) throw new Error('O pedido precisa ter valor maior que zero.');
  const row = { id: rid(8), order_id: order.id, account_id: order.accountId, reference: 'GR' + order.code, provider: payProvider(), amount_cents: order.price, currency: 'BRL' };
  try { const [created] = await T.insert('provider_payments', [row]); return created; }
  catch (error) {
    if (error.status !== 409) throw error;
    const raced = await T.one('provider_payments', { order_id: eq(order.id) });
    if (raced) return raced;
    throw error;
  }
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
  const m = req.method, ip = ipOf(req);
  if (m !== 'GET' && (req.headers['x-req'] !== '1' || !originAllowed(req))) return bad(res, 'Requisição inválida.', 403);
  const noTerms = () => bad(res, "Marque a caixa 'Li e aceito' para continuar.", 403);
  if (p === '/api/site') {
    await sweep();
    const ss = cookie(req, CLI_COOKIE) ? await sessionOf(req) : null, ageOk = hasTermsConsent(req);
    const [cfg, profs] = await Promise.all([settings(['site_live']), ageOk ? T.get('profiles', { published: eq(true), order: 'created_at.asc' }) : []]);
    const sel = profs.find(x => x.id === u.searchParams.get('p')) || profs[0];
    const its = sel ? await T.get('items', { profile_id: eq(sel.id), published: eq(true), order: 'created_at.desc' }) : [];
    const items = its.map(toItem);
    return J(res, 200, { ageOk, me: ss ? meOut(ss.account) : null, site: publicSite(cfg.site_live), profiles: profs.map(toProfile).map(prPub), profile: sel ? prPub(toProfile(sel)) : null,
      photos: items.filter(i => i.type === 'photo').map(iPub), videos: items.filter(i => i.type === 'video' || i.nv > 0).map(iPub) });
  }
  if (p === '/api/age' && m === 'POST') { if (limited(ip, 'age', 30)) return bad(res, 'Muitas tentativas.', 429); const b = await body(req); if (b.termsAccepted !== true) return bad(res, "Marque a caixa 'Li e aceito' para continuar.", 400); if (b.adult !== true) return bad(res, 'Confirme que você tem 18 anos ou mais.'); setTermsConsent(res); return J(res, 200, { ok: 1 }); }
  if (!hasTermsConsent(req)) return noTerms();
  if (p === '/api/door' && m === 'POST') { if (limited(ip, 'door', 10, 15 * 60e3)) return bad(res, 'Aguarde alguns minutos.', 429); const b = await body(req), w = S(b.word, 60).toLowerCase(), d = await setting('door'); if (!d || !d.salt || !d.hash || !teq(hash(w, d.salt), d.hash)) return bad(res, 'Comando não reconhecido.', 401); return J(res, 200, { go: ADMIN_PATH }); }

  /* --- contas de clientes --- */
  if (p === '/api/auth/me') { const ss = await sessionOf(req); return J(res, 200, { me: ss ? meOut(ss.account) : null }); }
  if (p === '/api/auth/signup' && m === 'POST') {
    if (limited(ip, 'su', 10, 60 * 60e3)) return bad(res, 'Muitas tentativas. Aguarde alguns minutos.', 429);
    const b = await body(req);
    if (b.termsAccepted !== true) return bad(res, "Marque a caixa 'Li e aceito' para continuar.", 400);
    const user = S(b.user, 40).toLowerCase(), pw = typeof b.password === 'string' ? b.password : '', pw2 = typeof b.password2 === 'string' ? b.password2 : '';
    if (!cliUserOk(user)) return bad(res, 'Usuário inválido. Use de 3 a 20 letras minúsculas, números, ponto, hífen ou underline.');
    if (pw.length < 6 || pw.length > 100) return bad(res, 'A senha precisa ter pelo menos 6 caracteres.');
    if (pw !== pw2) return bad(res, 'As duas senhas não são iguais.');
    const salt = crypto.randomBytes(16).toString('hex'), hh = (await deriveAdminHash(pw, salt)).toString('hex');
    let acc; try { [acc] = await T.insert('accounts', [{ id: crypto.randomUUID(), email: user, pass_salt: salt, pass_hash: hh }]); }
    catch (e) { if (e instanceof SupaError && e.status === 409) return bad(res, 'Este usuário já existe. Escolha outro.', 409); throw e; }
    startSession(res, acc); return J(res, 200, { ok: 1, me: meOut(acc) });
  }
  if (p === '/api/auth/login' && m === 'POST') {
    if (limited(ip, 'li', 30, 15 * 60e3)) return bad(res, 'Muitas tentativas. Aguarde alguns minutos.', 429);
    const b = await body(req), user = S(b.user, 40).toLowerCase(), key = 'acct:' + user;
    if (isBlocked(key)) return bad(res, 'Muitas tentativas. Aguarde 15 minutos.', 429);
    const acc = cliUserOk(user) ? await T.one('accounts', { email: eq(user) }) : null;
    let ok = false;
    if (acc && acc.pass_salt && acc.pass_hash) { const got = await deriveAdminHash(typeof b.password === 'string' ? b.password : '', acc.pass_salt), want = Buffer.from(acc.pass_hash, 'hex'); ok = got.length === want.length && crypto.timingSafeEqual(got, want); }
    if (!ok) { strike(key, 8, 15 * 60e3, 15 * 60e3); return bad(res, 'Usuário ou senha incorretos.', 401); }
    clearStrike(key); startSession(res, acc); return J(res, 200, { ok: 1, me: meOut(acc) });
  }
  if (p === '/api/auth/logout' && m === 'POST') { const v = readSignedCookie(req, CLI_COOKIE); if (v) sess.delete(v.id); addCookie(res, mkCookie(CLI_COOKIE, '', 0, SECURE)); return J(res, 200, { ok: 1 }); }

  /* --- pedidos --- */
  if (p === '/api/order' && m === 'POST') {
    if (limited(ip, 'co', 20)) return bad(res, 'Muitas tentativas. Aguarde um minuto.', 429); await sweep();
    const ss = await sessionOf(req); if (!ss) return bad(res, 'Entre na sua conta para comprar.', 401, { needLogin: true });
    const acc = ss.account, b = await body(req);
    if (!b.itemId) return bad(res, 'Pedido inválido.');
    const it = await T.one('items', { id: eq(sid(b.itemId)), published: eq(true) }), pr = it && await T.one('profiles', { id: eq(it.profile_id), published: eq(true) });
    if (!it || !pr) return bad(res, 'Item indisponível.', 404); if (!(it.price_cents > 0)) return bad(res, 'Este item ainda não tem preço definido.');
    if (await T.count('orders', { account_id: eq(acc.id), status: eq('pending') }) >= 10) {
      const existing = await T.one('orders', { account_id: eq(acc.id), item_id: eq(it.id), type: eq('item'), status: eq('pending') });
      if (!existing) return bad(res, 'Você tem muitos pedidos aguardando pagamento. Pague ou aguarde alguns dias.', 429);
    }
    const o = await newItemOrder(acc, it);
    if (o.status === 'paid') return bad(res, 'Você já comprou este item. Veja em Compras.', 409);
    if (o.status === 'pending') {
      try { await ensureProviderPayment(o); }
      catch (e) { logErr('registro do pagamento do pedido ' + o.code, e); return bad(res, 'Seu pedido foi criado, mas não foi possível preparar o pagamento. Tente novamente em instantes.', 503, { retryable: true, token: o.token }); }
    }
    push(sse.admins, { t: 'order' });
    return J(res, 200, { token: o.token });
  }
  let mm;
  const tokenGuard = () => limited(ip, 'ot', 120) || isBlocked('tk:' + ip);
  if ((mm = p.match(/^\/api\/order\/(\w+)\/paid$/)) && m === 'POST') {/* cliente avisa que já pagou o Pix: só manda notificação ao administrador */
    if (tokenGuard() || limited(ip, 'claim', 6, 10 * 60e3)) return bad(res, 'Muitas tentativas. Aguarde alguns minutos.', 429);
    const r = await T.one('orders', { token: eq(mm[1]) }); if (!r) { strike('tk:' + ip, 15, 10 * 60e3, 15 * 60e3); return bad(res, 'Pedido não encontrado.', 404); }
    if (r.status !== 'pending') return J(res, 200, { ok: 1 });
    if (r.note !== 'CLAIMED') { await T.patch('orders', { id: eq(r.id), status: eq('pending') }, { note: 'CLAIMED' }); }
    push(sse.admins, { t: 'order' }); if (r.note !== 'CLAIMED') notifyAdmin('Cliente avisou que pagou', brl(r.price_cents) + ' · ' + r.email + ' · pedido ' + r.code, r.id);
    return J(res, 200, { ok: 1 });
  }
  if ((mm = p.match(/^\/api\/pagamento\/(\w+)$/)) && m === 'GET') {
    if (tokenGuard()) return bad(res, 'Muitas tentativas. Aguarde alguns minutos.', 429);
    const row = await T.one('orders', { token: eq(mm[1]) });
    if (!row) { strike('tk:' + ip, 15, 10 * 60e3, 15 * 60e3); return bad(res, 'Pedido não encontrado.', 404); }
    const o = toOrder(row);
    let payment = await T.one('provider_payments', { order_id: eq(o.id) });
    if (!payment && o.status === 'pending' && o.accountId) payment = await ensureProviderPayment(o);
    const status = o.status === 'paid' || (payment && payment.status === 'confirmed') ? 'confirmed' : o.status !== 'pending' ? 'failed' : 'pending';
    const px = status === 'pending' ? await pixCfg() : { key: '', receiver: '' };
    return J(res, 200, { status, reference: payment ? payment.reference : 'GR' + o.code, amountCents: o.price, claimed: row.note === 'CLAIMED',
      pixKey: px.key, pixReceiver: px.receiver, pixCode: px.key ? pix_.payload(px, o.price, 'GR' + o.code) : '' });
  }
  if (p === '/api/my' && m === 'POST') {
    if (limited(ip, 'my', 60)) return bad(res, 'Muitas tentativas. Aguarde alguns minutos.', 429);
    const ss = await sessionOf(req); if (!ss) return J(res, 200, { orders: [], needLogin: true });
    const orders = (await T.get('orders', { account_id: eq(ss.account.id), order: 'created_at.desc', limit: 100 })).map(toOrder), c = await ctxFor(orders);
    return J(res, 200, { orders: orders.map(o => c.out(o)) });
  }
  bad(res, 'Rota não encontrada.', 404);
}

/* ---------- API do painel administrativo ---------- */
const pf = b => ({ name: S(b.name, 60), username: S(b.user, 40).replace(/^@?/, '@'), bio: S(b.bio, 200), avatar: up(b.avatar), verified: !!b.verified, published: !!b.published });
async function admData(a) {
  const [profiles, items, orderRows] = await Promise.all([
    T.get('profiles', { order: 'created_at.asc' }),
    T.get('items', { order: 'created_at.desc' }),
    T.get('orders', { order: 'created_at.desc', limit: 300 })
  ]);
  const its = items.map(toItem), IT = new Map(its.map(i => [i.id, i]));
  const orders = orderRows.map(o => ({ id: o.id, code: o.code, user: o.email, title: o.item_id ? (IT.get(o.item_id) || { title: '(conteúdo removido)' }).title : 'Conteúdo', price: o.price_cents, status: o.status, claimed: o.status === 'pending' && o.note === 'CLAIMED', createdAt: ms(o.created_at) }))
    .sort((x, y) => (x.status === 'pending' ? 0 : 1) - (y.status === 'pending' ? 0 : 1) || (+y.claimed - +x.claimed));
  return { role: 'admin', me: a.username, site: publicSite((await settings(['site_live'])).site_live), profiles: profiles.map(toProfile), items: its, orders, stats: { pending: orders.filter(o => o.status === 'pending').length, paid: orders.filter(o => o.status === 'paid').length }, pix: await (async () => { const c = await pixCfg(); return { ...c, code: pix_.payload(c, 0, '') }; })() };
}
const EXT_SIG = { '.jpg': 'jpg', '.jpeg': 'jpg', '.png': 'png', '.webp': 'webp', '.mp4': 'mp4', '.webm': 'webm', '.mov': 'mov' }, EXT_MIME = { '.jpg': ['image/jpeg'], '.jpeg': ['image/jpeg'], '.png': ['image/png'], '.webp': ['image/webp'], '.mp4': ['video/mp4'], '.webm': ['video/webm'], '.mov': ['video/quicktime', 'video/mp4'] };
const L = (b, a, z) => b.toString('latin1', a, z), SIG = { jpg: b => b.length > 3 && b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF, png: b => b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])), webp: b => b.length >= 12 && L(b, 0, 4) === 'RIFF' && L(b, 8, 12) === 'WEBP', webm: b => b.length >= 4 && b[0] === 0x1A && b[1] === 0x45 && b[2] === 0xDF && b[3] === 0xA3, mp4: b => b.length >= 12 && L(b, 4, 8) === 'ftyp', mov: b => b.length >= 12 && (L(b, 4, 8) === 'ftyp' || ['moov', 'mdat', 'wide', 'free', 'skip', 'pnot'].includes(L(b, 4, 8))) };
const base = f => path.basename(String(f || ''));
async function delItem(x) {/* apaga o original (bucket privado), as prévias (bucket público) e a linha do banco */
  try { await supa.storage.remove('originals', (x.files && x.files.length ? x.files : [x.file]).map(base)); const pv = [x.preview, x.cover, x.teaser].filter(Boolean).map(base); if (pv.length) await supa.storage.remove('previews', pv); } catch (e) { logErr('aviso: arquivo não removido do Storage', e); }
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
    if (existing) {/* já existe acesso: só substitui quem tem o código de segurança do servidor (ADMIN_SETUP_CODE ou, se não houver, o APP_SECRET do .env) */
      const need = String(E.ADMIN_SETUP_CODE || '') || E.APP_SECRET;
      if (!safeEqualText(b.setupCode, need)) return bad(res, 'Código de segurança incorreto.', 403);
      const fresh = await makeAdminCredential(username, password);
      await T.patch('settings', { key: eq('admin_credential') }, { value: fresh, updated_at: new Date().toISOString() });
      clearAdminCookie(res); await audit(username, 'acesso administrativo recriado', '');
      return J(res, 200, { ok: 1 });
    }
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
    if (limited(ip, 'alog', 20, 2 * 60e3)) return bad(res, 'Muitas tentativas. Aguarde 2 minutos.', 429);
    const b = await body(req), username = adminUsername(b.username), password = adminPassword(b.password);
    const key = 'admin:' + (username || 'invalid');
    if (!STABLE_SECRET) return bad(res, 'A autenticação administrativa não está configurada corretamente.', 503);
    if (isBlocked(key)) return bad(res, 'Muitas tentativas. Aguarde 2 minutos.', 429);
    const row = await adminCredentialRow(), credential = row && row.value;
    const valid = await verifyAdminCredential(credential, username, password);
    if (!valid) { strike(key, 10, 5 * 60e3, 2 * 60e3); return bad(res, 'Usuário ou senha inválidos.', 401); }
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
  if (p === '/api/admin/push/key' && m === 'GET') return J(res, 200, { key: (await getVapid()).publicKey });
  if (p === '/api/admin/push/subscribe' && m === 'POST') {
    b = await body(req); const s = b.subscription;
    if (!s || typeof s.endpoint !== 'string' || !/^https:\/\/[^\s]{10,600}$/.test(s.endpoint) || !s.keys || typeof s.keys.p256dh !== 'string' || typeof s.keys.auth !== 'string') return bad(res, 'Inscrição inválida.');
    const clean = { endpoint: s.endpoint, keys: { p256dh: S(s.keys.p256dh, 120), auth: S(s.keys.auth, 60) } };
    const subs = (await setting('push_subs') || []).filter(x => x.endpoint !== clean.endpoint); subs.push(clean);
    await putSetting('push_subs', subs.slice(-10)); return J(res, 200, { ok: 1 });
  }
  if (p === '/api/admin/site' && m === 'POST') {
    b = await body(req); const brand = S(b.brand, 40);
    if (!brand) return bad(res, 'Informe o nome do site.');
    const cur = publicSite((await settings(['site_live'])).site_live), ar = b.areas && typeof b.areas === 'object' ? b.areas : {};
    const next = { ...cur, brand, howto: S(b.howto, 3000), areas: { fotos: ar.fotos === true, videos: ar.videos === true }, colorsOn: b.colorsOn === true };
    if (next.colorsOn) for (const k of ['accent', 'gold', 'bg']) { if (!/^#[0-9a-fA-F]{6}$/.test(String(b[k]))) return bad(res, 'Cor inválida.'); next[k] = String(b[k]); }
    await putSetting('site_live', next); await audit(a.username, 'site alterado', ''); return J(res, 200, { ok: 1 });
  }
  if (p === '/api/admin/pix' && m === 'POST') {
    b = await body(req); const key = S(b.key, 140), receiver = S(b.receiver, 25), city = S(b.city, 15);
    if (!key) return bad(res, 'Informe a chave Pix.');
    if (!receiver) return bad(res, 'Informe o nome de quem recebe.');
    await putSetting('pix', { key, receiver, city }); await audit(a.username, 'chave Pix alterada', ''); return J(res, 200, { ok: 1 });
  }
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
    const d = {
      title: S(b.title, 100), price_cents: cl(b.price), preview: up(b.preview), cover: up(b.cover),
      teaser: up(b.teaser), duration: Math.max(0, Math.round(+b.duration || 0)), published: !!b.published
    };
    if (!d.title) return bad(res, 'Informe o título.'); if (d.published && !(d.price_cents > 0)) return bad(res, 'Defina um preço maior que zero para publicar.');
    const x0 = b.id && await T.one('items', { id: eq(sid(b.id)) });
    if (b.bio) d.bio = S(b.bio, 600); else if (x0 && x0.bio) d.bio = '';
    if (x0) { const [r] = await T.patch('items', { id: eq(x0.id) }, d); return J(res, 200, toItem(r)); }
    const list = (Array.isArray(b.files) && b.files.length ? b.files : [b.file]).slice(0, 1000).map(f => base(S(f, 80))), file = list.join(','), type = list.length && list.every(f => /\.(mp4|webm|mov)$/i.test(f)) ? 'video' : 'photo'; if (!(await T.one('profiles', { id: eq(sid(b.profileId)) }))) return bad(res, 'Escolha o perfil.');
    if (!list.length || !list.every(f => /^[\w.\-]{3,80}$/.test(f))) return bad(res, 'Envie o arquivo.'); try { for (let k = 0; k < list.length; k += 10) await Promise.all(list.slice(k, k + 10).map(f => supa.storage.sign('originals', f, 30))); } catch { return bad(res, 'Envie o arquivo.'); }
    const [r] = await T.insert('items', [{ id: rid(5), profile_id: sid(b.profileId), type, original_file: file, ...d }]); await audit(a.username, type === 'video' ? 'vídeo adicionado' : 'foto adicionada', d.title); return J(res, 200, toItem(r));
  }
  if ((mm = p.match(/^\/api\/admin\/item\/(\w+)$/)) && m === 'DELETE') { const x = await T.one('items', { id: eq(mm[1]) }); if (x) { await delItem(toItem(x)); await audit(a.username, 'item excluído', x.title); } return J(res, 200, { ok: 1 }); }

  /* pedidos, pagamentos e liberações */
  if ((mm = p.match(/^\/api\/admin\/order\/(\w+)\/(confirm|reject|revoke)$/)) && m === 'POST') {
    if (mm[2] === 'confirm') {
      const r0 = await T.one('orders', { id: eq(mm[1]) }); if (!r0) return bad(res, 'Pedido não encontrado.', 404);
      if (r0.status !== 'pending') return bad(res, 'Este pedido não está pendente.');
      const bc = await body(req);
      if (!(await T.rpc('confirm_order', { p_order: r0.id, p_by: a.username, p_note: S(bc.note, 200), p_source: 'admin', p_auth_id: rid(8) }))) return bad(res, 'Não foi possível confirmar.');
      await audit(a.username, 'pagamento confirmado manualmente', r0.code); push(sse.admins, { t: 'order' }); return J(res, 200, { ok: 1 });
    }
    const r = await T.one('orders', { id: eq(mm[1]) }); if (!r) return bad(res, 'Pedido não encontrado.', 404); b = await body(req); const o = toOrder(r), note = S(b.note, 200);
    if (mm[2] === 'revoke') { if (o.status !== 'paid') return bad(res, 'Só é possível revogar pedidos pagos.'); if (!note) return bad(res, 'Informe o motivo da revogação.'); if (!(await T.rpc('revoke_access', { p_order: o.id, p_by: a.username, p_note: note }))) return bad(res, 'Não foi possível revogar.'); await audit(a.username, 'acesso revogado', o.code + ' ' + note); return J(res, 200, { ok: 1 }); }
    if (mm[2] !== 'reject') return bad(res, 'Operação inválida.', 400);
    if (o.status !== 'pending') return bad(res, 'Este pedido não está pendente.');
    const got = await T.patch('orders', { id: eq(o.id), status: eq('pending') }, { status: 'rejected', paid_by: a.username, note });
    if (got.length) {
      await T.patch('payments', { order_id: eq(o.id) }, { status: 'rejected', note });
      await T.patch('provider_payments', { order_id: eq(o.id), status: eq('pending') }, { status: 'failed', updated_at: iso(Date.now()) });
      orderEvent(o.id, 'pending', 'rejected', a.username, note); await audit(a.username, 'pedido recusado', o.code);
    }
    return J(res, 200, { ok: 1 });
  }
  if (p === '/api/admin/authorize' && m === 'POST') return bad(res, 'A liberação sem pagamento foi desativada; o conteúdo só é liberado após a confirmação do pagamento.', 403);


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
      const fl = String(it.original_file).split(',').filter(Boolean), nth = Math.max(0, parseInt(u.searchParams.get('n'), 10) || 0); if (nth >= fl.length) return deny();
      return pipeUpstream(req, res, await openPrivateMedia('originals', base(fl[nth]), req.headers.range), MIME[path.extname(fl[nth]).toLowerCase()]);
    }
    if (p === '/admin.webmanifest') {/* só entrega para quem já está logado no painel (não revela o endereço secreto) */
      const row = await adminCredentialRow(); if (!(await adminSessionOf(req, row && row.value))) return bad(res, 'Não encontrado.', 404);
      res.writeHead(200, { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify({ name: 'GOLDREX Admin', short_name: 'Admin', start_url: ADMIN_PATH, scope: '/', display: 'standalone', background_color: '#07030c', theme_color: '#07030c', icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }, { src: '/icon-512.png', sizes: '512x512', type: 'image/png' }] }));
    }
    // Bloqueia explicitamente a antiga rota de recuperação, mesmo se um deploy
    // por cópia deixar um JS obsoleto no diretório public/js.
    if (p === '/recuperar' || p === '/js/recuperar.js' || p.startsWith('/acesso/')) {
      res.writeHead(404, { 'Cache-Control': 'no-store' });
      return res.end('404');
    }
    let f = p === '/' ? 'index.html' : p === ADMIN_PATH || p === ADMIN_PATH + '/' ? 'admin.html' : p.startsWith('/pagamento/') ? 'pagamento.html' : p === '/privacidade' ? 'privacidade.html' : p === '/termos' ? 'termos.html' : p.slice(1);
    if (f === 'admin.html' && !(p === ADMIN_PATH || p === ADMIN_PATH + '/')) return bad(res, 'Não encontrado.', 404);
    if (f === 'admin.html' || f === 'pagamento.html') res.setHeader('X-Robots-Tag', 'noindex');
    const fp = path.join(PUB, f); if (!fp.startsWith(PUB + path.sep)) return bad(res, 'proibido', 403);
    sendFile(req, res, fp, MIME[path.extname(fp)] || 'application/octet-stream', 'no-store');
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
let closing = false; const shutdown = (why, code) => { if (closing) return; closing = true; console.log('\nEncerrando (' + why + ')…'); try { srv.close(); } catch { } sse.admins.forEach(r => { try { r.end(); } catch { } }); setTimeout(() => { try { srv.closeAllConnections && srv.closeAllConnections(); } catch { } }, 1500).unref(); setTimeout(() => process.exit(code), 4000).unref(); srv.on('close', () => process.exit(code)); };
process.on('SIGINT', () => shutdown('SIGINT', 0)); process.on('SIGTERM', () => shutdown('SIGTERM', 0));
process.on('uncaughtException', e => { logErr('erro inesperado', e); shutdown('erro inesperado', 1); });
process.on('unhandledRejection', e => { logErr('promessa rejeitada', e); shutdown('promessa rejeitada', 1); });
srv.listen(...(HOST ? [PORT, HOST] : [PORT]), () => {
  console.log('GOLDREX em http://localhost:' + PORT + (ADMIN_PATH === '/admin' ? '  |  painel: http://localhost:' + PORT + '/admin' : '  |  painel: no endereço definido em ADMIN_PATH'));
  console.log('Pagamento: Pix com QR Code automático (o administrador confirma em Pedidos).');
  T.get('settings', { select: 'key', limit: 1 })
    .then(() => console.log('Supabase: conexão OK.'))
    .catch(e => {
      const detail = e && e.message ? e.message : 'erro desconhecido';
      console.error('AVISO: o servidor iniciou, mas a conexão de rede com o Supabase falhou (' + detail + '). Verifique a conectividade de saída/DNS da máquina e a disponibilidade do projeto. Este aviso, sozinho, não indica erro nas migrations nem nas chaves.');
    });
});
