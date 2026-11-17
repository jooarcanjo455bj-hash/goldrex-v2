const $=(s,e=document)=>e.querySelector(s),app=$('#app');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const brl=c=>(c/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}),dt=t=>t?new Date(t).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'}):'—',cents=v=>Math.round(parseFloat(String(v||'0').replace(',','.'))*100)||0;
const api=async(u,m='GET',b)=>{const r=await fetch('/api/admin'+u,{method:m,headers:{'content-type':'application/json','x-req':'1'},body:b?JSON.stringify(b):undefined});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||'Erro');return j};
const IC={v:'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',u:'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0',c:'M3 5h18v14H3zM3 16l5-5 4 4 3-3 6 6',p:'M7 4l13 8-13 8z',s:'M5 8h14l-1 12H6zM9 8a3 3 0 016 0',m:'M4 5h16v11H8l-4 4z',l:'M3 6h13v12H3zM16 10l5-3v10l-5-3',x:'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h3v3M20 14v6h-3',a:'M12 3a9 9 0 100 18c1.5 0 2-1 1.5-2s0-2 1.5-2h2a3 3 0 003-3 9 9 0 00-8-11z',k:'M7 11a4 4 0 118 0v2h2v8H5v-8h2z',g:'M12 3a9 9 0 100 18 9 9 0 000-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18'};
const ico=k=>`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="${IC[k]}"/></svg>`;
const sw=(id,on)=>`<label class="sw"><input type="checkbox" id="${id}" ${on?'checked':''}><span></span></label>`;
const fld=(id,l,v='',t='text',x='')=>`<label>${l}</label><input id="${id}" type="${t}" value="${esc(v)}" ${x}>`;
const msg=(m,ok)=>{const d=document.createElement('div');d.className='banner admin-toast '+(ok?'toast-success':'toast-error');d.textContent=m;document.body.append(d);setTimeout(()=>d.remove(),2800)};
const CP=t=>navigator.clipboard.writeText(t).then(()=>msg('Copiado',1)).catch(()=>msg('Não foi possível copiar'));
function modal(h){const d=document.createElement('div');d.className='modal';d.innerHTML='<div class="box" style="max-height:92vh;overflow:auto">'+h+'</div>';document.body.append(d);return d}
/* ---------- acesso (login) ---------- */
const wrap=h=>{app.innerHTML=`<div class="term"><div class="box" style="max-width:380px;width:100%"><div class="logo" style="margin-bottom:6px">GOLDREX</div><p class="mu c sm" style="margin-bottom:6px">Painel administrativo</p>${h}<p id="er" class="err"></p></div></div>`};
const submit=fn=>{$('#fm').onsubmit=async e=>{e.preventDefault();$('#er').textContent='';try{await fn()}catch(x){$('#er').textContent=x.message}}};
let CFG={};
async function term(){const st=await api('/state');CFG=st;if(st.authed)return panel();viewLogin()}
function viewLogin(notice='',username='',tab){
 const setup=!CFG.configured,up=(tab||(setup?'up':'in'))==='up',repl=up&&!setup;
 wrap(`<div class="tabs" style="margin:8px 0"><button id="t-in" type="button" class="${up?'':'on'}">Entrar</button><button id="t-up" type="button" class="${up?'on':''}">Criar sua conta</button></div>${up?`<h2 class="c">Criar sua conta de administrador</h2>${repl?'<p class="mu sm c">Já existe um acesso antigo. Para criar um novo (o antigo é apagado), digite o código de segurança: copie o valor de APP_SECRET do arquivo .env do projeto.</p>':'<p class="mu sm c">Guarde seu usuário e sua senha.</p>'}`:'<h2 class="c">Entrar</h2>'}<form id="fm" autocomplete="on">${repl?fld('sc','Código de segurança','','password','autocomplete="off" required'):''}${fld('username','Usuário',username,'text','autocomplete="username" minlength="3" maxlength="32" pattern="[A-Za-z0-9._-]{3,32}" required')}${fld('c','Senha','','password',`autocomplete="${up?'new-password':'current-password'}" required minlength="8" maxlength="128"`)}${up?fld('c2','Confirmar senha','','password','autocomplete="new-password" required minlength="8" maxlength="128"'):'<label class="row" style="justify-content:flex-start;gap:8px;margin-top:10px"><input id="remember" type="checkbox"> Manter conectado</label>'}<button class="btn gold full" style="margin-top:12px">${up?'Criar acesso':'Entrar'}</button></form>${CFG.stableSecret?'':'<p class="err sm">O servidor precisa de um APP_SECRET estável (mínimo 32 caracteres) para habilitar o painel.</p>'}`);
 $('#t-in').onclick=()=>viewLogin('',$('#username').value,'in');$('#t-up').onclick=()=>viewLogin('',$('#username').value,'up');
 if(notice){$('#er').classList.add('success-message');$('#er').textContent=notice}
 submit(async()=>{
  const user=$('#username').value.trim().toLowerCase(),pw=$('#c').value;
  if(pw.length<8)throw new Error('A senha precisa ter pelo menos 8 caracteres.');
  if(up){
   if(pw!==$('#c2').value)throw new Error('As senhas não conferem.');
   await api('/signup','POST',{username:user,password:pw,setupCode:repl?$('#sc').value:undefined});
   CFG.configured=true;viewLogin('Acesso criado! Entre com seu usuário e senha.',user,'in');return;
  }
  await api('/login','POST',{username:user,password:pw,remember:$('#remember').checked});panel()
 })}
