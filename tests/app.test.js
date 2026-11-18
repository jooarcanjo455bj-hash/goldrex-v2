/* Testes do GOLDREX contra um Supabase SIMULADO (tests/mock-supabase.js). Rodar: npm test (sem internet). */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const crypto = require('node:crypto');
const mock = require('./mock-supabase');
const push = require('../lib/push');

const MPORT = 54300, SPORT = 54301, BASE = 'http://127.0.0.1:' + SPORT, ROOT = path.join(__dirname, '..'), SECRET = 'z'.repeat(40);
const ENV = { ...process.env, PORT: String(SPORT), SUPABASE_URL: 'http://127.0.0.1:' + MPORT, SUPABASE_SERVICE_ROLE_KEY: mock.SERVICE, APP_SECRET: SECRET, SITE_URL: BASE, NODE_ENV: 'test', TRUST_PROXY: 'true', PIX_KEY: 'pix@goldrex.test', PIX_RECEIVER_NAME: 'Recebedor Teste' };
let M, proc; const S = {};
function startServer() {
  return new Promise((ok, no) => {
    proc = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: ENV }); let out = '';
    proc.stdout.on('data', d => { out += d; if (out.includes('Pagamento:')) ok(out); }); proc.stderr.on('data', d => { out += d; });
    proc.on('exit', c => no(new Error('servidor saiu (' + c + '): ' + out))); setTimeout(() => no(new Error('timeout: ' + out)), 8000);
  });
}
function browser(age = true) {
  const jar = new Map();
  if (age) { const payload = Buffer.from(JSON.stringify({ purpose: 'terms-v1', accepted: true, exp: Date.now() + 30 * 864e5 })).toString('base64url'); jar.set('age', payload + '.' + crypto.createHmac('sha256', SECRET).update('age.' + payload).digest('hex')); }
  const api = async (method, p, { json, headers = {}, body } = {}) => {
    const h = { 'x-req': '1', ...headers, cookie: [...jar].map(([k, v]) => k + '=' + v).join('; ') };
    if (json !== undefined) h['content-type'] = 'application/json';
    const res = await fetch(BASE + p, { method, headers: h, body: json !== undefined ? JSON.stringify(json) : body, duplex: body ? 'half' : undefined, redirect: 'manual' });
    for (const c of res.headers.getSetCookie()) { const [kv] = c.split(';'), i = kv.indexOf('='), k = kv.slice(0, i), v = kv.slice(i + 1); if (/Max-Age=0/.test(c) || v === '') jar.delete(k); else jar.set(k, v); }
    const t = await res.text(); let j = null; try { j = JSON.parse(t); } catch { } return { status: res.status, json: j, text: t, headers: res.headers };
  };
  return { api, get: p => api('GET', p), post: (p, json) => api('POST', p, { json: json || {} }) };
}
const tinyJpg = (n, seed) => { const b = crypto.createHash('sha256').update(seed).digest(); const x = Buffer.alloc(n); for (let i = 0; i < n; i++) x[i] = b[i % 32]; x[0] = 0xFF; x[1] = 0xD8; x[2] = 0xFF; return x; };
before(async () => { M = await mock.start(MPORT); S.log = await startServer(); });
after(async () => { if (proc) { proc.removeAllListeners('exit'); proc.kill('SIGTERM'); } await M.close(); });

test('1. páginas no ar, sem páginas de e-mail/recuperação, tela 18+ obrigatória', async () => {
  const b = browser(false);
  for (const p of ['/', '/admin', '/privacidade', '/termos', '/style.css', '/js/app.js', '/sw.js', '/healthz']) assert.equal((await b.get(p)).status, 200, p);
  for (const p of ['/recuperar', '/acesso/abc', '/js/recuperar.js']) assert.equal((await b.get(p)).status, 404, p);
  assert.equal((await b.get('/admin.webmanifest')).status, 404, 'manifesto do painel só para admin logado');
  assert.equal((await b.get('/api/site')).json.ageOk, false);
  assert.equal((await b.post('/api/auth/signup', { user: 'maria', password: '123456', password2: '123456', termsAccepted: true })).status, 403, 'sem 18+ não cria conta');
  for (const p of ['/api/auth/recover', '/api/auth/reset', '/api/auth/google/start', '/api/webhook/pagamento', '/api/chat/open']) assert.equal((await b.post(p, {})).status, 403, p + ' (sem acesso)');
  assert.equal((await browser().post('/api/auth/recover', { email: 'a@b.com' })).status, 404, 'recuperação por e-mail não existe');
});

