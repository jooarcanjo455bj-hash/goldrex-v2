#!/usr/bin/env node
/* Importa os dados da versão ANTIGA do GOLDREX (data/db.json + pastas de fotos/vídeos) para o Supabase.
   Uso:   node scripts/migrate-legacy.js --from <pasta-da-versao-antiga> [--dry-run]
   A pasta deve conter  data/db.json  e, se existirem,  private/photos  private/videos  public/uploads.
   - Não apaga nem altera nada na pasta antiga (só lê).
   - Pode ser executado mais de uma vez: registros com o mesmo id são atualizados, não duplicados.
   - Administradores antigos NÃO são importados (a senha antiga não pode ser convertida). Defina ADMIN_EMAILS e crie a conta pelo site.
   - Pedidos antigos ficam sem conta; passam a aparecer na conta do cliente quando ele se cadastrar com o MESMO e-mail (e-mail confirmado). */
const fs = require('fs'), path = require('path');
try { fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split('\n').forEach(l => { const m = l.match(/^\s*([A-Z_0-9]+)\s*=\s*(.*?)\s*$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ''); }); } catch { }
const { createSupa, eq } = require('../lib/supa');
const args = process.argv.slice(2), arg = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; }, DRY = args.includes('--dry-run');
const from = arg('--from'); if (!from) { console.error('Uso: node scripts/migrate-legacy.js --from <pasta-da-versao-antiga> [--dry-run]'); process.exit(1); }
const E = process.env; if (!DRY && (!E.SUPABASE_URL || !E.SUPABASE_ANON_KEY || !E.SUPABASE_SERVICE_ROLE_KEY)) { console.error('Defina SUPABASE_URL, SUPABASE_ANON_KEY e SUPABASE_SERVICE_ROLE_KEY (.env).'); process.exit(1); }
const dbFile = path.join(from, 'data', 'db.json'); if (!fs.existsSync(dbFile)) { console.error('Não encontrei ' + dbFile); process.exit(1); }
let old; try { old = JSON.parse(fs.readFileSync(dbFile, 'utf8')); } catch (e) { console.error('db.json ilegível: ' + e.message); process.exit(1); }
if (old.v !== 2) { console.error('Este db.json não está no formato v2. Abra a versão antiga uma vez (ela migra o arquivo sozinha, com backup) e tente de novo.'); process.exit(1); }
const iso = t => new Date(+t || Date.now()).toISOString(), isoAny = t => {
  const d = typeof t === 'number' || /^\d+$/.test(String(t)) ? new Date(+t) : new Date(t);
  return Number.isNaN(d.getTime()) ? iso(Date.now()) : d.toISOString();
}, arr = x => Array.isArray(x) ? x : [];
const cleanSite = input => {
  const d = {
    brand: 'GOLDREX', welcome: 'Explore o meu universo', cover: '',
    accent: '#8b3dff', gold: '#d4af37', bg: '#07030c',
    areas: { fotos: true, videos: true, live: true, chat: true },
    counters: true,
    howto: '1. Escolha um item e toque em Comprar.\\n2. Confira o valor e abra a pagina de pagamento.\\n3. O conteudo e liberado depois que o pagamento for confirmado.\\n4. A pagina DropFans abre somente o cadastro de comerciante (KYC), nao uma cobranca; a confirmacao automatica aguarda a documentacao oficial.'
  };
  const x = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const out = { ...d };
  for (const k of ['brand', 'welcome', 'cover', 'howto']) {
    if (typeof x[k] === 'string') out[k] = x[k].slice(0, k === 'howto' ? 3000 : k === 'cover' ? 1000 : 120);
  }
  const color = /^#[0-9a-fA-F]{6}$/;
  for (const k of ['accent', 'gold', 'bg']) {
    if (typeof x[k] === 'string' && color.test(x[k])) out[k] = x[k];
  }
  if (x.areas && typeof x.areas === 'object' && !Array.isArray(x.areas)) {
    out.areas = {};
    for (const k of ['fotos', 'videos', 'live', 'chat']) out.areas[k] = x.areas[k] === true;
  }
  if (typeof x.counters === 'boolean') out.counters = x.counters;
  return out;
};
const PHO = path.join(from, 'private', 'photos'), VID = path.join(from, 'private', 'videos'), UP = path.join(from, 'public', 'uploads');
const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime' };
const stats = { profiles: 0, items: 0, services: 0, slots: 0, orders: 0, payments: 0, authorizations: 0, leads: 0, chats: 0, files: 0, missingFiles: [] };


