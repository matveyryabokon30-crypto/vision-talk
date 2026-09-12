/* Passive resource accounting and explicit native IndexedDB fault boundary.
 * Original browser primitives execute normally unless a named one-shot fault is
 * armed by the scenario. This script never supplies a saved draft or PASS value.
 */
(() => {
 'use strict';
 const native={add:EventTarget.prototype.addEventListener,remove:EventTarget.prototype.removeEventListener,
  setTimeout:setTimeout.bind(window),clearTimeout:clearTimeout.bind(window),
  setInterval:setInterval.bind(window),clearInterval:clearInterval.bind(window),
  raf:requestAnimationFrame.bind(window),caf:cancelAnimationFrame.bind(window),
  MutationObserver,ResizeObserver,IntersectionObserver,transaction:IDBDatabase.prototype.transaction};
 const timers=new Map(),frames=new Map(),listeners=[],targets=new WeakMap(),observers=[];
 const errors=[],idbEvents=[],quiet=new Map();let serial=0;
 function source(){return(new Error().stack||'').split('\n').find(x=>/\/pablicus\//.test(x))?.trim()||'browser-or-test'}
 const ref=x=>new WeakRef(x);
 const counts=xs=>xs.reduce((out,x)=>{out[x]=(out[x]||0)+1;return out},{});
 function removeRecord(r){r.active=false;const target=r.target.deref();const entries=target&&targets.get(target);if(entries)entries.delete(r.key)}
 EventTarget.prototype.addEventListener=function(type,callback,options){
  if(callback==null)return native.add.call(this,type,callback,options);
  const capture=typeof options==='boolean'?options:!!options?.capture;
  let entries=targets.get(this);if(!entries){entries=new Map();targets.set(this,entries)}
  for(const r of entries.values())if(r.active&&r.type===type&&r.capture===capture&&r.callback.deref()===callback)return;
  if(options?.signal?.aborted)return native.add.call(this,type,callback,options);
  const r={key:++serial,target:ref(this),callback:ref(callback),type,capture,active:true,source:source()};
  const wrapped=function(event){if(options?.once)removeRecord(r);return typeof callback==='function'?callback.call(this,event):callback.handleEvent.call(callback,event)};
  r.wrapped=ref(wrapped);entries.set(r.key,r);listeners.push(r);
  if(options?.signal)native.add.call(options.signal,'abort',()=>removeRecord(r),{once:true});
  return native.add.call(this,type,wrapped,options);
 };
 EventTarget.prototype.removeEventListener=function(type,callback,options){
  const capture=typeof options==='boolean'?options:!!options?.capture,entries=targets.get(this);
  if(entries)for(const r of entries.values())if(r.active&&r.type===type&&r.capture===capture&&r.callback.deref()===callback){const wrapped=r.wrapped.deref();removeRecord(r);return native.remove.call(this,type,wrapped,options)}
  return native.remove.call(this,type,callback,options);
 };
 window.setTimeout=function(fn,delay,...args){const from=source();let id;id=native.setTimeout(function(...values){timers.delete(id);return typeof fn==='function'?fn.apply(this,values):(0,eval)(String(fn))},delay,...args);timers.set(id,{kind:'timeout',source:from});return id};
 window.clearTimeout=function(id){timers.delete(id);return native.clearTimeout(id)};
 window.setInterval=function(fn,delay,...args){const id=native.setInterval(fn,delay,...args);timers.set(id,{kind:'interval',source:source()});return id};
 window.clearInterval=function(id){timers.delete(id);return native.clearInterval(id)};
 window.requestAnimationFrame=function(fn){let id;id=native.raf(function(t){frames.delete(id);return fn.call(this,t)});frames.set(id,source());return id};
 window.cancelAnimationFrame=function(id){frames.delete(id);return native.caf(id)};
 for(const name of ['MutationObserver','ResizeObserver','IntersectionObserver']){
  const Original=native[name];if(!Original)continue;
  window[name]=class extends Original{
   constructor(callback){const r={kind:name,targets:[],calls:0,source:source()};super((...args)=>{r.calls++;return callback(...args)});r.observer=ref(this);this.__integrationRecord=r;observers.push(r)}
   observe(target,...args){const r=this.__integrationRecord;if(!r.targets.some(x=>x.deref()===target))r.targets.push(ref(target));return super.observe(target,...args)}
   unobserve(target){const r=this.__integrationRecord;r.targets=r.targets.filter(x=>x.deref()!==target);return super.unobserve(target)}
   disconnect(){this.__integrationRecord.targets=[];return super.disconnect()}
  };
 }
 native.add.call(window,'error',e=>errors.push({kind:'error',message:e.message}),false);
 native.add.call(window,'unhandledrejection',e=>errors.push({kind:'unhandledrejection',message:String(e.reason?.message||e.reason)}),false);
 const controllerStats={subscriptions:0,handlers:new Set(),navigations:[]};let controller;
 Object.defineProperty(window,'PablicusController',{configurable:true,get(){return controller},set(value){
  controller=value;const subscribe=value.subscribe,register=value.register,navigate=value.navigate;
  value.subscribe=function(...args){const dispose=subscribe.apply(this,args);controllerStats.subscriptions++;let closed=false;return()=>{if(!closed){closed=true;controllerStats.subscriptions--;return dispose()}}};
  value.register=function(name,...args){const dispose=register.call(this,name,...args);controllerStats.handlers.add(name);return()=>{controllerStats.handlers.delete(name);return dispose()}};
  value.navigate=function(...args){const e={target:{...args[0]},started:performance.now(),status:'pending'};controllerStats.navigations.push(e);return navigate.apply(this,args).then(v=>{e.status='fulfilled';e.result=v;e.finished=performance.now();return v},error=>{e.status='rejected';e.error=String(error?.message||error);e.finished=performance.now();throw error})};
 }});
 let fault=null,hold=null;
 IDBDatabase.prototype.transaction=function(stores,mode,...args){
  const names=typeof stores==='string'?[stores]:Array.from(stores),f=fault;
  if(f&&(!f.database||f.database===this.name)&&(!f.mode||f.mode===mode)&&(!f.store||names.includes(f.store))){
   fault=null;idbEvents.push({kind:'native-transaction-refusal',database:this.name,stores:names,mode,name:f.name});throw new DOMException('INTEGRATION_NATIVE_'+f.name,f.name);
  }
  const tx=native.transaction.call(this,stores,mode,...args);
  const h=hold;
  if(h&&!h.used&&(!h.database||h.database===this.name)&&mode==='readwrite'&&names.includes(h.store||'drafts')){
   h.used=true;h.entered=true;h.tx=ref(tx);idbEvents.push({kind:'native-transaction-held',database:this.name,stores:names,mode});
   const deadline=performance.now()+10000;
   const keepAlive=()=>{if(h.released)return;if(performance.now()>deadline){h.timedOut=true;h.released=true;tx.abort();return}const r=tx.objectStore(names[0]).get('__integration_keepalive_nonexistent__');native.add.call(r,'success',keepAlive,{once:true})};keepAlive();
  }
  return tx;
 };
 function snapshot(){
  const live=listeners.filter(r=>r.active&&r.target.deref()&&r.callback.deref());
  const active=observers.filter(r=>r.observer.deref()&&r.targets.some(t=>t.deref()));
  return {listeners:live.length,listener_sources:counts(live.map(r=>r.source+' | '+r.type)),
   detached_listeners:live.filter(r=>{const t=r.target.deref();return t instanceof Node&&!t.isConnected}).length,
   observers:counts(active.map(r=>r.kind)),observer_sources:counts(active.map(r=>r.kind+' | '+r.source)),
   timers:counts([...timers.values()].map(r=>r.kind)),timer_sources:counts([...timers.values()].map(r=>r.kind+' | '+r.source)),
   frames:frames.size,controller:{subscriptions:controllerStats.subscriptions,handlers:[...controllerStats.handlers].sort()},
   channels:controller?.getServices()?.client?.getChannels().map(c=>({topic:c.topic,state:c.state})).sort((a,b)=>a.topic.localeCompare(b.topic))||[],
   list:window.PablicusChat?.snapshot?.counters||null,media:window.PablicusChat?.snapshot?.resources||null,
   errors:[...errors]};
 }
 window.__integration={snapshot,errors,idbEvents,controllerStats,
  delay:ms=>new Promise(r=>native.setTimeout(r,ms)),
  armFault:spec=>{fault={name:'AbortError',...spec}},
  holdWrite:spec=>{hold={used:false,entered:false,released:false,...spec};return true},
  held:()=>hold?{used:hold.used,entered:hold.entered,released:hold.released,timedOut:!!hold.timedOut}:null,
  releaseWrite:()=>{if(hold)hold.released=true},
  observeQuiet(name,selector){quiet.get(name)?.observer.disconnect();const target=document.querySelector(selector);if(!target)throw Error('QUIET_TARGET_MISSING '+selector);const r={records:0,callbacks:0,target:ref(target)};r.observer=new native.MutationObserver(records=>{r.records+=records.length;r.callbacks++});r.observer.observe(target,{childList:true,subtree:true,characterData:true});quiet.set(name,r)},
  quiet:name=>{const r=quiet.get(name);return r?{records:r.records,callbacks:r.callbacks,connected:!!r.target.deref()?.isConnected}:null},
  stopQuiet:name=>{quiet.get(name)?.observer.disconnect();quiet.delete(name)}
 };
})();
