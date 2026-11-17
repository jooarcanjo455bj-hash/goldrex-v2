/* Recebe as notificações push do painel (aviso de pedido novo no celular do administrador). */
self.addEventListener('push', e => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch { }
  e.waitUntil(self.registration.showNotification(d.title || 'Novo aviso', { body: d.body || '', actions: d.orderId ? [{ action: 'confirm', title: 'Confirmar pagamento' }] : [], icon: '/icon-192.png', badge: '/icon-192.png', tag: 'pedido', renotify: true, data: { url: d.url || '/', orderId: d.orderId || '' } }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close(); const nd = e.notification.data || {}, url = nd.url || '/';
  if (e.action === 'confirm' && nd.orderId) {/* botão "Confirmar pagamento" direto na notificação */
    e.waitUntil(fetch('/api/admin/order/' + encodeURIComponent(nd.orderId) + '/confirm', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-req': '1' }, body: '{}' })
      .then(r => self.registration.showNotification(r.ok ? 'Pagamento confirmado' : 'Abra o painel para confirmar', { body: r.ok ? 'O cliente já recebeu o produto.' : 'Entre no painel e toque em Confirmar.', icon: '/icon-192.png', tag: 'confirmacao', data: { url } }))
      .catch(() => self.registration.showNotification('Abra o painel para confirmar', { body: 'Não deu para confirmar daqui.', icon: '/icon-192.png', tag: 'confirmacao', data: { url } })));
    return;
  }
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(l => { for (const c of l) { if ('focus' in c) { c.navigate(url).catch(() => { }); return c.focus(); } } return self.clients.openWindow(url); }));
});
