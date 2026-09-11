(function(root){
 'use strict';

 const state={section:'chats',screen:'home',resourceId:null,conversationId:null,canvas:false,generation:0,sessionGeneration:0,sessionUserId:null};
 const handlers=new Map(),subs=new Set();
 const labels={chats:'Чаты',feed:'Лента',tasks:'Дела',bots:'Боты',profile:'Профиль'};
 let services=null,disposed=false,requestSerial=0,latestRequest=0,activeTransition=null,currentScope=null,releasePromise=null,sessionLookupSerial=0;
 const clone=()=>({...state});

 function reportError(error){try{if(typeof services?.reportError==='function')services.reportError(error);else console.error('[PablicusController]',error)}catch{}}
 function normalizeCleanup(resource){if(typeof resource==='function')return resource;if(resource&&typeof resource.dispose==='function')return()=>resource.dispose.call(resource);return null}
 function createScope(){
  let closed=false,disposePromise=null;const cleanups=[];
  async function run(resource){const fn=normalizeCleanup(resource);if(!fn)return;try{await fn()}catch(error){reportError(error)}}
  function add(resource){const fn=normalizeCleanup(resource);if(!fn)return null;if(closed)return run(fn);cleanups.push(fn);return null}
  function dispose(){if(disposePromise)return disposePromise;closed=true;const owned=cleanups.splice(0).reverse();disposePromise=(async()=>{for(const fn of owned)await run(fn)})();return disposePromise}
  return{add,dispose,get closed(){return closed}};
 }
 function project(){const nav=document.getElementById('mainNav');if(nav)for(const button of nav.querySelectorAll('button[data-page]'))button.classList.toggle('selected',button.dataset.page===state.section);const label=state.screen==='factory'?'Фабрика':state.screen==='scenario'?'Сценарий':labels[state.section]||'Public';const brand=document.getElementById('brandTitle'),section=document.getElementById('sectionTitle');if(brand)brand.textContent=label;if(section){section.textContent=label;section.hidden=state.screen==='home'&&state.section==='chats'}}
 function emit(){project();const snapshot=clone();for(const fn of [...subs]){try{fn(snapshot)}catch(error){reportError(error)}}}
 function setServices(value){services=value}
 function getServices(){return services}
 function register(name,handler){handlers.set(name,handler);return()=>{if(handlers.get(name)===handler)handlers.delete(name)}}
 function normalizeTarget(next){const target={...state,...next,generation:state.generation+1};if(target.screen==='home'){if(!Object.prototype.hasOwnProperty.call(next,'resourceId'))target.resourceId=null;if(!Object.prototype.hasOwnProperty.call(next,'conversationId'))target.conversationId=null;target.canvas=false}else if(['bots','factory'].includes(target.screen)){target.resourceId=null;target.conversationId=null;target.canvas=false}else if(['conversation','canvas'].includes(target.screen)){target.resourceId=null;target.canvas=target.screen==='canvas'}return target}
 function releaseCurrentScope(){if(currentScope){const owned=currentScope;currentScope=null;const pending=Promise.resolve(owned.dispose()),tracked=pending.finally(()=>{if(releasePromise===tracked)releasePromise=null});releasePromise=tracked;return tracked}return releasePromise||Promise.resolve()}
 function transitionIsCurrent(transition,target){return !disposed&&latestRequest===transition.id&&!transition.abort.signal.aborted&&state.sessionGeneration===transition.sessionGeneration&&(!target.resourceId||state.resourceId===target.resourceId)&&(!target.conversationId||state.conversationId===target.conversationId)}

 async function navigate(next,params={}){
  if(disposed)return false;
  const previous=clone(),target=normalizeTarget(next);
  // Consent is synchronous and precedes request publication, abort and cleanup.
  if(typeof services?.beforeNavigate==='function'){
   const allowed=services.beforeNavigate({previous,target,params});
   if(allowed&&typeof allowed.then==='function')throw TypeError('beforeNavigate must be synchronous');
   if(allowed===false)return false;
  }
  const requestId=++requestSerial;latestRequest=requestId;const transition={id:requestId,abort:new AbortController(),scope:createScope(),sessionGeneration:state.sessionGeneration};
  if(activeTransition&&activeTransition!==transition){activeTransition.abort.abort();void activeTransition.scope.dispose()}activeTransition=transition;
  await releaseCurrentScope();
  if(disposed||latestRequest!==requestId||transition.abort.signal.aborted||state.sessionGeneration!==transition.sessionGeneration){await transition.scope.dispose();if(activeTransition===transition)activeTransition=null;return false}
  Object.assign(state,target,{generation:state.generation+1});currentScope=transition.scope;emit();
  const key=target.screen||target.section,handler=handlers.get(key)||handlers.get(target.section);if(!handler){if(activeTransition===transition)activeTransition=null;return true}
  const ctx={state:clone(),previous,services,params,signal:transition.abort.signal,onCleanup:transition.scope.add,isCurrent:()=>transitionIsCurrent(transition,target)};
  try{const result=await handler(ctx),lateCleanup=transition.scope.add(result);if(lateCleanup)await lateCleanup;if(!ctx.isCurrent()){await transition.scope.dispose();if(currentScope===transition.scope)currentScope=null;if(activeTransition===transition)activeTransition=null;return false}if(activeTransition===transition)activeTransition=null;return true}
  catch(error){const stale=!ctx.isCurrent();await transition.scope.dispose();if(currentScope===transition.scope)currentScope=null;if(activeTransition===transition)activeTransition=null;if(stale){reportError(error);return false}throw error}
 }

 function applySessionIdentity(userId){
  const normalized=userId||null;if(state.sessionUserId===normalized)return (releasePromise||Promise.resolve()).then(()=>false);
  state.sessionUserId=normalized;state.sessionGeneration++;state.generation++;latestRequest=++requestSerial;
  if(activeTransition){activeTransition.abort.abort();void activeTransition.scope.dispose();activeTransition=null}
  emit();return releaseCurrentScope().then(()=>true);
 }
 function sessionChanged(userId){
  const lookup=++sessionLookupSerial;
  if(disposed)return Promise.resolve(false);
  // An explicit SDK identity invalidates all earlier asynchronous lookups.
  if(arguments.length)return applySessionIdentity(userId);
  const getSession=services?.getSession;if(typeof getSession!=='function')return Promise.resolve(false);
  return Promise.resolve().then(()=>getSession()).then(result=>{
   if(disposed||lookup!==sessionLookupSerial)return false;
   if(result?.error){reportError(result.error);return false}
   if(!result?.data||!Object.prototype.hasOwnProperty.call(result.data,'session')){reportError(Error('Invalid session response'));return false}
   return applySessionIdentity(result.data.session?.user?.id||null);
  },error=>{reportError(error);return false});
 }
 function subscribe(fn){subs.add(fn);fn(clone());return()=>subs.delete(fn)}
 async function dispose(){if(disposed)return;disposed=true;sessionLookupSerial++;latestRequest=++requestSerial;if(activeTransition){activeTransition.abort.abort();await activeTransition.scope.dispose();activeTransition=null}await releaseCurrentScope();handlers.clear();subs.clear()}
 root.PablicusController={state:clone,navigate,register,subscribe,setServices,getServices,sessionChanged,dispose};
})(window);