/* Preflight: todos os arquivos precisam existir antes de qualquer gravacao. */
const requiredFiles = [];
const requireFile = (bucket, key, root) => {
  const name = typeof key === 'string' ? path.basename(key) : '';
  requiredFiles.push({ bucket, key: name || '(nome ausente)', file: name ? path.join(root, name) : '' });
};
for (const i of arr(old.items)) {
  requireFile('originals', i.file, i.type === 'video' ? VID : PHO);
  for (const u of [i.preview, i.cover, i.teaser]) if (u) requireFile('previews', u, UP);
}
for (const p of arr(old.profiles)) if (p.avatar) requireFile('previews', p.avatar, UP);
const sl = old.site && old.site.live && old.site.live.cover;
const sd = old.site && old.site.draft && old.site.draft.cover;
for (const u of [sl, sd]) if (u) requireFile('previews', u, UP);
if (old.live && old.live.loop) requireFile('previews', old.live.loop, UP);
const missing = requiredFiles.filter(x => !x.file || !fs.existsSync(x.file));
if (missing.length) {
  console.error('Preflight interrompido: arquivos obrigatorios ausentes. Nenhum dado foi gravado.');
  console.error(missing.map(x => x.bucket + '/' + x.key + ' <- ' + (x.file || '(caminho invalido)')).join('\\n'));
  process.exit(1);
}

