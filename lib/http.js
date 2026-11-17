/* Utilitários HTTP do servidor: respostas JSON, leitura de corpo, cookies, limites de tentativas, arquivos estáticos e proxy de mídia. */
const fs = require('fs'), { Readable } = require('stream');

const J = (res, c, o) => { res.writeHead(c, { 'Content-Type': 'application/json;charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(o)); };
const bad = (res, m, c = 400, extra) => J(res, c, { error: m, ...(extra || {}) });

const body = (req, max = 2e6) => new Promise((ok, no) => {
  const ch = []; let n = 0, fin = false;
  const end = (f, v) => { if (fin) return; fin = true; clearTimeout(tm); f(v); };
  const tm = setTimeout(() => { end(no, Object.assign(new Error('Tempo esgotado.'), { status: 408 })); req.destroy(); }, 20000);
  req.on('data', c => { n += c.length; if (n > max) { end(no, Object.assign(new Error('Requisição grande demais.'), { status: 413 })); req.destroy(); return; } ch.push(c); });
  req.on('end', () => { let o = {}; try { o = n ? JSON.parse(Buffer.concat(ch).toString('utf8')) : {}; } catch { } end(ok, o && typeof o === 'object' && !Array.isArray(o) ? o : {}); });
  req.on('error', e => end(no, e));
  req.on('close', () => { if (!req.complete) end(no, Object.assign(new Error('Requisição interrompida.'), { status: 400 })); });
});

const cookie = (req, n) => ((req.headers.cookie || '').match(new RegExp('(?:^|; )' + n + '=([^;]*)')) || [])[1];
/* acrescenta um cookie sem apagar os que já foram definidos nesta resposta */
const addCookie = (res, c) => res.appendHeader('Set-Cookie', c);
const mkCookie = (n, v, age, secure) => `${n}=${v}; Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}; Max-Age=${age}`;

/* limite de requisições por janela */
const rl = new Map();
const limited = (ip, k, n, ms = 60000) => { const now = Date.now(), key = ip + '|' + k, a = (rl.get(key) || []).filter(t => now - t < ms); if (a.length >= n) { rl.set(key, a); return true; } a.push(now); rl.set(key, a); if (rl.size > 50000) rl.clear(); return false; };
setInterval(() => { const n = Date.now(); rl.forEach((a, k) => { if (!a.length || n - a[a.length - 1] > 900000) rl.delete(k); }); }, 300000).unref();

/* bloqueio depois de N falhas dentro da janela */
const strikes = new Map();
const isBlocked = k => { const f = strikes.get(k); return !!(f && f.until > Date.now()); };
const strike = (k, max, win, block) => { const n = Date.now(); let f = strikes.get(k); if (!f || (f.until <= n && n - f.t0 > win)) f = { n: 0, t0: n, until: 0 }; f.n++; if (f.n >= max) { f.until = n + block; f.n = 0; f.t0 = n; } strikes.set(k, f); if (strikes.size > 50000) strikes.clear(); };
const clearStrike = k => strikes.delete(k);
setInterval(() => { const n = Date.now(); strikes.forEach((f, k) => { if (f.until < n && n - f.t0 > 3600e3) strikes.delete(k); }); }, 600000).unref();

const MIME = { '.html': 'text/html;charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime' };

/* arquivo estático do próprio site (pasta public) */
function sendFile(req, res, file, type, cache = 'private, no-store') {
  let st; try { st = fs.statSync(file); } catch { res.writeHead(404); return res.end('404'); }
  if (!st.isFile()) { res.writeHead(404); return res.end('404'); }
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Cache-Control': cache });
  if (req.method === 'HEAD') return res.end();
  const rs = fs.createReadStream(file); rs.on('error', () => res.destroy()); res.on('close', () => rs.destroy()); rs.pipe(res);
}

/* repassa uma resposta do Storage ao visitante (com suporte a Range para vídeo) */
function pipeUpstream(req, res, up, type, cache) {
  if (!up.ok && up.status !== 206 && up.status !== 416) { res.writeHead(up.status === 404 || up.status === 400 ? 404 : 502); return res.end(up.status === 404 || up.status === 400 ? '404' : '502'); }
  const h = { 'Content-Type': type || up.headers.get('content-type') || 'application/octet-stream', 'Cache-Control': cache || 'private, no-store', 'Accept-Ranges': 'bytes' };
  for (const k of ['content-length', 'content-range']) { const v = up.headers.get(k); if (v) h[k] = v; }
  res.writeHead(up.status, h);
  if (req.method === 'HEAD' || !up.body) return res.end();
  const rs = Readable.fromWeb(up.body); rs.on('error', () => res.destroy()); res.on('close', () => rs.destroy()); rs.pipe(res);
}

module.exports = { J, bad, body, cookie, addCookie, mkCookie, limited, isBlocked, strike, clearStrike, MIME, sendFile, pipeUpstream };
