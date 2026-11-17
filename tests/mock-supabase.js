/* Supabase SIMULADO, só para testes locais (sem internet). Imita o subconjunto de PostgREST, Auth e Storage que o GOLDREX usa.
   Não é o Supabase de verdade: o que depende dele (RLS, e-mails, limites do plano) precisa ser validado no seu projeto real. */
const http = require('http'), crypto = require('crypto');
const ANON = 'eyJ.anon-key-test.x', SERVICE = 'eyJ.service-key-test.x';/* parecem JWT, como as chaves reais */
const PK = { accounts: 'id', settings: 'key', leads: 'email', chats: 'cid' };
const nowIso = () => new Date().toISOString();
const DEF = {
  accounts: () => ({ role: 'cliente', display_name: null, created_at: nowIso() }),
  profiles: () => ({ username: '', bio: '', avatar: '', verified: false, published: false, created_at: nowIso() }),
  items: () => ({ price_cents: 0, preview: '', cover: '', teaser: '', duration: 0, published: false, created_at: nowIso() }),
  live_services: () => ({ description: '', price_cents: 0, duration_min: 30, conditions: '', active: false, created_at: nowIso() }),
  live_slots: () => ({ order_id: null }),
  orders: () => ({ account_id: null, item_id: null, service_id: null, slot_id: null, slot_at: null, notes: '', status: 'pending', created_at: nowIso(), paid_at: null, paid_by: null, note: null }),
  payments: () => ({ method: 'pix', status: 'pending', source: null, note: null, created_at: nowIso(), confirmed_at: null }),
  provider_payments: () => ({ provider: 'manual', currency: 'BRL', provider_transaction_id: null, last_event_id: null, status: 'pending', created_at: nowIso(), updated_at: nowIso(), confirmed_at: null }),
  authorizations: () => ({ account_id: null, item_id: null, note: '', created_at: nowIso(), revoked_at: null, revoked_by: null }),
  order_events: () => ({ from_status: null, by: '', note: '', created_at: nowIso() }),
  audit_log: () => ({ actor: '', detail: '', created_at: nowIso() }),
  settings: () => ({ updated_at: nowIso() }),
  chats: () => ({ email: '', mode: 'bot', status: 'open', msgs: [], stack: [], updated_at: nowIso() }),
  leads: () => ({ created_at: nowIso() }),
};
const UNIQUE = { orders: [['code'], ['token']], live_slots: [['service_id', 'at']], accounts: [['email']], provider_payments: [['order_id'], ['reference']] };
const SERIAL = { audit_log: 0, order_events: 0 };

