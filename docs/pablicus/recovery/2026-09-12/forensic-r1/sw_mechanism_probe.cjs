// Executes unchanged worker source with an in-memory Cache/Fetch boundary.
// No network, browser settings, repository files or real user storage are touched.
const fs=require('fs'),vm=require('vm'),cp=require('child_process'),crypto=require('crypto');
const root=process.cwd(),scope='https://fixture.invalid/pablicus/';
const source=ref=>cp.execFileSync('git',['show',ref+':pablicus/sw.js'],{encoding:'utf8'});
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
function worker(src){
 const listeners={},stores=new Map();let served='old',requests=0,changeAt=Infinity,claims=0;
 const caches={async open(name){if(!stores.has(name))stores.set(name,new Map());const m=stores.get(name);return {async match(req){return m.get(typeof req==='string'?req:req.url)},async put(req,r){m.set(typeof req==='string'?req:req.url,r)}}},async keys(){return [...stores.keys()]},async delete(k){return stores.delete(k)}};
 const fetch=async req=>({ok:true,generation:++requests>=changeAt?'new':served,url:typeof req==='string'?req:req.url});
 const self={registration:{scope},addEventListener(name,cb){(listeners[name]??=[]).push(cb)},clients:{async claim(){claims++}},skipWaiting(){}};
 const ctx=vm.createContext({self,caches,fetch,URL,Request,Promise,console});vm.runInContext(src,ctx);
 async function event(name,rest={}){const waits=[];let response;for(const cb of listeners[name]||[])cb({...rest,waitUntil(p){waits.push(p)},respondWith(p){response=p}});await Promise.all(waits);return response?await response:null}
 return {event,stores,set(v,at=Infinity){served=v;changeAt=at},get claims(){return claims},cacheName:vm.runInContext('VERSION',ctx),urls:vm.runInContext('urls',ctx),network:fetch};
}
(async()=>{
 const result={scope:'Algorithm reproduction with real unchanged worker sources; NOT observation of owner device cache',checks:[]};
 const w=worker(source('f348ace'));await w.event('install');w.set('new');
 const nav={url:scope+'?conversation=fixture',method:'GET'},app={url:scope+'app.js',method:'GET'},newShell={url:scope+'app-shell.js',method:'GET'};
 const interceptedNav=await w.event('fetch',{request:nav}),navResponse=interceptedNav||await w.network(nav),appResponse=await w.event('fetch',{request:app}),shellResponse=(await w.event('fetch',{request:newShell}))||await w.network(newShell);
 result.checks.push({id:'PWA-QUERY-MIX',status:navResponse.generation==='new'&&appResponse.generation==='old'&&shellResponse.generation==='new'?'REPRODUCED':'NOT_REPRODUCED',html:navResponse,app:appResponse,newShell:shellResponse,html_intercepted:!!interceptedNav});
 const race=worker(source('883003e'));race.set('old',8);await race.event('install');const generations=[...new Set([...race.stores.get(race.cacheName).values()].map(x=>x.generation))];
 result.checks.push({id:'PWA-INSTALL-NO-REVISION-BINDING',status:generations.length===2?'REPRODUCED':'NOT_REPRODUCED',cache:race.cacheName,generations});
 const hashes=Object.fromEntries(['f5eec61','ccfdd90','f146055','c5e26c2','883003e'].map(ref=>[ref,sha(source(ref))]));
 result.checks.push({id:'PWA-UNCHANGED-WORKER-AFTER-RUNTIME-CHANGES',status:new Set(Object.values(hashes)).size===1?'CONFIRMED':'NOT_CONFIRMED',hashes});
 await race.stores.set('pablicus-shell-old',new Map());await race.event('activate');result.checks.push({id:'PWA-ACTIVATION-CLAIMS-CLIENTS-AND-DELETES-OLD',status:race.claims===1&&!race.stores.has('pablicus-shell-old')?'CONFIRMED':'NOT_CONFIRMED',claims:race.claims});
 fs.writeFileSync('../iphone_correction/PWA_MECHANISM_PROOF.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
})();
