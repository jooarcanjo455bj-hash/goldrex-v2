/* Cliente mínimo do Supabase via REST (sem dependências; usa o fetch do Node 18+).
   - db:      PostgREST  (/rest/v1)
   - storage: Storage    (/storage/v1)
   A chave service_role só existe no servidor. Nunca envie esta chave ao navegador. */
const fs = require('fs'), { Readable } = require('stream');

class SupaError extends Error {
  constructor(msg, status, body, cause) { super(msg); this.name = 'SupaError'; this.status = status; this.body = body; if (cause) this.cause = cause; }
}

const qs = p => { const u = new URLSearchParams(); for (const [k, v] of Object.entries(p || {})) if (v !== undefined && v !== null) u.append(k, String(v)); return u.toString(); };
const seg = k => String(k).split('/').map(encodeURIComponent).join('/');

/* filtros do PostgREST: use dentro de params, ex.: {status: eq('paid'), id: inn(['a','b'])} */
const eq = v => 'eq.' + v, neq = v => 'neq.' + v, lt = v => 'lt.' + v, gt = v => 'gt.' + v, gte = v => 'gte.' + v;
const isNull = 'is.null', notNull = 'not.is.null';
const inn = a => 'in.(' + a.map(x => '"' + String(x).replace(/"/g, '') + '"').join(',') + ')';

function createSupa({ url, anonKey, serviceKey, timeoutMs = 20000, fetchImpl }) {
  if (!url || !serviceKey || !anonKey) throw new Error('Configure SUPABASE_URL, SUPABASE_ANON_KEY e SUPABASE_SERVICE_ROLE_KEY.');
  const base = url.replace(/\/+$/, ''), F = fetchImpl || fetch;
  const transientNetworkError = e => {
    const cause = e && e.cause, code = e && ((cause && cause.code) || e.code);
    return ['UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN', 'ENOTFOUND'].includes(code) ||
      !!(e && (e.name === 'AbortError' || (cause && cause.name === 'AbortError') || /UND_ERR_CONNECT_TIMEOUT|UND_ERR_SOCKET|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENOTFOUND/.test(String(e.message || ''))));
  };
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

  async function call(method, path, { key = serviceKey, bearer, headers = {}, json, body, duplex, timeout = timeoutMs } = {}) {
    /* chaves antigas (service_role/anon) são JWT e vão também em Authorization; as chaves novas (sb_secret_/sb_publishable_) só no cabeçalho apikey */
    const tok = bearer || key, h = { apikey: key, ...(/^eyJ/.test(tok) ? { Authorization: 'Bearer ' + tok } : {}), ...headers };
    let b = body;
    if (json !== undefined) { h['Content-Type'] = 'application/json'; b = JSON.stringify(json); }
    let res;
    try { res = await F(base + path, { method, headers: h, body: b, duplex, signal: timeout ? AbortSignal.timeout(timeout) : undefined }); }
    catch (e) { throw new SupaError('Falha de rede ao falar com o Supabase: ' + (e.cause && e.cause.code || e.name || e.message), 0, null, e); }
    return res;
  }
  async function parse(res) {
    const t = await res.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch { }
    if (!res.ok) throw new SupaError((j && (j.message || j.msg || j.error_description || j.error)) || ('Supabase respondeu ' + res.status), res.status, j);
    return j;
  }
  async function getParsed(path, options) {
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await call('GET', path, options);
        const data = await parse(res);
        return { res, data };
      } catch (e) {
        const retryable = transientNetworkError(e) || (e instanceof SupaError && (e.status === 0 || e.status >= 500));
        if (attempt >= 2 || !retryable) throw e;
        await wait(attempt === 0 ? 250 : 750);
      }
    }
  }

  /* ---------------- banco (PostgREST) ---------------- */
  const db = {
    get: async (table, params) => (await getParsed(`/rest/v1/${table}?${qs({ select: '*', ...params })}`)).data || [],
    one: async (table, params) => (await db.get(table, { ...params, limit: 1 }))[0] || null,
    insert: async (table, rows, { upsert, onConflict } = {}) => {
      const pref = ['return=representation']; if (upsert) pref.push('resolution=merge-duplicates');
      return (await parse(await call('POST', `/rest/v1/${table}${onConflict ? '?' + qs({ on_conflict: onConflict }) : ''}`, { json: rows, headers: { Prefer: pref.join(',') } }))) || [];
    },
    patch: async (table, params, patch) => (await parse(await call('PATCH', `/rest/v1/${table}?${qs(params)}`, { json: patch, headers: { Prefer: 'return=representation' } }))) || [],
    del: async (table, params) => (await parse(await call('DELETE', `/rest/v1/${table}?${qs(params)}`, { headers: { Prefer: 'return=representation' } }))) || [],
    count: async (table, params) => {
      const { res } = await getParsed(`/rest/v1/${table}?${qs({ select: '*', ...params, limit: 1 })}`, { headers: { Prefer: 'count=exact' } });
      const m = /\/(\d+)$/.exec(res.headers.get('content-range') || ''); return m ? +m[1] : 0;
    },
    rpc: async (fn, args) => parse(await call('POST', `/rest/v1/rpc/${fn}`, { json: args || {} })),
  };

  /* ---------------- armazenamento (Storage) ---------------- */
  const signedUrls = new Map();
  const storage = {
    /* envia um arquivo local (caminho) para o bucket, em streaming */
    putFile: async (bucket, key, filePath, contentType) => {
      const size = fs.statSync(filePath).size;
      const res = await call('POST', `/storage/v1/object/${bucket}/${seg(key)}`, {
        headers: { 'Content-Type': contentType || 'application/octet-stream', 'Content-Length': String(size), 'x-upsert': 'true' },
        body: Readable.toWeb(fs.createReadStream(filePath)), duplex: 'half', timeout: 0 });
      return parse(res);
    },
    putBuffer: async (bucket, key, buf, contentType) => parse(await call('POST', `/storage/v1/object/${bucket}/${seg(key)}`, { headers: { 'Content-Type': contentType || 'application/octet-stream', 'x-upsert': 'true' }, body: buf })),
    /* link temporário (só o servidor o usa, nunca é entregue ao navegador) */
    sign: async (bucket, key, expiresIn = 120) => {
      const cacheKey = JSON.stringify([bucket, key]), cached = signedUrls.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) return cached.url;
      if (cached) signedUrls.delete(cacheKey);
      const j = await parse(await call('POST', `/storage/v1/object/sign/${bucket}/${seg(key)}`, { json: { expiresIn }, timeout: 30000 }));
      const p = j.signedURL || j.signedUrl, url = p.startsWith('http') ? p : base + '/storage/v1' + (p.startsWith('/') ? p : '/' + p);
      if (signedUrls.size >= 500) signedUrls.delete(signedUrls.keys().next().value);
      signedUrls.set(cacheKey, { url, expiresAt: Date.now() + Math.max(1, expiresIn - 15) * 1000 });
      return url;
    },
    /* abre o objeto e devolve a Response (para repassar ao visitante, com Range) */
    openPrivate: async (bucket, key, range) => {
      for (let attempt = 0; ; attempt++) {
        try {
          const u = await storage.sign(bucket, key, 120);
          return await F(u, { headers: range ? { Range: range } : {}, signal: AbortSignal.timeout(30000) });
        } catch (e) {
          if (attempt >= 2 || !transientNetworkError(e)) throw e;
          await wait(attempt === 0 ? 300 : 900);
        }
      }
    },
    openPublic: async (bucket, key, range) =>
      F(`${base}/storage/v1/object/public/${bucket}/${seg(key)}`, { headers: range ? { Range: range } : {}, signal: AbortSignal.timeout(30000) }),
    /* lista (e permite apagar) os arquivos de um bucket, em páginas de 100 */
    list: async bucket => parse(await call('POST', `/storage/v1/object/list/${bucket}`, { json: { prefix: '', limit: 100, offset: 0 } })),
    remove: async (bucket, keys) => { if (!keys.length) return; return parse(await call('DELETE', `/storage/v1/object/${bucket}`, { json: { prefixes: keys } })); },
  };

  return { db, storage, base };
}

module.exports = { createSupa, SupaError, eq, neq, lt, gt, gte, isNull, notNull, inn };