test('2. conta só com usuário e senha: confirma senha, não repete usuário, não usa e-mail', async () => {
  const c = browser();
  assert.equal((await c.post('/api/auth/signup', { user: 'Ma', password: '123456', password2: '123456', termsAccepted: true })).status, 400);
  assert.equal((await c.post('/api/auth/signup', { user: 'maria@x.com', password: '123456', password2: '123456', termsAccepted: true })).status, 400, 'usuário não aceita @');
  assert.equal((await c.post('/api/auth/signup', { user: 'maria', password: '12345', password2: '12345', termsAccepted: true })).status, 400, 'senha curta');
  const diff = await c.post('/api/auth/signup', { user: 'maria', password: '123456', password2: '654321', termsAccepted: true });
  assert.equal(diff.status, 400); assert.match(diff.json.error, /iguais/);
  assert.equal((await c.post('/api/auth/signup', { user: 'maria', password: '123456', password2: '123456' })).status, 400, 'exige aceite');
  const ok = await c.post('/api/auth/signup', { user: 'Maria', password: 'minha-senha', password2: 'minha-senha', termsAccepted: true });
  assert.equal(ok.status, 200); assert.equal(ok.json.me.user, 'maria');
  assert.equal((await c.get('/api/auth/me')).json.me.user, 'maria');
  assert.equal((await browser().post('/api/auth/signup', { user: 'maria', password: 'outra-senha', password2: 'outra-senha', termsAccepted: true })).status, 409, 'usuário repetido');
  const row = M.st.tables.accounts[0]; assert.equal(row.email, 'maria'); assert.ok(row.pass_hash && row.pass_salt); assert.ok(!JSON.stringify(row).includes('minha-senha'), 'senha só como hash');
  assert.equal(M.st.users.size, 0, 'nada criado no Supabase Auth (sem e-mail de verificação)');
  assert.equal(M.st.calls.filter(x => x.includes('/auth/v1')).length, 0, 'nenhuma chamada ao Auth');
  const d = browser(); assert.equal((await d.post('/api/auth/login', { user: 'maria', password: 'errada' })).status, 401);
  assert.equal((await d.post('/api/auth/login', { user: 'maria', password: 'minha-senha' })).status, 200);
  await d.post('/api/auth/logout', {}); assert.equal((await d.get('/api/auth/me')).json.me, null);
  const e = browser(); for (let i = 0; i < 8; i++) await e.post('/api/auth/login', { user: 'maria', password: 'x' + i });
  assert.equal((await e.post('/api/auth/login', { user: 'maria', password: 'minha-senha' })).status, 429, 'bloqueia tentativas em excesso');
});

