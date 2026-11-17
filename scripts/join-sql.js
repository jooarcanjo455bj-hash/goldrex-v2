const fs = require('fs');

const files = [
  'supabase/migrations/0001_schema.sql',
  'supabase/migrations/0002_rls.sql',
  'supabase/migrations/0003_storage.sql',
  'supabase/migrations/0004_functions.sql',
  'supabase/migrations/0005_integrity.sql',
  'supabase/migrations/0006_atomic_orders.sql',
  'supabase/migrations/0007_private_previews.sql',
  // 0008_asaas_pix.sql remains historical and is intentionally excluded.
  'supabase/migrations/0009_refresh_changed_price_orders.sql',
  'supabase/migrations/0010_pagamentos.sql',
  'supabase/migrations/0011_remover_dropfans.sql',
  'supabase/migrations/0012_contas_sem_email.sql'
];

for (const file of files) {
  if (!fs.existsSync(file)) {
    console.error('Migracao ausente: ' + file);
    process.exit(1);
  }
}

const output = 'supabase/EXECUTAR-TUDO.sql';
const backup = output + '.backup-script';

if (fs.existsSync(output) && !fs.existsSync(backup)) {
  fs.copyFileSync(output, backup);
}

const content = files
  .map(file => fs.readFileSync(file, 'utf8').trimEnd())
  .join('\n\n') + '\n';

fs.writeFileSync(output, content, 'utf8');

if (fs.readFileSync(output, 'utf8') !== content) {
  console.error('Falha ao conferir o SQL gerado.');
  process.exit(1);
}

console.log('SQL consolidado gerado e conferido.');
console.log('Migracoes incluidas: ' + files.length);
