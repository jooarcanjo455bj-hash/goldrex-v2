/* Teste de tela do PAINEL ADMIN (Playwright + Supabase simulado). Rodar: node tests/ui-admin.js  — salva capturas em tests/shots/ */
/* Confere: menu so com Perfis/Fotografias/Videos/Pedidos/Acesso, Pedidos sem dado de cliente, nenhum 'undefined', campos do Dropfans no item e site publico sem Chat/Ao Vivo. */
const { spawn } = require('child_process'), path = require('path'), fs = require('fs'), crypto = require('crypto');
const { chromium } = require('playwright'); const mock = require('./mock-supabase');
const MP = 54200, SP = 54201, BASE = 'http://127.0.0.1:' + SP, ROOT = path.join(__dirname, '..'), SHOTS = path.join(__dirname, 'shots'); fs.mkdirSync(SHOTS, { recursive: true });
(async () => {
  const errors = [];
  let M = null, proc = null, browser = null;
  try {
    M = await mock.start(MP);
    proc = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: SP, SUPABASE_URL: M.url, SUPABASE_ANON_KEY: mock.ANON, SUPABASE_SERVICE_ROLE_KEY: mock.SERVICE, APP_SECRET: 'y'.repeat(40), NODE_ENV: 'test' } });
    await new Promise((resolve, reject) => {
      let settled = false;
      let serverOutput = '';
      const finish = err => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        err ? reject(err) : resolve();
      };
      const timer = setTimeout(() => finish(new Error('Server did not start in 30 seconds.\n' + serverOutput)), 30000);
      proc.once('error', e => finish(new Error('Falha ao iniciar servidor: ' + e.message)));
      proc.stdout.on('data', d => {
        serverOutput += String(d);
        if (serverOutput.includes('GOLDREX em')) finish();
      });
      proc.stderr.on('data', d => { serverOutput += String(d); });
      proc.once('exit', (code, signal) => finish(new Error('Server exited before starting; code: ' + code + ', signal: ' + signal + '\n' + serverOutput)));
    });
    browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } }), page = await ctx.newPage();
  page.on('pageerror', e => errors.push('pageerror: ' + e.message)); page.on('console', m => m.type() === 'error' && errors.push('console: ' + m.text()));
  const check = (c, msg) => { if (!c) { errors.push('FALHOU: ' + msg); console.log('  ✗ ' + msg); } else console.log('  ✓ ' + msg); };
  try {
    // cadastra o admin e semeia conteúdo pela API (como o painel faria)
    const cj = []; const call = async (m, p, body, raw) => { const r = await fetch(BASE + p, { method: m, headers: { 'x-req': '1', cookie: cj.join('; '), ...(body && !Buffer.isBuffer(body) ? { 'content-type': 'application/json' } : {}) }, body: body ? (Buffer.isBuffer(body) ? body : JSON.stringify(body)) : undefined }); r.headers.getSetCookie().forEach(c => cj.push(c.split(';')[0])); return r.json(); };
    await call('POST', '/api/admin/signup', { username: 'admin', password: 'senha-forte-1' }); await call('POST', '/api/admin/login', { username: 'admin', password: 'senha-forte-1' });
    const prof = await call('POST', '/api/admin/profile', { name: 'Perfil Demo', user: 'demo', bio: 'Bio de teste', published: true, verified: true });
    const jpg = n => { const b = crypto.randomBytes(n); b[0] = 0xFF; b[1] = 0xD8; b[2] = 0xFF; return b; };
    const pv = await call('PUT', '/api/admin/upload?kind=cover&name=p.jpg', jpg(400)), og = await call('PUT', '/api/admin/upload?kind=photo&name=f.jpg', jpg(4000));
    await call('POST', '/api/admin/item', { profileId: prof.id, type: 'photo', file: og.file, title: 'Foto 01', price: 1990, preview: pv.url, published: true });
    await call('POST', '/api/admin/service', { name: 'Chamada demo', desc: 'Modalidade de teste', price: 1500, duration: 20, active: true });


    console.log('Painel administrativo (sem dados de cliente)');
    const actx = await browser.newContext({ viewport: { width: 1100, height: 800 } }), ap = await actx.newPage();
    ap.on('pageerror', e => errors.push('admin pageerror: ' + e.message)); ap.on('console', m => m.type() === 'error' && !/401|503/.test(m.text()) && errors.push('admin console: ' + m.text()));
    await ap.goto(BASE + '/admin'); await ap.waitForSelector('#fm');
    await ap.fill('#username', 'admin'); await ap.fill('#c', 'senha-forte-1'); await ap.click('#fm button'); await ap.waitForSelector('.adm'); check(true, 'admin entra no painel');
    const menu = (await ap.locator('.side button[data-s]').allInnerTexts()).map(t => t.trim());
    check(JSON.stringify(menu) === JSON.stringify(['Perfis', 'Fotografias', 'Vídeos', 'Pedidos', 'Acesso']), 'menu so tem Perfis, Fotografias, Videos, Pedidos e Acesso (veio: ' + menu.join(', ') + ')');
    // cria um pedido pendente de verdade (cliente comum) para a tela de Pedidos ter dado
    const cust = []; const cc = async (m, p, body) => { const r = await fetch(BASE + p, { method: m, headers: { 'x-req': '1', cookie: cust.join('; '), 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); r.headers.getSetCookie().forEach(c => cust.push(c.split(';')[0])); return r.json().catch(() => ({})); };
    await cc('POST', '/api/auth/signup', { email: 'cliente.secreto@example.com', password: 'senha-forte-9', termsAccepted: true });
    // cada secao: nenhum 'undefined', nenhum e-mail, nenhum nome de cliente
    let vazou = [];
    for (const s of ['pedidos', 'compras', 'perfis', 'fotos', 'videos', 'acesso']) {
      const b = await ap.$(`[data-s=${s}]`); if (!b) continue;
      await b.click(); await ap.waitForTimeout(300);
      const txt = await ap.locator('#mn').innerText();
      if (/undefined|NaN|\[object/.test(txt)) vazou.push(s + ': texto quebrado');
      if (/@[a-z0-9-]+\./i.test(txt) || /cliente\.secreto/i.test(txt)) vazou.push(s + ': e-mail visivel');
      await ap.screenshot({ path: path.join(SHOTS, 'admin-' + s + '.png') });
    }
    check(vazou.length === 0, 'nenhuma secao mostra e-mail, "undefined" ou texto quebrado' + (vazou.length ? ' -> ' + vazou.join(' | ') : ''));
    await ap.click('[data-s=compras]'); await ap.waitForTimeout(300);
    const heads = (await ap.locator('#mn th').allInnerTexts()).map(t => t.trim().toLowerCase());
    check(JSON.stringify(heads) === JSON.stringify(['id do pedido', 'produto', 'valor', 'status do pagamento']), 'Pedidos mostra so ID, produto, valor e status (veio: ' + heads.join(', ') + ')');
    const full = await ap.locator('#mn').innerText();
    check(!/pagar? manualmente|confirme pagamentos|aguardando documenta/i.test(full) && !(await ap.locator('#mn button', { hasText: /confirmar|liberar|revogar/i }).count()), 'sem botao de confirmar/liberar pagamento manual e sem aviso antigo');
    // chamadas diretas de API do admin tambem nao entregam cliente
    const data = JSON.stringify(await (await fetch(BASE + '/api/admin/data', { headers: { 'x-req': '1', cookie: (await actx.cookies()).map(c => c.name + '=' + c.value).join('; ') } })).json());
    const hit = data.match(/.{0,40}([\w.+-]+@[\w-]+\.[\w.]+|"email"|"clients"|"chats"|"leads").{0,40}/); check(!hit, '/api/admin/data nao contem e-mail, clientes, chats nem leads (o @demo do perfil e apelido publico)' + (hit ? ' -> ' + hit[0] : ''));
    // edicao: a lista de fotos tem os campos do Dropfans (ID do produto e valor) em cada foto
    await ap.click('[data-s=fotos]'); await ap.waitForSelector('[data-df-id]');
    check((await ap.locator('[data-df-id]').count()) >= 1 && (await ap.locator('[data-df-amount]').count()) >= 1, 'cada foto tem os campos do Dropfans (ID do produto e valor)');
    await ap.screenshot({ path: path.join(SHOTS, 'admin-fotos-dropfans.png') });
    console.log('Site publico');
    const pctx = await browser.newContext({ viewport: { width: 390, height: 800 } }), pp = await pctx.newPage();
    await pp.goto(BASE + '/'); await pp.waitForSelector('.gate'); await pp.check('#age-terms'); await pp.click('#gc'); await pp.waitForSelector('.hero');
    const nav = (await pp.locator('.bn button').allInnerTexts().catch(() => [])).join(' | ');
    check(nav.length > 0 && !/chat|ao vivo/i.test(nav), 'site publico nao mostra as abas Chat e Ao Vivo (menu: ' + nav + ')');
    await pp.screenshot({ path: path.join(SHOTS, 'site-publico.png') });

  } catch (e) { errors.push('EXCEÇÃO: ' + e.message); }
  } catch (e) {
    errors.push('FALHA NA INICIALIZA??O: ' + e.message);
  } finally {
    if (browser) {
      try { await browser.close(); } catch (e) { errors.push('Falha ao fechar navegador: ' + e.message); }
    }
    if (proc && proc.exitCode === null && proc.signalCode === null) {
      proc.kill('SIGTERM');
    }
    if (M) {
      try { await M.close(); } catch (e) { errors.push('Falha ao fechar mock: ' + e.message); }
    }
  }
  console.log(errors.length ? '\nPROBLEMAS:\n' + errors.join('\n') : '\nInterface OK, sem erros de console.');
  process.exitCode = errors.length ? 1 : 0;
})();