test('3. compra por Pix manual: pedido, "já paguei", confirmação do admin e liberação', async () => {
  S.admin = browser(); assert.equal((await S.admin.post('/api/admin/signup', { username: 'admin', password: 'senha-forte-1' })).status, 200);
  assert.equal((await S.admin.post('/api/admin/signup', { username: 'outro', password: 'senha-forte-1' })).status, 403, 'acesso do admin só pode ser criado uma vez');
  assert.equal((await S.admin.post('/api/admin/login', { username: 'admin', password: 'senha-forte-1' })).status, 200);
  const prof = await S.admin.post('/api/admin/profile', { name: 'Perfil', user: 'perfil', bio: 'b', published: true, verified: true });
  const up1 = await S.admin.api('PUT', '/api/admin/upload?kind=cover&name=p.jpg', { body: tinyJpg(300, 'p'), headers: { 'content-type': 'image/jpeg' } });
  const up2 = await S.admin.api('PUT', '/api/admin/upload?kind=photo&name=f.jpg', { body: tinyJpg(4000, 'o'), headers: { 'content-type': 'image/jpeg' } });
  const item = await S.admin.post('/api/admin/item', { profileId: prof.json.id, type: 'photo', file: up2.json.file, title: 'Foto', price: 1500, preview: up1.json.url, published: true });
  assert.equal(item.status, 200);
  assert.equal((await browser().get('/api/site')).json.photos.length, 1);

  S.c = browser(); await S.c.post('/api/auth/signup', { user: 'joao', password: 'senha123', password2: 'senha123', termsAccepted: true });
  assert.equal((await browser().post('/api/order', { itemId: item.json.id })).status, 401, 'sem conta não compra');
  const ord = await S.c.post('/api/order', { itemId: item.json.id }); assert.equal(ord.status, 200); S.token = ord.json.token;
  const pay = (await S.c.get('/api/pagamento/' + S.token)).json;
  assert.deepEqual([pay.status, pay.amountCents, pay.pixKey, pay.pixReceiver, pay.claimed], ['pending', 1500, 'pix@goldrex.test', 'Recebedor Teste', false]);
  assert.ok(!(await S.c.get('/api/my')).json.orders && (await S.c.post('/api/my', {})).json.orders[0].status === 'pending');
  assert.ok(!(await S.c.post('/api/my', {})).json.orders[0].media, 'nada liberado antes da confirmação');

  assert.equal((await S.c.post('/api/admin/order/x/confirm', {})).status, 401, 'cliente não confirma');
  assert.equal((await S.c.post('/api/order/' + S.token + '/paid', {})).status, 200);
  assert.equal((await S.c.get('/api/pagamento/' + S.token)).json.claimed, true);
  const data = (await S.admin.get('/api/admin/data')).json;
  assert.equal(data.orders[0].claimed, true); assert.equal(data.orders[0].user, 'joao'); assert.equal(data.pix.key, 'pix@goldrex.test'); assert.equal(data.stats.pending, 1);
  assert.equal((await S.admin.get('/admin.webmanifest')).status, 200);
  assert.equal((await S.admin.post('/api/admin/order/' + data.orders[0].id + '/confirm', { note: 'Pix conferido' })).status, 200);
  assert.equal((await S.admin.post('/api/admin/order/' + data.orders[0].id + '/confirm', {})).status, 400, 'não confirma duas vezes');
  const my = (await S.c.post('/api/my', {})).json.orders[0]; assert.equal(my.status, 'paid'); assert.ok(my.media && my.media.url);
  const media = await S.c.get(my.media.url); assert.equal(media.status, 200);
  assert.equal((await browser(false).get(my.media.url)).status, 403, 'sem aceite 18+ não abre');
  assert.equal((await S.c.get('/api/pagamento/' + S.token)).json.status, 'confirmed');
});

test('4. admin recusa e remove acesso; produto e pedido têm código', async () => {
  const item = (await S.admin.get('/api/admin/data')).json.items[0];
  const c2 = browser(); await c2.post('/api/auth/signup', { user: 'ana', password: 'senha123', password2: 'senha123', termsAccepted: true });
  const o = await c2.post('/api/order', { itemId: item.id }), id = (await S.admin.get('/api/admin/data')).json.orders.find(x => x.user === 'ana').id;
  assert.equal((await S.admin.post('/api/admin/order/' + id + '/reject', { note: 'não achei o Pix' })).status, 200);
  assert.equal((await c2.get('/api/pagamento/' + o.json.token)).json.status, 'failed');
  const paid = (await S.admin.get('/api/admin/data')).json.orders.find(x => x.user === 'joao');
  assert.equal((await S.admin.post('/api/admin/order/' + paid.id + '/revoke', { note: 'teste' })).status, 200);
  assert.ok(!(await S.c.post('/api/my', {})).json.orders[0].media, 'acesso removido');
  assert.ok(item.id && (await S.admin.get('/api/admin/data')).json.orders.every(x => x.code));
});