(async () => {
  const supa = DRY ? null : createSupa({ url: E.SUPABASE_URL, anonKey: E.SUPABASE_ANON_KEY, serviceKey: E.SUPABASE_SERVICE_ROLE_KEY }), T = supa && supa.db;
  const up = async (bucket, key, file) => { if (!fs.existsSync(file)) throw new Error('Arquivo desapareceu durante a importacao: ' + bucket + '/' + key); if (!DRY) await supa.storage.putFile(bucket, key, file, MIME[path.extname(key).toLowerCase()]); stats.files++; return true; };
  const put = async (table, rows, onConflict) => { if (!rows.length) return; if (!DRY) for (let i = 0; i < rows.length; i += 200) await T.insert(table, rows.slice(i, i + 200), { upsert: true, onConflict: onConflict || 'id' }); };

  /* 1. arquivos */
  for (const i of arr(old.items)) { const dir = i.type === 'video' ? VID : PHO; await up('originals', path.basename(i.file), path.join(dir, path.basename(i.file))); for (const u of [i.preview, i.cover, i.teaser]) if (u) await up('previews', path.basename(u), path.join(UP, path.basename(u))); }
  for (const p of arr(old.profiles)) if (p.avatar) await up('previews', path.basename(p.avatar), path.join(UP, path.basename(p.avatar)));
  const sl = old.site && old.site.live && old.site.live.cover, sd = old.site && old.site.draft && old.site.draft.cover; for (const u of [sl, sd]) if (u) await up('previews', path.basename(u), path.join(UP, path.basename(u)));
  if (old.live && old.live.loop) await up('previews', path.basename(old.live.loop), path.join(UP, path.basename(old.live.loop)));

  /* 2. tabelas (ordem respeita as chaves estrangeiras) */
  const profiles = arr(old.profiles).map(p => ({ id: p.id, name: p.name, username: p.user || '', bio: p.bio || '', avatar: p.avatar || '', verified: !!p.verified, published: !!p.published })); await put('profiles', profiles); stats.profiles = profiles.length;
  const pids = new Set(profiles.map(p => p.id));
  const items = arr(old.items).filter(i => pids.has(i.profileId)).map(i => ({ id: i.id, profile_id: i.profileId, type: i.type, title: i.title, price_cents: i.price || 0, original_file: path.basename(i.file), preview: i.preview || '', cover: i.cover || '', teaser: i.teaser || '', duration: i.duration || 0, published: !!i.published, created_at: iso(i.createdAt) })); await put('items', items); stats.items = items.length;
  const iids = new Set(items.map(i => i.id)), svcs = arr(old.live && old.live.services);
  await put('live_services', svcs.map(s => ({ id: s.id, name: s.name, description: s.desc || '', price_cents: s.price || 0, duration_min: s.duration || 30, conditions: s.conditions || '', active: !!s.active }))); stats.services = svcs.length;
  const orders = arr(old.orders), oids = new Set(orders.map(o => o.id));
  const slots = svcs.flatMap(s => arr(s.slots).map(x => ({ id: x.id, service_id: s.id, at: iso(x.at), order_id: null })));
  await put('live_slots', slots); stats.slots = slots.length;
  const slotById = new Map(slots.map(s => [s.id, s]));
  const orderRows = orders.map(o => {
    const serviceId = o.type === 'live' && svcs.some(s => s.id === o.serviceId) ? o.serviceId : null;
    const slot = o.type === 'live' && slotById.get(o.slotId);
    return { id: o.id, code: o.code, token: o.token, account_id: null, email: String(o.email || '').toLowerCase(), type: o.type, item_id: o.type === 'item' && iids.has(o.itemId) ? o.itemId : null, service_id: serviceId, slot_id: slot && slot.service_id === serviceId ? slot.id : null, slot_at: o.type === 'live' && o.slotAt ? iso(o.slotAt) : null, notes: o.notes || '', price_cents: o.price || 0, status: ['pending', 'paid', 'rejected', 'cancelled', 'revoked'].includes(o.status) ? o.status : 'cancelled', created_at: iso(o.createdAt), paid_at: o.paidAt ? iso(o.paidAt) : null, paid_by: o.by || null, note: o.note || null };
  });
  await put('orders', orderRows); stats.orders = orders.length;
  const orderById = new Map(orderRows.map(o => [o.id, o]));
  for (const service of svcs) for (const slot of arr(service.slots)) {
    const order = orderById.get(slot.orderId);
    if (!DRY && order && order.type === 'live' && order.slot_id === slot.id) {
      await T.patch('live_slots', { id: eq(slot.id) }, { order_id: order.id });
    }
  }
  const paySt = { paid: 'confirmed', revoked: 'confirmed', pending: 'pending', rejected: 'rejected', cancelled: 'cancelled' };
  await put('payments', orders.map(o => ({ id: 'pg' + o.id, order_id: o.id, method: 'legacy', amount_cents: o.price || 0, status: paySt[o.status] || 'cancelled', txid: 'GR' + o.code, source: ['paid', 'revoked'].includes(o.status) ? (o.by === 'webhook' ? 'webhook' : 'admin') : null, note: o.note || null, created_at: iso(o.createdAt), confirmed_at: o.paidAt ? iso(o.paidAt) : null }))); stats.payments = orders.length;
  const auths = orders.filter(o => ['paid', 'revoked'].includes(o.status) && o.type === 'item' && iids.has(o.itemId)).map(o => {
    const revokedAt = o.revokedAt || o.revoked_at || (o.status === 'revoked' ? o.paidAt || o.createdAt : null);
    return { id: 'au' + o.id, order_id: o.id, account_id: null, email: String(o.email || '').toLowerCase(), item_id: o.itemId, kind: 'payment', granted_by: o.by || 'legado', note: o.note || 'importado da versão antiga', created_at: iso(o.paidAt || o.createdAt), revoked_at: revokedAt ? isoAny(revokedAt) : null, revoked_by: o.revokedBy || o.revoked_by || (o.status === 'revoked' ? o.by || 'legado' : null) };
  }); await put('authorizations', auths); stats.authorizations = auths.length;
  const leads = arr(old.leads).filter(l => l.email).map(l => ({ email: String(l.email).toLowerCase(), created_at: iso(l.at) })); await put('leads', leads, 'email'); stats.leads = leads.length;
  const chats = arr(old.chats).map(c => ({ cid: c.cid, id: c.id, email: c.email || '', mode: c.mode || 'bot', status: c.status || 'open', msgs: c.msgs || [], stack: c.stack || [], updated_at: iso(c.updated) })); await put('chats', chats, 'cid'); stats.chats = chats.length;

  /* 3. configurações */
  const now = new Date().toISOString(), S = [];
  if (old.site) { if (old.site.live) S.push({ key: 'site_live', value: cleanSite(old.site.live), updated_at: now }); if (old.site.draft) S.push({ key: 'site_draft', value: cleanSite(old.site.draft), updated_at: now }); }
  if (old.robot) S.push({ key: 'robot', value: old.robot, updated_at: now });
  if (old.live) S.push({ key: 'live_loop', value: { url: old.live.loop || '', on: old.live.loopOn !== false }, updated_at: now });
  await put('settings', S, 'key');
  const log = arr(old.log).slice(0, 300).reverse().map(l => ({ actor: 'legado', action: String(l.a || '').slice(0, 200), detail: String(l.d || '').slice(0, 300), created_at: iso(l.t) }));
  if (!DRY && log.length && (await T.count('audit_log', { actor: 'eq.legado' })) === 0) await T.insert('audit_log', log);

  console.log((DRY ? 'SIMULAÇÃO (nada foi gravado)\n' : 'Importação concluída\n') + JSON.stringify({ ...stats, missingFiles: stats.missingFiles.length }, null, 2));
  if (stats.missingFiles.length) console.log('\nArquivos citados no banco mas ausentes na pasta antiga (o registro foi importado mesmo assim):\n - ' + stats.missingFiles.join('\n - '));
  if (arr(old.admins).length) console.log('\nLembrete: ' + old.admins.length + ' administrador(es) antigo(s) NÃO foram importados. Defina ADMIN_EMAILS e crie a conta pelo cadastro do site.');
})().catch(e => { console.error('\nFalha na importação: ' + e.message + '\nNada foi apagado. Corrija o problema e rode de novo: o script pode ser repetido.'); process.exit(1); });
