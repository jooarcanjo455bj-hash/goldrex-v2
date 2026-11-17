/* Apaga TODOS os arquivos dos buckets "originals" e "previews" do Supabase Storage. Uso: npm run limpar-arquivos */
const readline = require('readline/promises'), path = require('path');
const loadEnv = require('../lib/env'), { createSupa } = require('../lib/supa');
(async () => {
  loadEnv(path.join(__dirname, '..'), { skipInTest: false });
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ans = await rl.question('Isto APAGA todas as fotos e vídeos do Storage. Digite SIM para continuar: '); rl.close();
  if (ans !== 'SIM') return console.log('Cancelado.');
  const supa = createSupa({ url: process.env.SUPABASE_URL, anonKey: process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY, serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY });
  for (const bucket of ['originals', 'previews']) {
    let total = 0;
    for (;;) {
      const files = (await supa.storage.list(bucket)).filter(f => f && f.name && f.id);
      if (!files.length) break;
      await supa.storage.remove(bucket, files.map(f => f.name)); total += files.length;
    }
    console.log(bucket + ': ' + total + ' arquivo(s) apagado(s).');
  }
})().catch(e => { console.error('Falhou: ' + e.message); process.exitCode = 1; });