test('5. push: criptografia Web Push (RFC 8291) abre no aparelho e o VAPID é assinado', () => {
  const ua = crypto.createECDH('prime256v1'); ua.generateKeys(); const auth = crypto.randomBytes(16);
  const sub = { endpoint: 'https://push.example/abc', keys: { p256dh: ua.getPublicKey().toString('base64url'), auth: auth.toString('base64url') } };
  const body = push.encrypt(sub, { title: 'Novo pedido', body: 'R$ 15,00' });
  const salt = body.subarray(0, 16), rs = body.readUInt32BE(16), idlen = body[20], asPub = body.subarray(21, 21 + idlen), ct = body.subarray(21 + idlen);
  assert.equal(rs, 4096); assert.equal(idlen, 65);
  const secret = ua.computeSecret(asPub);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', secret, auth, Buffer.concat([Buffer.from('WebPush: info\0'), ua.getPublicKey(), asPub]), 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16)), nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce); d.setAuthTag(ct.subarray(ct.length - 16));
  const plain = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
  assert.equal(plain[plain.length - 1], 2); assert.deepEqual(JSON.parse(plain.subarray(0, -1).toString()), { title: 'Novo pedido', body: 'R$ 15,00' });
  const v = push.generateVapid(), h = push.vapidHeader(sub.endpoint, v, 'mailto:a@b.com'), [, jwt, k] = /^vapid t=(\S+), k=(\S+)$/.exec(h);
  assert.equal(k, v.publicKey); const [hd, cl, sg] = jwt.split('.');
  const pub = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: Buffer.from(k, 'base64url').subarray(1, 33).toString('base64url'), y: Buffer.from(k, 'base64url').subarray(33).toString('base64url') }, format: 'jwk' });
  assert.ok(crypto.verify('sha256', Buffer.from(hd + '.' + cl), { key: pub, dsaEncoding: 'ieee-p1363' }, Buffer.from(sg, 'base64url')));
  assert.equal(JSON.parse(Buffer.from(cl, 'base64url')).aud, 'https://push.example');
});