/* ---------- painel ---------- */
let D,sec='compras';
const SEC=[['compras','Pedidos','s'],['perfis','Perfis','u'],['fotos','Fotografias','c'],['videos','Vídeos','p'],['pix','Pix','x'],['site','Site','g'],['acesso','Acesso','k']];
const mySec=()=>SEC;
async function panel(){D=await api('/data');if(!mySec().some(s=>s[0]===sec))sec=mySec()[0][0];shell();new EventSource('/api/admin/stream').onmessage=()=>{if(sec==='compras'&&!document.querySelector('.modal'))api('/data').then(d=>{D=d;draw()}).catch(()=>{})}}
const reload=async()=>{D=await api('/data');draw()};
const run=async(f,ok)=>{try{await f();if(ok)msg(ok,1);await reload()}catch(e){msg(e.message)}};
function shell(){app.innerHTML=`<div class="adm"><aside class="side"><div class="logo" style="padding:8px 6px 14px;justify-content:flex-start">GOLDREX</div>${mySec().map(s=>`<button data-s="${s[0]}">${ico(s[2])}<span>${s[1]}</span></button>`).join('')}<button class="lo" id="lo" style="margin-top:20px">Sair</button></aside><main class="main" id="mn"></main></div>`;
 app.querySelectorAll('[data-s]').forEach(b=>b.onclick=()=>{sec=b.dataset.s;reload().catch(e=>msg(e.message))});$('#lo').onclick=async()=>{await api('/logout','POST');location.reload()};draw()}
let ct;function draw(){clearInterval(ct);app.querySelectorAll('[data-s]').forEach(b=>b.classList.toggle('on',b.dataset.s===sec));({perfis,fotos:m=>lista(m,'photo'),videos:m=>lista(m,'video'),compras,pix:pixsec,site:sitesec,acesso}[sec])($('#mn'))}
function perfis(m){m.innerHTML=`<div class="row"><h2 style="flex:1">Perfis cadastrados</h2><button class="btn sm" id="n">+ Novo perfil</button></div>${D.profiles.map(p=>`<div class="box row" style="flex-wrap:nowrap"><div class="av" style="width:56px;height:56px;margin:0;flex:none;border-width:2px">${p.avatar?`<img src="${esc(p.avatar)}" alt="">`:ico('u')}</div><div style="flex:1;min-width:0"><b>${esc(p.name)}</b> <span class="mu">${esc(p.user)}</span><br><span class="mu sm">${D.items.filter(i=>i.profileId===p.id).length} itens · ${p.published?'publicado':'oculto'}${p.verified?' · verificado':''}</span></div><button class="btn sm sec" data-e="${p.id}">Editar</button><button class="btn sm red" data-d="${p.id}">Excluir</button></div>`).join('')||'<p class="mu">Nenhum perfil. Cadastre o primeiro.</p>'}<p class="mu sm">Cada perfil mantém as próprias fotos, vídeos e preços. A foto de perfil é pública.</p>`;
 $('#n').onclick=()=>pform();m.querySelectorAll('[data-e]').forEach(b=>b.onclick=()=>pform(D.profiles.find(p=>p.id===b.dataset.e)));m.querySelectorAll('[data-d]').forEach(b=>b.onclick=()=>confirm('Excluir o perfil e TODAS as fotos e vídeos dele? Não dá para desfazer.')&&run(()=>api('/profile/'+b.dataset.d,'DELETE'),'Excluído'))}
