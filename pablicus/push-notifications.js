/* Web Push consent belongs to this device and account. No token is stored here or in the worker. */
(function(root){
 'use strict';
 const OWNER='pablicus:push-owner',UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
 const element=(tag,cls,text)=>{const n=document.createElement(tag);n.className=cls;if(text!==undefined)n.textContent=text;return n;};
 function keyBytes(value){const s=String(value||'');if(!/^[A-Za-z0-9_-]+$/.test(s))throw Error('Не удалось получить ключ уведомлений.');const raw=atob(s.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-s.length%4)%4));const bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));if(bytes.length!==65||bytes[0]!==4)throw Error('Не удалось получить ключ уведомлений.');return bytes;}
 function limited(promise,ms=8000){let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Нет ответа. Проверьте интернет и повторите.')),ms);})]).finally(()=>clearTimeout(timer));}
 function create(options={}){
  if(typeof options.getSession!=='function'||typeof options.getUserId!=='function')throw Error('Push account callbacks are required');
  const endpoint=new URL('/functions/v1/pablicus-push',options.projectUrl).href;
  const scope=new URL('./',root.location.href).href;
  let generation=0,enabled=false,busy=false,destroyed=false,refreshing=null,section=null,button=null,status=null;
  const readOwner=()=>{try{return root.localStorage.getItem(OWNER)||'';}catch{return '';}};
  const writeOwner=id=>{try{if(id)root.localStorage.setItem(OWNER,id);else root.localStorage.removeItem(OWNER);}catch{}};
  const supported=()=>root.isSecureContext&&'serviceWorker'in navigator&&'PushManager'in root&&'Notification'in root;
  const needsInstall=()=>/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
  const standalone=()=>root.matchMedia?.('(display-mode: standalone)').matches||navigator.standalone===true;
  const still=(uid,token)=>!destroyed&&token===generation&&options.getUserId()===uid;
  function view(message=''){
   if(!section)return;const uid=options.getUserId();section.hidden=!uid;button.disabled=busy;button.textContent=enabled?'Отключить уведомления':'Включить уведомления';
   if(needsInstall()&&!standalone()){button.textContent='Добавить на главный экран';status.textContent='На iPhone откройте приложение с главного экрана, чтобы включить уведомления.';return;}
   if(!supported()){button.disabled=true;status.textContent='Этот браузер не поддерживает уведомления. Откройте приложение в Safari или другом поддерживаемом браузере.';return;}
   if(Notification.permission==='denied'){button.disabled=true;status.textContent='Уведомления запрещены. Разрешите их для Pablicus в настройках уведомлений устройства.';return;}
   status.textContent=message||(enabled?'Уведомления о новых сообщениях включены на этом устройстве.':'Новые сообщения смогут появляться на экране, даже когда приложение закрыто.');
  }
  async function registration(){const reg=await limited(navigator.serviceWorker.getRegistration(scope).then(r=>r?.active?r:navigator.serviceWorker.ready));if(!reg?.active||reg.scope!==scope)throw Error('Обновление приложения ещё устанавливается. Откройте приложение повторно.');return reg;}
  async function bind(recipientId,reg){
   reg=reg||await registration();await limited(new Promise((resolve,reject)=>{const channel=new MessageChannel();channel.port1.onmessage=e=>{channel.port1.close();e.data?.ok?resolve():reject(Error('Не удалось настроить уведомления.'));};channel.port1.onmessageerror=()=>{channel.port1.close();reject(Error('Не удалось настроить уведомления.'));};reg.active.postMessage({type:'PABLICUS_PUSH_BIND',recipientId:recipientId||null},[channel.port2]);}));
  }
  async function request(method,body,uid){
   const raw=await options.getSession(),session=raw?.data?.session||raw?.session||raw;
   if(!session?.access_token||session.user?.id!==uid||options.getUserId()!==uid)throw Error('Аккаунт изменился. Откройте профиль повторно.');
   const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
   try{const response=await fetch(endpoint,{method,headers:{Authorization:'Bearer '+session.access_token,apikey:options.apiKey,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:controller.signal,cache:'no-store'});const data=await response.json().catch(()=>({}));if(!response.ok)throw Error(response.status===401?'Войдите снова, чтобы включить уведомления.':'Не удалось подключить уведомления. Повторите попытку.');return data;}
   finally{clearTimeout(timer);}
  }
  async function refresh(){
   if(refreshing)return refreshing;const uid=options.getUserId(),token=generation;
   enabled=false;view();if(!uid||!supported()||(needsInstall()&&!standalone())||Notification.permission!=='granted')return;
   refreshing=(async()=>{try{const reg=await registration(),sub=await reg.pushManager.getSubscription();if(!still(uid,token))return;
    if(readOwner()!==uid){await bind(null,reg);if(sub)await sub.unsubscribe();view();return;}
    if(!sub){writeOwner('');await bind(null,reg);view();return;}
    await bind(uid,reg);if(!still(uid,token))return;const result=await request('POST',{action:'subscribe',subscription:sub.toJSON()},uid);if(!still(uid,token))return;if(result.ok!==true)throw Error('Не удалось подключить уведомления.');enabled=true;view();
   }catch(e){if(still(uid,token))view(e.message);}finally{refreshing=null;}})();return refreshing;
  }
  async function enable(){
   if(busy||destroyed)return;if(needsInstall()&&!standalone()){options.onInstall?.();return;}
   const uid=options.getUserId();if(!uid||!supported())return;
   // Invoke synchronously from the button gesture: iOS rejects permission prompts after network awaits.
   const permission=Notification.permission==='default'?Notification.requestPermission():Promise.resolve(Notification.permission);
   const token=++generation;busy=true;view('Подключаем уведомления…');let created=null;
   try{if(await permission!=='granted'){view('Разрешение не получено. Уведомления не включены.');return;}if(!still(uid,token))return;
    const [reg,config]=await Promise.all([registration(),request('GET',null,uid)]);if(!still(uid,token))return;const applicationServerKey=keyBytes(config.publicKey);
    let sub=await reg.pushManager.getSubscription();if(!still(uid,token))return;
    if(sub&&readOwner()!==uid){await bind(null,reg);await sub.unsubscribe();sub=null;}
    if(!still(uid,token))return;sub=sub||await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey});created=sub;
    if(!still(uid,token)){await sub.unsubscribe();return;}await bind(uid,reg);if(!still(uid,token)){await sub.unsubscribe();return;}
    const result=await request('POST',{action:'subscribe',subscription:sub.toJSON()},uid);if(result.ok!==true)throw Error('Не удалось подключить уведомления.');
    if(!still(uid,token)){await sub.unsubscribe();return;}writeOwner(uid);enabled=true;view();
   }catch(e){if(still(uid,token)){enabled=false;writeOwner('');if(created)await created.unsubscribe().catch(()=>{});await bind(null).catch(()=>{});view(e.name==='AbortError'?'Нет связи. Проверьте интернет и повторите.':e.message);}}
   finally{if(token===generation){busy=false;view(status?.textContent);}}
  }
  async function signOut({remote=true}={}){
   const uid=options.getUserId(),priorOwner=readOwner();++generation;enabled=false;busy=false;writeOwner('');view();let detached=false,serverRemoved=false;
   if(!supported())return{detached:true,serverRemoved:false};
   if(!priorOwner&&Notification.permission!=='granted')return{detached:true,serverRemoved:false};
   try{const reg=await registration();try{await bind(null,reg);detached=true;}catch{}
    // Remove previously displayed alerts for the account as well as future subscriptions.
    try{for(const notification of await reg.getNotifications())notification.close();}catch{}
    const sub=await reg.pushManager.getSubscription();if(!sub)return{detached,serverRemoved:true};
    if(remote&&uid){try{serverRemoved=(await request('POST',{action:'unsubscribe',endpoint:sub.endpoint},uid)).ok===true;}catch{}}
    try{detached=(await sub.unsubscribe())||detached;}catch{}detached=detached||serverRemoved;
   }catch{}
   return{detached,serverRemoved};
  }
  async function disable(){if(busy)return;busy=true;view('Отключаем уведомления…');const result=await signOut();view(result.detached?'Уведомления на этом устройстве отключены.':'Не удалось отключить уведомления. Повторите попытку или отключите их в настройках устройства.');}
  function mount(container){
   if(!container)return null;section=element('section','pushSettings');section.setAttribute('aria-label','Уведомления');
   const title=element('h2','','Уведомления');button=element('button','setting pushButton');button.type='button';status=element('p','pushStatus');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
   button.onclick=()=>enabled?disable():enable();section.append(title,button,status);container.append(section);view();refresh();return section;
  }
  function onMessage(event){const data=event.data;if(data?.type!=='PABLICUS_PUSH_OPEN'||!UUID.test(data.conversationId||'')||data.recipientId!==options.getUserId())return;options.onOpenConversation?.(data.conversationId,data.recipientId);}
  navigator.serviceWorker?.addEventListener('message',onMessage);
  function clear(){return signOut({remote:false});}
  function destroy(){destroyed=true;++generation;navigator.serviceWorker?.removeEventListener('message',onMessage);section?.remove();section=button=status=null;}
  if(options.container)mount(options.container);
  return{mount,refresh,enable,disable,signOut,clear,destroy,get enabled(){return enabled;}};
 }
 root.PablicusPush={create,keyBytes};
})(typeof window!=='undefined'?window:globalThis);