test('6. admin: salvar inscrição de notificação e chave pública', async () => {
  assert.equal((await S.admin.get('/api/admin/push/key')).status, 200);
  assert.equal((await browser().get('/api/admin/push/key')).status, 401);
  assert.equal((await S.admin.post('/api/admin/push/subscribe', { subscription: { endpoint: 'http://x', keys: {} } })).status, 400);
  const ua = crypto.createECDH('prime256v1'); ua.generateKeys();
  assert.equal((await S.admin.post('/api/admin/push/subscribe', { subscription: { endpoint: 'https://127.0.0.1:9/push/abc123', keys: { p256dh: ua.getPublicKey().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') } } })).status, 200);
  assert.equal(M.st.tables.settings.find(x => x.key === 'push_subs').value.length, 1);
});

test('7. card Site: só o admin salva; nome, textos, abas e cores aparecem no site público e voltam ao padrão', async () => {
  const pub = () => browser().get('/api/site').then(r => r.json.site);
  const antes = await pub();
  assert.equal(antes.brand, 'GOLDREX'); assert.equal(antes.colorsOn, false);
  const dados = await S.admin.get('/api/admin/data'); assert.equal(dados.status, 200);
  assert.equal(dados.json.site.brand, 'GOLDREX'); const pixAntes = dados.json.pix.key;
  const corpo = { brand: 'Minha Marca', howto: 'Passo 1\nPasso 2', areas: { fotos: true, videos: false }, colorsOn: true, accent: '#112233', gold: '#aabbcc', bg: '#010203' };
  assert.ok((await browser().post('/api/admin/site', corpo)).status >= 400, 'sem login não pode salvar');
  assert.equal((await S.c.post('/api/admin/site', corpo)).status >= 400, true, 'cliente comum não pode salvar');
  assert.equal((await S.admin.post('/api/admin/site', corpo)).status, 200);
  const dep = await pub();
  assert.equal(dep.brand, 'Minha Marca'); assert.equal(dep.howto, 'Passo 1\nPasso 2');
  assert.deepEqual(dep.areas, { fotos: true, videos: false }); assert.equal(dep.colorsOn, true);
  assert.equal(dep.accent, '#112233'); assert.equal(dep.gold, '#aabbcc'); assert.equal(dep.bg, '#010203');
  assert.equal((await S.admin.post('/api/admin/site', { ...corpo, accent: 'vermelho' })).status, 400, 'cor inválida');
  assert.equal((await S.admin.post('/api/admin/site', { ...corpo, brand: '   ' })).status, 400, 'nome vazio');
  assert.equal((await pub()).accent, '#112233', 'erro não altera o que já estava salvo');
  assert.equal((await S.admin.post('/api/admin/site', { ...corpo, brand: 'X'.repeat(80), colorsOn: false })).status, 200);
  const fim = await pub(); assert.equal(fim.brand.length, 40); assert.equal(fim.colorsOn, false);
  const d2 = await S.admin.get('/api/admin/data'); assert.equal(d2.json.pix.key, pixAntes, 'o Pix não muda');
  assert.equal(d2.json.profiles.length, dados.json.profiles.length, 'perfis não mudam');
  const ajs = (await browser().get('/js/admin.js')).text, pjs = (await browser().get('/js/app.js')).text;
  assert.ok(ajs.includes("['site','Site','g']") && ajs.includes('function sitesec'), 'card Site no painel');
  assert.ok(pjs.includes('applyTheme(D.site)'), 'site público aplica o tema');
});

test('8. pack misto (foto + vídeo + bio): um card, um preço, aparece nas duas abas e libera todos os arquivos', async () => {
  const prof = (await S.admin.get('/api/admin/data')).json.profiles[0];
  const mp4 = n => { const b = Buffer.alloc(n, 7); b.write('ftyp', 4, 'latin1'); return b; };
  const pv = await S.admin.api('PUT', '/api/admin/upload?kind=cover&name=p.jpg', { body: tinyJpg(300, 'pm'), headers: { 'content-type': 'image/jpeg' } });
  const f1 = await S.admin.api('PUT', '/api/admin/upload?kind=photo&name=a.jpg', { body: tinyJpg(2000, 'm1'), headers: { 'content-type': 'image/jpeg' } });
  const f2 = await S.admin.api('PUT', '/api/admin/upload?kind=photo&name=b.jpg', { body: tinyJpg(2000, 'm2'), headers: { 'content-type': 'image/jpeg' } });
  const v1 = await S.admin.api('PUT', '/api/admin/upload?kind=video&name=c.mp4', { body: mp4(3000), headers: { 'content-type': 'video/mp4' } });
  assert.ok(f1.json.file && v1.json.file);
  const it = await S.admin.post('/api/admin/item', { profileId: prof.id, files: [f1.json.file, f2.json.file, v1.json.file], title: 'Pack completo', price: 9000, preview: pv.json.url, published: true });
  assert.equal(it.status, 200); assert.equal(it.json.type, 'photo'); assert.equal(it.json.files.length, 3);
  const site = (await browser().get('/api/site')).json, pk = site.photos.find(x => x.title === 'Pack completo');
  assert.ok(pk && pk.mixed && pk.nPhotos === 2 && pk.nVideos === 1 && pk.price === 9000, 'card do pack misto');
  assert.ok(site.videos.some(x => x.id === pk.id), 'pack misto também aparece na aba Vídeos');
  const solo = await S.admin.post('/api/admin/item', { profileId: prof.id, files: [v1.json.file], title: 'Só vídeo', price: 3000, cover: pv.json.url, published: true });
  assert.equal(solo.json.type, 'video', 'só vídeos vira item de vídeo');
  const c = browser(); await c.post('/api/auth/signup', { user: 'pedro', password: 'senha123', password2: 'senha123', termsAccepted: true });
  const o = await c.post('/api/order', { itemId: it.json.id }); assert.equal(o.status, 200);
  const oid = (await S.admin.get('/api/admin/data')).json.orders.find(x => x.user === 'pedro').id;
  assert.equal((await S.admin.post('/api/admin/order/' + oid + '/confirm', {})).status, 200);
  const m = (await c.post('/api/my', {})).json.orders[0].media;
  assert.equal(m.urls.length, 3); assert.deepEqual(m.kinds, ['photo', 'photo', 'video']);
  for (const u of m.urls) assert.equal((await c.get(u)).status, 200);
  assert.equal((await c.get(m.urls[0].replace(/&n=\d+/, '&n=9'))).status, 403, 'índice fora do pack é negado');
  const adm = (await S.admin.get('/api/admin/data')).json.items.find(i => i.id === it.json.id);
  assert.ok(adm.mixed && adm.nPhotos === 2 && adm.nVideos === 1, 'painel recebe os dados do pack misto');
});