function pform(p={}){const m=modal(`<h3>${p.id?'Editar':'Novo'} perfil</h3><label>Foto de perfil</label><input id="f" type="file" accept="image/*">${fld('a','Nome de exibição',p.name)}${fld('u','Usuário',p.user)}${fld('b','Bio',p.bio)}<div class="row" style="margin-top:10px"><label style="margin:0;color:var(--tx)">Perfil verificado</label>${sw('vf',p.verified)}<label style="margin:0 0 0 10px;color:var(--tx)">Perfil publicado</label>${sw('pb',p.published)}</div><p class="err" id="er"></p><div class="row" style="margin-top:10px"><button class="btn" id="ok">Salvar alterações</button><button class="btn sec" id="no">Cancelar</button></div>`);$('#no',m).onclick=()=>m.remove();
 $('#ok',m).onclick=()=>run(async()=>{let avatar=p.avatar||'';const f=$('#f',m).files[0];if(f)avatar=(await upload(f,'cover')).url;await api('/profile','POST',{id:p.id,name:$('#a',m).value,user:$('#u',m).value,bio:$('#b',m).value,avatar,verified:$('#vf',m).checked,published:$('#pb',m).checked});m.remove()},'Salvo')}
let curP='';
function lista(m,type){const ps=D.profiles,T=type==='photo'?'foto':'vídeo';if(!ps.length){m.innerHTML=`<h2>${type==='photo'?'Fotografias':'Vídeos'}</h2><p class="mu">Cadastre um perfil primeiro (menu Perfis).</p>`;return}
 if(!ps.some(x=>x.id===curP))curP=ps[0].id;const its=D.items.filter(i=>i.type===type&&i.profileId===curP).sort((a,b)=>b.createdAt-a.createdAt);
 m.innerHTML=`<div class="row"><div style="flex:1"><h2 style="margin:0">${type==='photo'?'Fotografias':'Vídeos'}</h2><span class="mu sm">${its.length} ${type==='photo'?'fotografias':'vídeos'} cadastrados</span></div>${ps.length>1?`<select id="pp" style="width:auto">${ps.map(x=>`<option value="${x.id}" ${x.id===curP?'selected':''}>${esc(x.name)}</option>`).join('')}</select>`:''}<button class="btn sm" id="n">+ Adicionar ${T}</button></div><div class="ag" style="margin-top:10px">${its.map(i=>`<div class="ac"><div class="im" style="background-image:url(${type==='photo'?'/api/admin/file/'+esc(i.file):esc(i.cover)})">${type==='video'?`<span class="du" style="position:absolute;left:6px;bottom:6px;background:var(--cor-overlay-forte);padding:2px 6px;border-radius:6px;font-size:11px">${i.duration?Math.floor(i.duration/60)+':'+String(i.duration%60).padStart(2,'0'):''}</span>`:''}</div><div class="bd"><b>${esc(i.title)}</b><span class="mu sm">Código ${esc(i.id)}${i.files&&i.files.length>1?` · Pack de ${i.files.length}`:''}</span>${i.bio?`<span class="mu sm">${esc(i.bio)}</span>`:''}<div class="row" style="flex-wrap:nowrap"><input data-pr="${i.id}" value="${(i.price/100).toFixed(2)}" inputmode="decimal" style="min-height:34px"><span class="mu">R$</span></div><div class="row" style="justify-content:space-between"><span class="mu sm">${i.published?'Publicado':'Oculto'}</span>${sw('pb-'+i.id,i.published)}</div><div class="row"><button class="btn sm sec" data-t="${i.id}">Título</button><button class="btn sm sec" data-bio="${i.id}">Bio</button><button class="btn sm red" data-x="${i.id}">Excluir</button></div></div></div>`).join('')||`<p class="mu">Nenhum ${T} cadastrado neste perfil.</p>`}</div><p class="mu sm">Cada ${T} tem o seu preço em reais. A prévia é borrada; o original só abre depois que o pagamento é confirmado.</p>`;
 const save=(i,patch)=>run(()=>api('/item','POST',{...i,...patch}),'Salvo');if($('#pp'))$('#pp').onchange=e=>{curP=e.target.value;draw()};$('#n').onclick=()=>iform(type);
 m.querySelectorAll('[data-pr]').forEach(x=>x.onchange=()=>save(D.items.find(i=>i.id===x.dataset.pr),{price:cents(x.value)}));m.querySelectorAll('input[id^=pb-]').forEach(x=>x.onchange=()=>save(D.items.find(i=>i.id===x.id.slice(3)),{published:x.checked}));
 m.querySelectorAll('[data-t]').forEach(x=>x.onclick=()=>{const i=D.items.find(y=>y.id===x.dataset.t),t=prompt('Novo título:',i.title);if(t)save(i,{title:t})});m.querySelectorAll('[data-bio]').forEach(x=>x.onclick=()=>{const i=D.items.find(y=>y.id===x.dataset.bio),t=prompt('Bio do card:',i.bio||'');if(t!==null)save(i,{bio:t})});m.querySelectorAll('[data-x]').forEach(x=>x.onclick=()=>confirm('Excluir este item e o arquivo? Não dá para desfazer.')&&run(()=>api('/item/'+x.dataset.x,'DELETE'),'Excluído'))}
