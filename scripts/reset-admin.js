const readline = require('readline/promises');
const { stdin, stdout } = require('process');
const path = require('path');
const loadEnv = require('../lib/env');
const { createSupa, eq } = require('../lib/supa');

async function main() {
  loadEnv(path.join(__dirname, '..'), { skipInTest: false });
  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    const answer = await rl.question('Para apagar somente o acesso administrativo, digite SIM: ');
    if (answer !== 'SIM') {
      console.log('Operação cancelada.');
      return;
    }

    const supa = createSupa({
      url: process.env.SUPABASE_URL,
      anonKey: process.env.SUPABASE_ANON_KEY,
      serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY
    });
    const removed = await supa.db.del('settings', { key: eq('admin_credential') });
    console.log(removed.length ? 'Acesso administrativo removido.' : 'Nenhum acesso administrativo estava configurado.');
  } finally {
    rl.close();
  }
}

main().catch(error => {
  console.error('Falha ao redefinir o acesso administrativo. Verifique a configuração e a conexão, sem compartilhar credenciais.');
  process.exitCode = 1;
});
