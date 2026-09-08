'use strict';
// Contract tests execute production client/worker bytes with explicit browser and push-provider boundaries.
// They do not claim delivery to a physical iPhone; that requires its owner's permission and a real endpoint.
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const source=name=>fs.readFileSync(path.join(__dirname,'../src',name),'utf8');
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',C='33333333-3333-4333-8333-333333333333',M='44444444-4444-4444-8444-444444444444';
const scope='https://fixture.invalid/vision-talk/pablicus/',publicKey=Buffer.from([4,...new Array(64).fill(5)]).toString('base64url');
class Node{constructor(tag){this.tag=tag;this.children=[];this.textContent='';}setAttribute(){}append(...nodes){this.children.push(...nodes);}remove(){}}
function fixture({ios=false,installed=false,permission='default',failure=false,permissionPromise}={}){
 const calls=[],values=new Map(),events={},bindings=[];let user=A,current=null,requestPermissionCount=0;
 const reg={scope,active:{postMessage(data,ports){bindings.push(data.recipientId);queueMicrotask(()=>ports[0].peer.onmessage({data:{ok:true}}));}},getNotifications:async()=>[],pushManager:{getSubscription:async()=>current,subscribe:async options=>{calls.push({subscribe:options});const sub={endpoint:'https://push.fixture.invalid/'+calls.length,toJSON:()=>({endpoint:sub.endpoint,keys:{p256dh:'PUBLIC',auth:'AUTH'}}),unsubscribe:async()=>{calls.push({unsubscribe:sub.endpoint});if(current===sub)current=null;return true;}};current=sub;return sub;}}};
 class Channel{constructor(){this.port1={close(){}};this.port2={peer:this.port1};}}
 const browser={URL,Uint8Array,atob,setTimeout,clearTimeout,AbortController,MessageChannel:Channel,console,isSecureContext:true,PushManager:function(){},location:{href:scope},matchMedia:()=>({matches:installed}),localStorage:{getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)},Notification:{permission,requestPermission(){requestPermissionCount++;return permissionPromise||Promise.resolve(browser.Notification.permission='granted');}},document:{createElement:tag=>new Node(tag)},navigator:{userAgent:ios?'iPhone':'Browser',platform:ios?'iPhone':'Linux',maxTouchPoints:ios?5:0,serviceWorker:{getRegistration:async()=>reg,ready:Promise.resolve(reg),addEventListener:(t,fn)=>events[t]=fn,removeEventListener(){}}},fetch:async(url,options)=>{calls.push({url,method:options.method,headers:options.headers,body:options.body&&JSON.parse(options.body)});return{ok:!failure,status:failure?500:200,json:async()=>options.method==='GET'?{publicKey}:{ok:true}};}};
 browser.window=browser;vm.runInNewContext(source('push-notifications.js'),browser);
 const opened=[];const api=browser.PablicusPush.create({projectUrl:'https://db.fixture.invalid',apiKey:'PUBLISHABLE',getUserId:()=>user,getSession:async()=>({data:{session:{access_token:'TOKEN_'+user,user:{id:user}}}}),onOpenConversation:(id,recipient)=>opened.push({id,recipient})});
 return{api,browser,calls,values,bindings,reg,events,opened,setUser:id=>user=id,get current(){return current;},get prompts(){return requestPermissionCount;}};
}
test('mount/refresh never prompts; enabling requests consent directly and registers under the authenticated account',async()=>{
 const f=fixture();f.api.mount(new Node('main'));await f.api.refresh();assert.equal(f.prompts,0);const pending=f.api.enable();assert.equal(f.prompts,1,'permission is requested before the first asynchronous boundary');await pending;
 assert.equal(f.api.enabled,true);const request=f.calls.find(c=>c.body?.action==='subscribe');assert.equal(request.headers.Authorization,'Bearer TOKEN_'+A);assert.equal(request.headers.apikey,'PUBLISHABLE');assert.deepEqual(Object.keys(request.body).sort(),['action','subscription']);assert.equal(f.bindings.at(-1),A);assert.equal(f.values.get('pablicus:push-owner'),A);
 const native=f.calls.find(c=>c.subscribe).subscribe;assert.equal(native.userVisibleOnly,true);assert.equal(native.applicationServerKey.length,65);
});
test('iPhone browser tab gives installation guidance and never requests permission or a subscription',async()=>{
 const f=fixture({ios:true});const panel=f.api.mount(new Node('main'));await f.api.enable();assert.equal(f.prompts,0);assert.equal(f.calls.length,0);assert.match(panel.children[2].textContent,/главного экрана/);
});
test('server rejection never reports enabled and removes the created browser subscription',async()=>{
 const f=fixture();const fetch=f.browser.fetch;f.browser.fetch=async(url,options)=>options.method==='POST'?{ok:false,status:500,json:async()=>({})}:fetch(url,options);await f.api.enable();assert.equal(f.api.enabled,false);assert.equal(f.current,null);assert.equal(f.values.size,0);assert.equal(f.bindings.at(-1),null);assert.equal(f.calls.filter(c=>c.unsubscribe).length,1);
});
test('logout with no prior consent does not wait for a blocked service worker or call the backend',async()=>{
 const f=fixture();let registrations=0;f.browser.navigator.serviceWorker.getRegistration=()=>{registrations++;return new Promise(()=>{});};const result=await f.api.signOut();assert.equal(result.detached,true);assert.equal(registrations,0);assert.equal(f.calls.length,0);
});
test('logout removes server ownership and native subscription and clears worker binding',async()=>{
 const f=fixture();await f.api.enable();const result=await f.api.signOut();assert.equal(result.detached,true);assert.equal(result.serverRemoved,true);assert.equal(f.current,null);assert.equal(f.values.size,0);assert.equal(f.bindings.at(-1),null);assert.equal(f.calls.filter(c=>c.body?.action==='unsubscribe').length,1);
});
test('account changes during a permission prompt cannot register the previous account',async()=>{
 let allow;const f=fixture({permissionPromise:new Promise(resolve=>allow=resolve)});const pending=f.api.enable();f.setUser(B);await f.api.clear();allow('granted');await pending;assert.equal(f.calls.filter(c=>c.body?.action==='subscribe').length,0);assert.equal(f.current,null);assert.equal(f.api.enabled,false);
});
test('new accounts do not adopt another account’s existing device subscription',async()=>{
 const f=fixture();await f.api.enable();f.setUser(B);await f.api.refresh();assert.equal(f.current,null);assert.equal(f.api.enabled,false);assert.equal(f.bindings.at(-1),null);
});
test('notification navigation ignores another recipient and invalid conversation identifiers',()=>{
 const f=fixture();for(const data of [{type:'PABLICUS_PUSH_OPEN',recipientId:B,conversationId:C},{type:'PABLICUS_PUSH_OPEN',recipientId:A,conversationId:'https://evil.invalid'}])f.events.message({data});assert.equal(f.opened.length,0);
 f.events.message({data:{type:'PABLICUS_PUSH_OPEN',recipientId:A,conversationId:C}});assert.deepEqual(f.opened,[{id:C,recipient:A}]);
});
function worker(values=new Map(),failShow=0){
 const events={},notifications=[],opened=[],messages=[];let clients=[];
 const indexedDB={open(){const req={};queueMicrotask(()=>{req.result={transaction(){const tx={objectStore(){return{get(key){const r={};queueMicrotask(()=>{r.result=values.get(key);r.onsuccess?.();queueMicrotask(()=>tx.oncomplete?.());});return r;},put(value,key){const r={};queueMicrotask(()=>{values.set(key,value);r.result=key;r.onsuccess?.();queueMicrotask(()=>tx.oncomplete?.());});return r;}};}};return tx;},close(){}};req.onsuccess();});return req;}};
 const env={URL,indexedDB,console,self:{registration:{scope,showNotification:async(title,options)=>{if(failShow-->0)throw Error('Notification display failed');notifications.push({title,options});}},addEventListener:(type,fn)=>(events[type]||=[]).push(fn),clients:{matchAll:async()=>clients,openWindow:async url=>opened.push(url)}}};vm.runInNewContext(source('sw.js'),env);
 async function emit(type,event){const pending=[];for(const fn of events[type]||[])fn({...event,waitUntil:p=>pending.push(p)});await Promise.all(pending);}
 return{values,notifications,opened,messages,emit,setClients:list=>clients=list};
}
test('worker persists opaque ownership only and shows generic alerts only for that recipient',async()=>{
 const f=worker(),acks=[];await f.emit('message',{source:{url:scope},data:{type:'PABLICUS_PUSH_BIND',recipientId:A},ports:[{postMessage:data=>acks.push(data)}]});assert.equal(acks[0].ok,true);assert.equal(f.values.get('recipient'),A);assert.equal(f.values.get('recent').length,0);
 const payload={recipient_id:B,conversation_id:C,message_id:M,body:'Private text must not be shown'};await f.emit('push',{data:{json:()=>payload}});assert.equal(f.notifications.length,0);payload.recipient_id=A;await f.emit('push',{data:{json:()=>payload}});assert.equal(f.notifications.length,1);assert.equal(f.notifications[0].options.body,'Новое сообщение');assert.equal('badge'in f.notifications[0].options,false);assert.equal(f.notifications[0].options.data.recipientId,A);
});
test('worker rejects foreign-scope binding and notification URLs are generated within the app scope',async()=>{
 const f=worker();await f.emit('message',{source:{url:'https://fixture.invalid/another-app/'},data:{type:'PABLICUS_PUSH_BIND',recipientId:A},ports:[{postMessage(){}}]});assert.equal(f.values.size,0);f.values.set('recipient',A);
 let closed=0;await f.emit('notificationclick',{notification:{close:()=>closed++,data:{recipientId:A,conversationId:C,url:'https://evil.invalid'}}});assert.equal(closed,1);const target=new URL(f.opened[0]);assert.equal(target.origin,new URL(scope).origin);assert.equal(target.pathname,new URL(scope).pathname);assert.equal(target.searchParams.get('conversation'),C);assert.equal(target.searchParams.get('recipient'),A);
 f.values.set('recipient',B);await f.emit('notificationclick',{notification:{close(){},data:{recipientId:A,conversationId:C}}});assert.equal(f.opened.length,1);
});
test('worker focuses existing app without replacing its page or discarding its draft',async()=>{
 const f=worker();f.values.set('recipient',A);let focused=0;f.setClients([{url:scope,focus:async()=>focused++,postMessage:data=>f.messages.push(data)}]);await f.emit('notificationclick',{notification:{close(){},data:{recipientId:A,conversationId:C}}});assert.equal(focused,1);assert.equal(f.opened.length,0);assert.equal(f.messages[0].type,'PABLICUS_PUSH_OPEN');assert.equal(f.messages[0].recipientId,A);
});
test('worker deduplicates concurrent and restarted deliveries but presents new messages in the same conversation',async()=>{
 const f=worker();f.values.set('recipient',A);const delivery=id=>({data:{json:()=>({recipient_id:A,conversation_id:C,message_id:id})}});
 await Promise.all([f.emit('push',delivery(M)),f.emit('push',delivery(M))]);assert.equal(f.notifications.length,1);
 const restarted=worker(f.values);await restarted.emit('push',delivery(M));assert.equal(restarted.notifications.length,0);await restarted.emit('push',delivery(B));assert.equal(restarted.notifications.length,1);assert.equal(restarted.notifications[0].options.tag,f.notifications[0].options.tag);assert.equal(f.values.get('recent').length,2);
});
test('failed notification display remains retryable and the persisted deduplication window is bounded',async()=>{
 const f=worker(new Map([['recipient',A]]),1),delivery=id=>({data:{json:()=>({recipient_id:A,conversation_id:C,message_id:id})}});
 await assert.rejects(f.emit('push',delivery(M)),/display failed/);assert.equal(f.values.get('recent'),undefined);await f.emit('push',delivery(M));assert.equal(f.notifications.length,1);
 for(let i=0;i<130;i++)await f.emit('push',delivery('55555555-5555-4555-8555-'+String(i).padStart(12,'0')));assert.equal(f.values.get('recent').length,128);assert.equal(f.values.get('recent').includes(M),false);
});
test('binding the same account preserves recent IDs; changing account or signing out clears them',async()=>{
 const f=worker(new Map([['recipient',A],['recent',[M]]]));const bind=recipientId=>f.emit('message',{source:{url:scope},data:{type:'PABLICUS_PUSH_BIND',recipientId},ports:[{postMessage(){}}]});await bind(A);assert.equal(f.values.get('recent').length,1);await bind(B);assert.equal(f.values.get('recent').length,0);f.values.set('recent',[C]);await bind(null);assert.equal(f.values.get('recent').length,0);assert.equal(f.values.get('recipient'),null);
});
