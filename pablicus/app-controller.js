(function(root){'use strict';
 const state={section:'chats',screen:'home',resourceId:null,conversationId:null,canvas:false,generation:0,sessionGeneration:0};
 const handlers=new Map(),subs=new Set();let currentDispose=null,services=null,disposed=false;
 const labels={chats:'Чаты',feed:'Лента',tasks:'Дела',bots:'Боты',profile:'Профиль'};
 const clone=()=>({...state});
 function project(){
  const nav=document.getElementById('mainNav');if(nav)for(const b of nav.querySelectorAll('button[data-page]'))b.classList.toggle('selected',b.dataset.page===state.section);
  const label=state.screen==='factory'?'Фабрика':state.screen==='scenario'?'Сценарий':labels[state.section]||'Public';
  const brand=document.getElementById('brandTitle'),section=document.getElementById('sectionTitle');if(brand)brand.textContent=label;if(section){section.textContent=label;section.hidden=state.screen==='home'&&state.section==='chats'}
 }
 function emit(){project();const s=clone();for(const fn of [...subs])fn(s)}
 function setServices(value){services=value}
 function getServices(){return services}
 function register(name,handler){handlers.set(name,handler);return()=>handlers.delete(name)}
 async function navigate(next){
  if(disposed)return false;const previous=clone(),target={...state,...next,generation:state.generation+1};if(target.screen==='home'){if(!Object.prototype.hasOwnProperty.call(next,'resourceId'))target.resourceId=null;if(!Object.prototype.hasOwnProperty.call(next,'conversationId'))target.conversationId=null;target.canvas=false}else if(['bots','factory'].includes(target.screen)){target.resourceId=null;target.conversationId=null;target.canvas=false}else if(['conversation','canvas'].includes(target.screen)){target.resourceId=null;target.canvas=target.screen==='canvas'};
  const key=target.screen||target.section,handler=handlers.get(key)||handlers.get(target.section),token=target.generation;
  if(currentDispose){const dispose=currentDispose;currentDispose=null;await dispose()}
  Object.assign(state,target);emit();if(!handler)return true;
  const ctx={state:clone(),previous,services,isCurrent:()=>!disposed&&state.generation===token&&state.sessionGeneration===target.sessionGeneration&&(!target.resourceId||state.resourceId===target.resourceId)&&(!target.conversationId||state.conversationId===target.conversationId)};
  const result=await handler(ctx);if(!ctx.isCurrent()){try{await result?.dispose?.()}catch{}return false}
  currentDispose=typeof result==='function'?result:result?.dispose||null;return true;
 }
 function sessionChanged(){state.sessionGeneration++;state.generation++;emit()}
 function subscribe(fn){subs.add(fn);fn(clone());return()=>subs.delete(fn)}
 async function dispose(){if(disposed)return;disposed=true;if(currentDispose)await currentDispose();currentDispose=null;handlers.clear();subs.clear()}
 root.PablicusController={state:clone,navigate,register,subscribe,setServices,getServices,sessionChanged,dispose};
})(window);