function iform(type){const T=type==='photo'?'foto':'vídeo';const m=modal(`<h3>${type==='photo'?'Adicionar foto(s)':'Novo vídeo'}</h3><label>Perfil</label><select id="pr">${D.profiles.map(x=>`<option value="${x.id}" ${x.id===curP?'selected':''}>${esc(x.name)}</option>`).join('')}</select><div class="row" style="margin:12px 0 4px"><label style="margin:0;color:var(--tx);flex:1">Enviar como PACK (vários arquivos em um card só)</label>${sw('pk',false)}</div><label id="fll"></label><input id="fl" type="file" ${type==='photo'?'accept="image/*" multiple':'accept="video/*"'}><p class="mu sm" id="fc"></p><div id="pkf">${fld('ti','Título / nome')}${fld('bi','Bio (opcional)')}<label>Capa (opcional; vira prévia borrada)</label><input id="cv" type="file" accept="image/*"></div><label id="pcl"></label><input id="pc" inputmode="decimal" placeholder="0,00"><div class="row" style="margin-top:10px"><label style="margin:0;color:var(--tx)">Publicar no site</label>${sw('pb',false)}</div><p class="mu sm" id="pg"></p><div class="row" style="margin-top:10px"><button class="btn" id="ok">Salvar${type==='video'?' e publicar':''}</button><button class="btn sec" id="no">Cancelar</button></div>`);$('#no',m).onclick=()=>m.remove();
 const sync=()=>{const pk=$('#pk',m).checked;$('#fl',m).multiple=type==='photo'||pk;$('#fll',m).textContent=pk?`Arquivos do pack (${type==='photo'?'fotos':'vídeos'}) — escolha quantos quiser`:`Arquivo${type==='photo'?'s (pode escolher várias; cada foto vira um card)':' (mp4, webm ou mov)'}`;$('#pkf',m).style.display=pk||type==='video'?'':'none';$('#pcl',m).textContent=pk?'Preço do pack inteiro (R$)':`Preço (R$)${type==='photo'?' de cada foto':''}`;const n=$('#fl',m).files.length;$('#fc',m).textContent=pk&&n?`${n} arquivo(s) selecionado(s)`:''};
 $('#pk',m).onchange=sync;$('#fl',m).onchange=sync;sync();
 let saving=false,photoStartCount=null;const completedFiles=new Map(),packUp=new Map(),button=$('#ok',m);
 button.onclick=async()=>{if(saving)return;saving=true;const controls=[...m.querySelectorAll('input,select,button')];controls.forEach(x=>x.disabled=true);button.textContent='Enviando…';
  const pg=$('#pg',m);
  pg.classList.remove('upload-error');
  try{
   const files=[...$('#fl',m).files],price=cents($('#pc',m).value),pub=$('#pb',m).checked&&price>0,prof=$('#pr',m).value,pack=$('#pk',m).checked;
   if(!files.length)throw new Error('Escolha o arquivo.');
   if($('#pb',m).checked&&!(price>0))throw new Error('Defina um preço maior que zero para publicar.');
   if(pack){
    const title=$('#ti',m).value.trim(),bio=$('#bi',m).value.trim();if(!title)throw new Error('Informe o nome do pack.');
    let preview='',cover='',teaser='',duration=0;const cf=$('#cv',m).files[0];
    pg.textContent='Gerando prévia borrada…';
    if(type==='photo'){const bl=await blurFromImage(cf||files[0]);if(!bl)throw new Error('Não foi possível gerar a prévia segura.');preview=(await upload(bl,'cover','p.jpg')).url}
    else{let ve=null;try{ve=await vidEl(files[0]);duration=Math.round(ve.duration)||0}catch{}
     try{if(cf)cover=(await upload(await blurFromImage(cf),'cover','c.jpg')).url;else if(ve)cover=(await upload(await blurFromVideo(ve),'cover','c.jpg')).url}catch{}
     if(ve){try{const tb=await teaserFromVideo(ve);if(tb)teaser=(await upload(tb,'teaser','t.webm')).url}catch{}}}
    const names=[];
    for(let k=0;k<files.length;k++){const f=files[k],key=[f.name,f.size,f.lastModified,k].join('|');
     if(!packUp.has(key)){pg.textContent=`Enviando ${k+1} de ${files.length}… aguarde.`;packUp.set(key,(await upload(f,type==='photo'?'photo':'video')).file)}
     names.push(packUp.get(key))}
    pg.textContent='Salvando o pack…';
    await api('/item','POST',{profileId:prof,type,files:names,title,bio,price,preview,cover,teaser,duration,published:pub})
   }else if(type==='photo'){
    if(photoStartCount===null)photoStartCount=D.items.filter(i=>i.type==='photo'&&i.profileId===prof).length;
    const occurrences=new Map();
    for(let k=0;k<files.length;k++){
     const file=files[k],signature=[file.name,file.size,file.lastModified,file.type].join('|'),occurrence=occurrences.get(signature)||0;occurrences.set(signature,occurrence+1);
     const key=signature+'|'+occurrence;let saved=completedFiles.get(key);
     if(saved&&saved.created)continue;
     pg.textContent=`Enviando ${k+1} de ${files.length}… gerando prévia borrada`;
     if(!saved){saved={preview:'',file:'',title:''};completedFiles.set(key,saved)}
     if(!saved.preview){const blurred=await blurFromImage(file);if(!blurred)throw new Error('Não foi possível gerar a prévia segura desta foto.');saved.preview=(await upload(blurred,'cover','p.jpg')).url}
     if(!saved.file)saved.file=(await upload(file,'photo')).file;
     if(!saved.title){const completed=[...completedFiles.values()].filter(x=>x.created).length;saved.title='Foto '+String(photoStartCount+completed+1).padStart(2,'0')}
     try{await api('/item','POST',{profileId:prof,type:'photo',file:saved.file,title:saved.title,price,preview:saved.preview,published:pub});saved.created=true}
     catch(error){
      try{await reload()}catch(refreshError){throw new Error(error.message+' Não consegui confirmar se a foto foi cadastrada; atualize a lista antes de reenviar. ('+refreshError.message+')')}
      if(D.items.some(i=>i.type==='photo'&&i.profileId===prof&&i.file===saved.file))saved.created=true;else throw error
     }
    }
   }else{
    const title=$('#ti',m).value;if(!title.trim())throw new Error('Informe o título.');
    pg.textContent='Gerando prévia borrada…';let ve=null,cover='',teaser='',duration=0;try{ve=await vidEl(files[0]);duration=Math.round(ve.duration)||0}catch{}
    const cf=$('#cv',m).files[0];try{if(cf)cover=(await upload(await blurFromImage(cf),'cover','c.jpg')).url;else if(ve)cover=(await upload(await blurFromVideo(ve),'cover','c.jpg')).url}catch{}if(ve){try{const tb=await teaserFromVideo(ve);if(tb)teaser=(await upload(tb,'teaser','t.webm')).url}catch{}}
    pg.textContent='Enviando o vídeo… aguarde.';const f=(await upload(files[0],'video')).file;await api('/item','POST',{profileId:prof,type:'video',file:f,title,bio:$('#bi',m).value.trim(),price,cover,teaser,duration,published:pub})
   }
   m.remove();await reload();msg('Salvo',1)
  }catch(e){if(pg){pg.textContent=e.message;pg.classList.add('upload-error')}msg(e.message)}
  finally{saving=false;if(m.isConnected)controls.forEach(x=>x.disabled=false)}
 }}
