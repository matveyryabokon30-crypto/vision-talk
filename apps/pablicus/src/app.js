/* Pablicus 0.1.0-rc2. Existing Auth, server sequence, RPCs, Realtime + polling.
   Ordered multimodal messages keep a single server sequence. Feed/tasks/AI
   and adaptive video transcoding are not enabled in this release. */
(() => {'use strict';
 const URL='https://ctcoqgsztdtsazdiwcmd.supabase.co',KEY='sb_publishable_kMGqZAM2vadfXbBr8r5uzw_l9EiBtIw',BUCKET='message-media',VERSION='0.1.0-rc2';
 const $=x=>document.getElementById(x),el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n};
 const safeGet=k=>{try{return JSON.parse(localStorage.getItem(k))}catch{return null}},safeSet=(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v))}catch{}};
 const timeoutFetch=async(u,opts={},ms=25000)=>{const c=new AbortController(),t=setTimeout(()=>c.abort(),ms);const abort=()=>c.abort();opts.signal?.addEventListener('abort',abort,{once:true});try{return await fetch(u,{...opts,signal:c.signal})}finally{clearTimeout(t);opts.signal?.removeEventListener('abort',abort)}};
 const authStorageKey='sb-ctcoqgsztdtsazdiwcmd-auth-token';
 const passkeyGuardKey='pablicus:passkey-unvalidated';
 let passkeyUnvalidated=safeGet(passkeyGuardKey)===true;
 // The SDK can retain a failed candidate when its logout request is offline.
 // Never restore that candidate after a refresh or an interrupted browser flow.
 if(passkeyUnvalidated){try{localStorage.removeItem(authStorageKey)}catch{}}
 function trustExplicitSignIn(){passkeyUnvalidated=false;safeSet(passkeyGuardKey,false)}
 // The bundled SDK can auto-detect PKCE despite detectSessionInUrl:false.
 // Capture and clean the callback before constructing any Auth client.
 const authCallbackHref=PablicusOAuthSession.capture();
 const sb=supabase.createClient(URL,KEY,{auth:{storageKey:authStorageKey,persistSession:true,autoRefreshToken:true,detectSessionInUrl:false,flowType:'pkce',experimental:{passkey:true}},global:{fetch:timeoutFetch}});
 // Recovery requests do not bind an email link to the PWA's PKCE store.
 // This client cannot read or persist the signed-in application's session.
 const recoveryClient=supabase.createClient(URL,KEY,{auth:{storageKey:'pablicus-recovery-request',persistSession:false,autoRefreshToken:false,detectSessionInUrl:false,flowType:'implicit'},global:{fetch:timeoutFetch}});
 // A candidate key login cannot write or broadcast the application's session.
 const passkeySignInClient=supabase.createClient(URL,KEY,{auth:{storageKey:'pablicus-passkey-candidate',persistSession:false,autoRefreshToken:false,detectSessionInUrl:false,flowType:'pkce',experimental:{passkey:true}},global:{fetch:timeoutFetch}});
 let authVersion=0,passkeys=null,passwordLogin=null,passkeySigninActive=false,passkeyAuthEvent=null,sessionCleanup=Promise.resolve();
 let user=null,profile=null,dialogs=[],current=null,rows=[],page='chats',filter='all',opening=false,syncing=false,olderBusy=false,refreshing=false,worker=false,channel=null,epoch=0,toastTimer=0,peersRead=0;
 const signed=new Map(),cacheKey=()=>`pablicus:${user?.id}:dialogs`,focusKey=()=>`pablicus:${user?.id}:focus`;
 const replyCache=new Map();
 const mediaViewer=PablicusMediaViewer.create({resolveUrl:mediaUrl,download:downloadAttachment});
 const messageTools=PablicusChatActions.create({getContext:()=>({userId:user?.id,conversationId:current?.id,epoch,rows}),rpc:(name,args)=>sb.rpc(name,args),onRows:next=>{rows=next;PablicusChat.update(rows.map(mapped));refreshReplyQuotes()},onReply:chooseReply,onDownload:downloadAttachment,getDialogs:async()=>{await loadDialogs();return dialogs},onForward:forwardMessages,onLocate:locateMessage,onError:problem});
 const people=PablicusPeople.create({search:async query=>{const uid=user?.id;if(!uid)throw Error('Войдите в приложение');const r=await sb.rpc('pablicus_search_people',{p_query:query});if(user?.id!==uid)return[];if(r.error)throw r.error;return r.data||[]},onOpen:openPerson,onError:problem});
 let pendingPerson=new window.URL(location.href).searchParams.get('person')||'';
 try{if(pendingPerson)sessionStorage.setItem('pablicus:pending-person',pendingPerson);else pendingPerson=sessionStorage.getItem('pablicus:pending-person')||'';}catch{}
 function showPersonLink(){if(!user||!pendingPerson)return;const query=pendingPerson;pendingPerson='';try{sessionStorage.removeItem('pablicus:pending-person')}catch{}people.open(query);}
 const pushNotifications=PablicusPush.create({getSession:()=>sb.auth.getSession(),getUserId:()=>user?.id,projectUrl:URL,apiKey:KEY,onInstall:install,onOpenConversation:(id,recipientId)=>openPushConversation(id,recipientId).catch(problem)});
 let pendingPush=null;const entryUrl=new window.URL(location.href),pushConversation=entryUrl.searchParams.get('conversation'),pushRecipient=entryUrl.searchParams.get('recipient'),validUuid=value=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value||'');
 try{if(validUuid(pushConversation)&&validUuid(pushRecipient)){pendingPush={id:pushConversation,recipientId:pushRecipient};sessionStorage.setItem('pablicus:pending-push',JSON.stringify(pendingPush));}else{const saved=JSON.parse(sessionStorage.getItem('pablicus:pending-push')||'null');if(validUuid(saved?.id)&&validUuid(saved?.recipientId))pendingPush=saved;}}catch{}
 async function openPushConversation(id,recipientId){const uid=user?.id;if(!uid||uid!==recipientId||!validUuid(id))return;if(opening)throw Error('Дождитесь открытия разговора');await PablicusChat.flush();if(user?.id!==uid)return;await loadDialogs();if(user?.id!==uid)return;const target=dialogs.find(d=>d.id===id);if(!target)throw Error('Этот разговор больше недоступен');if(current?.id!==id)await openConversation(target);}
 function showPushConversation(){if(!user||!pendingPush)return;const target=pendingPush;pendingPush=null;try{sessionStorage.removeItem('pablicus:pending-push');const cleaned=new window.URL(location.href);cleaned.searchParams.delete('conversation');cleaned.searchParams.delete('recipient');history.replaceState(history.state,'',cleaned.href);}catch{}if(target.recipientId!==user.id)return;openPushConversation(target.id,target.recipientId).catch(problem);}
 async function openPerson(person,{isCurrent=()=>true}={}){const uid=user?.id,ep=epoch;if(!uid||opening)throw Error('Дождитесь открытия приложения');await PablicusChat.flush();if(user?.id!==uid||!isCurrent())return;const r=await sb.rpc('start_direct_conversation',{target_username:person.username});if(r.error)throw r.error;if(user?.id!==uid||!isCurrent())return;await loadDialogs();if(user?.id!==uid||epoch!==ep||!isCurrent())return;await openConversation(dialogs.find(d=>d.id===r.data)||{id:r.data,title:person.display_name||'@'+person.username});if(user?.id===uid&&current?.id!==r.data)throw Error('Не удалось открыть разговор');}
 async function shareProfile(){const url=PablicusPeople.profileLink(profile.username);if(navigator.share){try{await navigator.share({title:'Pablicus · '+(profile.display_name||profile.username),url});return}catch(e){if(e.name==='AbortError')return;}}await navigator.clipboard.writeText(url);toast('Ссылка на профиль скопирована');}
 function polishIcons(){for(const [id,name]of [['newChat','compose'],['reportBtn','outbox'],['chatBack','back'],['attach','plus'],['send','send'],['cancelReply','close']]){const node=$(id);if(node)node.replaceChildren(PablicusMessageMenu.icon(name));}for(const node of document.querySelectorAll('#mainNav button'))node.querySelector('span')?.replaceChildren(PablicusMessageMenu.icon(node.dataset.page));}
 polishIcons();

 const inboxMonitor=PablicusInboxMonitor.create({resolveUrl:block=>mediaUrl(mediaItem(block)),openConversation:async id=>{if(opening)throw Error('Разговор ещё открывается');const uid=user?.id;await PablicusChat.flush();if(!uid||user?.id!==uid)return;await openConversation(dialogs.find(d=>d.id===id)||{id,title:'Разговор'});if(user?.id===uid&&current?.id!==id)throw Error('Не удалось открыть разговор. Повторите попытку')},onError:problem});
 let inboxChannel=null,inboxEpoch=0,inboxPolling=false;
 const inboxSeq=new Map(),inboxSeen=new Set();
 function inboxContext(){inboxMonitor.setContext({userId:user?.id||null,conversationId:current?.id||null,active:!!current&&!document.hidden});}
 function stopInbox(){++inboxEpoch;if(inboxChannel)sb.removeChannel(inboxChannel);inboxChannel=null;inboxSeq.clear();inboxSeen.clear();inboxMonitor.setContext({userId:null,conversationId:null,active:false});}
 function deliverInbox(message,uid,token){
  if(user?.id!==uid||token!==inboxEpoch||!current||document.hidden||!message?.id||message.sender_id===uid||message.conversation_id===current.id||inboxSeen.has(message.id))return;
  if(inboxMonitor.push({message,conversationTitle:dialogs.find(d=>d.id===message.conversation_id)?.title||'Другой чат'})){inboxSeen.add(message.id);if(inboxSeen.size>512)inboxSeen.delete(inboxSeen.values().next().value);}
 }
 function startInbox(){stopInbox();if(!user)return;const uid=user.id,token=inboxEpoch;for(const d of dialogs)inboxSeq.set(d.id,+d.last_seq||0);inboxContext();
  inboxChannel=sb.channel('pablicus-inbox-'+uid).on('postgres_changes',{event:'INSERT',schema:'public',table:'messages'},payload=>deliverInbox(payload.new,uid,token)).subscribe(state=>{if(state==='SUBSCRIBED')pollInbox()});
 }
 async function pollInbox(){
  if(!user||!current||opening||document.hidden||!navigator.onLine||inboxPolling)return;
  inboxPolling=true;const uid=user.id,token=inboxEpoch;
  try{await loadDialogs();if(user?.id!==uid||token!==inboxEpoch)return;
   for(const d of dialogs){
    if(user?.id!==uid||token!==inboxEpoch||!current||document.hidden)return;
    const last=+d.last_seq||0;if(d.id===current.id){inboxSeq.set(d.id,last);continue;}
    const after=inboxSeq.has(d.id)?inboxSeq.get(d.id):Math.max(0,last-20);if(last<=after)continue;
    const r=await sb.from('messages').select('*').eq('conversation_id',d.id).gt('server_seq',after).order('server_seq',{ascending:true}).limit(50);
    if(user?.id!==uid||token!==inboxEpoch)return;if(r.error)continue;
    // Realtime and polling can overlap or arrive out of order. Only this ordered
    // catch-up query advances its watermark; the delivery set handles duplicates.
    for(const message of r.data||[])deliverInbox(message,uid,token);
    if(r.data?.length)inboxSeq.set(d.id,+r.data.at(-1).server_seq);
   }
  }catch(_){}finally{inboxPolling=false;}
 }

 function toast(text){$('toast').textContent=text;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,5000)}
 function problem(e){console.warn(e?.name||'Pablicus error');toast(e?.message||'Не удалось выполнить действие. Черновик сохранён.')}
 function connection(){const offline=!navigator.onLine;$('connection').hidden=!offline;$('connection').textContent=offline?'Нет сети · исходящие сохраняются на устройстве':'';if(current){$('chatHint').textContent=offline?'Нет сети · очередь сохранена':'';$('chatHint').hidden=!offline}}
 function dialog(title){const d=$('productDialog');$('dialogTitle').textContent=title;$('dialogContent').replaceChildren();if(!d.open)d.showModal();return $('dialogContent')}
 function unavailable(name){const c=dialog(name);c.append(el('p','',name+' пока не включён в эту версию. Ваш текст и вложения не отправлены помощнику.'))}
 function install(){const c=dialog('Pablicus на iPhone');c.append(el('p','','В Safari нажмите «Поделиться» → «На экран “Домой”» → включите «Открывать как веб-приложение» → «Добавить».'),el('p','muted','На главном экране появится утверждённая иконка. Обновления приходят по этому же адресу.'))}
 $('dialogClose').onclick=()=>$('productDialog').close();$('installLogin').onclick=install;
 function theme(value){safeSet('pablicus:theme',value);document.documentElement.dataset.theme=value;const dark=value==='dark'||value==='system'&&matchMedia('(prefers-color-scheme:dark)').matches;document.querySelector('meta[name="theme-color"]').content=dark?'#141516':'#fafafa';window.PablicusChat?.list?.refreshFont()}
 theme(safeGet('pablicus:theme')||'system');matchMedia('(prefers-color-scheme:dark)').addEventListener('change',()=>theme(safeGet('pablicus:theme')||'system'));
 function clearSessionView(){const pushCleanup=pushNotifications.clear();people.close();messageTools.clear();stopInbox();PablicusRichMessage.stopAll?.();mediaViewer.close();replyCache.clear();sessionCleanup=sessionCleanup.then(()=>Promise.all([pushCleanup,window.PablicusChat?.leave()])).catch(e=>toast('Не удалось сохранить черновик на устройстве. '+e.message));$('newChat').hidden=true;if(passkeys?.snapshot().busy&&passkeys.snapshot().operation!=='signIn')passkeys.cancel();$('productDialog').close();$('dialogContent').replaceChildren();user=null;profile=null;dialogs=[];rows=[];current=null;epoch++;signed.clear();if(channel)sb.removeChannel(channel);channel=null;$('app').hidden=true;$('home').hidden=false;$('workspace').hidden=true;$('mainNav').hidden=true;$('loginPane').hidden=false;}
 async function authenticate(session,{signal,verifiedPasskey=false}={}){
  if(signal?.aborted)return;
  const attempt=++authVersion;
  if(!session){clearSessionView();return}
  if(!PablicusPublicPasskey.identityValid(session.user)){clearSessionView();throw Error('Ключ не удалось связать с прежним аккаунтом. Войдите прежним способом.')}
  if(!verifiedPasskey&&(passkeyUnvalidated||safeGet(passkeyGuardKey)===true)){clearSessionView();return}
  if(user?.id===session.user.id&&profile)return;
  if(user&&user.id!==session.user.id)clearSessionView();
  await sessionCleanup;if(attempt!==authVersion||signal?.aborted)return;
  user=session.user;profile=null;const uid=user.id;
  const r=await sb.from('profiles').select('id,username,display_name,avatar_url,is_approved').eq('id',uid).single();
  if(attempt!==authVersion||signal?.aborted)return;
  if(r.error){const cached=safeGet('pablicus:'+uid+':profile');if(!verifiedPasskey&&!navigator.onLine&&cached)profile=cached;else{user=null;throw Error('Не удалось проверить доступ к аккаунту. '+r.error.message)}}else profile=r.data;
  if(!profile.is_approved){profile=null;user=null;throw Error('Аккаунт ещё не одобрен. Свяжитесь с владельцем Pablicus.')}
  safeSet('pablicus:'+uid+':profile',profile);$('loginPane').hidden=true;$('workspace').hidden=false;$('mainNav').hidden=false;dialogs=safeGet(cacheKey())||[];renderHome();await loadDialogs();if(user?.id!==uid)return;startInbox();pump();showPersonLink();showPushConversation();pushNotifications.refresh();
 }
 $('loginForm').onsubmit=async e=>{e.preventDefault();if(passkeySigninActive)return;$('loginSubmit').disabled=true;$('loginError').textContent='';try{const r=await sb.auth.signInWithPassword({email:$('email').value.trim(),password:$('password').value});if(r.error)throw r.error;$('password').value='';trustExplicitSignIn();await authenticate(r.data.session)}catch(e){$('loginError').textContent=e.message}finally{$('loginSubmit').disabled=false}};
 const authConfig=globalThis.PablicusAuthConfig;
 const passkeyConfig=authConfig?.passkeys;
 const publicKeyEnabled=authConfig?.publicPasskey?.enabled===true&&authConfig.publicPasskey.origin===location.origin;
 const passkeyEnabled=passkeyConfig?.enabled===true&&passkeyConfig.origin===location.origin&&passkeyConfig.rpId===location.hostname;
 $('legacyLogin').hidden=publicKeyEnabled;
 function paintPasskeys(state){
  $('passkeyLogin').hidden=!publicKeyEnabled&&!(state.enabled&&state.supported);
  $('passkeySignIn').disabled=state.busy||(publicKeyEnabled&&!state.supported);
  $('passkeyLoginStatus').textContent=publicKeyEnabled&&!state.supported?'Откройте Pablicus в Safari или Chrome на устройстве с поддержкой ключей доступа.':state.operation==='signIn'?state.message:'';
  const button=$('passkeyRegister'),status=$('passkeySettingsStatus'),list=$('passkeyList');
  if(button)button.disabled=state.busy;
  if(status)status.textContent=state.operation==='signIn'?'':state.message;
  if(list){list.replaceChildren();for(const item of state.credentials||[]){list.append(el('li','',item.friendly_name||'Сохранённый ключ доступа'))}}
 }
 passkeys=PablicusPasskeys.create({
  client:sb,signInClient:passkeySignInClient,enabled:passkeyEnabled,
  getAccount:async({userId})=>{
   const registering=passkeys?.snapshot().operation!=='signIn';
   if(registering&&user?.id!==userId)return null;
   const result=await sb.from('profiles').select('id,is_approved').eq('id',userId).single();
   if(result.error||result.data?.id!==userId||result.data.is_approved!==true)return null;
   if(registering&&user?.id!==userId)return null;
   return{id:userId,approved:true};
  },
  authenticate:async(session,{signal}={})=>{
   if(signal?.aborted)return false;
   if(passkeyAuthEvent&&passkeyAuthEvent.session?.user.id!==session.user.id)return false;
   const allowed=await passkeySignInClient.from('profiles').select('id,is_approved').eq('id',session.user.id).single();
   if(signal?.aborted||allowed.error||allowed.data?.id!==session.user.id||allowed.data.is_approved!==true)return false;
   const imported=await sb.auth.setSession({access_token:session.access_token,refresh_token:session.refresh_token});
   if(signal?.aborted||imported.error||imported.data?.session?.user.id!==session.user.id)return false;
   await authenticate(session,{signal,verifiedPasskey:true});
   return !signal?.aborted&&(!passkeyAuthEvent||passkeyAuthEvent.session?.user.id===session.user.id)&&user?.id===session.user.id&&profile?.is_approved===true;
  },
  onChange:paintPasskeys,
 });
 paintPasskeys(passkeys.snapshot());
 const publicKeyFlow=PablicusPublicPasskey.create({client:sb,config:{enabled:publicKeyEnabled},projectUrl:URL,redirectTo:new window.URL('./',location.href).href,validateAuthorizeUrl:PablicusOAuth.validateAuthorizeUrl,onChange:state=>{
  $('passkeySignIn').disabled=state.busy;
  $('passkeyLoginStatus').textContent=state.phase==='error'?'Не удалось открыть вход. Попробуйте ещё раз.':state.busy?'Открываем вход с ключом доступа…':'';
 }});
 window.addEventListener('pageshow',()=>publicKeyFlow.resume());
 if(publicKeyEnabled){$('accessModeNote').textContent='При первом входе укажите имя и создайте ключ доступа.'}
 $('passkeySignIn').onclick=async()=>{
  if(!passkeys.snapshot().supported||passkeys.snapshot().busy||passwordLogin?.isBusy())return;
  if(publicKeyEnabled){await publicKeyFlow.start();return}
  passkeyUnvalidated=true;safeSet(passkeyGuardKey,true);
  if(safeGet(passkeyGuardKey)!==true){$('passkeyLoginStatus').textContent='Разрешите сохранение данных сайта, чтобы безопасно войти с ключом доступа.';return}
  passkeySigninActive=true;passkeyAuthEvent=null;
  try{await passkeys.signIn()}
  finally{
   const pending=passkeyAuthEvent;passkeySigninActive=false;passkeyAuthEvent=null;
   if(!passkeys.snapshot().validated)await authenticate(null);
   else{trustExplicitSignIn();if(pending&&pending.session?.user.id!==user?.id)authenticate(pending.session).catch(problem)}
  }
 };
 function passkeySettings(container){
  const state=passkeys.snapshot();if(!state.enabled||!state.supported)return;
  const section=el('section','passkey-settings');section.id='passkeySettings';
  section.append(el('h3','','Ключ доступа'),el('p','muted','Вход через Face ID, отпечаток или код устройства. Сохраните ключ в менеджере паролей, чтобы использовать его и на других устройствах.'));
  if(PablicusPublicPasskey.ownsPublicKey(user)&&!user.email_confirmed_at&&!user.phone_confirmed_at){section.append(el('p','','Аккаунт создан с ключом доступа. Для повторного входа используйте сохранённый ключ.'));container.append(section);return}
  const button=el('button','setting','Создать ключ доступа');button.id='passkeyRegister';button.type='button';button.onclick=()=>passkeys.register();
  const status=el('p');status.id='passkeySettingsStatus';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const list=el('ul');list.id='passkeyList';section.append(button,status,list);container.append(section);paintPasskeys(state);passkeys.list();
 }

 const oauthReady=!publicKeyEnabled&&authConfig?.publicSignupReady===true&&Object.values(authConfig.providers||{}).some(value=>value===true);
 $('oauthLogin').hidden=!oauthReady;
 if(oauthReady){
  $('accessModeNote').textContent='При первом входе аккаунт создаётся автоматически.';
  PablicusOAuth.mount({client:sb,projectUrl:URL,element:$('oauthProviders'),config:authConfig,redirectTo:new window.URL('./',location.href).href});
  $('loginForm').classList.add('legacy-login');
  $('loginForm').insertAdjacentHTML('beforebegin','<details id="passwordLogin"><summary>Войти с паролем Pablicus</summary></details>');
  $('passwordLogin').append($('loginForm'),$('recoverPassword'),$('emailLogin'));
 }
 let authBooting=true,pendingAuthEvent=null;
 sb.auth.onAuthStateChange((_event,session)=>{
  if(passkeySigninActive){
   const previous=passkeyAuthEvent?.session?.user.id;
   passkeyAuthEvent={event:_event,session};
   if(!session||(previous&&previous!==session.user.id)){++authVersion;passkeys.cancel();clearSessionView()}
   return;
  }
  if(authBooting){pendingAuthEvent={session};return}
  const observed=++authVersion;
  setTimeout(()=>{if(observed!==authVersion)return;if(passkeyUnvalidated||safeGet(passkeyGuardKey)===true){clearSessionView();return}if(session?.user.id===user?.id&&profile)return;authenticate(session).catch(e=>{$('loginError').textContent=e.message})},0);
 });
 PablicusOAuthSession.restore({client:sb,storageKey:authStorageKey,href:authCallbackHref}).then(session=>{
  if(session&&new window.URL(authCallbackHref).searchParams.has('code'))trustExplicitSignIn();
  authBooting=false;const next=pendingAuthEvent?pendingAuthEvent.session:session;pendingAuthEvent=null;return authenticate(next);
 }).catch(e=>{authBooting=false;pendingAuthEvent=null;authenticate(null);$('loginError').textContent=e.message});
 async function loadDialogs(){if(!user||refreshing||!navigator.onLine)return;refreshing=true;const uid=user.id;try{let r=await sb.rpc('my_conversations_v3');if(r.error)r=await sb.rpc('my_conversations_v2');if(r.error)throw r.error;if(user?.id!==uid)return;dialogs=r.data||[];safeSet(cacheKey(),dialogs);if(!current&&page==='chats')renderHome()}catch(e){if(!dialogs.length)toast('Не удалось обновить список разговоров')}finally{refreshing=false}}
 function renderHome(){
  if(!user||current)return;const c=$('screenContent');c.replaceChildren();$('sectionTitle').textContent={chats:'Чаты',feed:'Лента',tasks:'Дела',profile:'Профиль'}[page];$('sectionTitle').hidden=page==='chats';$('searchChats').hidden=page!=='chats';$('chatFilters').hidden=page!=='chats';$('newChat').hidden=page!=='chats';
  document.querySelectorAll('#mainNav button').forEach(b=>b.classList.toggle('selected',b.dataset.page===page));
  if(page==='chats'){
   const find=el('button','findPeople','Найти человека');find.type='button';find.prepend(PablicusMessageMenu.icon('users'));find.onclick=()=>people.open($('searchChats').value);c.append(find);
   const saved=el('button','savedConversation','Избранное');saved.type='button';saved.append(el('span','muted','Сообщения и материалы для себя'));saved.onclick=async()=>{saved.disabled=true;try{const r=await sb.rpc('start_saved_conversation');if(r.error)throw r.error;await loadDialogs();await openConversation(dialogs.find(d=>d.id===r.data)||{id:r.data,title:'Избранное'})}catch(e){problem(e)}finally{saved.disabled=false}};c.append(saved);
   const focused=new Set(safeGet(focusKey())||[]),q=$('searchChats').value.toLowerCase();const ds=dialogs.filter(d=>(filter!=='focus'||focused.has(d.id))&&(!q||String(d.title).toLowerCase().includes(q)));
   if(!ds.length){c.append(el('p','empty',filter==='focus'?'Здесь появятся отмеченные вами разговоры.':'Разговоров пока нет. Найдите человека по имени или откройте его ссылку профиля.'));return}
   for(const d of ds){const row=el('section','chatCard'),button=el('button','chatMain'),avatar=el('span','avatar',(d.title||'?').replace('@','').slice(0,1).toUpperCase()),body=el('span','chatText');body.append(el('strong','',d.title||'Разговор'),el('span','previewText',d.last_message||'Начните разговор'));button.append(avatar,body);if(+d.unread_count)button.append(el('span','unread',d.unread_count));button.onclick=()=>openConversation(d).catch(problem);const focus=el('button','focusBtn',focused.has(d.id)?'★':'☆');focus.setAttribute('aria-label','Изменить Фокус');focus.onclick=()=>{focused.has(d.id)?focused.delete(d.id):focused.add(d.id);safeSet(focusKey(),[...focused]);renderHome()};row.append(button,focus);c.append(row)}
  }else if(page==='profile'){
   const p=el('section','profileCard');p.append(el('div','profileAvatar',(profile.display_name||profile.username).slice(0,1).toUpperCase()),el('h2','',profile.display_name||profile.username),el('p','muted','@'+profile.username));
   const share=el('button','setting profileShare','Поделиться профилем');share.id='shareProfile';share.prepend(PablicusMessageMenu.icon('share'));share.onclick=()=>shareProfile().catch(problem);const copyLink=el('button','setting profileCopyLink','Скопировать ссылку');copyLink.id='copyProfileLink';copyLink.onclick=async()=>{try{await navigator.clipboard.writeText(PablicusPeople.profileLink(profile.username));toast('Ссылка на профиль скопирована')}catch(e){problem(e)}};p.append(share,copyLink);
   const label=el('label','','Тема'),select=el('select');for(const[v,t]of [['system','Системная'],['light','Светлая'],['dark','Тёмная']]){const o=el('option','',t);o.value=v;select.append(o)}select.value=safeGet('pablicus:theme')||'system';select.onchange=()=>theme(select.value);label.append(select);p.append(label);
   const installB=el('button','setting','Добавить на главный экран');installB.onclick=install;const logout=el('button','setting danger','Выйти');logout.onclick=async()=>{try{await PablicusChat.flush();if(worker){toast('Дождитесь завершения текущей отправки');return}await pushNotifications.signOut();await sb.auth.signOut();await authenticate(null)}catch(e){problem(e)}};
   const info=el('p','muted','Pablicus '+VERSION+' · Кандидат выпуска. Черновики и исходящие сохраняются отдельно для каждого аккаунта и разговора.');p.append(installB,logout,info);c.append(p);pushNotifications.mount(p);passkeySettings(p);
  }else{c.append(el('p','empty',page==='feed'?'Публикации, подписки и сторис появятся в следующем обновлении. Раздел пока не включён.':'Личные и общие задачи появятся в следующем обновлении. Раздел пока не включён.'))}
 }
 document.querySelectorAll('#mainNav button').forEach(b=>b.onclick=()=>{page=b.dataset.page;renderHome()});document.querySelectorAll('#chatFilters button').forEach(b=>b.onclick=()=>{filter=b.dataset.filter;document.querySelectorAll('#chatFilters button').forEach(x=>x.classList.toggle('selected',x===b));renderHome()});$('searchChats').oninput=renderHome;
 $('newChat').onclick=()=>people.open($('searchChats').value);
 function mapped(m){return{id:m.id,number:m.server_seq,mine:m.sender_id===user?.id,text:PablicusChatActions.effective(m).body||'',revision:messageTools.revision(m),remote:m}}
 async function openConversation(d){if(opening||!user)return;messageTools.clear();PablicusRichMessage.stopAll?.();mediaViewer.close();opening=true;const uid=user.id,ep=++epoch;current=d;inboxContext();rows=[];peersRead=0;if(channel){await sb.removeChannel(channel);channel=null}$('home').hidden=true;$('app').style.visibility='hidden';$('app').inert=true;$('app').hidden=false;$('chatTitle').textContent=d.title||'Разговор';connection();try{
   let remote=[];const r=navigator.onLine?await sb.from('messages').select('*').eq('conversation_id',d.id).order('server_seq',{ascending:false}).limit(150):{data:[],error:null};if(r.error){if(navigator.onLine)toast('История пока недоступна. Черновик и очередь доступны локально.')}else remote=(r.data||[]).reverse();if(ep!==epoch)return;rows=remote;inboxSeq.set(d.id,Math.max(inboxSeq.get(d.id)||0,+rows.at(-1)?.server_seq||0));await PablicusChat.open(uid,d.id,rows.map(mapped));if(ep!==epoch||user?.id!==uid)return;$('app').style.visibility='';$('app').inert=false;
   messageTools.sync();channel=sb.channel('pablicus-chat-'+d.id).on('postgres_changes',{event:'INSERT',schema:'public',table:'messages',filter:'conversation_id=eq.'+d.id},()=>syncMessages()).subscribe(state=>{if(state==='SUBSCRIBED')syncMessages()});pump();
  }catch(e){problem(e);current=null;$('app').hidden=true;$('home').hidden=false;renderHome()}finally{opening=false;inboxContext()}}
 $('chatBack').onclick=async()=>{messageTools.clear();PablicusRichMessage.stopAll?.();mediaViewer.close();try{await PablicusChat.leave();current=null;inboxContext();epoch++;if(channel)sb.removeChannel(channel);channel=null;$('app').hidden=true;$('home').hidden=false;renderHome();loadDialogs()}catch(e){problem(e)}};
 async function syncMessages(){if(!current||!user||syncing||opening||document.hidden||!navigator.onLine)return;syncing=true;const d=current,uid=user.id,ep=epoch;try{
  const last=rows.at(-1)?.server_seq||0,r=await sb.from('messages').select('*').eq('conversation_id',d.id).gt('server_seq',last).order('server_seq',{ascending:true}).limit(200);if(r.error)throw r.error;if(ep!==epoch||uid!==user?.id)return;
  if(r.data?.length){const seen=new Set(rows.map(m=>m.id));rows.push(...r.data.filter(m=>!seen.has(m.id)));PablicusChat.update(rows.map(mapped))}
  inboxSeq.set(d.id,Math.max(inboxSeq.get(d.id)||0,+rows.at(-1)?.server_seq||0));
  if(PablicusChat.list?.follow&&rows.length)await sb.rpc('mark_conversation_read',{p_conversation_id:d.id,p_last_read_seq:rows.at(-1).server_seq});
  const peer=await sb.from('conversation_members').select('last_read_seq').eq('conversation_id',d.id).neq('user_id',uid);if(ep!==epoch)return;const next=peer.data?.length?Math.min(...peer.data.map(p=>+p.last_read_seq)):0;
  if(next!==peersRead){peersRead=next;document.querySelectorAll('#canvas [data-server-seq]').forEach(n=>{const meta=n.querySelector('.meta');if(meta&&n.classList.contains('mine'))meta.replaceWith(messageMeta({created:n.dataset.created,state:+n.dataset.serverSeq<=peersRead?'read':'sent',edited:!!n.dataset.edited}))})}
 }catch(e){if(navigator.onLine){$('chatHint').textContent='Повторяем подключение…';$('chatHint').hidden=false}}finally{syncing=false}}
 const stamp=d=>{try{return new Date(d).toLocaleTimeString('ru',{hour:'2-digit',minute:'2-digit'})}catch{return''}};
 function messageMeta({created,state=null,edited=false}={}){
  const meta=el('div','meta');if(created){const time=el('time','messageTime',stamp(created));time.dateTime=created;meta.append(time)}
  if(state){const labels={queued:'Ожидает отправки',sending:'Отправляется',error:'Не отправлено. Открыть исходящие',sent:'Отправлено на сервер',read:'Прочитано'},receipt=el(['queued','sending','error'].includes(state)?'button':'span','messageReceipt');receipt.dataset.messageStatus=state;receipt.title=labels[state]||labels.queued;receipt.setAttribute('aria-label',receipt.title);if(receipt.tagName==='BUTTON'){receipt.type='button';receipt.onclick=e=>{e.stopPropagation();window.PablicusHost.showOutbox()}}
   const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 16 16');svg.setAttribute('aria-hidden','true');svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.25');const circle=document.createElementNS(ns,'circle');circle.setAttribute('cx','8');circle.setAttribute('cy','8');circle.setAttribute('r',state==='read'?'4.2':'5');if(state==='read')circle.setAttribute('fill','currentColor');svg.append(circle);
   if(['queued','sending','error'].includes(state)){const line=document.createElementNS(ns,'path');line.setAttribute('stroke-linecap','round');line.setAttribute('d',state==='error'?'M8 5v3.5M8 11h.01':'M8 4.8V8l2.2 1.2');svg.append(line)}receipt.append(svg);meta.append(receipt)}
  if(edited){const mark=el('span','messageEdited');mark.title='Изменено';mark.setAttribute('aria-label','Изменено');mark.append(PablicusMessageMenu.icon('edit'));meta.append(mark)}return meta;
 }
 function renderMessage(m){const r=PablicusChatActions.effective(m.remote),row=el('article','row'+(m.mine?' mine':'')),b=el('div','bubble'),t=el('div','text');row.dataset.id=m.id;row.dataset.rev=m.revision;row.dataset.serverSeq=r.server_seq;row.dataset.created=r.created_at;row.dataset.edited=r.edited_at||'';
  if(r.attachment_metadata?.reply_to)b.append(replyQuote(r.attachment_metadata.reply_to));
  if(r.type==='rich')b.append(renderRichContent(r.attachment_metadata,false,r));
  else if((r.attachment_metadata?.mime_type||'').startsWith('audio/'))b.append(renderRichContent({v:1,blocks:[{id:'legacy-audio',type:'audio',path:r.attachment_path,name:r.attachment_metadata.name,mime:r.attachment_metadata.mime_type,size:r.attachment_metadata.size_bytes}]},false,r));
  else if(r.type==='text')t.textContent=r.body||'';
  else{const md=r.attachment_metadata||{},button=el('button','mediaOpen'),name=md.name||'Вложение';button.setAttribute('aria-label','Открыть '+name);
   if(r.type==='image'){const im=el('img','messageImage');im.alt='Фото';im.loading='lazy';if(/^data:image\/(jpeg|png|webp);base64,/.test(md.thumb_data_url||''))im.src=md.thumb_data_url;button.append(im);if(!im.src){const fallback=el('span','mediaLabel','Фото');button.append(fallback);requestAnimationFrame(()=>{if(!im.isConnected||!im.closest('#canvas'))return;signedUrl(r.attachment_path).then(u=>{if(im.isConnected){im.src=u;fallback.remove()}}).catch(()=>{fallback.textContent='Фото · нажмите, чтобы повторить'})})}}
   else button.append(el('span','mediaGlyph',r.type==='video'?'▷':'▤'),el('span','fileName',name),el('span','muted',md.size_bytes?Math.round(md.size_bytes/1024)+' КБ':''));
   button.onclick=()=>viewAttachment(r).catch(problem);b.append(button);if(r.body)t.textContent=r.body;
  }
  b.append(t,messageMeta({created:r.created_at,state:m.mine?(+r.server_seq<=peersRead?'read':'sent'):null,edited:!!r.edited_at}));messageTools.decorate(row,b,m.remote);row.append(b);return row;
 }

 function renderRichContent(content,local=false,source=null){return PablicusRichMessage.render(content,{
  resolveUrl:(path,block)=>local?PablicusChat.localAssetUrl(block.assetId):signedUrl(path),
  openMedia:(block,gallery)=>['image','video'].includes(block.type)?mediaViewer.open((gallery?.items||[block]).map(b=>mediaItem(b,local)),gallery?.index||0):viewAttachment({type:block.type,localAssetId:local?block.assetId:null,attachment_path:block.path,attachment_metadata:{name:block.name,mime_type:block.mime,size_bytes:block.size}}),
  onReply:source?block=>chooseReply(source,source.type==='rich'?block.id:null):undefined,
 });}
 function renderPendingMessage(m){const row=el('article','row mine outgoing-pending'),bubble=el('div','bubble');row.dataset.id=m.id;row.dataset.rev=m.revision;row.dataset.outboxId=m.outboxId;
  const blocks=m.richBlocks.map(block=>{if(block.type==='text')return block;const asset=PablicusChat.assets.get(block.assetId);return {...block,name:asset?.name||'Вложение',mime:asset?.file?.type||'',size:asset?.file?.size||0}});
  if(m.reply_to)bubble.append(replyQuote(m.reply_to));
  bubble.append(renderRichContent({v:1,blocks},true),messageMeta({state:['queued','sending','error'].includes(m.queueState)?m.queueState:'queued'}));row.append(bubble);return row;
 }
 function mediaItem(block,local=false){return{type:block.type,path:block.path,localAssetId:local?block.assetId:null,name:block.name||'Вложение',mime:block.mime,size:block.size,blockId:block.id};}
 async function mediaUrl(item){const uid=user?.id;if(!uid)throw Error('Войдите в приложение');const result=item.localAssetId?PablicusChat.localAssetUrl(item.localAssetId):await signedUrl(item.path);if(user?.id!==uid)throw Error('Аккаунт изменился');return result;}
 async function downloadAttachment(item){const uid=user?.id;if(!uid)throw Error('Войдите в приложение');let url;if(item.localAssetId)url=PablicusChat.localAssetUrl(item.localAssetId);else{const r=await sb.storage.from(BUCKET).createSignedUrl(item.path,300,{download:item.name||true});if(r.error)throw r.error;url=r.data.signedUrl}if(user?.id!==uid)throw Error('Аккаунт изменился');const a=el('a');a.href=url;a.download=item.name||'Вложение';a.rel='noopener';document.body.append(a);a.click();a.remove();}
 function replyDescription(target,ref){target=target?PablicusChatActions.effective(target):target;const block=ref.block_id?target?.attachment_metadata?.blocks?.find(b=>b.id===ref.block_id):null,type=block?.type||target?.type;
  const labels={audio:'Голосовое сообщение',image:'Фото',video:'Видео',document:'Документ',file:'Файл'};
  const kind=ref.block_id?labels[type]||'Фрагмент сообщения':'Сообщение';
  const text=block?(block.type==='text'?block.text:labels[type]+(block.type==='audio'?'':': '+(block.name||''))):(target?.body||labels[type]||'Сообщение');
  return{title:'Ответ: '+kind.toLowerCase()+(target?.created_at?' · '+stamp(target.created_at):''),text:String(text||'Сообщение').slice(0,240)};
 }
 async function replyMessage(ref){const known=rows.find(r=>r.id===ref.message_id)||replyCache.get(ref.message_id);if(known)return known;const uid=user?.id,cid=current?.id;if(!uid||!cid)return null;const r=await sb.from('messages').select('*').eq('conversation_id',cid).eq('id',ref.message_id).maybeSingle();if(user?.id!==uid||current?.id!==cid)return null;if(r.error)throw r.error;if(r.data)replyCache.set(r.data.id,r.data);return r.data;}
 function replyQuote(ref){const q=el('div','replyQuote'),title=el('strong','','Ответ на сообщение'),preview=el('span','','Загрузка цитаты…');q.append(title,preview);q.dataset.replyMessageId=ref.message_id;if(ref.block_id)q.dataset.replyBlockId=ref.block_id;
  const paint=target=>{const d=target?replyDescription(target,ref):{title:'Ответ на сообщение',text:'Исходное сообщение недоступно'};title.textContent=d.title;preview.textContent=d.text};
  const cached=rows.find(r=>r.id===ref.message_id)||replyCache.get(ref.message_id);if(cached)paint(cached);else requestAnimationFrame(()=>{if(!q.isConnected||q.closest('.measureBox'))return;replyMessage(ref).then(paint).catch(()=>paint(null))});return q;
 }
 function refreshReplyQuotes(){for(const q of document.querySelectorAll('.replyQuote[data-reply-message-id]')){const target=rows.find(m=>m.id===q.dataset.replyMessageId);if(!target)continue;const ref={message_id:target.id,...(q.dataset.replyBlockId?{block_id:q.dataset.replyBlockId}:{})},d=target.deleted_at?{title:'Ответ на сообщение',text:'Сообщение удалено'}:replyDescription(target,ref);q.querySelector('strong').textContent=d.title;q.querySelector('span').textContent=d.text;replyCache.set(target.id,target);}}
 function paintReplyDraft(ref){const container=$('replyDraft');container.hidden=!ref;$('replyDraftText').replaceChildren();if(ref)$('replyDraftText').append(replyQuote(ref));}
 function chooseReply(message,blockId=null){if(!current||message.conversation_id!==current.id)return;replyCache.set(message.id,message);$('productDialog').close();PablicusChat.setReply({message_id:message.id,...(blockId?{block_id:blockId}:{})});}
 $('cancelReply').onclick=()=>PablicusChat.setReply(null);

 async function locateMessage(message){const uid=user?.id,cid=current?.id,ep=epoch;if(!uid||message.conversation_id!==cid)return;if(!rows.some(r=>r.id===message.id)){const r=await sb.from('messages').select('*').eq('conversation_id',cid).gte('server_seq',Math.max(1,message.server_seq-30)).lte('server_seq',message.server_seq+30).order('server_seq',{ascending:true}).limit(61);if(r.error)throw r.error;if(user?.id!==uid||epoch!==ep)return;const combined=new Map(rows.map(m=>[m.id,m]));for(const m of r.data||[])combined.set(m.id,m);rows=[...combined.values()].sort((a,b)=>a.server_seq-b.server_seq);PablicusChat.update(rows.map(mapped));}const list=PablicusChat.list,index=list?.messages.findIndex(m=>m.id===message.id);if(index>=0)list.go(index);}
 async function forwardMessages(destination,messages){const uid=user?.id,ep=epoch;if(!uid||!current||opening)throw Error('Сначала откройте разговор');const blocks=[],files=[];let bytes=0;
  await PablicusChat.flush();toast('Подготавливаю пересылку…');
  for(const original of messages){const m=PablicusChatActions.effective(original);if(m.deleted_at)throw Error('Сообщение удалено');const content=m.type==='rich'?m.attachment_metadata?.blocks:[...(m.body?[{type:'text',text:m.body}]:[]),...(m.attachment_path?[{type:(m.attachment_metadata?.mime_type||'').startsWith('audio/')?'audio':['image','video'].includes(m.type)?m.type:'document',path:m.attachment_path,name:m.attachment_metadata?.name,mime:m.attachment_metadata?.mime_type,size:m.attachment_metadata?.size_bytes}]:[])];
   for(const block of content||[]){if(user?.id!==uid||epoch!==ep)throw Error('Разговор изменился. Пересылка отменена');const id=crypto.randomUUID();if(block.type==='text'){blocks.push({id,type:'text',text:block.text});continue;}if(bytes+(+block.size||0)>104857600)throw Error('Для пересылки выберите до 100 МБ вложений');const url=await signedUrl(block.path),response=await timeoutFetch(url);if(!response.ok)throw Error('Не удалось загрузить вложение для пересылки');const blob=await response.blob();bytes+=blob.size;if(blob.size>26214400||bytes>104857600)throw Error('Превышен размер вложений');const assetId=crypto.randomUUID(),file=new File([blob],block.name||'Вложение',{type:block.mime||blob.type||'application/octet-stream'});files.push({id:assetId,file,name:file.name,type:file.type,size:file.size,lastModified:file.lastModified,kind:block.type});blocks.push({id,type:block.type,assetId});}
  }
  if(user?.id!==uid||epoch!==ep)throw Error('Разговор изменился. Пересылка отменена');await openConversation(dialogs.find(d=>d.id===destination)||{id:destination,title:'Разговор'});if(user?.id!==uid||current?.id!==destination)throw Error('Не удалось открыть разговор');await PablicusChat.appendContent({blocks,files});if(user?.id!==uid||current?.id!==destination)return;toast('Добавлено к сообщению. Нажмите «Отправить».');
 }
 async function loadOlder(){if(!current||olderBusy||!navigator.onLine||!rows.length)return;const first=+rows[0].server_seq;if(first<=1)return;olderBusy=true;const d=current,ep=epoch;try{const r=await sb.from('messages').select('*').eq('conversation_id',d.id).lt('server_seq',first).order('server_seq',{ascending:false}).limit(100);if(r.error)throw r.error;if(ep!==epoch||current?.id!==d.id)return;const older=(r.data||[]).reverse();if(older.length){rows=[...older,...rows];PablicusChat.prepend(older.map(mapped))}}catch(e){if(navigator.onLine)console.warn('history')}finally{olderBusy=false}}
 async function signedUrl(path){const old=signed.get(path);if(old&&old.until>Date.now())return old.url;const r=await sb.storage.from(BUCKET).createSignedUrl(path,300);if(r.error)throw r.error;signed.set(path,{url:r.data.signedUrl,until:Date.now()+240000});return r.data.signedUrl}
 async function viewAttachment(r){if(['image','video'].includes(r.type))return mediaViewer.open([{type:r.type,path:r.attachment_path,localAssetId:r.localAssetId,name:r.attachment_metadata?.name||'Вложение',mime:r.attachment_metadata?.mime_type}],0);const md=r.attachment_metadata||{},c=dialog(md.name||'Вложение');c.append(el('p','','Открываю…'));const uid=user?.id,u=r.localAssetId?PablicusChat.localAssetUrl(r.localAssetId):await signedUrl(r.attachment_path);if(user?.id!==uid)return;c.replaceChildren();
  if(r.type==='image'){const im=el('img','viewerImage');im.src=u;im.alt='Фотография';c.append(im)}
  else if((md.mime_type||'').startsWith('audio/')){const a=el('audio');a.controls=true;a.src=u;c.append(a)}
  else if(r.type==='video'){const v=el('video','viewerVideo');v.controls=true;v.playsInline=true;v.preload='metadata';v.src=u;v.onerror=()=>{if(v.isConnected)c.prepend(el('p','muted','Браузер не смог воспроизвести это видео. Откройте или сохраните файл ниже.'))};c.append(v)}
  else if(md.mime_type==='application/pdf'){const f=el('iframe','pdfFrame');f.title=md.name||'PDF';f.src=u;f.setAttribute('sandbox','');c.append(f)}
  const a=el('a','setting','Открыть / сохранить файл');a.href=u;a.target='_blank';a.rel='noopener noreferrer';c.append(a);
 }
 $('productDialog').addEventListener('close',()=>{$('dialogContent').querySelectorAll('video,audio').forEach(m=>{m.pause();m.removeAttribute('src');m.load()})});
 function acceptFile(f){if(f.size===0){toast('Пустой файл не добавлен');return false}if(f.size>25*1024*1024){toast('В этом кандидате вложения до 25 МБ. Файл не был добавлен.');return false}return true}
 async function objectExists(path){const a=await sb.storage.from(BUCKET).createSignedUrl(path,60);return !a.error}
 const b64=s=>btoa(unescape(encodeURIComponent(s)));
 const attachmentName=f=>f.name.normalize('NFKC').replace(/[^a-zA-Z0-9._-]/g,'_').slice(-80).replace(/^\.+/,'')||'file';
 const stableContent=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
 function richContent(item,m,cid,uid,id){return {v:1,...(m.reply_to?{reply_to:m.reply_to}:{}),blocks:m.blocks.flatMap(block=>{
  if(block.type==='text')return block.text.trim()?[{id:block.id,type:'text',text:block.text}]:[];
  const f=item.files.find(file=>file.id===block.assetId);if(!f)throw Error('Байты вложения не найдены');
  return [{id:block.id,type:block.type,path:cid+'/'+uid+'/'+id+'/'+block.id+'/'+attachmentName(f),name:f.name,mime:f.type||'application/octet-stream',size:f.size}];
 })};}
 async function upload(store,item,m,f,owner,cid,uid,richMessageId=null){const id=await pablicusClientId(item.id,m.id),path=cid+'/'+uid+'/'+(richMessageId?richMessageId+'/'+m.id:id)+'/'+attachmentName(f);
  if(await objectExists(path))return{path,id};if(user?.id!==uid)throw Error('Аккаунт изменился');
  if(f.size<=6*1024*1024){const r=await sb.storage.from(BUCKET).upload(path,f.file,{contentType:f.type||'application/octet-stream',upsert:false});if(r.error&&!await objectExists(path))throw r.error;return{path,id}}
  const endpoint=URL.replace('.supabase.co','.storage.supabase.co')+'/storage/v1/upload/resumable';let location=item.parts?.[m.id]?.upload_url;
  const auth=async()=>{if(user?.id!==uid)throw Error('Аккаунт изменился');const s=await sb.auth.getSession();if(!s.data.session)throw Error('Войдите для продолжения отправки');if(s.data.session.user.id!==uid)throw Error('Аккаунт изменился');return{Authorization:'Bearer '+s.data.session.access_token,apikey:KEY,'Tus-Resumable':'1.0.0'}};
  let offset=0;if(location){const lu=new window.URL(location),eu=new window.URL(endpoint);if(lu.origin!==eu.origin||!lu.pathname.startsWith('/storage/v1/upload/resumable/'))throw Error('Некорректный адрес загрузки');const h=await timeoutFetch(location,{method:'HEAD',headers:await auth()});if(h.ok)offset=+(h.headers.get('Upload-Offset')||0);else if([404,410].includes(h.status))location=null;else throw Error('Не удалось продолжить загрузку: '+h.status)}
  if(!location){const r=await timeoutFetch(endpoint,{method:'POST',headers:{...await auth(),'Upload-Length':String(f.size),'Upload-Metadata':[['bucketName',BUCKET],['objectName',path],['contentType',f.type||'application/octet-stream'],['cacheControl','3600']].map(([k,v])=>k+' '+b64(v)).join(',')}});if(!r.ok)throw Error('Ошибка начала загрузки: '+r.status);if(!r.headers.get('Location'))throw Error('Сервер не вернул адрес загрузки');location=new window.URL(r.headers.get('Location'),endpoint).href;if(new window.URL(location).origin!==new window.URL(endpoint).origin)throw Error('Некорректный адрес загрузки');await store.progress(item.id,owner,m.id,{upload_url:location})}
  while(offset<f.size){const end=Math.min(offset+6*1024*1024,f.size),r=await timeoutFetch(location,{method:'PATCH',headers:{...await auth(),'Upload-Offset':String(offset),'Content-Type':'application/offset+octet-stream'},body:f.file.slice(offset,end)},60000);if(!r.ok)throw Error('Загрузка прервана: '+r.status);offset=+(r.headers.get('Upload-Offset')||end);await store.progress(item.id,owner,m.id,{upload_url:location,uploaded:offset})}
  return{path,id};
 }
 async function pump(){if(worker||!user||!navigator.onLine||document.hidden)return;worker=true;const uid=user.id,owner=DraftVault.uid();try{
  for(const d of dialogs){if(user?.id!==uid)break;const store=PablicusChat.scope.user===uid&&PablicusChat.scope.chat===d.id?PablicusChat.store:new PablicusStore(uid,d.id);if(!store)continue;try{
   const queue=await store.readQueue();for(const it of queue){if(user?.id!==uid||!navigator.onLine)break;if(it.state==='error'&&(!it.retryable||it.nextAttemptAt>Date.now()))break;if(!['queued','sending','error'].includes(it.state))continue;const claimed=await store.claim(it.id,owner);if(!claimed)break;const item={...claimed,files:it.files};
    try{for(const m of item.messages){if(user?.id!==uid)throw Error('Аккаунт изменился');if(item.parts?.[m.id]?.ack)continue;const id=await pablicusClientId(item.id,m.id);
     const content=m.kind==='rich'?richContent(item,m,d.id,uid,id):null;
     const existing=await sb.from('messages').select('id,server_seq,client_message_id,conversation_id,type,attachment_metadata').eq('sender_id',uid).eq('client_message_id',id).maybeSingle();if(existing.error)throw existing.error;let ack=existing.data;
     if(ack&&ack.conversation_id!==d.id)throw Error('Подтверждение относится к другому разговору');
     if(ack&&content&&(ack.type!=='rich'||stableContent(ack.attachment_metadata)!==stableContent(content)))throw Error('Сервер вернул другое содержимое сообщения. Исходящее сохранено.');
     if(!ack){let r;if(m.kind==='rich'){
      for(const block of m.blocks){
       if(block.type==='text')continue;
       const f=item.files.find(file=>file.id===block.assetId);if(!f)throw Error('Байты вложения не найдены');
       await upload(store,item,{id:block.id},f,owner,d.id,uid,id);
      }
      if(user?.id!==uid)throw Error('Аккаунт изменился');
      r=await sb.rpc('send_rich_message',{p_conversation_id:d.id,p_client_message_id:id,p_content:content});
     }else if(m.kind==='text'){if(user?.id!==uid)throw Error('Аккаунт изменился');r=await sb.rpc('send_message',{p_conversation_id:d.id,p_client_message_id:id,p_type:'text',p_body:m.text,p_attachment_path:null})}
      else{const f=item.files.find(f=>f.id===m.assetId);if(!f)throw Error('Байты вложения не найдены');if(f.size>25*1024*1024||m.kind==='video')throw Error('Этот файл пока не поддерживается текущим релизом');const media=await upload(store,item,m,f,owner,d.id,uid);if(user?.id!==uid)throw Error('Аккаунт изменился');r=await sb.rpc('send_attachment_message',{p_conversation_id:d.id,p_client_message_id:id,p_type:m.kind==='image'?'image':'document',p_attachment_path:media.path,p_attachment_name:f.name,p_mime_type:f.type||'application/octet-stream',p_size_bytes:f.size,p_caption:null,p_thumb_data_url:null})}
      if(r.error)throw r.error;ack=r.data;
     }
     if(user?.id!==uid)throw Error('Аккаунт изменился');
     if(!ack?.id||!ack.server_seq||ack.client_message_id!==id)throw Error('Нет корректного подтверждения сервера');await store.progress(item.id,owner,m.id,{ack:{id:ack.id,server_seq:ack.server_seq,client_message_id:id}});
    }
    await store.finish(item.id,owner);if(current?.id===d.id){await syncMessages();await PablicusChat.refreshQueue()}
   }catch(e){await store.failed(item.id,owner,e,!navigator.onLine);if(current?.id===d.id)await PablicusChat.refreshQueue();if(navigator.onLine)toast('Исходящее сохранено. '+e.message);break}
   }
  }finally{if(store!==PablicusChat.store)store.close()}}
 }catch(e){problem(e)}finally{worker=false}}
 async function showOutbox(){const c=dialog('Исходящие'),store=PablicusChat.store;if(!store)return;const q=(await store.readQueue(false)).filter(r=>!['sent','cancelled'].includes(r.state));if(!q.length)c.append(el('p','','Все исходящие подтверждены сервером. Это не означает, что получатель их прочитал.'));for(const r of q){const b=el('section','outboxItem');b.append(el('strong','',({queued:'В очереди',sending:'Отправляется',error:'Ошибка'})[r.state]||r.state),el('p','',r.messages.find(m=>m.kind==='text')?.text.slice(0,180)||'Вложения'));if(r.error)b.append(el('p','danger',r.error.message));const retry=el('button','setting','Повторить');retry.onclick=async()=>{try{await store.retry(r.id);$('productDialog').close();pump()}catch(e){problem(e)}};b.append(retry);c.append(b)}}
 window.PablicusHost={renderMessage,renderPendingMessage,messageMeta,paintReplyDraft,notify:toast,acceptFile,unavailable,showOutbox,historyTop:loadOlder,canSend:()=>{if(!user||!profile?.is_approved||!current||opening||PablicusChat.scope.user!==user.id||PablicusChat.scope.chat!==current.id)return false;if((PablicusChat.rich?.capture().text||$('input').value||'').length>5000){toast('Одно сообщение — до 5000 символов. Черновик сохранён; сократите его или разделите.');return false}return true}};
 window.addEventListener('pablicus:queued',()=>pump());window.addEventListener('online',()=>{connection();loadDialogs();syncMessages();pump()});window.addEventListener('offline',connection);document.addEventListener('visibilitychange',()=>{inboxContext();if(!document.hidden)messageTools.sync();if(!document.hidden){connection();loadDialogs();syncMessages();pump()}});
 setInterval(()=>{pollInbox();if(!document.hidden)messageTools.sync()},5000);
 setInterval(()=>{if(!document.hidden){if(current)syncMessages();else loadDialogs();pump()}},1300);connection();
 if('serviceWorker'in navigator){let approveUpdate=false;const hadController=!!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js',{scope:'./',updateViaCache:'none'}).then(reg=>{const show=()=>{$('updateNotice').hidden=!reg.waiting};reg.addEventListener('updatefound',()=>reg.installing?.addEventListener('statechange',show));show();
   $('applyUpdate').onclick=async()=>{try{await PablicusChat.flush();if(worker){toast('Сначала дождитесь завершения отправки');return}approveUpdate=true;reg.waiting?.postMessage('ACTIVATE')}catch(e){problem(e)}};
   navigator.serviceWorker.addEventListener('controllerchange',async()=>{if(!hadController)return;if(approveUpdate){await PablicusChat.flush();location.reload()}else toast('Обновление готово. Сохраните черновик перед перезапуском.')});reg.update();
  }).catch(()=>toast('Офлайн-режим не установлен. Онлайн-переписка доступна.'));
 }
 window.PablicusDebug={version:VERSION,get user(){return user?.id},get current(){return current?.id},get messageCount(){return rows.length},pump,syncMessages};
})();
