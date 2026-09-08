"""Real browser IndexedDB checks for one-message atomic rich drafts/outbox.

No Supabase, messages, microphone, or user accounts are accessed. Binary fixtures
verify persistence, not codec playback. The harness applies the product DB-v3
upgrade to the inherited vault while loading the actual product rich store.
"""
import asyncio
import json
import tempfile
from pathlib import Path

from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = {
    'vault.js': ROOT / 'inherited/gate015/vault.js',
    'outbox.js': ROOT / 'inherited/gate015/outbox.js',
    'transport-store.js': ROOT / 'src/transport-store.js',
    'rich-store.js': ROOT / 'src/rich-store.js',
}

CHECKS = r'''async () => {
 const checks=[];
 const assert=(condition,label)=>{if(!condition)throw Error(label);checks.push(label)};
 const rejects=async(promise,name,label)=>{let actual;try{await promise}catch(e){actual=e.name}assert(actual===name,label)};
 const digest=DraftVault.digest;
 const account=crypto.randomUUID(),chat=crypto.randomUUID();
 const s=new PablicusRichStore(account,chat),oldClient=new PablicusStore(account,chat);
 const file=(id,kind,content)=>{const f=new File([content],id,{type:kind==='document'?'text/plain':kind+'/webm',lastModified:123});return{id,name:f.name,type:f.type,kind,size:f.size,lastModified:123,file:f}};
 const photo=file('photo','image','PHOTO\u0000original bytes'),video=file('video','video','VIDEO bytes'),audio=file('voice','audio','VOICE bytes'),doc=file('doc','document','Document 🙂');
 const shot={text:'До изображения\nПосле изображения\nКонец',selection:{start:2,end:2,direction:'none'},expanded:true,
  blocks:[{id:'t1',type:'text',text:'До изображения'},{id:'p',type:'image',assetId:'photo'},{id:'t2',type:'text',text:'После изображения'},
   {id:'v',type:'video',assetId:'video'},{id:'a',type:'audio',assetId:'voice'},{id:'d',type:'document',assetId:'doc'},{id:'t3',type:'text',text:'Конец'}],files:[photo,video,audio,doc]};
 const raw=()=>s.transaction(['drafts'],'readonly',(tx,done)=>{const q=tx.objectStore('drafts').get('draft');q.onsuccess=()=>done(q.result)});
 try{
  await new Promise((resolve,reject)=>{
   const q=indexedDB.open(s.name,2);
   q.onupgradeneeded=()=>{for(const name of ['drafts','assets','proofs','outbox','meta'])q.result.createObjectStore(name,{keyPath:'id'})};
   q.onerror=()=>reject(q.error);q.onsuccess=()=>{
    const db=q.result,tx=db.transaction(['drafts'],'readwrite');
    tx.objectStore('drafts').put({id:'draft',schema:1,revision:1,text:'Старый черновик',files:[],selection:{start:3,end:3},expanded:false});
    tx.oncomplete=()=>{db.close();resolve()};tx.onabort=()=>{db.close();reject(tx.error)};
   };
  });
  assert((await s.open()).version===3,'database v3 upgrades the existing account/chat namespace');
  const migrated=await s.read();
  assert(migrated.text==='Старый черновик'&&!migrated.reply_to&&migrated.revision===1,'upgrade preserves a deployed v2 draft without a reply target');
  let saved=await s.write(shot,migrated.revision);s.close();let restored=await s.read();
  assert(JSON.stringify(restored.blocks)===JSON.stringify(shot.blocks)&&restored.text===shot.text,'mixed block order survives a new database connection');
  assert((await Promise.all(restored.files.map(f=>digest(f.file)))).join() === (await Promise.all(shot.files.map(f=>digest(f.file)))).join(),'all original media bytes survive restoration');
  const puts=s.stats.blob_puts;
  saved=await s.write({...shot,selection:{start:3,end:3}},saved.revision);
  assert(saved.intent===restored.intent&&s.stats.blob_puts===puts,'selection changes retain intent and do not rewrite media bytes');
  const reply={message_id:crypto.randomUUID(),block_id:'voice-block_1'};
  let replied=await s.write({...shot,reply_to:{...reply,message_id:reply.message_id.toUpperCase()}},saved.revision);
  s.close();restored=await s.read();
  assert(JSON.stringify(restored.reply_to)===JSON.stringify(reply),'the exact voice-block reply target survives reopening and normalizes UUID casing');
  saved=await s.write({...shot,reply_to:reply,selection:{start:4,end:4}},replied.revision);
  assert(saved.intent===replied.intent&&s.stats.blob_puts===puts,'reply selection changes and UUID casing retain intent without rewriting media bytes');
  const otherTarget={message_id:crypto.randomUUID(),block_id:'voice-block_2'};
  replied=await s.write({...shot,reply_to:otherTarget},saved.revision);
  assert(replied.intent!==saved.intent,'changing only the reply target creates a new send intent');
  await rejects(s.write({...shot,reply_to:reply},saved.revision),'ConflictError','a stale tab cannot overwrite a newer reply target');
  saved=await s.write({...shot,reply_to:{message_id:otherTarget.message_id}},replied.revision);
  assert(saved.intent!==replied.intent,'switching a block reply to a whole-message reply creates a new intent');
  replied=await s.write({...shot,reply_to:{message_id:otherTarget.message_id,block_id:null}},saved.revision);
  assert(replied.intent===saved.intent&&!Object.hasOwn((await s.read()).reply_to,'block_id'),'null and absent optional block IDs normalize to the same whole-message reply');
  saved=await s.write({...shot,reply_to:null},replied.revision);
  replied=await s.write(shot,saved.revision);
  assert(saved.intent===replied.intent&&!Object.hasOwn(await s.read(),'reply_to'),'null and absent reply targets retain the same intent');
  saved=await s.write({...shot,reply_to:reply},replied.revision);
  const reordered={...shot,reply_to:reply,blocks:[shot.blocks[0],shot.blocks[3],shot.blocks[1],shot.blocks[2],...shot.blocks.slice(4)]};
  const moved=await s.write(reordered,saved.revision);
  assert(moved.intent!==saved.intent,'changing media order creates a new send intent');
  await rejects(s.write(shot,saved.revision),'ConflictError','stale tab cannot overwrite a newer rich draft');
  await rejects(s.write(DraftVault.empty(),moved.revision),'ConflictError','legacy-shaped snapshot cannot erase a rich draft');
  // A v1 request is exactly how the old deployed writer reopens after onversionchange.
  await rejects(new Promise((resolve,reject)=>{const q=indexedDB.open(s.name,1);q.onsuccess=()=>{q.result.close();resolve()};q.onerror=()=>reject(q.error)}),'VersionError','old DB-v1 client cannot reopen the upgraded database');
  await rejects(new Promise((resolve,reject)=>{const q=indexedDB.open(s.name,2);q.onsuccess=()=>{q.result.close();resolve()};q.onerror=()=>reject(q.error)}),'VersionError','old DB-v2 rich writer cannot reopen and erase reply metadata');
  const before=JSON.stringify(await raw());
  for(const [fault,name] of [['quota','QuotaExceededError'],['denied','NotAllowedError'],['abort','AbortError']]){
   s.enqueueFault=fault;await rejects(s.enqueue(moved.intent,moved.revision),name,'enqueue '+fault+' reports failure');
   assert(JSON.stringify(await raw())===before&&(await s.readQueue()).length===0,'enqueue '+fault+' atomically preserves the entire draft');
  }
  s.fault='abort';await rejects(s.write({...shot,text:'',blocks:[],files:[]},moved.revision),'AbortError','failed rich draft write is surfaced');
  assert(JSON.stringify(await raw())===before&&(await s.counts()).assets===4,'failed draft deletion rolls back metadata and all assets');
  const other=new PablicusRichStore(account,chat);
  const outcomes=await Promise.all([s.enqueue(moved.intent,moved.revision),other.enqueue(moved.intent,moved.revision)]);other.close();
  const queued=outcomes.find(x=>!x.deduplicated).item;
  assert(outcomes.filter(x=>x.deduplicated).length===1&&(await s.readQueue()).length===1,'two simultaneous enqueues produce one durable message');
  assert(queued.messages.length===1&&queued.messages[0].kind==='rich'&&JSON.stringify(queued.messages[0].blocks)===JSON.stringify(reordered.blocks),'one rich outbox message contains the complete ordered body');
  assert(JSON.stringify(queued.messages[0].reply_to)===JSON.stringify(reply),'the same atomic outbox commit includes the exact message and voice-block reply target');
  assert(!(await s.read()).text&&!(await s.read()).files.length&&!(await s.read()).reply_to,'successful queue commit clears the body and reply target atomically');
  assert(s.stats.blob_puts===puts,'enqueue references original bytes without cloning their stored Blob');
  let d=await s.read();
  saved=await s.write({text:'Следующий черновик',blocks:[{id:'next',type:'text',text:'Следующий черновик'},{id:'image',type:'image',assetId:'photo'}],files:[photo]},d.revision);
  saved=await s.write({text:'Следующий черновик',blocks:[{id:'next',type:'text',text:'Следующий черновик'}],files:[]},saved.revision);
  assert((await s.counts()).assets===4&&(await s.readQueue())[0].files.length===4,'removing a draft asset preserves bytes held by the active outgoing message');
  const pending={text:'Диктую и печатаю',blocks:[{id:'typing',type:'text',text:'Диктую и печатаю'},{id:'newvoice',type:'audio',assetId:'recording',pending:true},{id:'photo2',type:'image',assetId:'photo'}],files:[photo],recording:{startedAt:123}};
  saved=await s.write(pending,saved.revision);d=await s.read();
  assert(d.blocks[1].pending&&d.recording.startedAt===123&&d.files.length===1,'pending voice is a placeholder while text and photo remain durable');
  await rejects(s.enqueue(saved.intent,saved.revision),'InvalidStateError','unfinished voice cannot be sent as completed audio');
  await rejects(s.write({...pending,files:[photo,file('recording','audio','partial')]},saved.revision),'DataError','pending recording cannot masquerade as final audio bytes');
  const completedVoice=file('recording','audio','finished recording');
  const completed={...pending,recording:null,blocks:pending.blocks.map(b=>b.pending?{id:b.id,type:b.type,assetId:b.assetId}:b),files:[photo,completedVoice]};
  saved=await s.write(completed,saved.revision);const second=await s.enqueue(saved.intent,saved.revision);
  assert(second.item.messages.length===1&&second.item.messages[0].blocks[1].type==='audio','finalized audio is sent in the same message as text and photo');
  // Finalizing the first message must not reclaim its photo while the second uses it.
  const owner='rich-store-test';await s.claim(queued.id,owner);
  await s.progress(queued.id,owner,queued.messages[0].id,{ack:{id:'server-first'}});await s.finish(queued.id,owner);
  assert((await s.counts()).assets===2&&(await s.readQueue())[0].files.length===2,'ACK collection removes only assets unreferenced by remaining outgoing messages');
  await s.claim(second.item.id,owner);await s.progress(second.item.id,owner,second.item.messages[0].id,{ack:{id:'server-second'}});await s.finish(second.item.id,owner);
  assert((await s.counts()).assets===0&&(await s.readQueue()).length===0,'all final media bytes retire only after the final owning message is acknowledged');
  d=await s.read();saved=await s.write({...DraftVault.empty(),text:'Legacy text',files:[doc]},d.revision);
  const legacy=await s.enqueue(saved.intent,saved.revision);
  assert(legacy.item.messages.length===2&&legacy.item.messages[0].kind==='text'&&legacy.item.messages[1].kind==='document','legacy snapshots and split outgoing messages remain compatible');
  d=await s.read();saved=await s.write(shot,d.revision);
  for(const invalid of ['message',[],{}, {message_id:'not-a-uuid'}, {message_id:reply.message_id,block_id:''},
   {message_id:reply.message_id,block_id:'a'.repeat(129)}, {message_id:reply.message_id,block_id:'voice/1'},
   {message_id:reply.message_id,block_id:3}, {message_id:reply.message_id,preview:'untrusted extra field'}]){
   await rejects(s.write({...shot,reply_to:invalid},saved.revision),'DataError','invalid reply schema is rejected: '+JSON.stringify(invalid));
  }
  assert((await s.read()).revision===saved.revision,'invalid reply targets never mutate the durable draft');
  await rejects(s.write({...DraftVault.empty(),text:'Legacy response',reply_to:reply},saved.revision),'DataError','a legacy-shaped reply is rejected instead of silently losing its target');
  await rejects(s.write({...shot,files:shot.files.slice(1)},saved.revision),'DataError','missing referenced file is rejected');
  await rejects(s.write({...shot,blocks:shot.blocks.filter(b=>b.assetId!=='doc')},saved.revision),'DataError','unreferenced file is rejected');
  await rejects(s.write({text:'a'.repeat(5001),files:[],blocks:[{id:'text',type:'text',text:'a'.repeat(5001)}]},saved.revision),'DataError','aggregate text length is limited');
  await rejects(s.write({text:'',files:[],blocks:Array.from({length:101},(_,i)=>({id:'b'+i,type:'text',text:''}))},saved.revision),'DataError','block count is limited');
  const oversized=file('large','video',new Uint8Array(25*1024*1024+1));
  await rejects(s.write({text:'',files:[oversized],blocks:[{id:'large',type:'video',assetId:'large'}]},saved.revision),'DataError','file byte limit is enforced before writing');
  await s.transaction(['assets'],'readwrite',tx=>tx.objectStore('assets').delete('video'));
  await rejects(s.enqueue(saved.intent,saved.revision),'DataError','missing persisted bytes prevent enqueue');
  assert((await raw()).intent===saved.intent&&(await raw()).blocks.length===shot.blocks.length,'missing bytes never clear the surviving draft body');
  return {pass:true,checks,scope:'isolated real IndexedDB and binary fixtures; no network transport or codec playback'};
 }finally{oldClient.close();await s.destroy()}
}'''


async def one(engine, name):
    with tempfile.TemporaryDirectory(prefix='pablicus-rich-store-') as directory:
        ctx = await engine.launch_persistent_context(directory, headless=True)
        try:
            async def route(request):
                filename = request.request.url.rsplit('/', 1)[-1]
                if filename in SCRIPTS:
                    source = SCRIPTS[filename].read_text()
                    if filename == 'vault.js':
                        source = source.replace('indexedDB.open(this.name,1)', 'indexedDB.open(this.name,3)')
                    await request.fulfill(status=200, content_type='application/javascript', body=source)
                else:
                    await request.fulfill(status=200, content_type='text/html', body=''.join(
                        f'<script src="/{script}"></script>' for script in SCRIPTS))
            await ctx.route('http://127.0.0.1:8769/**', route)
            page = await ctx.new_page()
            await page.goto('http://127.0.0.1:8769/', wait_until='load')
            return {'engine': name, **await page.evaluate(CHECKS)}
        finally:
            await ctx.close()


async def main():
    import sys
    names = sys.argv[1:] or ['chromium', 'webkit']
    async with async_playwright() as playwright:
        result = [await one(getattr(playwright, name), name) for name in names]
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    asyncio.run(main())