const urlB64=k=>{const p='='.repeat((4-k.length%4)%4),r=(k+p).replace(/-/g,'+').replace(/_/g,'/'),raw=atob(r);return Uint8Array.from([...raw].map(c=>c.charCodeAt(0)))};
async function enablePush(){
 if(!('serviceWorker' in navigator)||!('PushManager' in window)||!('Notification' in window))throw new Error('Este navegador não aceita notificações. No iPhone: abra no Safari, toque em Compartilhar > Adicionar à Tela de Início, abra o ícone e tente de novo.');
 const reg=await navigator.serviceWorker.register('/sw.js');await navigator.serviceWorker.ready;
 if(await Notification.requestPermission()!=='granted')throw new Error('Você não permitiu as notificações. Libere nas configurações do navegador.');
 const {key}=await api('/push/key');let sub=await reg.pushManager.getSubscription();
 if(!sub)sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:urlB64(key)});
 await api('/push/subscribe','POST',{subscription:sub.toJSON()})}
function compras(m){
 const o=D.orders,pend=o.filter(x=>x.status==='pending'),rest=o.filter(x=>x.status!=='pending'),stt={paid:['g','Pago'],rejected:['r','Recusado'],cancelled:['r','Cancelado'],revoked:['r','Acesso removido']};
 const pushOn=localStorage.getItem('pushOn')==='1'&&'Notification' in window&&Notification.permission==='granted';
 m.innerHTML=`<div class="row"><h2 style="flex:1">Pedidos</h2><button class="btn sm sec" id="rf">Atualizar</button></div>
 <div class="box"><b>Pix configurado:</b> ${D.pix.key?`${esc(D.pix.key)}${D.pix.receiver?' · '+esc(D.pix.receiver):''}`:'<span class="err">NÃO configurado. Preencha PIX_KEY no arquivo .env do servidor.</span>'}
 <div class="row" style="margin-top:10px">${pushOn?'<span class="tag g">Notificações neste aparelho: ligadas</span>':'<button class="btn" id="pe">Ligar notificações neste aparelho</button>'}<button class="btn sm sec" id="cc">Copiar todos os códigos</button></div></div>
 <h3>Aguardando confirmação (${pend.length})</h3>
 ${pend.map(x=>`<div class="box"><div class="row" style="justify-content:space-between"><b>${esc(x.title)}</b><b style="color:var(--gold);font-size:20px">${brl(x.price)}</b></div><p class="mu">Cliente: <b>${esc(x.user)}</b> · Código <b>${esc(x.code)}</b> · ${dt(x.createdAt)}</p>${x.claimed?'<p><span class="tag y">Cliente avisou que já pagou</span></p>':''}<p class="mu sm">Confira no seu banco o Pix de ${brl(x.price)} antes de confirmar.</p><div class="row" style="margin-top:8px"><button class="btn" data-ok="${x.id}">Confirmar pagamento</button><button class="btn sec" data-no="${x.id}">Recusar</button></div></div>`).join('')||'<p class="mu">Nenhum pedido aguardando.</p>'}
 <h3 style="margin-top:20px">Anteriores</h3><div class="box tw"><table><tr><th>Código</th><th>Produto</th><th>Cliente</th><th>Valor</th><th>Status</th><th></th></tr>${rest.map(x=>{const t=stt[x.status]||['r',esc(x.status)];return`<tr><td><b>${esc(x.code)}</b></td><td>${esc(x.title)}</td><td>${esc(x.user)}</td><td>${brl(x.price)}</td><td><span class="tag ${t[0]}">${t[1]}</span></td><td>${x.status==='paid'?`<button class="btn sm sec" data-rv="${x.id}">Remover acesso</button>`:''}</td></tr>`}).join('')||'<tr><td class="mu" colspan="6">Nenhum pedido.</td></tr>'}</table></div>`;
 $('#rf').onclick=()=>reload().catch(e=>msg(e.message));
 $('#cc').onclick=()=>CP(o.map(x=>`${x.code} | ${x.title} | ${x.user} | ${brl(x.price)} | ${x.status}`).join('\n')||'Sem pedidos');
 if($('#pe'))$('#pe').onclick=async()=>{try{await enablePush();localStorage.setItem('pushOn','1');msg('Notificações ligadas',1);draw()}catch(e){msg(e.message)}};
 m.querySelectorAll('[data-ok]').forEach(b=>b.onclick=()=>{const x=o.find(y=>y.id===b.dataset.ok);confirm('Confirmar o pagamento de '+brl(x.price)+' de '+x.user+'? O conteúdo será liberado na hora.')&&run(()=>api('/order/'+x.id+'/confirm','POST',{note:'Pix conferido'}),'Pagamento confirmado')});
 m.querySelectorAll('[data-no]').forEach(b=>b.onclick=()=>{const x=o.find(y=>y.id===b.dataset.no),n=prompt('Motivo (opcional):','Pagamento não encontrado');if(n!==null)run(()=>api('/order/'+x.id+'/reject','POST',{note:n}),'Pedido recusado')});
 m.querySelectorAll('[data-rv]').forEach(b=>b.onclick=()=>{const n=prompt('Motivo para remover o acesso:');if(n)run(()=>api('/order/'+b.dataset.rv+'/revoke','POST',{note:n}),'Acesso removido')})}