function start(port, opts = {}) {
  const st = { tables: {}, users: new Map(), access: new Map(), refresh: new Map(), recovery: new Map(), oauthCodes: new Set(['mock-google-code']), mail: [], files: new Map(), signed: new Map(), autoConfirm: opts.autoConfirm !== false, calls: [] };
  const T = n => st.tables[n] || (st.tables[n] = []);
  const sendJ = (res, c, o, h = {}) => { res.writeHead(c, { 'Content-Type': 'application/json', ...h }); res.end(JSON.stringify(o)); };
  const timeEq = (a, b) => (/^\d{4}-\d\d-\d\dT/.test(String(a)) && /^\d{4}-\d\d-\d\dT/.test(String(b))) ? Date.parse(a) === Date.parse(b) : String(a) === String(b);
  const cmp = (a, b) => (/^\d{4}-\d\d-\d\dT/.test(String(a)) && /^\d{4}-\d\d-\d\dT/.test(String(b))) ? Date.parse(a) - Date.parse(b) : (a > b ? 1 : a < b ? -1 : 0);
  function match(row, key, expr) {
    const v = row[key];
    const test = e => {
      if (e.startsWith('not.')) return !test(e.slice(4));
      if (e === 'is.null') return v === null || v === undefined;
      const i = e.indexOf('.'), op = e.slice(0, i), val = e.slice(i + 1);
      if (op === 'eq') return v !== null && v !== undefined && timeEq(v, val);
      if (op === 'neq') return !(v !== null && v !== undefined && timeEq(v, val));
      if (op === 'lt') return v != null && cmp(v, val) < 0; if (op === 'gt') return v != null && cmp(v, val) > 0;
      if (op === 'gte') return v != null && cmp(v, val) >= 0; if (op === 'lte') return v != null && cmp(v, val) <= 0;
      if (op === 'in') { const list = val.replace(/^\(|\)$/g, '').split(',').map(s => s.replace(/^"|"$/g, '')); return list.includes(String(v)); }
      throw new Error('operador não suportado no mock: ' + e);
    };
    return test(expr);
  }
  const filterRows = (table, q) => { const skip = new Set(['select', 'order', 'limit', 'on_conflict']); let rows = T(table).filter(r => [...q.keys()].every(k => skip.has(k) || match(r, k, q.get(k)))); const ord = q.get('order'); if (ord) { const [c, d] = ord.split('.'); rows = [...rows].sort((a, b) => (cmp(a[c], b[c])) * (d === 'desc' ? -1 : 1)); } if (q.get('limit')) rows = rows.slice(0, +q.get('limit')); return rows; };
  const violates = (table, row, ignore) => (UNIQUE[table] || []).some(cols => T(table).some(r => r !== ignore && cols.every(c => timeEq(r[c], row[c]))));
  function cascade(table, row) {
    const del = (t, f) => { st.tables[t] = T(t).filter(r => !f(r)); };
    if (table === 'profiles') T('items').filter(i => i.profile_id === row.id).forEach(i => { cascade('items', i); st.tables.items = T('items').filter(x => x !== i); });
    if (table === 'items') { T('orders').forEach(o => { if (o.item_id === row.id) o.item_id = null; }); T('authorizations').forEach(a => { if (a.item_id === row.id) a.item_id = null; }); }
    if (table === 'live_services') { T('live_slots').filter(s => s.service_id === row.id).forEach(s => del('live_slots', x => x === s)); T('orders').forEach(o => { if (o.service_id === row.id) o.service_id = null; }); }
    if (table === 'orders') { del('payments', p => p.order_id === row.id); del('provider_payments', p => p.order_id === row.id); del('authorizations', a => a.order_id === row.id); del('order_events', e => e.order_id === row.id); T('live_slots').forEach(s => { if (s.order_id === row.id) s.order_id = null; }); }
  }
  function rpc(fn, a) {
    const o = id => T('orders').find(x => x.id === id), ev = (oid, f, t, by, note) => T('order_events').push({ id: ++SERIAL.order_events, order_id: oid, from_status: f, to_status: t, by, note, ...DEF.order_events(), ...{ from_status: f, by, note } });
    if (fn === 'confirm_order') {
      const r = o(a.p_order);
      if (!r || r.status !== 'pending') return false;
      const p = T('payments').find(x => x.order_id === r.id);
      if (!p || p.status !== 'pending' || p.amount_cents !== r.price_cents || p.txid !== 'GR' + r.code) {
        throw Object.assign(new Error('pagamento inconsistente'), { code: 409 });
      }
      Object.assign(r, { status: 'paid', paid_at: nowIso(), paid_by: a.p_by, note: a.p_note });
      Object.assign(p, { status: 'confirmed', source: a.p_source, note: a.p_note, confirmed_at: nowIso() });
      T('authorizations').push({ ...DEF.authorizations(), id: a.p_auth_id, order_id: r.id, account_id: r.account_id, email: r.email, item_id: r.item_id, kind: 'payment', granted_by: a.p_by, note: a.p_note || '' });
      ev(r.id, 'pending', 'paid', a.p_by, a.p_note || '');
      return true;
    }
    if (fn === 'create_item_order') {
      const activePurchase = T('orders').find(x => x.account_id === a.p_account && x.item_id === a.p_item && x.type === 'item' && x.status === 'paid' && T('payments').some(p => p.order_id === x.id && p.status === 'confirmed' && p.method !== 'manual'));
      if (activePurchase) return activePurchase.id;
      const pending = T('orders').find(x => x.account_id === a.p_account && x.item_id === a.p_item && x.type === 'item' && x.status === 'pending');
      if (pending && pending.price_cents === a.p_price) return pending.id;
      if (pending) {
        const payment = T('payments').find(x => x.order_id === pending.id && x.status === 'pending');
        if (payment) { payment.status = 'cancelled'; payment.note = 'Preço do item alterado.'; }
        pending.status = 'cancelled';
        pending.note = 'Preço do item alterado; gere um novo pedido pelo valor atualizado.';
        ev(pending.id, 'pending', 'cancelled', 'sistema', 'Preço do item alterado; o próximo pedido usará o valor atualizado.');
      }
      const row = { ...DEF.orders(), id: a.p_order, code: a.p_code, token: a.p_token, account_id: a.p_account, email: a.p_email.toLowerCase(), type: 'item', item_id: a.p_item, price_cents: a.p_price };
      if (violates('orders', row)) throw Object.assign(new Error('dup'), { code: 409 });
      T('orders').push(row);
      T('payments').push({ ...DEF.payments(), id: a.p_payment, order_id: row.id, amount_cents: row.price_cents, txid: 'GR' + row.code });
      ev(row.id, null, 'pending', 'cliente', '');
      return row.id;
    }
    if (fn === 'grant_manual_access') { if (T('authorizations').some(x => x.account_id === a.p_account && x.item_id === a.p_item && !x.revoked_at)) throw Object.assign(new Error('acesso ativo'), { code: 409 }); const row = { ...DEF.orders(), id: a.p_order, code: a.p_code, token: a.p_token, account_id: a.p_account, email: a.p_email.toLowerCase(), type: 'item', item_id: a.p_item, price_cents: 0, status: 'paid', paid_at: nowIso(), paid_by: a.p_by, note: a.p_note }; if (violates('orders', row)) throw Object.assign(new Error('dup'), { code: 409 }); T('orders').push(row); T('payments').push({ ...DEF.payments(), id: a.p_payment, order_id: a.p_order, method: 'manual', amount_cents: 0, status: 'confirmed', txid: 'MANUAL' + a.p_code, source: 'admin', note: a.p_note, confirmed_at: nowIso() }); T('authorizations').push({ ...DEF.authorizations(), id: a.p_auth, order_id: a.p_order, account_id: a.p_account, email: a.p_email.toLowerCase(), item_id: a.p_item, kind: 'manual', granted_by: a.p_by, note: a.p_note || '' }); ev(a.p_order, null, 'paid', a.p_by, 'liberação manual'); return a.p_order; }
    if (fn === 'revoke_access') { const r = o(a.p_order); if (!r || r.status !== 'paid') return false; r.status = 'revoked'; T('authorizations').forEach(x => { if (x.order_id === r.id && !x.revoked_at) { x.revoked_at = nowIso(); x.revoked_by = a.p_by; } }); ev(r.id, 'paid', 'revoked', a.p_by, a.p_note || ''); return true; }
    if (fn === 'apply_provider_payment') {
      const dp = T('provider_payments').find(x => x.reference === a.p_reference && x.amount_cents === a.p_amount_cents);
      if (!dp || !['confirmed', 'refunded', 'chargeback'].includes(a.p_status)) return false;
      const r = o(dp.order_id);
      if (!r || dp.provider_transaction_id && dp.provider_transaction_id !== a.p_transaction_id) return false;
      if (dp.last_event_id === a.p_event_id) return true;
      if (a.p_status === 'confirmed') {
        if (dp.status === 'refunded' || dp.status === 'chargeback' || dp.status === 'failed' || ['revoked', 'rejected', 'cancelled'].includes(r.status)) return true;
        if (dp.status === 'confirmed') return dp.provider_transaction_id === a.p_transaction_id;
        if (dp.status !== 'pending' || r.status !== 'pending') return false;
        const p = T('payments').find(x => x.order_id === r.id);
        if (!p || p.status !== 'pending' || p.amount_cents !== r.price_cents || p.txid !== 'GR' + r.code) return false;
        Object.assign(r, { status: 'paid', paid_at: nowIso(), paid_by: 'cloud', note: 'Pagamento confirmado pelo provedor (' + dp.reference + ')' });
        Object.assign(p, { status: 'confirmed', source: 'webhook', confirmed_at: nowIso() });
        T('authorizations').push({ ...DEF.authorizations(), id: a.p_auth_id, order_id: r.id, account_id: r.account_id, email: r.email, item_id: r.item_id, kind: 'payment', granted_by: 'cloud' });
        ev(r.id, 'pending', 'paid', 'cloud', 'Pagamento confirmado pelo provedor');
        Object.assign(dp, { status: 'confirmed', provider_transaction_id: a.p_transaction_id, last_event_id: a.p_event_id, confirmed_at: nowIso(), updated_at: nowIso() });
        return true;
      }
      if (dp.status === 'refunded' || dp.status === 'chargeback') {
        if (dp.status === 'refunded' && a.p_status === 'chargeback') {
          dp.status = 'chargeback'; dp.last_event_id = a.p_event_id; dp.updated_at = nowIso();
          const lp = T('payments').find(x => x.order_id === r.id && x.status === 'refunded');
          if (lp) lp.status = 'chargeback';
        }
        return true;
      }
      const old = r.status;
      if (['pending', 'paid'].includes(old)) {
        r.status = 'revoked';
        T('authorizations').filter(x => x.order_id === r.id && !x.revoked_at).forEach(x => { x.revoked_at = nowIso(); x.revoked_by = 'cloud'; });
        ev(r.id, old, 'revoked', 'cloud', 'Reembolso ou chargeback do provedor');
      }
      Object.assign(dp, { status: a.p_status, provider_transaction_id: a.p_transaction_id, last_event_id: a.p_event_id, updated_at: nowIso() });
      const lp = T('payments').find(x => x.order_id === r.id && ['pending', 'confirmed'].includes(x.status));
      if (lp) lp.status = a.p_status;
      return true;
    }
    throw new Error('rpc desconhecida: ' + fn);
  }
  const bearerOf = req => String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const readBody = req => new Promise(ok => { const ch = []; req.on('data', c => ch.push(c)); req.on('end', () => ok(Buffer.concat(ch))); });
  const userOut = u => ({ id: u.id, email: u.email, email_confirmed_at: u.confirmed ? u.confirmedAt : null, created_at: u.createdAt });
  const mkSession = u => { const at = 'eyJat_' + crypto.randomBytes(16).toString('hex'), rt = 'rt_' + crypto.randomBytes(16).toString('hex'); st.access.set(at, u.id); st.refresh.set(rt, u.id); return { access_token: at, refresh_token: rt, expires_in: 3600, token_type: 'bearer', user: userOut(u) }; };
  const addUser = (email, password, confirmed) => { const u = { id: crypto.randomUUID(), email: email.toLowerCase(), password, confirmed, confirmedAt: confirmed ? nowIso() : null, createdAt: nowIso() }; st.users.set(u.id, u); T('accounts').push({ ...DEF.accounts(), id: u.id, email: u.email }); return u; };

  const srv = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x'), p = u.pathname, q = u.searchParams, m = req.method; st.calls.push(m + ' ' + p);
    try {
      /* ---- Auth ---- */
      if (p.startsWith('/auth/v1/')) {
        if (req.headers.apikey !== ANON && req.headers.apikey !== SERVICE) return sendJ(res, 401, { message: 'No API key' });
        const raw = await readBody(req), b = raw.length ? JSON.parse(raw) : {}, sub = p.slice(9);
        if (sub === 'signup') { const em = String(b.email || '').toLowerCase(); if (!em || String(b.password || '').length < 6) return sendJ(res, 422, { error_code: 'weak_password', msg: 'Password should be at least 6 characters.' }); if ([...st.users.values()].some(x => x.email === em)) return sendJ(res, 200, { id: crypto.randomUUID(), email: em }); const nu = addUser(em, b.password, st.autoConfirm); if (!st.autoConfirm) { st.mail.push({ to: em, kind: 'confirm' }); return sendJ(res, 200, userOut(nu)); } return sendJ(res, 200, mkSession(nu)); }
        if (sub === 'token' && q.get('grant_type') === 'password') { const x = [...st.users.values()].find(y => y.email === String(b.email || '').toLowerCase()); if (!x || x.password !== b.password) return sendJ(res, 400, { error_code: 'invalid_credentials', msg: 'Invalid login credentials' }); if (!x.confirmed) return sendJ(res, 400, { error_code: 'email_not_confirmed', msg: 'Email not confirmed' }); return sendJ(res, 200, mkSession(x)); }
        if (sub === 'token' && q.get('grant_type') === 'pkce') {
          if (!st.oauthCodes.delete(b.auth_code) || !/^[A-Za-z0-9_-]{43,128}$/.test(String(b.code_verifier || ''))) return sendJ(res, 400, { error: 'invalid_grant', error_description: 'Invalid OAuth code' });
          let user = [...st.users.values()].find(x => x.email === 'google@x.com');
          if (!user) user = addUser('google@x.com', 'google-oauth', true);
          return sendJ(res, 200, mkSession(user));
        }
        if (sub === 'token' && q.get('grant_type') === 'refresh_token') { const id = st.refresh.get(b.refresh_token); if (!id) return sendJ(res, 400, { error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' }); st.refresh.delete(b.refresh_token); return sendJ(res, 200, mkSession(st.users.get(id))); }
        if (sub === 'user' && m === 'GET') { const id = st.access.get(bearerOf(req)); if (!id || !st.users.get(id)) return sendJ(res, 401, { msg: 'invalid JWT' }); return sendJ(res, 200, userOut(st.users.get(id))); }
        if (sub === 'user' && m === 'PUT') { const id = st.access.get(bearerOf(req)) || st.recovery.get(bearerOf(req)); if (!id) return sendJ(res, 401, { msg: 'invalid JWT' }); if (String(b.password || '').length < 6) return sendJ(res, 422, { error_code: 'weak_password', msg: 'Password should be at least 6 characters.' }); st.users.get(id).password = b.password; return sendJ(res, 200, userOut(st.users.get(id))); }
        if (sub === 'logout') { st.access.delete(bearerOf(req)); return sendJ(res, 204, {}); }
        if (sub === 'recover') { const x = [...st.users.values()].find(y => y.email === String(b.email || '').toLowerCase()); if (x) { const tk = 'eyJrec_' + crypto.randomBytes(12).toString('hex'); st.recovery.set(tk, x.id); st.mail.push({ to: x.email, kind: 'recovery', token: tk, redirect: q.get('redirect_to') }); } return sendJ(res, 200, {}); }
        if (sub === 'admin/users' && m === 'POST') { if (bearerOf(req) !== SERVICE) return sendJ(res, 403, { msg: 'not admin' }); if ([...st.users.values()].some(x => x.email === String(b.email).toLowerCase())) return sendJ(res, 422, { error_code: 'email_exists', msg: 'A user with this email address has already been registered' }); return sendJ(res, 200, userOut(addUser(b.email, b.password, true))); }
        if (sub.startsWith('admin/users/') && m === 'DELETE') { if (bearerOf(req) !== SERVICE) return sendJ(res, 403, { msg: 'not admin' }); const id = sub.slice(12); st.users.delete(id); st.tables.accounts = T('accounts').filter(a => a.id !== id); T('orders').forEach(o => { if (o.account_id === id) o.account_id = null; }); return sendJ(res, 200, {}); }
        return sendJ(res, 404, { msg: 'rota auth não suportada no mock: ' + sub });
      }
      /* ---- Storage ---- */
      if (p.startsWith('/storage/v1/')) {
        const sub = p.slice(12);
        if ((m === 'GET') && sub.startsWith('object/public/')) return sendJ(res, 400, { message: 'Bucket is private' });
        if (m === 'GET' && sub.startsWith('object/sign/')) { const t = q.get('token'), key = st.signed.get(t); if (!key || Date.now() > key.exp) return sendJ(res, 400, { message: 'invalid token' }); return serve(req, res, st.files.get(key.key)); }
        if (bearerOf(req) !== SERVICE) return sendJ(res, 401, { message: 'Unauthorized' });
        if (m === 'POST' && sub.startsWith('object/sign/')) { const [bucket, ...k] = sub.slice(12).split('/'), key = bucket + '/' + decodeURIComponent(k.join('/')); if (!st.files.has(key)) return sendJ(res, 400, { message: 'Object not found' }); const b = JSON.parse(await readBody(req)), t = 'sig_' + crypto.randomBytes(10).toString('hex'); st.signed.set(t, { key, exp: Date.now() + b.expiresIn * 1000 }); return sendJ(res, 200, { signedURL: `/object/sign/${bucket}/${k.join('/')}?token=${t}` }); }
        if (m === 'POST' && sub.startsWith('object/')) { const [bucket, ...k] = sub.slice(7).split('/'); if (!['previews', 'originals'].includes(bucket)) return sendJ(res, 404, { message: 'Bucket not found' }); const buf = await readBody(req); st.files.set(bucket + '/' + decodeURIComponent(k.join('/')), { buf, type: req.headers['content-type'] }); return sendJ(res, 200, { Key: sub.slice(7) }); }
        if (m === 'DELETE' && sub.startsWith('object/')) { const bucket = sub.slice(7), b = JSON.parse(await readBody(req)); (b.prefixes || []).forEach(k => st.files.delete(bucket + '/' + k)); return sendJ(res, 200, []); }
        return sendJ(res, 404, { message: 'rota storage não suportada no mock' });
      }
      /* ---- PostgREST ---- */
      if (p.startsWith('/rest/v1/')) {
        if (req.headers.apikey !== SERVICE || bearerOf(req) !== SERVICE) return sendJ(res, 401, { message: 'o servidor deve usar a service_role' });
        const sub = p.slice(9), pref = String(req.headers.prefer || '');
        if (sub.startsWith('rpc/')) { const raw = await readBody(req); try { return sendJ(res, 200, rpc(sub.slice(4), raw.length ? JSON.parse(raw) : {})); } catch (e) { return sendJ(res, e.code === 409 ? 409 : 400, { message: e.message }); } }
        const table = sub; if (!(table in DEF)) return sendJ(res, 404, { message: 'tabela inexistente: ' + table });
        const sel = q.get('select'); if (sel && sel !== '*') { const known = new Set([...Object.keys(DEF[table]()), PK[table] || 'id', 'code', 'token', 'email', 'type', 'name', 'cid', 'key', 'title', 'at', 'service_id', 'order_id', 'status', 'profile_id', 'original_file', 'price_cents', 'role', 'cid']); if (sel.split(',').some(c => !known.has(c))) return sendJ(res, 400, { message: 'column ' + sel + ' does not exist' }); }
        for (const k of q.keys()) if (!['select', 'order', 'limit', 'on_conflict'].includes(k) && !(k in DEF[table]()) && k !== (PK[table] || 'id') && !['code', 'token', 'email', 'type', 'service_id', 'order_id', 'item_id', 'profile_id', 'account_id', 'cid', 'key', 'at', 'status', 'role', 'published', 'active', 'actor'].includes(k)) return sendJ(res, 400, { message: 'column ' + k + ' does not exist' });
        if (m === 'GET') { const rows = filterRows(table, q); const h = {}; if (/count=exact/.test(pref)) h['Content-Range'] = `0-${Math.max(0, rows.length - 1)}/${T(table).filter(r => [...q.keys()].every(k => ['select', 'order', 'limit'].includes(k) || match(r, k, q.get(k)))).length}`; return sendJ(res, 200, rows, h); }
        const raw = await readBody(req), b = raw.length ? JSON.parse(raw) : null;
        if (m === 'POST') {
          const out = []; for (const r of (Array.isArray(b) ? b : [b])) {
            const row = { ...DEF[table](), ...r }; if (table in SERIAL) row.id = ++SERIAL[table];
            const pk = PK[table] || 'id', ex = T(table).find(x => x[pk] === row[pk]);
            if (ex) { if (/merge-duplicates/.test(pref)) { Object.assign(ex, r); out.push(ex); continue; } return sendJ(res, 409, { message: 'duplicate key value violates unique constraint' }); }
            if (violates(table, row)) return sendJ(res, 409, { message: 'duplicate key value violates unique constraint' });
            T(table).push(row); out.push(row);
          } return sendJ(res, 201, out);
        }
        if (m === 'PATCH') { const rows = filterRows(table, q); rows.forEach(r => Object.assign(r, b)); return sendJ(res, 200, rows); }
        if (m === 'DELETE') { const rows = filterRows(table, q); rows.forEach(r => cascade(table, r)); st.tables[table] = T(table).filter(r => !rows.includes(r)); return sendJ(res, 200, rows); }
      }
      sendJ(res, 404, { message: 'não suportado no mock: ' + m + ' ' + p });
    } catch (e) { sendJ(res, 500, { message: 'erro no mock: ' + e.message }); }
  });
  function serve(req, res, f) {
    if (!f) return sendJ(res, 404, { message: 'Object not found' });
    const size = f.buf.length, rg = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (rg) { const s = rg[1] ? +rg[1] : 0, e = rg[2] ? Math.min(+rg[2], size - 1) : size - 1; res.writeHead(206, { 'Content-Type': f.type, 'Content-Range': `bytes ${s}-${e}/${size}`, 'Content-Length': e - s + 1 }); return res.end(f.buf.subarray(s, e + 1)); }
    res.writeHead(200, { 'Content-Type': f.type, 'Content-Length': size }); res.end(f.buf);
  }
  return new Promise(ok => srv.listen(port, '127.0.0.1', () => ok({ st, srv, url: 'http://127.0.0.1:' + port, ANON, SERVICE, close: () => new Promise(r => { srv.closeAllConnections && srv.closeAllConnections(); srv.close(r); }) })));
}
module.exports = { start, ANON, SERVICE };
