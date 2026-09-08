/* Gate 01.5: atomic durable handoff. Local queue only, NO transport or acknowledgements. */
(() => {
'use strict';
const {DraftStore,uid,empty,digest}=DraftVault;
const failError=(name,message)=>Object.assign(new Error(message),{name});
const contentKey=s=>JSON.stringify([s.text,s.files.map(({file,...m})=>m)]);
const active=r=>r.state!=='cancelled';
class OutboxStore extends DraftStore {
 constructor(name='vision-talk-gate-015-v1'){super(name);this.enqueueFault=null;this.queueStats={enqueues:0,deduplicated:0,retries:0,cancellations:0};}
 async write(snapshot,expected){
  if(typeof snapshot?.text!=='string'||!Array.isArray(snapshot.files))throw failError('DataError','Некорректный черновик');
  const ids=new Set();for(const f of snapshot.files){if(!f.id||ids.has(f.id)||!(f.file instanceof Blob)||f.file.size!==f.size)throw failError('DataError','Нет байтов вложения');ids.add(f.id)}
  const fault=this.fault;this.fault=null;let puts=0,deletes=0;
  const result=await this.transaction(['drafts','assets','outbox'],'readwrite',(tx,done,fail)=>{
   const ds=tx.objectStore('drafts'),as=tx.objectStore('assets'),r=ds.get('draft');
   r.onsuccess=()=>{
    const old=r.result,rev=old?.revision||0;
    if(rev!==expected){this.stats.conflicts++;fail(failError('ConflictError','Черновик изменён в другой вкладке'));return}
    if(fault==='quota'||fault==='denied'){fail(failError(fault==='quota'?'QuotaExceededError':'NotAllowedError','Тестовый отказ записи'));return}
    const q=tx.objectStore('outbox').getAll();q.onsuccess=()=>{
     const held=new Set(q.result.filter(active).flatMap(x=>x.files.map(f=>f.id))),prior=new Set((old?.files||[]).map(f=>f.id));
     for(const f of snapshot.files)if(!prior.has(f.id)&&!held.has(f.id)){as.put({id:f.id,blob:f.file});puts++}
     for(const id of prior)if(!ids.has(id)&&!held.has(id)){as.delete(id);deletes++}
     const hasContent=!!snapshot.text.trim()||snapshot.files.length>0;
     const intent=hasContent?(old?.intent&&contentKey(old)===contentKey(snapshot)?old.intent:uid()):null;
     const rec={id:'draft',schema:1,revision:rev+1,savedAt:new Date().toISOString(),text:snapshot.text,selection:snapshot.selection||empty().selection,expanded:!!snapshot.expanded,files:snapshot.files.map(({file,...m})=>m),intent};
     ds.put(rec);if(fault==='abort'){fail(failError('AbortError','Тестовый откат'));return}done({revision:rec.revision,intent,savedAt:rec.savedAt});
    };
   };
  });this.stats.commits++;this.stats.blob_puts+=puts;this.stats.blob_deletes+=deletes;return result;
 }
 async enqueue(intent,expectedRevision){
  if(!intent)throw failError('DataError','Черновик пуст');
  const fault=this.enqueueFault;this.enqueueFault=null;
  const result=await this.transaction(['drafts','assets','outbox','meta'],'readwrite',(tx,done,fail)=>{
   const ds=tx.objectStore('drafts'),os=tx.objectStore('outbox'),as=tx.objectStore('assets'),ms=tx.objectStore('meta');
   const existing=os.get(intent);existing.onsuccess=()=>{
    if(existing.result){done({item:existing.result,deduplicated:true});return}
    const q=ds.get('draft');q.onsuccess=()=>{
     const d=q.result;
     if(!d||d.revision!==expectedRevision||d.intent!==intent){fail(failError('ConflictError','Изменился черновик. Повторное добавление остановлено.'));return}
     if(!d.text.trim()&&!d.files.length){fail(failError('DataError','Пустое сообщение'));return}
     if(fault==='quota'||fault==='denied'){fail(failError(fault==='quota'?'QuotaExceededError':'NotAllowedError','ТЕСТ: запись очереди отклонена; черновик сохранён'));return}
     let left=d.files.length;
     const create=()=>{
      const m=ms.get('sequence');m.onsuccess=()=>{
       let n=m.result?.value||0;const messages=[];
       if(d.text.trim())messages.push({id:intent+':0',sequence:++n,kind:'text',text:d.text});
       for(const f of d.files)messages.push({id:intent+':'+messages.length,sequence:++n,kind:f.kind,assetId:f.id});
       const item={id:intent,client_message_id:intent,source_revision:d.revision,first_sequence:messages[0].sequence,messages,files:d.files,state:'queued',retries:0,createdAt:new Date().toISOString(),server_ack:null,error:null,version:1};
       os.add(item);ms.put({id:'sequence',value:n});
       const cleared={id:'draft',schema:1,revision:d.revision+1,savedAt:new Date().toISOString(),...empty(),intent:null};
       ds.put(cleared);
       if(fault==='abort'){fail(failError('AbortError','ТЕСТ: откат после добавления записи и очистки черновика'));return}
       done({item,draftRevision:cleared.revision,deduplicated:false});
      };
     };
     if(!left)create();
     for(const f of d.files){const a=as.get(f.id);a.onsuccess=()=>{if(!a.result||!(a.result.blob instanceof Blob)||a.result.blob.size!==f.size){fail(failError('DataError','Нет полных байтов вложения; перенос остановлен'));return}if(--left===0)create()};}
    };
   };
  });if(result.deduplicated)this.queueStats.deduplicated++;else this.queueStats.enqueues++;return result;
 }
 async readQueue(withFiles=true){
  return this.transaction(['outbox','assets'],'readonly',(tx,done,fail)=>{
   const q=tx.objectStore('outbox').getAll();q.onsuccess=()=>{
    const rows=q.result.sort((a,b)=>a.first_sequence-b.first_sequence);done(rows);
    if(!withFiles)return;
    for(const r of rows.filter(active))for(const f of r.files){const a=tx.objectStore('assets').get(f.id);a.onsuccess=()=>{if(!a.result||!(a.result.blob instanceof Blob)||a.result.blob.size!==f.size){fail(failError('DataError','Исходящее содержит отсутствующее вложение'));return}f.file=new File([a.result.blob],f.name,{type:f.type,lastModified:f.lastModified})};}
   };
  });
 }
 async retry(id){
  const row=await this.transaction(['outbox'],'readwrite',(tx,done,fail)=>{
   const s=tx.objectStore('outbox'),q=s.get(id);q.onsuccess=()=>{const r=q.result;if(!r||!active(r)){fail(failError('InvalidStateError','Эта запись отменена или отсутствует'));return}r.state='queued';r.error=null;r.retries++;r.version++;s.put(r);done(r)};
  });this.queueStats.retries++;return row;
 }
 async cancel(id){
  await this.transaction(['drafts','assets','outbox'],'readwrite',(tx,done,fail)=>{
   const os=tx.objectStore('outbox'),q=os.get(id);q.onsuccess=()=>{const r=q.result;if(!r){fail(failError('NotFoundError','Исходящее не найдено'));return}if(!active(r)){done(false);return}
    r.state='cancelled';r.version++;r.cancelledAt=new Date().toISOString();os.put(r);
    const d=tx.objectStore('drafts').get('draft');d.onsuccess=()=>{const all=os.getAll();all.onsuccess=()=>{const held=new Set([...(d.result?.files||[]).map(f=>f.id),...all.result.filter(active).flatMap(x=>x.files.map(f=>f.id))]);for(const f of r.files)if(!held.has(f.id))tx.objectStore('assets').delete(f.id);done(true)}};
   };
  });this.queueStats.cancellations++;
 }
 async counts(){return this.transaction(['drafts','assets','outbox'],'readonly',(tx,done)=>{const v={};done(v);for(const n of ['drafts','assets','outbox']){const q=tx.objectStore(n).count();q.onsuccess=()=>v[n]=q.result}})}
}
async function queueFingerprint(rows){
 const result=[];for(const r of rows.filter(active)){
  const entry={id:r.id,sequence:r.first_sequence,state:r.state,messages:[],files:[]};
  for(const m of r.messages)entry.messages.push({id:m.id,sequence:m.sequence,kind:m.kind,assetId:m.assetId||null,text:m.kind==='text'?await digest(new Blob([m.text])):null});
  for(const f of r.files)entry.files.push({id:f.id,size:f.size,kind:f.kind,hash:await digest(f.file)});
  result.push(entry);
 }return result;
}
async function tests(){
 const results=[],check=(name,pass,measured)=>{results.push({name,pass:!!pass,measured});};
 const s=new OutboxStore('vision-g015-test-'+uid()),file=new File([Uint8Array.from({length:65537},(_,i)=>i%251)],'fixture.bin',{type:'application/octet-stream'});
 const shot={...empty(),text:'Перенос в очередь\n\n🙂 e\u0301 — العربية',files:[{id:'a',file,name:file.name,type:file.type,kind:'document',size:file.size,lastModified:file.lastModified}]};
 try{
  check('Новая очередь пуста',(await s.readQueue()).length===0,true);
  let saved=await s.write(shot,0);let d=await s.read();const original=await digest(file);
  for(const fault of ['quota','denied','abort']){
   s.enqueueFault=fault;let error;try{await s.enqueue(d.intent,d.revision)}catch(e){error=e.name}
   const same=await s.read();check('Отказ '+fault+': черновик и байты целы, очередь пуста',!!error&&same.text===shot.text&&await digest(same.files[0].file)===original&&(await s.readQueue()).length===0,{injected:true,error});
  }
  const beforePuts=s.stats.blob_puts,r=await s.enqueue(d.intent,d.revision);const cleared=await s.read(),rows=await s.readQueue();
  check('Один commit: черновик очищен и исходящее сохранено',!cleared.text&&!cleared.files.length&&rows.length===1,{queued:rows.length});
  check('Текст и файл — отдельные сообщения с порядком',r.item.messages.length===2&&r.item.messages[0].kind==='text'&&r.item.messages[1].kind==='document'&&r.item.messages[1].sequence>r.item.messages[0].sequence,{messages:r.item.messages.length});
  check('Исходные байты в очереди совпали',await digest(rows[0].files[0].file)===original,{bytes:file.size});
  check('Перенос не копирует уже сохранённый Blob',s.stats.blob_puts===beforePuts,{new_blob_puts:s.stats.blob_puts-beforePuts});
  check('Нет подтверждения сервера и статуса отправлено',rows[0].state==='queued'&&rows[0].server_ack===null,{state:rows[0].state,server_ack:null});
  const dup=await s.enqueue(d.intent,d.revision);check('Повтор того же намерения не создаёт дубль',dup.deduplicated&&(await s.readQueue()).length===1,true);
  for(let i=0;i<3;i++)await s.retry(r.item.id);const ret=await s.readQueue();check('Повтор сохраняет ID, порядок и байты',ret.length===1&&ret[0].id===r.item.id&&ret[0].first_sequence===r.item.first_sequence&&ret[0].retries===3&&await digest(ret[0].files[0].file)===original,{retries:ret[0].retries});
  s.close();const re=await s.readQueue();check('Новое подключение восстанавливает очередь',re.length===1&&re[0].id===r.item.id&&await digest(re[0].files[0].file)===original,{kind:'NEW_CONNECTION_NOT_PROCESS_RESTART'});
  saved=await s.write({...empty(),text:'Следующий черновик'},cleared.revision);check('Новый черновик не удаляет вложения исходящего',await digest((await s.readQueue())[0].files[0].file)===original,true);
  const d2=await s.read();await s.write({...empty(),text:'Последняя правка'},d2.revision);let conflict=false;try{await s.enqueue(d2.intent,d2.revision)}catch(e){conflict=e.name==='ConflictError'}check('Устаревший снимок не забирает новый черновик',conflict&&(await s.read()).text==='Последняя правка',true);
  const d3=await s.read(),a=new OutboxStore(s.name),b=new OutboxStore(s.name);const pairs=await Promise.all([a.enqueue(d3.intent,d3.revision),b.enqueue(d3.intent,d3.revision)]);a.close();b.close();
  check('Две вкладки: одно исходящее на одно намерение',pairs.filter(x=>x.deduplicated).length===1&&(await s.readQueue()).length===2,true);
  const after=await s.read();await s.write({...shot,files:[]},after.revision);const newD=await s.read();await s.enqueue(newD.intent,newD.revision);
  check('Одинаковый текст по новому нажатию не подавляется',(await s.readQueue()).length===3,true);
  const ordered=await s.readQueue();const ids=ordered.flatMap(x=>x.messages.map(m=>m.id)),seqs=ordered.flatMap(x=>x.messages.map(m=>m.sequence));check('У всех сообщений уникальные ID и возрастающий порядок',new Set(ids).size===ids.length&&seqs.every((n,i)=>!i||n>seqs[i-1]),{messages:ids.length});
  await s.cancel(r.item.id);s.close();const ca=await s.readQueue();check('Отмена сохранена после подключения',ca.find(x=>x.id===r.item.id).state==='cancelled',true);
  let stopped=false;try{await s.retry(r.item.id)}catch(e){stopped=e.name==='InvalidStateError'}const tomb=await s.enqueue(d.intent,d.revision);check('Отмена не воскрешается повтором',stopped&&tomb.deduplicated&&tomb.item.state==='cancelled',true);
  check('После отмены освобождены неиспользуемые байты',(await s.counts()).assets===0,await s.counts());
  const current=await s.read();await s.write(shot,current.revision);const bad=await s.read();await s.transaction(['assets'],'readwrite',tx=>tx.objectStore('assets').delete('a'));let blocked=false;try{await s.enqueue(bad.intent,bad.revision)}catch(e){blocked=e.name==='DataError'}const raw=await s.transaction(['drafts'],'readonly',(tx,done)=>{const q=tx.objectStore('drafts').get('draft');q.onsuccess=()=>done(q.result)});check('Потеря байтов блокирует перенос, не очищая текст',blocked&&raw.text===shot.text,true);
 }catch(e){check('Выполнение теста',false,{name:e.name,message:e.message})}finally{await s.destroy().catch(()=>{})}
 return{generated_at:new Date().toISOString(),overall:results.every(x=>x.pass)?'PASS':'FAIL',results,summary:{checks:results.length,passed:results.filter(x=>x.pass).length},scope:'ISOLATED_LOCAL_QUEUE_FIXTURES; NO NETWORK_OR_PROCESS_RESTART_IN_AUTOTEST'};
}
window.OutboxVault={OutboxStore,queueFingerprint,tests,active};
})();