function sitesec(m){const x=D.site||{},a=x.areas||{},on=x.colorsOn===true,cv=(k,d)=>on?x[k]:d;
 const col=(id,l,v)=>`<label>${l}</label><input id="${id}" type="color" value="${esc(v)}" style="width:100%;height:44px;padding:2px">`;
 m.innerHTML=`<h2>Site</h2><p class="mu sm">Aqui você muda como o site aparece para os clientes. As mudanças valem assim que você salvar.</p>
 <div class="box"><h3>Nome e texto</h3>${fld('sb','Nome do site',x.brand||'','text','maxlength="40" autocomplete="off"')}<label>Texto do botão "Como funciona"</label><textarea id="sh" rows="5" maxlength="3000" placeholder="Explique para o cliente como comprar...">${esc(x.howto||'')}</textarea></div>
 <div class="box"><h3>O que aparece no site</h3><div class="row" style="justify-content:space-between;margin:8px 0"><span>Aba de Fotos</span>${sw('sf',a.fotos)}</div><div class="row" style="justify-content:space-between;margin:8px 0"><span>Aba de Vídeos</span>${sw('sv',a.videos)}</div></div>
 <div class="box"><h3>Cores</h3><div class="row" style="justify-content:space-between;margin:8px 0"><span>Usar cores personalizadas</span>${sw('so',on)}</div><div id="sc2" style="${on?'':'opacity:.5'}">${col('sa','Cor de destaque (botões e detalhes)',cv('accent','#b8476b'))}${col('sg','Cor dos títulos e do logo',cv('gold','#6d1f3a'))}${col('sk','Cor de fundo',cv('bg','#0a0708'))}</div><p class="mu sm" style="margin-top:8px">Desligado, o site usa as cores originais.</p></div>
 <button class="btn gold" id="ss">Salvar site</button>`;
 $('#so').onchange=()=>{$('#sc2').style.opacity=$('#so').checked?'1':'.5'};
 $('#ss').onclick=()=>run(()=>api('/site','POST',{brand:$('#sb').value,howto:$('#sh').value,areas:{fotos:$('#sf').checked,videos:$('#sv').checked},colorsOn:$('#so').checked,accent:$('#sa').value,gold:$('#sg').value,bg:$('#sk').value}),'Site salvo')}
