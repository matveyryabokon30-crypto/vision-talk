'use strict';
// Exact production functions/callers are evaluated in an isolated DOM/SDK fixture.
// No application handler is reimplemented here. Network and media boundaries are fakes.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const [id,root,controllerPath,appPath]=process.argv.slice(2);
const controller=fs.readFileSync(controllerPath,'utf8'),app=fs.readFileSync(appPath,'utf8');
const unhandled=[];process.on('unhandledRejection',e=>unhandled.push(String(e?.message||e)));
const evidence={source_spans:[],observations:{}};
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}}
async function bounded(p,label,ms=1500){let timer;try{return await Promise.race([p,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('WAIT_TIMEOUT: '+label)),ms)})])}finally{clearTimeout(timer)}}
async function until(fn,label){for(let i=0;i<200;i++){if(fn())return;await pause(2)}throw Error('WAIT_TIMEOUT: '+label)}
async function drain(){for(let i=0;i<4;i++)await pause(2)}
function check(value,reason,detail){evidence.observations[reason]=detail;assert.ok(value,reason)}
function span(start,end,label){const i=app.indexOf(start),j=app.indexOf(end,i);if(i<0||j<=i)throw Error('SOURCE_EXTRACTION: '+label);const text=app.slice(i,j);evidence.source_spans.push({name:label,start_line:app.slice(0,i).split('\n').length,sha256:sha(text)});return text}
function lineContaining(text){const i=app.indexOf(text);if(i<0)throw Error('SOURCE_EXTRACTION: '+text);return app.slice(app.lastIndexOf('\n',i)+1,app.indexOf('\n',i))}
function functionThrough(name,end){const i=app.indexOf('function '+name+'(');if(i<0)throw Error('SOURCE_EXTRACTION: '+name);return span(app.slice(app.lastIndexOf('\n',i)+1,i)+'function '+name+'(',end,name)}
function environment(){
 const nodes=new Map(),counts={aborts:0,close:0,reset:0,unsaved:0,confirm:0,leave:0,profile:0,getSession:0,canvasOpen:0,canvasActive:0,passkeyCancel:0,render:0},errors=[],storage=new Map(),profiles=new Map();
 function element(tag='div'){
  const attrs={},classes=new Set(),n={tagName:tag.toUpperCase(),children:[],dataset:{},style:{},hidden:false,inert:false,textContent:'',value:'',isConnected:true,attributes:attrs,
   classList:{toggle(k,v){if(v===undefined)v=!classes.has(k);v?classes.add(k):classes.delete(k);return v},add(...ks){ks.forEach(k=>classes.add(k))},remove(...ks){ks.forEach(k=>classes.delete(k))},contains:k=>classes.has(k)},
   setAttribute(k,v){attrs[k]=String(v)},getAttribute(k){return attrs[k]},append(...xs){this.children.push(...xs)},prepend(...xs){this.children.unshift(...xs)},replaceChildren(...xs){this.children=xs},remove(){this.isConnected=false},close(){this.open=false},showModal(){this.open=true},focus(){this.focused=true},click(){return this.onclick?.({target:this,preventDefault(){}})},querySelector(){return element()},querySelectorAll(){return[]},addEventListener(){},insertBefore(x){this.children.push(x)}};return n;
 }
 const node=key=>{if(!nodes.has(key))nodes.set(key,element());return nodes.get(key)};
 const buttons=['chats','feed','tasks','profile'].map(page=>{const b=element('button');b.dataset.page=page;return b});node('mainNav').querySelectorAll=()=>buttons;
 let session={user:{id:'A'},access_token:'token-1'},getSessionImpl=()=>Promise.resolve({data:{session}}),sdkCallback=null,restore=deferred();
 const no=()=>{},resource={reset:no,close:no,dismiss:no,clear:no,refresh:no};
 const sb={auth:{getSession(){counts.getSession++;return getSessionImpl()},onAuthStateChange(fn){sdkCallback=fn;return{data:{subscription:{unsubscribe:no}}}}},removeChannel:no,rpc:async()=>({data:[],error:null}),from(table){let uid;return{select(){return this},eq(_key,value){uid=value;return this},single(){counts.profile++;return profiles.get(uid)?.promise||Promise.resolve({data:{id:uid,is_approved:true},error:null})}}}};
 const ctx=vm.createContext({console,Promise,DOMException,URL,AbortController:class extends AbortController{abort(...args){counts.aborts++;return super.abort(...args)}},setTimeout,clearTimeout,
  document:{getElementById:node,createElement:element,querySelectorAll:selector=>selector==='#mainNav button'?buttons:[],hidden:false},navigator:{onLine:true},location:{href:'https://fixture.invalid/'},requestAnimationFrame:no,
  confirm(){counts.confirm++;return ctx.allowExit},allowExit:false,dirty:false,sb,counts,errors,storage,
  safeGet:key=>storage.get(key),safeSet:(key,value)=>storage.set(key,value),passkeyGuardKey:'guard',passkeyUnvalidated:false,
  recoveryClient:{},passkeySignInClient:{},authStorageKey:'test-auth',authCallbackHref:'https://fixture.invalid/',trustExplicitSignIn:no,
  PablicusOAuthSession:{restore:()=>restore.promise},
  PablicusPublicPasskey:{identityValid:person=>!person.invalid},
  PablicusChat:{list:{refreshFont:no},persistDraft:async()=>{},collapseEditor:no,leave:async()=>{counts.leave++},open:async()=>{},update:no},
  PablicusRichMessage:{stopAll:no},PablicusMessageMenu:{icon:()=>element()},
  chatCanvas:{element:{dataset:{state:'ready'}},hasUnsavedChanges(){counts.unsaved++;return ctx.dirty},close(){counts.close++;counts.canvasActive=0;ctx.dirty=false},reset(){counts.reset++;counts.canvasActive=0;ctx.dirty=false},open:async()=>{counts.canvasOpen++;counts.canvasActive=1}},
  workspaceQuick:{...resource},workspaceUploadState:new Map(),mediaViewer:{...resource},chatLibrary:{...resource},messageTools:{...resource},people:{...resource,open:no},tasksHome:{...resource},
  pushNotifications:{clear:async()=>{},refresh:no},signed:new Map(),replyCache:new Map(),
  toast:no,problem:e=>errors.push(e?.message||String(e)),stopInbox:no,inboxContext:no,startInbox:no,pump:no,showPersonLink:no,showPushConversation:no,
  connection:no,paintReplyDraft:no,install:no,theme:no,passkeySettings:no,showOutbox:no,showStorageUsage:no,filter:'all',publicKeyEnabled:false});
 ctx.window=ctx;
 const run=s=>vm.runInContext(s,ctx,{timeout:1000});run(controller);
 run(lineContaining('let authVersion='));run(lineContaining('let user=null,profile='));
 run("let canvasVisible=false,canvasSwitch=0,canvasEpoch=0,tasksEpoch=0;let authBooting=false,pendingAuthEvent=null;const $=x=>document.getElementById(x),el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n};const canvasContext=()=>({userId:user?.id,conversationId:current?.id,epoch:canvasEpoch});const canvasCurrent=c=>user?.id===c.userId&&current?.id===c.conversationId&&canvasEpoch===c.epoch;const cacheKey=()=>`pablicus:${user?.id}:dialogs`,focusKey=()=>`pablicus:${user?.id}:focus`;passkeys={snapshot:()=>({busy:false}),cancel:()=>counts.passkeyCancel++};");
 run(lineContaining('window.PablicusController?.setServices('));
 run(span(' function canvasNavigationAllowed()', ' let tasksEpoch=','canvas functions and tab callers'));
 run(lineContaining('function resetTasksHome()'));
 run(functionThrough('openConversation'," $('chatBack').onclick="));
 run(span(" $('chatBack').onclick=",' async function syncMessages()','chat back caller'));
 run(span(' function goConversation(',' function renderHome(','goConversation'));
 run(span(' function renderHome()',"\n document.querySelectorAll('#mainNav button').forEach",'renderHome'));
 run(span("\n document.querySelectorAll('#mainNav button').forEach"," document.querySelectorAll('#chatFilters button')",'home callers and registration'));
 const ri=app.lastIndexOf(' if(window.PablicusController){');
 // The final block is selected by its last occurrence, not its shared prefix.
 const finalBlock=app.slice(ri,app.indexOf(' window.PablicusHost=',ri));evidence.source_spans.push({name:'real conversation/canvas registration',sha256:sha(finalBlock)});run(finalBlock);
 run(span(' function clearSessionView()'," $('loginForm').onsubmit=",'real clearSessionView and authenticate'));
 run(span(' sb.auth.onAuthStateChange(',app.includes(' const authRestoreEvent=')?' const authRestoreEvent=':' PablicusOAuthSession.restore(','real SDK callback'));
 run(lineContaining('async function loadDialogs()'));
 ctx.PablicusController.setServices({...ctx.PablicusController.getServices(),reportError:e=>errors.push(e?.message||String(e))});
 return{ctx,run,node,counts,errors,profiles,restore,buttons,ctl:ctx.PablicusController,
  async login(uid='A'){session={user:{id:uid},access_token:'token-'+uid};await bounded(run('authenticate('+JSON.stringify(session)+')'),'authenticate '+uid)},
  fire(event,uid){session=uid?{user:{id:uid},access_token:event}:null;sdkCallback(event,session)},
  sessionReply(fn){getSessionImpl=fn},
  async canvas(){run("user={id:'A'};profile={id:'A',is_approved:true};current={id:'c1'};dialogs=[current];");await bounded(ctx.PablicusController.navigate({screen:'canvas',conversationId:'c1',resourceId:'foreign'}),'open canvas');run('paintConversationView()');ctx.dirty=true;ctx.allowExit=false;for(const key of ['close','reset','unsaved','confirm','aborts'])counts[key]=0;counts.canvasActive=1},
  snapshot(){return JSON.parse(run("JSON.stringify({user:user?.id||null,profile:profile?.id||null,current:current?.id||null,visible:canvasVisible,authVersion,epoch})"))}
 };
}
function plainController(){const errors=[];const ctx={console,AbortController,document:{getElementById:()=>null}};ctx.window=ctx;vm.runInNewContext(controller,ctx,{timeout:1000});ctx.PablicusController.setServices({reportError:e=>errors.push(e?.message||String(e))});return{ctl:ctx.PablicusController,errors}}
async function runCase(){
 if(id==='HARNESS_NEVER_FINISHES'){
  const child=require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
  console.log(JSON.stringify({probe:'intentional-hang',pid:process.pid,child_pid:child.pid}));setInterval(()=>{},1000);await new Promise(()=>{});return;
 }
 if(id==='1B-T01'){
  const {ctl}=plainController(),mounts=[];
  async function race(names,screen){const gate=deferred();let entered=false;ctl.register(screen,async()=>async()=>{entered=true;await gate.promise});for(const n of names)ctl.register(n,async()=>{mounts.push(n);return()=>{}});await ctl.navigate({screen});mounts.length=0;const ops=[ctl.navigate({screen:names[0]})];await until(()=>entered,'cleanup entered');for(const n of names.slice(1))ops.push(ctl.navigate({screen:n}));gate.resolve();await bounded(Promise.all(ops),'competing navigations');return{screen:ctl.state().screen,mounts:[...mounts]}}
  const first=await race(['A','B'],'X'),second=await race(['A','B','C'],'X2');check(first.screen==='B'&&JSON.stringify(first.mounts)==='["B"]'&&second.screen==='C'&&JSON.stringify(second.mounts)==='["C"]','R1_LATEST_WINS',{first,second});return;
 }
 if(id==='1B-T02'){
  const {ctl,errors}=plainController();let funcClean=0,objClean=0,newResources=0,started=false;const gate=deferred();ctl.register('A',async()=>{started=true;await gate.promise;return()=>funcClean++});ctl.register('B',async({onCleanup})=>{newResources++;onCleanup?.(()=>newResources--);return()=>{}});
  const pa=ctl.navigate({screen:'A',resourceId:'a'});await until(()=>started,'old mount started');await ctl.navigate({screen:'B',resourceId:'b'});gate.resolve();await bounded(pa,'late function');const afterFunction={funcClean,newResources,screen:ctl.state().screen};
  const other=deferred();let startedOther=false;const obj={count:0,dispose(){assert.equal(this,obj);this.count++;objClean++}};ctl.register('D',async()=>{startedOther=true;await other.promise;return obj});const pd=ctl.navigate({screen:'D',resourceId:'d'});await until(()=>startedOther,'object mount started');await ctl.navigate({screen:'B',resourceId:'b2'});other.resolve();await bounded(pd,'late object');await ctl.navigate({screen:'B',resourceId:'b3'});
  check(afterFunction.funcClean===1&&afterFunction.newResources===1&&afterFunction.screen==='B'&&funcClean===1&&objClean===1&&obj.count===1&&newResources===1&&errors.length===0,'R2_LATE_CLEANUP',{afterFunction,funcClean,objClean,objCount:obj.count,newResources,errors});return;
 }
 if(id==='1B-T05'||id==='1B-LATE-REJECT'){
  const {ctl,errors}=plainController();
  if(id==='1B-T05'){let mounted=0,active=0;ctl.register('badMount',async({onCleanup})=>{active++;onCleanup(()=>active--);throw Error('mount-fail')});let rejected=false;try{await ctl.navigate({screen:'badMount'})}catch(e){rejected=e.message==='mount-fail'};const afterFailure=active;ctl.register('badCleanup',async()=>()=>{throw Error('cleanup-fail')});ctl.register('good',async({onCleanup})=>{mounted++;active++;onCleanup(()=>active--)});await ctl.navigate({screen:'badCleanup'});for(let i=0;i<11;i++)await ctl.navigate({screen:'good',resourceId:'r'+i});check(rejected&&afterFailure===0&&active===1&&mounted===11&&errors.join()==='cleanup-fail','CURRENT_MOUNT_AND_CLEANUP_ERRORS',{rejected,afterFailure,active,mounted,errors});return}
  const gate=deferred();let entered=false,oldActive=0,newActive=0,cleaned=0,success=0;ctl.register('old',async({onCleanup})=>{oldActive++;onCleanup(()=>{oldActive--;cleaned++});entered=true;await gate.promise;success++});ctl.register('new',async({onCleanup})=>{newActive++;onCleanup(()=>newActive--)});const old=ctl.navigate({screen:'old'});await until(()=>entered,'old rejection mount');await ctl.navigate({screen:'new'});gate.reject(Error('late-old-rejection'));const oldReturn=await bounded(old,'old rejection');await drain();check(oldReturn===false&&ctl.state().screen==='new'&&oldActive===0&&newActive===1&&cleaned===1&&success===0&&errors.join()==='late-old-rejection'&&unhandled.length===0,'LATE_REJECTION_ISOLATION',{oldReturn,state:ctl.state(),oldActive,newActive,cleaned,success,errors,unhandled});return;
 }
 if(['1B-SESSION-LATE','1B-SESSION-ERROR','1B-SESSION-ORDER'].includes(id)){
  const f=environment(),c=f.ctl;await c.sessionChanged('A');let cleanup=0;c.register('stable',async()=>()=>cleanup++);await c.navigate({screen:'stable'});const before=c.state();
  if(id==='1B-SESSION-LATE'){const gate=deferred();f.sessionReply(()=>gate.promise);const pending=c.sessionChanged();await drain();await c.sessionChanged('B');await c.navigate({screen:'new'});gate.resolve({data:{session:{user:{id:'A'}}}});const result=await bounded(pending,'late session response');check(result===false&&c.state().sessionUserId==='B'&&c.state().screen==='new'&&cleanup===1,'EXPLICIT_IDENTITY_OVERTAKES_LOOKUP',{result,state:c.state(),cleanup});return}
  if(id==='1B-SESSION-ERROR'){for(const impl of [()=>Promise.resolve({data:{session:null},error:Error('sdk-response-error')}),()=>Promise.reject(Error('sdk-rejection')),()=>{throw Error('sdk-sync-throw')},()=>Promise.resolve({})]){f.sessionReply(impl);assert.equal(await c.sessionChanged(),false)}check(c.state().sessionUserId==='A'&&c.state().sessionGeneration===before.sessionGeneration&&cleanup===0&&f.errors.length===4,'SESSION_ERROR_IS_NOT_LOGOUT',{state:c.state(),cleanup,errors:f.errors});return}
  const one=deferred(),two=deferred();f.sessionReply(()=>one.promise);const p1=c.sessionChanged();await drain();f.sessionReply(()=>two.promise);const p2=c.sessionChanged();await drain();two.resolve({data:{session:{user:{id:'B'}}}});await p2;one.resolve({data:{session:null}});await p1;check(c.state().sessionUserId==='B'&&cleanup===1,'LATEST_SESSION_LOOKUP_WINS',{state:c.state(),cleanup});return;
 }
 if(id.startsWith('1B-AUTH')||id==='1B-T03'){
  const f=environment(),c=f.ctl;
  if(id==='1B-AUTH-BOOT'||id==='1B-AUTH-BOOT-ERROR'){
   f.run('authBooting=true');f.run(span(app.includes(' const authRestoreEvent=')?' const authRestoreEvent=':' PablicusOAuthSession.restore(',' async function loadDialogs()','real boot restore continuation'));f.fire('SIGNED_IN','B');if(id==='1B-AUTH-BOOT-ERROR')f.restore.reject(Error('restore-network-error'));else f.restore.resolve({user:{id:'A'}});await until(()=>f.snapshot().profile==='B','boot last event');check(f.snapshot().user==='B'&&c.state().sessionUserId==='B','BOOT_LAST_EVENT_WINS',{state:c.state(),app:f.snapshot()});return;
  }
  if(id==='1B-AUTH-SWITCH'||id==='1B-AUTH-LATE-ERROR'){
   const profileA=deferred(),action=deferred();f.profiles.set('A',profileA);let entered=false,oldCleanup=0,oldActive=0,newActive=0,oldPaint=0;
   const loginA=f.login('A');await until(()=>f.counts.profile===1,'profile A request');c.register('slow',async({isCurrent,onCleanup})=>{oldActive++;onCleanup(()=>{oldActive--;oldCleanup++});entered=true;await action.promise;if(isCurrent())oldPaint++});const pending=c.navigate({screen:'slow'});await until(()=>entered,'session A action');f.fire('SIGNED_IN','B');await until(()=>f.snapshot().profile==='B','profile B ready');c.register('new',async({onCleanup})=>{newActive++;onCleanup(()=>newActive--)});await c.navigate({screen:'new'});
   if(id==='1B-AUTH-LATE-ERROR')profileA.reject(Error('late profile A failure'));else profileA.resolve({data:{id:'A',is_approved:true},error:null});action.resolve();await bounded(Promise.all([loginA,pending]),'old session completion');await drain();
   check(f.snapshot().user==='B'&&f.snapshot().profile==='B'&&c.state().sessionUserId==='B'&&c.state().screen==='new'&&oldCleanup===1&&oldActive===0&&newActive===1&&oldPaint===0&&!f.node('loginError').textContent,'AUTH_SWITCH_INVALIDATES_OLD_WORK',{app:f.snapshot(),state:c.state(),oldCleanup,oldActive,newActive,oldPaint,errors:f.errors,loginError:f.node('loginError').textContent});return;
  }
  await f.login('A');f.fire('SIGNED_IN','A');await drain();f.counts.getSession=0;let cleaned=0;c.register('stable',async()=>()=>cleaned++);await c.navigate({screen:'stable'});const before=c.state(),version=f.snapshot().authVersion;
  if(id==='1B-AUTH-LOGOUT-RELOGIN'){
   const release=deferred();let entered=false;c.register('leaving',async()=>async()=>{entered=true;await release.promise;cleaned++});await c.navigate({screen:'leaving'});
   f.fire('SIGNED_OUT',null);await until(()=>entered,'logout cleanup');await drain();f.fire('SIGNED_IN','A');await drain();release.resolve();await until(()=>f.snapshot().profile==='A','relogin A');await drain();
   check(f.snapshot().user==='A'&&f.snapshot().profile==='A'&&c.state().sessionUserId==='A'&&cleaned===2,'LOGOUT_RELOGIN_DURING_CLEANUP',{app:f.snapshot(),state:c.state(),cleaned,counts:f.counts});return;
  }
  if(id==='1B-T03'){f.fire('TOKEN_REFRESHED','A');await drain();f.fire('SIGNED_IN','A');await drain();check(c.state().sessionGeneration===before.sessionGeneration&&c.state().generation===before.generation&&f.snapshot().authVersion===version&&cleaned===0&&f.counts.getSession===0&&f.counts.profile===1,'REAL_AUTH_REFRESH_AND_REPEAT',{before,after:c.state(),version,afterVersion:f.snapshot().authVersion,cleaned,counts:f.counts});return}
  if(id==='1B-AUTH-LOGOUT'){f.fire('SIGNED_OUT',null);await drain();f.fire('SIGNED_OUT',null);await drain();await f.run('sessionCleanup');check(c.state().sessionUserId===null&&f.snapshot().user===null&&cleaned===1&&f.counts.leave===1,'REAL_AUTH_LOGOUT_ONCE',{state:c.state(),app:f.snapshot(),cleaned,counts:f.counts});return}
  if(id==='1B-AUTH-ORDER'){f.fire('SIGNED_IN','B');f.fire('SIGNED_OUT',null);await drain();check(f.snapshot().user===null&&c.state().sessionUserId===null&&cleaned===1&&f.counts.profile===1,'REAL_AUTH_DEFERRED_EVENT_ORDER',{state:c.state(),app:f.snapshot(),cleaned,counts:f.counts});return}
  if(id==='1B-AUTH-PASSKEY'){
   f.run('passkeySigninActive=true');f.fire('SIGNED_IN','candidate');await drain();check(c.state().sessionUserId==='A'&&cleaned===0,'UNVALIDATED_CANDIDATE_ISOLATED',{state:c.state(),cleaned});f.fire('SIGNED_OUT',null);await drain();check(c.state().sessionUserId===null&&cleaned===1&&f.counts.passkeyCancel===1,'PASSKEY_CANCEL_LOGOUT',{state:c.state(),cleaned,counts:f.counts});f.run('passkeySigninActive=false;passkeyUnvalidated=true');await f.run("authenticate({user:{id:'B'}})");assert.equal(f.snapshot().user,null);await f.run("authenticate({user:{id:'B'}},{verifiedPasskey:true})");check(f.snapshot().user==='B'&&c.state().sessionUserId==='B','VERIFIED_PASSKEY_STILL_ALLOWED',{state:c.state(),app:f.snapshot()});return;
  }
  throw Error('Unknown auth scenario '+id);
 }
 const f=environment(),c=f.ctl;await f.canvas();
 if(id==='1B-T04'||id==='1B-CANVAS-YES'||id==='1B-CANVAS-CLEAN'){
  const before=c.state(),selected=f.node('canvasTab').getAttribute('aria-selected');f.ctx.allowExit=id==='1B-CANVAS-YES';f.ctx.dirty=id!=='1B-CANVAS-CLEAN';const result=await bounded(f.run("$('conversationTab').onclick()"),'real tab click');const after=c.state(),detail={before,after,result,counts:f.counts,app:f.snapshot(),dirty:f.ctx.dirty,selected:f.node('canvasTab').getAttribute('aria-selected')};
  if(id==='1B-T04')check(result===false&&JSON.stringify(before)===JSON.stringify(after)&&f.snapshot().visible&&f.ctx.dirty&&f.counts.confirm===1&&f.counts.close===0&&f.counts.reset===0&&f.counts.aborts===0&&f.counts.canvasActive===1&&detail.selected===selected,'R4_REAL_CALLER_CANCEL',detail);
  else check(result===true&&after.screen==='conversation'&&after.conversationId==='c1'&&after.resourceId===null&&!after.canvas&&!f.snapshot().visible&&f.counts.close===1&&f.counts.confirm===(id==='1B-CANVAS-YES'?1:0),'REAL_CANVAS_EXIT_ALLOWED',detail);return;
 }
 if(id==='1B-CANVAS-PENDING'){
  const gate=deferred();let entered=false;f.ctx.chatCanvas.open=async()=>{entered=true;await gate.promise};f.ctx.dirty=false;
  const pending=c.navigate({screen:'canvas',conversationId:'c1'},{sourceMessage:{id:'source'}});await until(()=>entered,'pending canvas open');f.ctx.dirty=true;const before=c.state(),aborts=f.counts.aborts;
  const cancelled=await f.run("$('conversationTab').onclick()");gate.resolve();const completed=await bounded(pending,'retained canvas action');
  check(cancelled===false&&completed===true&&JSON.stringify(before)===JSON.stringify(c.state())&&f.counts.aborts===aborts&&f.counts.close===0&&f.counts.reset===0&&f.counts.confirm===1&&f.ctx.dirty&&f.snapshot().visible,'CANCEL_PRESERVES_PENDING_CANVAS_ACTION',{cancelled,completed,before,after:c.state(),counts:f.counts,app:f.snapshot()});return;
 }
 if(id==='1B-CANVAS-CALLERS'){
  const initial=JSON.stringify(c.state()),operations=["showConversationView()","openConversation({id:'c2'})","goConversation({id:'c2'})","window.PablicusController.getServices().openConversation({id:'c2'})","$('chatBack').onclick()"];
  const attempts=[];for(const expr of operations){const prompts=f.counts.confirm;await bounded(f.run(expr),'caller '+expr);attempts.push({expr,prompts:f.counts.confirm-prompts,state:c.state()});assert.equal(JSON.stringify(c.state()),initial)}
  for(const target of [{screen:'conversation',conversationId:'c1'},{section:'feed',screen:'home'},{section:'bots',screen:'bots'},{section:'bots',screen:'factory'},{section:'bots',screen:'scenario',resourceId:'b'}]){const prompts=f.counts.confirm;assert.equal(await c.navigate(target),false);attempts.push({target,prompts:f.counts.confirm-prompts,state:c.state()});assert.equal(JSON.stringify(c.state()),initial)}
  check(attempts.every(x=>x.prompts===1)&&f.counts.close===0&&f.counts.reset===0&&f.counts.aborts===0&&f.counts.canvasActive===1&&f.ctx.dirty,'RELATED_CALLERS_NO_BYPASS_OR_DOUBLE_PROMPT',{attempts,counts:f.counts});return;
 }
 if(id==='1B-CANVAS-ROUNDTRIP'){
  f.ctx.dirty=false;const states=[];for(const expr of ["$('conversationTab').onclick()","$('canvasTab').onclick()","$('conversationTab').onclick()"]){await bounded(f.run(expr),'roundtrip');states.push(c.state())}check(states.map(s=>s.screen).join()==='conversation,canvas,conversation'&&states.every(s=>s.conversationId==='c1'&&s.resourceId===null&&s.canvas===(s.screen==='canvas'))&&f.counts.confirm===0,'CANONICAL_CONVERSATION_CANVAS_ROUNDTRIP',{states,counts:f.counts});return;
 }
 if(id==='1B-CANVAS-HOME'){
  f.ctx.allowExit=true;await bounded(f.run("$('chatBack').onclick()"),'back with consent');check(c.state().screen==='home'&&c.state().conversationId===null&&f.snapshot().current===null&&f.counts.confirm===1&&f.counts.leave===1&&!f.snapshot().visible,'HOME_EXIT_SINGLE_CONSENT',{state:c.state(),app:f.snapshot(),counts:f.counts});return;
 }
 throw Error('UNKNOWN_SCENARIO: '+id);
}
(async()=>{try{await runCase();await drain();check(unhandled.length===0,'NO_UNHANDLED_REJECTION',{unhandled});console.log(JSON.stringify({test:id,status:'PASS',...evidence}));process.exitCode=0}catch(error){const status=error?.code==='ERR_ASSERTION'?'FAIL':'ERROR';console.log(JSON.stringify({test:id,status,reason:error?.message||String(error),stack:error?.stack,...evidence,unhandled}));process.exitCode=1}})();
