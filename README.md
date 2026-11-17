# GOLDREX

Plataforma de perfil com fotos e vídeos vendidos individualmente, **Pix manual** e painel `/admin`. Dados no Supabase; site em Node.js (sem dependências).

Leia **COMECE-AQUI.md**.

- Contas dos clientes: usuário + senha (hash scrypt), sem e-mail e sem recuperação.
- Pagamento: o cliente paga na chave Pix, toca em "Já paguei"; o administrador confirma em Pedidos e recebe notificação push no celular (`lib/push.js`).
- Originais e prévias em buckets privados; o servidor só entrega o original com pedido pago + autorização + link temporário.
- Onde mexer: `server.js`, `lib/`, `public/`, `supabase/migrations/`.