function pixsec(m){const x=D.pix||{};m.innerHTML=`<h2>Pagamento por Pix</h2><p class="mu sm">Cadastre a chave uma vez. O QR Code e o Pix copia e cola de cada pedido são gerados sozinhos, já com o valor certo.</p>
 <div class="box">${fld('pk','Chave Pix (CPF, CNPJ, e-mail, telefone ou chave aleatória)',x.key||'','text','maxlength="140" autocomplete="off"')}${fld('pn','Nome de quem recebe (como no banco)',x.receiver||'','text','maxlength="25"')}${fld('pc','Cidade (opcional)',x.city||'','text','maxlength="15"')}<button class="btn gold" id="ps" style="margin-top:12px">Salvar chave Pix</button></div>
 <div class="box c"><h3>QR Code da sua chave</h3>${x.code?'<div id="aq" style="background:#fff;padding:10px;border-radius:12px;display:inline-block;line-height:0"></div><p class="mu sm" style="margin-top:8px">Este é o QR sem valor. Nos pedidos ele já sai com o valor certo.</p><button class="btn sec sm" id="pcp">Copiar Pix copia e cola</button>':'<p class="mu">Salve a chave para o QR Code aparecer aqui.</p>'}</div>`;
 if(x.code&&window.qrcode){const q=qrcode(0,'M');q.addData(x.code);q.make();$('#aq').innerHTML=q.createSvgTag({cellSize:5,margin:0,scalable:true});const sv=$('#aq svg');if(sv){sv.style.width='220px';sv.style.height='220px'}$('#pcp').onclick=()=>CP(x.code)}
 $('#ps').onclick=()=>run(()=>api('/pix','POST',{key:$('#pk').value,receiver:$('#pn').value,city:$('#pc').value}),'Pix salvo')}
