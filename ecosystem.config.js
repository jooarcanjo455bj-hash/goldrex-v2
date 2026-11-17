/* PM2 · mantém o GOLDREX no ar na VPS (reinicia sozinho se cair e sobe junto com o servidor).
   As variáveis ficam no arquivo ".env" desta pasta (o server.js já lê esse arquivo). */
module.exports = {
  apps: [{
    name: 'goldrex',
    script: 'server.js',
    cwd: __dirname,
    instances: 1,            // não aumente: o tempo real (chat/avisos) fica na memória de um único processo
    exec_mode: 'fork',
    max_memory_restart: '400M',
    kill_timeout: 5000,
    env: { NODE_ENV: 'production' },
  }],
};
