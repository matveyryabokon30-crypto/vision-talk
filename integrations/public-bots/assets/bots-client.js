/* Public bot transport: uses the host Auth client. No token copy, second client,
 * privileged credentials or alternate account are created by this module. */
(function(root,factory){'use strict';const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.PublicBotTransport=api;})(globalThis,function(){
 'use strict';
 const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
 class BotError extends Error{constructor(code,message,status=0){super(message);this.name='BotError';this.code=code;this.status=status;}}
 const changed=()=>new BotError('ACCOUNT_CHANGED','Аккаунт изменился. Откройте раздел заново.');
 const authError=()=>new BotError('SESSION_REQUIRED','Вход больше не подтверждён. Вернитесь в Public и войдите своим прежним аккаунтом.',401);
 const messages={REVISION_CONFLICT:'Настройки или диалог изменились в другой вкладке. Обновите данные перед повтором.',BOT_STOPPED:'Бот остановлен. Новые сообщения не отправлены.',NOT_FOUND:'Бот или диалог недоступен этому аккаунту.',FORBIDDEN:'Нет разрешения на это действие.',RATE_LIMIT:'Слишком много запросов. Подождите минуту.',INVALID_FLOW:'Проверьте тексты и варианты сценария.',IDEMPOTENCY_CONFLICT:'Идентификатор отправки уже использован. Сверьте историю; повтор не отправлен.'};
 function validId(value){if(!UUID.test(value||''))throw new BotError('INVALID_ID','Некорректный идентификатор.');return value;}
 class BotClient{
  constructor({baseUrl,apiKey,auth,getContext,fetcher=fetch,timeout=20000}){
   const base=new URL(baseUrl);if(base.protocol!=='https:'&&!(base.protocol==='http:'&&['localhost','127.0.0.1'].includes(base.hostname)))throw new Error('HTTPS required');
   if(base.search||base.hash||base.username||base.password)throw new Error('Invalid API URL');
   this.base=base.href.replace(/\/$/,'');this.apiKey=apiKey;this.auth=auth;this.context=getContext;this.fetcher=fetcher;this.timeout=timeout;this.generation=0;this.controllers=new Set();this.refreshing=null;
  }
  reset(){this.generation++;for(const c of this.controllers)c.abort();this.controllers.clear();}
  actor(){const c=this.context();if(!c?.approved||!UUID.test(c.id||''))throw authError();return c.id;}
  current(id,generation){if(this.generation!==generation||this.context()?.id!==id||!this.context()?.approved)throw changed();}
  async token(id,generation,refresh=false){
   this.current(id,generation);
   let result;
   if(refresh){
    // Deduplicate refreshes for this host instance. The SDK handles cross-tab locking.
    if(!this.refreshing){const p=Promise.resolve().then(()=>this.auth.refreshSession());this.refreshing=p;p.finally(()=>{if(this.refreshing===p)this.refreshing=null;}).catch(()=>{});}
    result=await this.refreshing;
   }else result=await this.auth.getSession();
   this.current(id,generation);
   const session=result?.data?.session;
   if(result?.error||!session?.access_token)throw authError();
   if(session.user?.id!==id)throw changed();
   return session.access_token;
  }
  async request(path,{method='GET',data}={}){
   if(!/^\/v1\/[a-z0-9\-/]+(?:\?after=\d+)?$/i.test(path))throw new BotError('INVALID_PATH','Недопустимый адрес запроса.');
   const id=this.actor(),gen=this.generation;let token=await this.token(id,gen);
   for(let attempt=0;attempt<2;attempt++){
    this.current(id,gen);const controller=new AbortController();this.controllers.add(controller);const timer=setTimeout(()=>controller.abort(),this.timeout);
    let response;
    try{
     response=await this.fetcher(this.base+path,{method,headers:{apikey:this.apiKey,Authorization:'Bearer '+token,...(data!==undefined?{'Content-Type':'application/json'}:{})},body:data===undefined?undefined:JSON.stringify(data),signal:controller.signal,cache:'no-store',credentials:'omit',redirect:'error',referrerPolicy:'no-referrer'});
     this.current(id,gen);
     if(response.status===401&&attempt===0){
      try{await response.body?.cancel();}catch{}
      const latest=await this.token(id,gen);token=latest!==token?latest:await this.token(id,gen,true);continue;
     }
     if(response.status===401)throw authError();
     const raw=await response.text();this.current(id,gen);
     if(raw.length>2000000)throw new BotError('INVALID_RESPONSE','Ответ сервера слишком большой.');
     let body;try{body=JSON.parse(raw);}catch{throw new BotError('INVALID_RESPONSE','Сервер вернул некорректный ответ.');}
     if(!response.ok){const code=String(body?.error?.code||'HTTP_ERROR').slice(0,80);throw new BotError(code,messages[code]||String(body?.error?.message||'Действие не подтверждено сервером.').slice(0,300),response.status);}
     return body;
    }catch(error){this.current(id,gen);if(error instanceof BotError)throw error;throw new BotError('UNCONFIRMED','Ответ не получен. Отправка могла сохраниться. Повторите то же сообщение кнопкой «Повторить».');}
    finally{clearTimeout(timer);this.controllers.delete(controller);}
   }
   throw authError();
  }
  async me(){const me=await this.request('/v1/me');if(me.id!==this.actor()||me.scope!=='manage')throw authError();return me;}
  templates(){return this.request('/v1/templates');}bots(){return this.request('/v1/bots');}catalog(){return this.request('/v1/catalog');}
  get(id){return this.request('/v1/bots/'+validId(id));}
  create(data){return this.request('/v1/bots',{method:'POST',data});}
  update(id,data){return this.request('/v1/bots/'+validId(id),{method:'PATCH',data});}
  chats(id){return this.request('/v1/bots/'+validId(id)+'/chats');}
  createChat(id,chat){return this.request('/v1/bots/'+validId(id)+'/chats',{method:'POST',data:{id:validId(chat)}});}
  history(id,after=0){if(!Number.isSafeInteger(after)||after<0)throw new Error('Invalid cursor');return this.request('/v1/chats/'+validId(id)+'?after='+after);}
  send(p){return this.request('/v1/chats/'+validId(p.chat)+'/messages',{method:'POST',data:{id:validId(p.id),text:p.text,revision:p.revision}});}
  records(id,after=0){if(!Number.isSafeInteger(after)||after<0)throw new Error('Invalid cursor');return this.request('/v1/bots/'+validId(id)+'/records?after='+after);}
 }
 function validPending(p,owner,chat){
  return !!p&&p.owner===owner&&p.chat===chat&&[p.owner,p.chat,p.bot,p.id].every(v=>UUID.test(v||''))&&typeof p.text==='string'&&p.text.trim().length>0&&p.text.length<=2000&&Number.isSafeInteger(p.revision)&&p.revision>=0;
 }
 class PendingStore{
  constructor(indexedDB=globalThis.indexedDB){this.indexedDB=indexedDB;this.opening=null;}
  db(){if(!this.indexedDB)return Promise.reject(new BotError('STORAGE_UNAVAILABLE','Браузер не разрешил сохранить исходящее. Сообщение не отправлено.'));if(!this.opening)this.opening=new Promise((resolve,reject)=>{
   const r=this.indexedDB.open('public-bot-outgoing-v1',1);r.onupgradeneeded=()=>r.result.createObjectStore('pending');r.onsuccess=()=>{r.result.onversionchange=()=>{r.result.close();this.opening=null;};resolve(r.result);};r.onerror=()=>{this.opening=null;reject(new BotError('STORAGE_UNAVAILABLE','Не удалось сохранить исходящее. Сообщение не отправлено.'));};r.onblocked=()=>{this.opening=null;reject(new BotError('STORAGE_BLOCKED','Закройте старую тестовую вкладку и повторите.'));};
  });return this.opening;}
  async transaction(mode,owner,chat,fn){validId(owner);validId(chat);const db=await this.db();return new Promise((resolve,reject)=>{const tx=db.transaction('pending',mode),store=tx.objectStore('pending');let value,error;const key=owner+'/'+chat;const r=store.get(key);r.onsuccess=()=>{try{value=fn(store,key,r.result);}catch(e){error=e;tx.abort();}};tx.oncomplete=()=>resolve(value);tx.onerror=tx.onabort=()=>reject(error||new BotError('STORAGE_UNAVAILABLE','Исходящее не подтверждено локальным хранилищем.'));});}
  read(owner,chat){return this.transaction('readonly',owner,chat,(_s,_k,p)=>{if(p&&!validPending(p,owner,chat))throw new BotError('STORAGE_INVALID','Сохранённая отправка повреждена. Автоматическая отправка отключена.');return p||null;});}
  put(p){if(!validPending(p,p?.owner,p?.chat))return Promise.reject(new BotError('INVALID_PENDING','Неверное исходящее.'));return this.transaction('readwrite',p.owner,p.chat,(s,k,old)=>{if(old&&JSON.stringify(old)!==JSON.stringify(p))throw new BotError('PENDING_EXISTS','В этом диалоге уже есть неподтверждённое сообщение. Сначала восстановите его.');s.put(p,k);return p;});}
  drop(owner,chat,id){return this.transaction('readwrite',owner,chat,(s,k,old)=>{if(old?.id===id)s.delete(k);return true;});}
 }
 return Object.freeze({BotClient,BotError,PendingStore,validPending,validId});
});
