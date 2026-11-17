const $=s=>document.querySelector(s),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),brl=c=>(c/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const token=location.pathname.split('/').pop(),root=$('#payment');let timer,stopped=false;
const post=u=>fetch(u,{method:'POST',headers:{'content-type':'application/json','x-req':'1'},body:'{}'}).then(r=>r.json().catch(()=>({})));
function show(p){
 if(p.status==='confirmed'){root.innerHTML=`<section class="box"><span class="tag g">Pagamento confirmado</span><h2 style="margin-top:12px">Pronto! Seu conteúdo foi liberado.</h2></section><a class="btn full" href="/?tab=compra">Ver minhas compras</a>`;return}
 if(p.status==='failed'){root.innerHTML=`<section class="box"><span class="tag r">Pedido encerrado</span><p style="margin-top:10px">Este pedido foi cancelado ou o pagamento não foi encontrado. Se você pagou, faça um novo pedido e envie o comprovante pelo contato do site.</p></section>`;return}
 root.innerHTML=`<section class="box"><span class="tag y">Aguardando pagamento</span><h2 style="margin-top:12px">Valor: ${brl(p.amountCents)}</h2><p class="mu sm">Código do pedido: <b>${esc(p.reference)}</b></p></section>
 ${p.pixKey?`<section class="box c"><h3>1. Pague por Pix</h3>${p.pixReceiver?`<p class="mu">Quem recebe: <b>${esc(p.pixReceiver)}</b></p>`:''}<div id="qr" style="background:#fff;padding:10px;border-radius:12px;display:inline-block;margin:8px auto;line-height:0"></div><p class="mu sm">Abra o app do seu banco, escolha Pix e leia o QR Code. Valor: <b>${brl(p.amountCents)}</b></p><p class="mu" style="margin-top:10px">Ou use o Pix copia e cola:</p><textarea id="pcode" readonly rows="3" style="width:100%;font-size:13px">${esc(p.pixCode)}</textarea><button class="btn full" id="copypix" type="button" style="margin-top:8px">Copiar Pix copia e cola</button></section>
 <section class="box"><h3>2. Avise que pagou</h3>${p.claimed?'<p><b>Aviso enviado.</b> Seu produto será confirmado em um momento. Pode deixar esta página aberta: ela atualiza sozinha.</p>':'<button class="btn gold full" id="paid" type="button">Já paguei</button><p class="mu sm" style="margin-top:8px">Seu produto será confirmado em um momento, assim que o pagamento for conferido.</p>'}</section>`:'<section class="box"><p>O Pix ainda não foi configurado pelo site. Volte mais tarde.</p></section>'}<p class="err" id="poll-error" role="status"></p>`;
 const qe=$('#qr');if(qe&&p.pixCode&&window.qrcode){const q=qrcode(0,'M');q.addData(p.pixCode);q.make();qe.innerHTML=q.createSvgTag({cellSize:5,margin:0,scalable:true});const sv=qe.querySelector('svg');if(sv){sv.style.width='240px';sv.style.height='240px'}}
 const cp=$('#copypix');if(cp)cp.onclick=async()=>{try{await navigator.clipboard.writeText(p.pixCode);cp.textContent='Pix copiado!'}catch{$('#pcode').select();cp.textContent='Selecione e copie o texto acima'}};
 const pd=$('#paid');if(pd)pd.onclick=async()=>{pd.disabled=true;await post('/api/order/'+encodeURIComponent(token)+'/paid');poll(true)};
}
async function poll(now){
 if(stopped)return;clearTimeout(timer);
 try{const r=await fetch('/api/pagamento/'+encodeURIComponent(token)),d=await r.json();if(!r.ok)throw new Error(d.error||'Não foi possível carregar o pagamento.');show(d);if(d.status!=='pending'){stopped=true;return}}
 catch(e){const el=$('#poll-error');if(el)el.textContent='Sem conexão agora. Vamos tentar de novo.';else root.innerHTML='<div class="box">'+esc(e.message)+'</div>'}
 timer=setTimeout(poll,6000);
}
poll();