function acesso(m){m.innerHTML=`<h2>Acesso administrativo</h2><p class="mu sm">Você entrou como <b>${esc(D.me)}</b>.</p>
 <div class="box"><h3>Alterar usuário e senha</h3>${fld('cu','Senha atual','','password','autocomplete="current-password" required')}${fld('nu','Novo usuário',D.me,'text','autocomplete="username" minlength="3" maxlength="32" pattern="[A-Za-z0-9._-]{3,32}" required')}${fld('nc','Nova senha (mín. 8)','','password','autocomplete="new-password" minlength="8" maxlength="128" required')}${fld('nc2','Confirmar nova senha','','password','autocomplete="new-password" minlength="8" maxlength="128" required')}<button class="btn" id="cg" style="margin-top:10px">Alterar usuário e senha</button></div>
 <div class="box"><h3>Atalho do painel</h3><p class="mu sm">No site público, Ctrl + / (ou 5 toques no logo, no celular) abre uma caixa. A palavra abaixo leva até a tela de login.</p><div class="row" style="flex-wrap:nowrap"><input id="dw" placeholder="Nova palavra (mín. 4)" style="flex:1"><button class="btn" id="ds">Salvar</button></div></div>
 <button class="btn red" id="lo2">Encerrar sessão</button>`;
 $('#ds').onclick=()=>api('/door','POST',{word:$('#dw').value}).then(()=>{$('#dw').value='';msg('Palavra salva',1)}).catch(e=>msg(e.message));
 $('#cg').onclick=()=>{if($('#nc').value!==$('#nc2').value)return msg('As senhas não conferem.');api('/credentials','POST',{currentPassword:$('#cu').value,username:$('#nu').value,newPassword:$('#nc').value}).then(()=>{msg('Credenciais alteradas. Entre novamente.',1);location.reload()}).catch(e=>msg(e.message))};
 $('#lo2').onclick=async()=>{await api('/logout','POST');location.reload()}}
term().catch(e=>app.textContent=e.message);
