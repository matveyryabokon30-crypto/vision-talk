/* Pablicus 0.1.0-rc3. Existing Auth, server sequence, RPCs, Realtime + polling.
   Feed/tasks/AI/video-processing/push are explicitly not enabled in this release. */
(() => {'use strict';
 const URL='https://ctcoqgsztdtsazdiwcmd.supabase.co',KEY='sb_publishable_kMGqZAM2vadfXbBr8r5uzw_l9EiBtIw',BUCKET='message-media',VERSION='0.1.0-rc3';
 const $=x=>document.getElementById(x),el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n};
 const safeGet=k=>{try{return JSON.parse(localStorage.getItem(k))}catch{return null}},safeSet=(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v))}catch{}};
 const timeoutFetch=async(u,opts={},ms=25000)=>{const c=new AbortController(),t=setTimeout(()=>c.abort(),ms);const abort=()=>c.abort();opts.signal?.addEventListener('abort',abort,{once:true});try{return await fetch(u,{...opts,signal:c.signal})}finally{clearTimeout(t);opts.signal?.removeEventListener('abort',abort)}};
 const sb=supabase.createClient(URL,KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true},global:{fetch:timeoutFetch}});
 let user=null,profile=null,dialogs=[],current=null,rows=[],page='chats',filter='all',opening=false,syncing=false,olderBusy=false,refreshing=false,worker=false,pumpPending=false,channel=null,epoch=0,toastTimer=0,peersRead=0;
 const signed=new Map(),cacheKey=()=>`pablicus:${user?.id}:dialogs`,focusKey=()=>`pablicus:${user?.id}:focus`;
 function toast(text){$('toast').textContent=text;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,5000)}
 function problem(e){console.warn(e?.name||'Pablicus error');toast(e?.message||'Не удалось выполнить действие. Черновик сохранён.')}
 function connection(){const offline=!navigator.onLine;$('connection').hidden=!offline;$('connection').textContent=offline?'Нет сети · исходящие сохраняются на устройстве':'';if(current)$('chatHint').textContent=offline?'Нет сети · очередь сохранена':'Pablicus'}
 function dialog(title){const d=$('productDialog');$('dialogTitle').textContent=title;$('dialogContent').replaceChildren();if(!d.open)d.showModal();return $('dialogContent')}
 function unavailable(name){const c=dialog(name);c.append(el('p','',name+' пока не включён в эту версию. Ваш текст и вложения не отправлены помощнику.'))}
 function install(){const c=dialog('Pablicus на iPhone');c.append(el('p','','В Safari нажмите «Поделиться» → «На экран “Домой”» → включите «Открывать как веб-приложение» → «Добавить».'),el('p','muted','На главном экране появится утверждённая иконка. Обновления приходят по этому же адресу.'))}
 $('dialogClose').onclick=()=>$('productDialog').close();$('installLogin').onclick=install;
 function theme(value){safeSet('pablicus:theme',value);document.documentElement.dataset.theme=value;const dark=value==='dark'||value==='system'&&matchMedia('(prefers-color-scheme:dark)').matches;$('logo').src='assets/wordmark-'+(dark?'dark':'light')+'.png';$('logo').parentElement.querySelector('source')?.remove();document.querySelector('meta[name="theme-color"]').content=dark?'#111218':'#FAF9FC';window.PablicusChat?.list?.refreshFont()}
 theme(safeGet('pablicus:theme')||'system');matchMedia('(prefers-color-scheme:dark)').addEventListener('change',()=>theme(safeGet('pablicus:theme')||'system'));
 async function authenticate(session){
  if(!session){$('productDialog').close();$('dialogContent').replaceChildren();user=null;profile=null;dialogs=[];rows=[];current=null;epoch++;signed.clear();if(channel)sb.removeChannel(channel);channel=null;$('app').hidden=true;$('home').hidden=false;$('workspace').hidden=true;$('mainNav').hidden=true;$('loginPane').hidden=false;return}
  if(user?.id===session.user.id&&profile)return;
  user=session.user;const uid=user.id;
  const r=await sb.from('profiles').select('id,username,display_name,avatar_url,is_approved').eq('id',uid).single();
  if(r.error){const cached=safeGet('pablicus:'+uid+':profile');if(!navigator.onLine&&cached)profile=cached;else{user=null;throw Error('Не удалось проверить доступ к аккаунту. '+r.error.message)}}else profile=r.data;
  if(!profile.is_approved){profile=null;user=null;throw Error('Аккаунт ещё не одобрен. Свяжитесь с владельцем Pablicus.')}
  safeSet('pablicus:'+uid+':profile',profile);$('loginPane').hidden=true;$('workspace').hidden=false;$('mainNav').hidden=false;dialogs=safeGet(cacheKey())||[];renderHome();await loadDialogs();pump();
 }

 $('magicForm').onsubmit=async e=>{e.preventDefault();const button=$('magicSubmit'),email=$('email').value.trim();button.disabled=true;$('loginError').textContent='';$('loginNotice').textContent='';try{const redirect=location.origin+location.pathname;const r=await sb.auth.signInWithOtp({email,options:{shouldCreateUser:false,emailRedirectTo:redirect}});if(r.error)throw r.error;$('loginNotice').textContent='Ссылка отправлена. Откройте письмо на этом iPhone и нажмите «Войти в Pablicus». Пароль не нужен.'}catch(e){$('loginError').textContent=e.message||'Не удалось отправить ссылку'}finally{button.disabled=false}};
 $('loginForm').onsubmit=async e=>{e.preventDefault();$('loginSubmit').disabled=true;$('loginError').textContent='';try{const r=await sb.auth.signInWithPassword({email:$('email').value.trim(),password:$('password').value});if(r.error)throw r.error;$('password').value='';await authenticate(r.data.session)}catch(e){$('loginError').textContent=e.message}finally{$('loginSubmit').disabled=false}};
 sb.auth.onAuthStateChange((_event,session)=>{setTimeout(()=>{if(session?.user.id===user?.id&&profile)return;authenticate(session).catch(e=>{$('loginError').textContent=e.message})},0)});
 sb.auth.getSession().then(r=>authenticate(r.data.session)).catch(e=>{$('loginError').textContent=e.message});
 async function loadDialogs(){if(!user||refreshing||!navigator.onLine)return;refreshing=true;const uid=user.id;try{let r=await sb.rpc('my_conversations_v3');if(r.error)r=await sb.rpc('my_conversations_v2');if(r.error)throw r.error;if(user?.id!==uid)return;dialogs=r.data||[];safeSet(cacheKey(),dialogs);if(!current&&page==='chats')renderHome()}catch(e){if(!dialogs.length)toast('Не удалось обновить список разговоров')}finally{refreshing=false}}
 function renderHome(){
  if(!user||current)return;const c=$('screenContent');c.replaceChildren();$('sectionTitle').textContent={chats:'Чаты',feed:'Лента',tasks:'Дела',profile:'Профиль'}[page];$('searchChats').hidden=page!=='chats';$('chatFilters').hidden=page!=='chats';$('newChat').hidden=page!=='chats';
  document.querySelectorAll('#mainNav button').forEach(b=>b.classList.toggle('selected',b.dataset.page===page));
  if(page==='chats'){
   const focused=new Set(safeGet(focusKey())||[]),q=$('searchChats').value.toLowerCase();const ds=dialogs.filter(d=>(filter!=='focus'||focused.has(d.id))&&(!q||String(d.title).toLowerCase().includes(q)));
   if(!ds.length){c.append(el('p','empty',filter==='focus'?'Здесь появятся отмеченные вами разговоры.':'Разговоров пока нет. Начните переписку по username.'));return}
   for(const d of ds){const row=el('section','chatCard'),button=el('button','chatMain'),avatar=el('span','avatar',(d.title||'?').replace('@','').slice(0,1).toUpperCase()),body=el('span','chatText');body.append(el('strong','',d.title||'Разговор'),el('span','previewText',d.last_message||'Начните разговор'));button.append(avatar,body);if(+d.unread_count)button.append(el('span','unread',d.unread_count));button.onclick=()=>openConversation(d).catch(problem);const focus=el('button','focusBtn',focused.has(d.id)?'★':'☆');focus.setAttribute('aria-label','Изменить Фокус');focus.onclick=()=>{focused.has(d.id)?focused.delete(d.id):focused.add(d.id);safeSet(focusKey(),[...focused]);renderHome()};row.append(button,focus);c.append(row)}
  }else if(page==='profile'){
   const p=el('section','profileCard');p.append(el('div','profileAvatar',(profile.display_name||profile.username).slice(0,1).toUpperCase()),el('h2','',profile.display_name||profile.username),el('p','muted','@'+profile.username));
   const label=el('label','','Тема'),select=el('select');for(const[v,t]of [['system','Системная'],['light','Светлая'],['dark','Тёмная']]){const o=el('option','',t);o.value=v;select.append(o)}select.value=safeGet('pablicus:theme')||'system';select.onchange=()=>theme(select.value);label.append(select);p.append(label);
   const installB=el('button','setting','Добавить на главный экран');installB.onclick=install;const logout=el('button','setting danger','Выйти');logout.onclick=async()=>{try{await PablicusChat.flush();if(worker){toast('Дождитесь завершения текущей отправки');return}await sb.auth.signOut();await authenticate(null)}catch(e){problem(e)}};
   const info=el('p','muted','Pablicus '+VERSION+' · Кандидат выпуска. Черновики и исходящие сохраняются отдельно для каждого аккаунта и разговора.');p.append(installB,logout,info);c.append(p);
  }else{c.append(el('p','empty',page==='feed'?'Публикации, подписки и сторис появятся в следующем обновлении. Раздел пока не включён.':'Личные и общие задачи появятся в следующем обновлении. Раздел пока не включён.'))}
 }
 document.querySelectorAll('#mainNav button').forEach(b=>b.onclick=()=>{page=b.dataset.page;renderHome()});document.querySelectorAll('#chatFilters button').forEach(b=>b.onclick=()=>{filter=b.dataset.filter;document.querySelectorAll('#chatFilters button').forEach(x=>x.classList.toggle('selected',x===b));renderHome()});$('searchChats').oninput=renderHome;
 $('newChat').onclick=()=>{const c=dialog('Новый разговор'),f=el('form'),i=el('input'),b=el('button','solid','Начать');i.placeholder='username';i.autocomplete='off';i.required=true;f.append(i,b);f.onsubmit=async e=>{e.preventDefault();b.disabled=true;try{const username=i.value.trim().replace(/^@/,'').toLowerCase(),r=await sb.rpc('start_direct_conversation',{target_username:username});if(r.error)throw r.error;$('productDialog').close();await loadDialogs();await openConversation(dialogs.find(d=>d.id===r.data)||{id:r.data,title:'@'+username})}catch(e){problem(e)}finally{b.disabled=false}};c.append(f);i.focus()};
 function mapped(m){return{id:m.id,number:m.server_seq,mine:m.sender_id===user?.id,text:m.body||'',revision:0,remote:m}}
 async function openConversation(d){if(opening)return;opening=true;const ep=++epoch;current=d;rows=[];peersRead=0;if(channel){await sb.removeChannel(channel);channel=null}$('home').hidden=true;$('app').hidden=false;$('chatTitle').textContent=d.title||'Разговор';connection();try{
   let remote=[];const r=navigator.onLine?await sb.from('messages').select('*').eq('conversation_id',d.id).order('server_seq',{ascending:false}).limit(150):{data:[],error:null};if(r.error){if(navigator.onLine)toast('История пока недоступна. Черновик и очередь доступны локально.')}else remote=(r.data||[]).reverse();if(ep!==epoch)return;rows=remote;await PablicusChat.open(user.id,d.id,rows.map(mapped));
   channel=sb.channel('pablicus-chat-'+d.id).on('postgres_changes',{event:'INSERT',schema:'public',table:'messages',filter:'conversation_id=eq.'+d.id},()=>syncMessages()).subscribe(state=>{if(state==='SUBSCRIBED')syncMessages()});pump();
  }catch(e){problem(e);current=null;$('app').hidden=true;$('home').hidden=false;renderHome()}finally{opening=false}}
 $('chatBack').onclick=async()=>{try{await PablicusChat.leave();current=null;epoch++;if(channel)sb.removeChannel(channel);channel=null;$('app').hidden=true;$('home').hidden=false;renderHome();loadDialogs()}catch(e){problem(e)}};
 async function syncMessages(){if(!current||!user||syncing||opening||document.hidden||!navigator.onLine)return;syncing=true;const d=current,uid=user.id,ep=epoch;try{
  const last=rows.at(-1)?.server_seq||0,r=await sb.from('messages').select('*').eq('conversation_id',d.id).gt('server_seq',last).order('server_seq',{ascending:true}).limit(200);if(r.error)throw r.error;if(ep!==epoch||uid!==user?.id)return;
  if(r.data?.length){const seen=new Set(rows.map(m=>m.id));rows.push(...r.data.filter(m=>!seen.has(m.id)));PablicusChat.update(rows.map(mapped))}
  if(PablicusChat.list?.follow&&rows.length)await sb.rpc('mark_conversation_read',{p_conversation_id:d.id,p_last_read_seq:rows.at(-1).server_seq});
  const peer=await sb.from('conversation_members').select('last_read_seq').eq('conversation_id',d.id).neq('user_id',uid);if(ep!==epoch)return;const next=peer.data?.length?Math.min(...peer.data.map(p=>+p.last_read_seq)):0;
  if(next!==peersRead){peersRead=next;document.querySelectorAll('#canvas [data-server-seq]').forEach(n=>{const meta=n.querySelector('.meta');if(meta&&n.classList.contains('mine'))meta.textContent=stamp(n.dataset.created)+' · '+(+n.dataset.serverSeq<=peersRead?'Прочитано':'Отправлено')})}
 }catch(e){if(navigator.onLine)$('chatHint').textContent='Повторяем подключение…'}finally{syncing=false}}
 const stamp=d=>{try{return new Date(d).toLocaleTimeString('ru',{hour:'2-digit',minute:'2-digit'})}catch{return''}};
 function renderMessage(m){const r=m.remote,row=el('article','row'+(m.mine?' mine':'')),b=el('div','bubble'),t=el('div','text');row.dataset.id=m.id;row.dataset.rev=m.revision;row.dataset.serverSeq=r.server_seq;row.dataset.created=r.created_at;
  if(r.type==='text')t.textContent=r.body||'';
  else{const md=r.attachment_metadata||{},button=el('button','mediaOpen'),name=md.name||'Вложение';button.setAttribute('aria-label','Открыть '+name);
   if(r.type==='image'){const im=el('img','messageImage');im.alt='Фото';im.loading='lazy';if(/^data:image\/(jpeg|png|webp);base64,/.test(md.thumb_data_url||''))im.src=md.thumb_data_url;button.append(im);if(!im.src){const fallback=el('span','mediaLabel','Фото');button.append(fallback);requestAnimationFrame(()=>{if(!im.isConnected||!im.closest('#canvas'))return;signedUrl(r.attachment_path).then(u=>{if(im.isConnected){im.src=u;fallback.remove()}}).catch(()=>{fallback.textContent='Фото · нажмите, чтобы повторить'})})}}
   else button.append(el('span','mediaGlyph',r.type==='video'?'▷':'▤'),el('span','fileName',name),el('span','muted',md.size_bytes?Math.round(md.size_bytes/1024)+' КБ':''));
   button.onclick=()=>viewAttachment(r).catch(problem);b.append(button);if(r.body)t.textContent=r.body;
  }
  b.append(t,el('div','meta',stamp(r.created_at)+(m.mine?' · '+(+r.server_seq<=peersRead?'Прочитано':'Отправлено'):'')));row.append(b);return row;
 }
 async function loadOlder(){if(!current||olderBusy||!navigator.onLine||!rows.length)return;const first=+rows[0].server_seq;if(first<=1)return;olderBusy=true;const d=current,ep=epoch;try{const r=await sb.from('messages').select('*').eq('conversation_id',d.id).lt('server_seq',first).order('server_seq',{ascending:false}).limit(100);if(r.error)throw r.error;if(ep!==epoch||current?.id!==d.id)return;const older=(r.data||[]).reverse();if(older.length){rows=[...older,...rows];PablicusChat.prepend(older.map(mapped))}}catch(e){if(navigator.onLine)console.warn('history')}finally{olderBusy=false}}
 async function signedUrl(path){const old=signed.get(path);if(old&&old.until>Date.now())return old.url;const r=await sb.storage.from(BUCKET).createSignedUrl(path,300);if(r.error)throw r.error;signed.set(path,{url:r.data.signedUrl,until:Date.now()+240000});return r.data.signedUrl}
 async function viewAttachment(r){const md=r.attachment_metadata||{},c=dialog(md.name||'Вложение');c.append(el('p','','Открываю…'));const uid=user?.id,u=await signedUrl(r.attachment_path);if(user?.id!==uid)return;c.replaceChildren();
  if(r.type==='image'){const im=el('img','viewerImage');im.src=u;im.alt='Фотография';c.append(im)}
  else if((md.mime_type||'').startsWith('audio/')){const a=el('audio');a.controls=true;a.src=u;c.append(a)}
  else if(r.type==='video'){c.append(el('p','muted','Исходное видео. Адаптивная обработка ещё не подключена.'));const v=el('video','viewerVideo');v.controls=true;v.playsInline=true;v.preload='metadata';v.src=u;c.append(v)}
  else if(md.mime_type==='application/pdf'){const f=el('iframe','pdfFrame');f.title=md.name||'PDF';f.src=u;f.setAttribute('sandbox','');c.append(f)}
  const a=el('a','setting','Открыть / сохранить файл');a.href=u;a.target='_blank';a.rel='noopener noreferrer';c.append(a);
 }
 $('productDialog').addEventListener('close',()=>{$('dialogContent').querySelectorAll('video,audio').forEach(m=>{m.pause();m.removeAttribute('src');m.load()})});
 function acceptFile(f){if(f.size===0){toast('Пустой файл не добавлен');return false}if(f.size>25*1024*1024){toast('В этом кандидате вложения до 25 МБ. Файл не был добавлен.');return false}if((f.type||'').startsWith('video/')){toast('Отправка видео будет включена после подключения обработки. Фото и документы уже доступны.');return false}return true}
 async function objectExists(path){const a=await sb.storage.from(BUCKET).createSignedUrl(path,60);return !a.error}
 const b64=s=>btoa(unescape(encodeURIComponent(s)));
 async function upload(store,item,m,f,owner,cid,uid){const id=await pablicusClientId(item.id,m.id),name=f.name.normalize('NFKC').replace(/[^a-zA-Z0-9._-]/g,'_').slice(-80)||'file',path=cid+'/'+uid+'/'+id+'/'+name;
  if(await objectExists(path))return{path,id};if(user?.id!==uid)throw Error('Аккаунт изменился');
  if(f.size<=6*1024*1024){const r=await sb.storage.from(BUCKET).upload(path,f.file,{contentType:f.type||'application/octet-stream',upsert:false});if(r.error&&!await objectExists(path))throw r.error;return{path,id}}
  const endpoint=URL.replace('.supabase.co','.storage.supabase.co')+'/storage/v1/upload/resumable';let location=item.parts?.[m.id]?.upload_url;
  const auth=async()=>{if(user?.id!==uid)throw Error('Аккаунт изменился');const s=await sb.auth.getSession();if(!s.data.session)throw Error('Войдите для продолжения отправки');return{Authorization:'Bearer '+s.data.session.access_token,apikey:KEY,'Tus-Resumable':'1.0.0'}};
  let offset=0;if(location){const lu=new window.URL(location),eu=new window.URL(endpoint);if(lu.origin!==eu.origin||!lu.pathname.startsWith('/storage/v1/upload/resumable/'))throw Error('Некорректный адрес загрузки');const h=await timeoutFetch(location,{method:'HEAD',headers:await auth()});if(h.ok)offset=+(h.headers.get('Upload-Offset')||0);else if([404,410].includes(h.status))location=null;else throw Error('Не удалось продолжить загрузку: '+h.status)}
  if(!location){const r=await timeoutFetch(endpoint,{method:'POST',headers:{...await auth(),'Upload-Length':String(f.size),'Upload-Metadata':[['bucketName',BUCKET],['objectName',path],['contentType',f.type||'application/octet-stream'],['cacheControl','3600']].map(([k,v])=>k+' '+b64(v)).join(',')}});if(!r.ok)throw Error('Ошибка начала загрузки: '+r.status);if(!r.headers.get('Location'))throw Error('Сервер не вернул адрес загрузки');location=new window.URL(r.headers.get('Location'),endpoint).href;if(new window.URL(location).origin!==new window.URL(endpoint).origin)throw Error('Некорректный адрес загрузки');await store.progress(item.id,owner,m.id,{upload_url:location})}
  while(offset<f.size){const end=Math.min(offset+6*1024*1024,f.size),r=await timeoutFetch(location,{method:'PATCH',headers:{...await auth(),'Upload-Offset':String(offset),'Content-Type':'application/offset+octet-stream'},body:f.file.slice(offset,end)},60000);if(!r.ok)throw Error('Загрузка прервана: '+r.status);offset=+(r.headers.get('Upload-Offset')||end);await store.progress(item.id,owner,m.id,{upload_url:location,uploaded:offset})}
  return{path,id};
 }
 async function pump(){if(worker){pumpPending=true;return}if(!user||!navigator.onLine||document.hidden)return;worker=true;const uid=user.id,owner=DraftVault.uid();try{
  for(const d of dialogs){if(user?.id!==uid)break;const store=PablicusChat.scope.chat===d.id?PablicusChat.store:new PablicusStore(uid,d.id);if(!store)continue;try{
   const queue=await store.readQueue();for(const it of queue){if(user?.id!==uid||!navigator.onLine)break;if(it.state==='error'&&(!it.retryable||it.nextAttemptAt>Date.now()))break;if(!['queued','sending','error'].includes(it.state))continue;const claimed=await store.claim(it.id,owner);if(!claimed)break;const item={...claimed,files:it.files};
    try{for(const m of item.messages){if(user?.id!==uid)throw Error('Аккаунт изменился');if(item.parts?.[m.id]?.ack)continue;const id=await pablicusClientId(item.id,m.id);
     const existing=await sb.from('messages').select('id,server_seq,client_message_id,conversation_id').eq('sender_id',uid).eq('client_message_id',id).maybeSingle();if(existing.error)throw existing.error;let ack=existing.data;
     if(ack&&ack.conversation_id!==d.id)throw Error('Подтверждение относится к другому разговору');
     if(!ack){let r;if(m.kind==='text')r=await sb.rpc('send_message',{p_conversation_id:d.id,p_client_message_id:id,p_type:'text',p_body:m.text,p_attachment_path:null});
      else{const f=item.files.find(f=>f.id===m.assetId);if(!f)throw Error('Байты вложения не найдены');if(f.size>25*1024*1024||m.kind==='video')throw Error('Этот файл пока не поддерживается текущим релизом');const media=await upload(store,item,m,f,owner,d.id,uid);r=await sb.rpc('send_attachment_message',{p_conversation_id:d.id,p_client_message_id:id,p_type:m.kind==='image'?'image':'document',p_attachment_path:media.path,p_attachment_name:f.name,p_mime_type:f.type||'application/octet-stream',p_size_bytes:f.size,p_caption:null,p_thumb_data_url:null})}
      if(r.error)throw r.error;ack=r.data;
     }
     if(!ack?.id||!ack.server_seq||ack.client_message_id!==id)throw Error('Нет корректного подтверждения сервера');await store.progress(item.id,owner,m.id,{ack:{id:ack.id,server_seq:ack.server_seq,client_message_id:id}});
    }
    await store.finish(item.id,owner);if(current?.id===d.id){await syncMessages();await PablicusChat.refreshQueue()}
   }catch(e){await store.failed(item.id,owner,e,!navigator.onLine);if(current?.id===d.id)await PablicusChat.refreshQueue();if(navigator.onLine)toast('Исходящее сохранено. '+e.message);break}
   }
  }finally{if(store!==PablicusChat.store)store.close()}}
 }catch(e){problem(e)}finally{worker=false;if(pumpPending){pumpPending=false;setTimeout(()=>pump(),0)}}}
 async function showOutbox(){const c=dialog('Исходящие'),store=PablicusChat.store;if(!store)return;const q=(await store.readQueue(false)).filter(r=>!['sent','cancelled'].includes(r.state));if(!q.length)c.append(el('p','','Все исходящие подтверждены сервером. Это не означает, что получатель их прочитал.'));for(const r of q){const b=el('section','outboxItem');b.append(el('strong','',({queued:'В очереди',sending:'Отправляется',error:'Ошибка'})[r.state]||r.state),el('p','',r.messages.find(m=>m.kind==='text')?.text.slice(0,180)||'Вложения'));if(r.error)b.append(el('p','danger',r.error.message));const retry=el('button','setting','Повторить');retry.onclick=async()=>{try{await store.retry(r.id);$('productDialog').close();pump()}catch(e){problem(e)}};b.append(retry);c.append(b)}}
 window.PablicusHost={renderMessage,acceptFile,unavailable,showOutbox,historyTop:loadOlder,canSend:()=>{if(!user||!profile?.is_approved||!current)return false;if(($('input').value||'').length>5000){toast('Одно сообщение — до 5000 символов. Черновик сохранён; сократите его или разделите.');return false}return true}};
 window.addEventListener('pablicus:queued',()=>pump());window.addEventListener('online',()=>{connection();loadDialogs();syncMessages();pump()});window.addEventListener('offline',connection);document.addEventListener('visibilitychange',()=>{if(!document.hidden){connection();loadDialogs();syncMessages();pump()}});
 setInterval(()=>{if(!document.hidden){if(current)syncMessages();else loadDialogs();pump()}},1300);connection();
 if('serviceWorker'in navigator){let approveUpdate=false;const hadController=!!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js',{scope:'./',updateViaCache:'none'}).then(reg=>{const show=()=>{$('updateNotice').hidden=!reg.waiting};reg.addEventListener('updatefound',()=>reg.installing?.addEventListener('statechange',show));show();
   $('applyUpdate').onclick=async()=>{try{await PablicusChat.flush();if(worker){toast('Сначала дождитесь завершения отправки');return}approveUpdate=true;reg.waiting?.postMessage('ACTIVATE')}catch(e){problem(e)}};
   navigator.serviceWorker.addEventListener('controllerchange',async()=>{if(!hadController)return;if(approveUpdate){await PablicusChat.flush();location.reload()}else toast('Обновление готово. Сохраните черновик перед перезапуском.')});reg.update();
  }).catch(()=>toast('Офлайн-режим не установлен. Онлайн-переписка доступна.'));
 }
 window.PablicusDebug={version:VERSION,get user(){return user?.id},get current(){return current?.id},get messageCount(){return rows.length},pump,syncMessages};
})();
