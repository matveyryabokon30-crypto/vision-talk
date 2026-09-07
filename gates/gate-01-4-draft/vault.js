/* Gate 01.4 — transactional local drafts. No network, accounts or delivery. */
(() => {
'use strict';
const uid=()=>crypto.randomUUID?crypto.randomUUID():Array.from(crypto.getRandomValues(new Uint32Array(4)),n=>n.toString(16).padStart(8,'0')).join('');
const err=(name,message)=>Object.assign(new Error(message),{name});
const key='draft';
class DraftStore {
 constructor(name='vision-talk-gate-014-v1'){this.name=name;this.db=null;this.pendingOpen=null;this.fault=null;this.stats={commits:0,blob_puts:0,blob_deletes:0,aborts:0,conflicts:0,durability:null};}
 async open(){
  if(this.db)return this.db;
  if(this.pendingOpen)return this.pendingOpen;
  this.pendingOpen=new Promise((resolve,reject)=>{
   let request,done=false;
   const finish=(e,db)=>{if(done){db?.close();return}done=true;clearTimeout(timer);if(e)reject(e);else{this.db=db;db.onversionchange=()=>{db.close();this.db=null};db.onclose=()=>{this.db=null};resolve(db)}};
   const timer=setTimeout(()=>finish(err('TimeoutError','Открытие локального хранилища не завершилось')),12000);
   try{request=indexedDB.open(this.name,1)}catch(e){finish(e);return}
   request.onupgradeneeded=()=>{const d=request.result;for(const n of ['drafts','assets','proofs'])if(!d.objectStoreNames.contains(n))d.createObjectStore(n,{keyPath:'id'})};
   request.onerror=()=>finish(request.error);request.onblocked=()=>finish(err('BlockedError','Хранилище занято другой вкладкой'));
   request.onsuccess=()=>finish(null,request.result);
  });
  try{return await this.pendingOpen}finally{this.pendingOpen=null}
 }
 async transaction(stores,mode,body){
  const db=await this.open();
  return new Promise((resolve,reject)=>{
   let tx,result,failure,done=false;
   try{tx=db.transaction(stores,mode,mode==='readwrite'?{durability:'strict'}:{});}catch(e){if(e.name!=='TypeError'){reject(e);return}tx=db.transaction(stores,mode)}
   if(mode==='readwrite')this.stats.durability=tx.durability||'browser-default';
   const timer=setTimeout(()=>{failure=err('TimeoutError','Операция сохранения не завершилась');try{tx.abort()}catch{};finish(failure)},15000);
   const finish=e=>{if(done)return;done=true;clearTimeout(timer);e?reject(e):resolve(result)};
   tx.oncomplete=()=>finish();tx.onabort=()=>{this.stats.aborts++;finish(failure||tx.error||err('AbortError','Транзакция отменена'))};
   const fail=e=>{failure=e;try{tx.abort()}catch{finish(e)}};
   try{body(tx,v=>{result=v},fail)}catch(e){fail(e)}
  });
 }
 async read(){
  return this.transaction(['drafts','assets'],'readonly',(tx,done,fail)=>{
   const r=tx.objectStore('drafts').get(key);r.onsuccess=()=>{
    const doc=r.result;if(!doc){done(null);return}
    if(doc.schema!==1||!Array.isArray(doc.files)||typeof doc.text!=='string'){fail(err('DataError','Формат черновика не распознан'));return}
    const files=[];done({...doc,files});
    for(const meta of doc.files){
     const q=tx.objectStore('assets').get(meta.id);
     q.onsuccess=()=>{const row=q.result;if(!row||!(row.blob instanceof Blob)||row.blob.size!==meta.size){fail(err('DataError','Данные вложения отсутствуют или неполны'));return}files.push({...meta,file:new File([row.blob],meta.name,{type:meta.type,lastModified:meta.lastModified})});files.sort((a,b)=>doc.files.findIndex(m=>m.id===a.id)-doc.files.findIndex(m=>m.id===b.id))};
    }
   };
  });
 }
 async write(snapshot,expected){
  if(!snapshot||typeof snapshot.text!=='string'||!Array.isArray(snapshot.files))throw err('DataError','Некорректный снимок');
  const ids=new Set();for(const f of snapshot.files){if(ids.has(f.id)||!(f.file instanceof Blob)||f.file.size!==f.size)throw err('DataError','Некорректные данные файла');ids.add(f.id)}
  const fault=this.fault;this.fault=null;
  const added=[],removed=[];
  const result=await this.transaction(['drafts','assets'],'readwrite',(tx,done,fail)=>{
   const ds=tx.objectStore('drafts'),as=tx.objectStore('assets'),r=ds.get(key);
   r.onsuccess=()=>{
    const old=r.result,rev=old?.revision||0;
    if(rev!==expected){this.stats.conflicts++;fail(err('ConflictError','Черновик изменён в другой вкладке'));return}
    if(fault==='quota'){fail(err('QuotaExceededError','Тестовый отказ: превышена квота'));return}
    if(fault==='denied'){fail(err('NotAllowedError','Тестовый отказ доступа'));return}
    const prior=new Set((old?.files||[]).map(f=>f.id));
    const files=snapshot.files.map(({file,...m})=>m);
    for(const f of snapshot.files)if(!prior.has(f.id)){as.put({id:f.id,blob:f.file});added.push(f.id)}
    for(const id of prior)if(!ids.has(id)){as.delete(id);removed.push(id)}
    const record={id:key,schema:1,revision:rev+1,savedAt:new Date().toISOString(),text:snapshot.text,selection:snapshot.selection||{start:0,end:0},expanded:!!snapshot.expanded,files};
    ds.put(record);
    if(fault==='abort'){fail(err('AbortError','Тестовый откат транзакции'));return}
    done({revision:record.revision,savedAt:record.savedAt,added:added.length,removed:removed.length});
   };
  });
  this.stats.commits++;this.stats.blob_puts+=added.length;this.stats.blob_deletes+=removed.length;return result;
 }
 async proof(value){return this.transaction(['proofs'],value?'readwrite':'readonly',(tx,done)=>{const s=tx.objectStore('proofs');if(value)s.put({id:key,...value});else {const q=s.get(key);q.onsuccess=()=>done(q.result||null)}})}
 async revision(){return this.transaction(['drafts'],'readonly',(tx,done)=>{const q=tx.objectStore('drafts').get(key);q.onsuccess=()=>done(q.result?.revision||0)})}
 async counts(){return this.transaction(['drafts','assets'],'readonly',(tx,done)=>{const v={drafts:0,assets:0};done(v);for(const n of ['drafts','assets']){const q=tx.objectStore(n).count();q.onsuccess=()=>v[n]=q.result}})}
 close(){this.db?.close();this.db=null}
 async destroy(){this.close();return new Promise((resolve,reject)=>{const q=indexedDB.deleteDatabase(this.name);q.onsuccess=()=>resolve();q.onerror=()=>reject(q.error);q.onblocked=()=>reject(err('BlockedError','Тестовая база занята'))})}
}
const signature=s=>JSON.stringify({text:s.text,selection:s.selection,expanded:s.expanded,files:s.files.map(({file,...m})=>m)});
async function digest(blob){const bytes=await blob.arrayBuffer();const v=await crypto.subtle.digest('SHA-256',bytes);return Array.from(new Uint8Array(v),n=>n.toString(16).padStart(2,'0')).join('')}
async function fingerprint(s){return {text:await digest(new Blob([s.text])),selection:s.selection,expanded:s.expanded,files:await Promise.all(s.files.map(async f=>({id:f.id,size:f.size,type:f.type,name:f.name,lastModified:f.lastModified,hash:await digest(f.file)})))}}
const empty=()=>({text:'',selection:{start:0,end:0,direction:'none'},expanded:false,files:[]});
class Controller {
 constructor(adapter){this.a=adapter;this.store=new DraftStore();this.ready=false;this.restoring=true;this.rev=0;this.pending=null;this.flight=null;this.timer=0;this.firstDirty=0;this.lastSignature='';this.state='loading';this.error=null;this.restored=0;this.reloadCheck=null;this.audit=null;this.info={persistent:null,quota:null,usage:null};this.history=[];this.changeCount=0;this.failures=0;this.bootId=uid();}
 set(state,e=null){this.state=state;this.error=e?{name:e.name,message:e.message}:null;this.history.push({state,error:e?.name||null,at:new Date().toISOString()});this.history=this.history.slice(-20);this.a.paint(this.public())}
 public(){return {state:this.state,error:this.error,revision:this.rev,restored_files:this.restored,changes:this.changeCount,failures:this.failures,pending:!!this.pending,transaction_active:!!this.flight,storage:{...this.info},database_stats:{...this.store.stats},reload_check:this.reloadCheck,audit:this.audit,events:this.history.slice(),scope:'THIS_ORIGIN_THIS_BROWSER_ONLY',background_save_guaranteed:false}}
 async init(){
  this.a.lock(true);
  try{
   const record=await this.store.read();this.rev=record?.revision||0;
   if(record){await this.a.restore(record);this.restored=record.files.length}
   this.lastSignature=signature(this.a.capture());this.restoring=false;this.ready=true;
   this.set(record?'restored':'empty');
   const proof=await this.store.proof();
   if(proof&&proof.bootId!==this.bootId&&proof.revision===this.rev){const now=await fingerprint(this.a.capture());const match=JSON.stringify(now)===JSON.stringify(proof.value);this.reloadCheck={pass:match,files:now.files.length,revision:this.rev,kind:'ACTUAL_NEW_PAGE_INSTANCE',checkedAt:new Date().toISOString()};this.set(match?'restored':'error',match?null:err('DataError','Проверка восстановленных байтов не пройдена'));}
  }catch(e){this.restoring=false;this.ready=false;this.set('load-error',e)}finally{this.a.lock(false)}
  this.updateInfo();
 }
 async updateInfo(){try{const n=navigator.storage;this.info.persistent=n?.persisted?await n.persisted():null;const est=n?.estimate?await n.estimate():{};this.info.quota=est.quota??null;this.info.usage=est.usage??null;this.a.paint(this.public())}catch{}}
 changed(){
  if(this.restoring||!this.ready)return;
  const s=this.a.capture(),sig=signature(s);
  if(sig===this.lastSignature)return;
  this.lastSignature=sig;this.pending={snapshot:s,signature:sig};this.changeCount++;
  if(this.state==='conflict')return;
  this.set('dirty');if(!this.firstDirty)this.firstDirty=Date.now();clearTimeout(this.timer);
  this.timer=setTimeout(()=>{this.flush().catch(()=>{})},Math.min(250,Math.max(0,1000-(Date.now()-this.firstDirty))));
 }
 async flush(){
  clearTimeout(this.timer);this.firstDirty=0;
  if(!this.ready)throw err('NotAllowedError','Сначала восстановите доступ к хранилищу');
  if(this.state==='conflict')throw err('ConflictError','Сохранение остановлено: другая вкладка');
  if(this.pump){await this.pump;if(this.pending)return this.flush();return}
  if(!this.pending)return;
  this.pump=this.drain();
  try{await this.pump}finally{this.pump=null}
 }
 async drain(){
  while(this.pending){
   const job=this.pending;this.pending=null;this.set('saving');this.flight=this.store.write(job.snapshot,this.rev);
   try{const r=await this.flight;this.rev=r.revision;this.flight=null}
   catch(e){this.flight=null;if(!this.pending)this.pending=job;this.failures++;this.set(e.name==='ConflictError'?'conflict':'error',e);throw e}
  }
  this.set('saved');
 }
 async reload(){
  this.changed();await this.flush();
  if(!this.rev){this.pending={snapshot:this.a.capture()};await this.flush()}
  this.a.lock(true);
  try{const revision=this.rev,current=this.a.capture();const fp=await fingerprint(current);await this.store.proof({bootId:this.bootId,revision,value:fp});if(revision!==this.rev||this.pending)throw err('DataError','Черновик изменился во время проверки');location.reload()}
  finally{this.a.lock(false)}
 }
 async verify(){
  this.changed();await this.flush();const revision=this.rev,live=this.a.capture();const stored=await this.store.read();
  if(!stored)throw err('DataError','Сохранённый черновик отсутствует');
  const a=await fingerprint(live),b=await fingerprint(stored);
  if(this.rev!==revision||this.pending)throw err('DataError','Черновик изменился во время проверки');
  this.audit={pass:JSON.stringify(a)===JSON.stringify(b),files:a.files.length,total_bytes:live.files.reduce((n,f)=>n+f.size,0),text_equal:a.text===b.text,revision,checkedAt:new Date().toISOString()};this.a.paint(this.public());return this.audit;
 }
 async retry(){if(!this.ready){return this.init()}if(this.state==='conflict')return;this.pending=this.pending||{snapshot:this.a.capture()};await this.flush()}
 async requestPersistent(){try{this.info.persistent=navigator.storage?.persist?await navigator.storage.persist():null;this.a.paint(this.public());return this.info.persistent}catch(e){this.set('error',e)}}
 async checkOtherTab(){if(!this.ready||this.flight||this.restoring)return;try{const r=await this.store.revision();if(r!==this.rev)this.set('conflict',err('ConflictError','Черновик изменён в другой вкладке. Текущий текст не стёрт.'))}catch{}}
 async loadSaved(){if(this.flight)await this.flight;clearTimeout(this.timer);this.pending=null;this.ready=false;return this.init()}
}
async function tests(){
 const results=[],check=(name,pass,measured)=>results.push({name,pass:!!pass,measured});
 const s=new DraftStore('vision-g014-test-'+uid()),text='Точный черновик\n\n🙂 👨‍👩‍👧‍👦 e\u0301 — العربية\n'+('Длинный текст '.repeat(250));
 const files=[{id:'one',name:'photo.jpg',type:'image/jpeg',kind:'image',lastModified:123,file:new File([new Uint8Array([255,216,1,2,3,255,217])],'photo.jpg',{type:'image/jpeg'})},{id:'two',name:'video.mp4',type:'video/mp4',kind:'video',lastModified:456,file:new File([new Uint8Array(65537).map((_,i)=>i%251)],'video.mp4',{type:'video/mp4'})},{id:'three',name:'Тест.txt',type:'text/plain',kind:'document',lastModified:789,file:new File(['не потерять\n\nконец'],'Тест.txt',{type:'text/plain'})}].map(f=>({...f,size:f.file.size}));
 const shot={text,selection:{start:7,end:19,direction:'forward'},expanded:true,files};
 try{
  check('Новая тестовая база пуста',(await s.read())===null,true);
  let rev=(await s.write(shot,0)).revision;s.close();let restored=await s.read();
  check('Текст восстановлен побуквенно',restored.text===text,{characters:text.length});
  check('Выделение и полный режим сохранены',JSON.stringify(restored.selection)===JSON.stringify(shot.selection)&&restored.expanded,true);
  for(let i=0;i<3;i++){const a=files[i],b=restored.files[i];check('Байты файла '+(i+1)+' совпадают (SHA-256)',await digest(a.file)===await digest(b.file),{bytes:a.size,kind:a.kind});}
  check('Имена, MIME и порядок файлов сохранены',files.every((f,i)=>['id','name','type','size','lastModified','kind'].every(k=>f[k]===restored.files[i][k])),{files:3});
  const before=s.stats.blob_puts;for(let n=0;n<10;n++)rev=(await s.write({...shot,text:text+n},rev)).revision;
  check('Набор не перезаписывает Blob',s.stats.blob_puts===before,{new_blob_puts:s.stats.blob_puts-before});
  let reject=false;try{await s.write({...shot,text:'stale'},1)}catch(e){reject=e.name==='ConflictError'}
  check('Устаревшая вкладка не затирает новый текст',reject&&(await s.read()).text===text+9,true);
  const unchanged=await fingerprint(await s.read());s.fault='abort';try{await s.write(empty(),rev)}catch{}
  check('Откат удаления сохраняет целый предыдущий черновик',JSON.stringify(await fingerprint(await s.read()))===JSON.stringify(unchanged),true);
  for(const fault of ['quota','denied']){s.fault=fault;let name;try{await s.write(empty(),rev)}catch(e){name=e.name}check('Симуляция '+fault+': отказ, старые данные сохранены',!!name&&JSON.stringify(await fingerprint(await s.read()))===JSON.stringify(unchanged),{injected:true,error:name})}
  const remain={...shot,files:files.filter(f=>f.id!=='two')};rev=(await s.write(remain,rev)).revision;s.close();restored=await s.read();
  check('Удалённый файл не возвращается',restored.files.length===2&&!restored.files.some(f=>f.id==='two'),{count:restored.files.length});
  check('Неиспользуемый Blob удалён из базы',(await s.counts()).assets===2,await s.counts());
  rev=(await s.write(empty(),rev)).revision;s.close();restored=await s.read();
  check('Очистка остаётся пустой после нового подключения',restored.text===''&&!restored.files.length&&(await s.counts()).assets===0,true);
  const a=new DraftStore(s.name),b=new DraftStore(s.name);const outcomes=await Promise.allSettled([a.write({...empty(),text:'A'},rev),b.write({...empty(),text:'B'},rev)]);
  check('Конкурирующие записи: ровно одна подтверждена',outcomes.filter(x=>x.status==='fulfilled').length===1&&outcomes.filter(x=>x.status==='rejected'&&x.reason.name==='ConflictError').length===1,true);a.close();b.close();
  const q=await s.read();rev=q.revision;rev=(await s.write(shot,rev)).revision;
  await s.transaction(['assets'],'readwrite',(tx)=>tx.objectStore('assets').delete('one'));
  let missing=false;try{await s.read()}catch(e){missing=e.name==='DataError'}
  check('Потерянные байты не выдаются за восстановленный файл',missing,true);
 }catch(e){check('Выполнение теста',false,e.name+': '+e.message)}finally{await s.destroy().catch(()=>{})}
 return {generated_at:new Date().toISOString(),scope:'ISOLATED_INDEXEDDB_DATABASE; TEST FIXTURES ARE BINARY, NOT PLAYBACK TESTS',results,overall:results.every(x=>x.pass)?'PASS':'FAIL',summary:{checks:results.length,passed:results.filter(x=>x.pass).length},device_acceptance:'PENDING',reload_is_not_simulated_as_browser_close:true};
}
window.DraftVault={uid,DraftStore,Controller,digest,fingerprint,empty,signature,tests};
})();
