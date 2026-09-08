/* One ordered message uses the existing account/conversation draft + outbox DB.
   Load after transport-store.js. The product vault must open DB version 2 so an
   older version-1 client cannot overwrite a rich draft after an upgrade. */
(() => {
 'use strict';
 const {uid,empty}=DraftVault;
 const error=(name,message)=>Object.assign(new Error(message),{name});
 const active=row=>!['sent','cancelled'].includes(row.state);
 const media=new Set(['image','video','audio','document']);
 const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
 const contentKey=s=>JSON.stringify([s.text,s.blocks??null,s.files.map(({file,...m})=>m)]);
 const validId=value=>typeof value==='string'&&value.length>0&&value.length<=200;

 function validate(snapshot,withBytes){
  if(typeof snapshot?.text!=='string'||!Array.isArray(snapshot.files))throw error('DataError','Некорректный черновик');
  const files=new Map();let bytes=0;
  for(const f of snapshot.files){
   if(!validId(f.id)||files.has(f.id)||!Number.isSafeInteger(f.size)||f.size<0||
      (withBytes&&(!(f.file instanceof Blob)||f.file.size!==f.size)))throw error('DataError','Нет полных байтов вложения');
   files.set(f.id,f);bytes+=f.size;
  }
  if(!own(snapshot,'blocks'))return null;
  if(!Array.isArray(snapshot.blocks)||snapshot.blocks.length>100)throw error('DataError','В сообщении может быть до 100 блоков');
  if([...files.values()].some(f=>f.size>25*1024*1024)||bytes>100*1024*1024)throw error('DataError','Лимит: 25 МБ на файл и 100 МБ на сообщение');
  const blockIds=new Set(),references=new Set();
  const blocks=snapshot.blocks.map(block=>{
   if(!block||!validId(block.id)||blockIds.has(block.id))throw error('DataError','Некорректный идентификатор блока');
   blockIds.add(block.id);
   if(block.type==='text'){
    if(typeof block.text!=='string'||block.pending)throw error('DataError','Некорректный текстовый блок');
    return {id:block.id,type:'text',text:block.text};
   }
   if(!media.has(block.type)||!validId(block.assetId)||references.has(block.assetId))throw error('DataError','Некорректное вложение в сообщении');
   references.add(block.assetId);
   const f=files.get(block.assetId);
   if(block.pending===true){
    if(block.type!=='audio'||f)throw error('DataError','Незавершённая запись не является сохранённым вложением');
    return {id:block.id,type:block.type,assetId:block.assetId,pending:true};
   }
   if(block.pending!==undefined&&block.pending!==false)throw error('DataError','Некорректное состояние записи');
   if(!f||f.kind!==block.type)throw error('DataError','Вложение блока отсутствует или имеет другой тип');
   return {id:block.id,type:block.type,assetId:block.assetId};
  });
  if([...files.keys()].some(id=>!references.has(id)))throw error('DataError','Файл не включён в тело сообщения');
  const text=blocks.filter(b=>b.type==='text').map(b=>b.text).join('\n');
  if(text.length>5000)throw error('DataError','В сообщении может быть до 5000 символов');
  if(snapshot.text!==text)throw error('DataError','Текст не совпадает с порядком блоков сообщения');
  return blocks;
 }

 class RichStore extends PablicusStore {
  async write(snapshot,expected){
   const blocks=validate(snapshot,true),isRich=blocks!==null;
   const recording=snapshot.recording==null?null:structuredClone(snapshot.recording);
   const fault=this.fault;this.fault=null;let puts=0,deletes=0;
   const result=await this.transaction(['drafts','assets','outbox'],'readwrite',(tx,done,fail)=>{
    const ds=tx.objectStore('drafts'),as=tx.objectStore('assets'),r=ds.get('draft');
    r.onsuccess=()=>{try{
     const old=r.result,rev=old?.revision||0;
     if(rev!==expected||(!isRich&&Array.isArray(old?.blocks))){
      this.stats.conflicts++;
      fail(error('ConflictError',rev!==expected?'Черновик изменён в другой вкладке':'Этот черновик содержит блоки. Откройте актуальный редактор, чтобы сохранить его.'));return;
     }
     if(fault==='quota'||fault==='denied'){fail(error(fault==='quota'?'QuotaExceededError':'NotAllowedError','Тестовый отказ записи'));return}
     const q=tx.objectStore('outbox').getAll();q.onsuccess=()=>{try{
      const held=new Set(q.result.filter(active).flatMap(x=>x.files.map(f=>f.id)));
      const prior=new Set((old?.files||[]).map(f=>f.id)),ids=new Set(snapshot.files.map(f=>f.id));
      for(const f of snapshot.files)if(!prior.has(f.id)&&!held.has(f.id)){as.put({id:f.id,blob:f.file});puts++}
      for(const id of prior)if(!ids.has(id)&&!held.has(id)){as.delete(id);deletes++}
      const files=snapshot.files.map(({file,...m})=>m);
      const content={text:snapshot.text,files,...(isRich?{blocks}:{})};
      const hasContent=!!snapshot.text.trim()||files.length>0||blocks?.some(b=>b.pending);
      const intent=hasContent?(old?.intent&&contentKey(old)===contentKey(content)?old.intent:uid()):null;
      const record={id:'draft',schema:1,revision:rev+1,savedAt:new Date().toISOString(),...content,
       selection:snapshot.selection||empty().selection,expanded:!!snapshot.expanded,intent,
       ...(recording===null?{}:{recording})};
      ds.put(record);
      if(fault==='abort'){fail(error('AbortError','Тестовый откат'));return}
      done({revision:record.revision,intent,savedAt:record.savedAt});
     }catch(e){fail(e)}};
    }catch(e){fail(e)}};
   });
   this.stats.commits++;this.stats.blob_puts+=puts;this.stats.blob_deletes+=deletes;return result;
  }

  async enqueue(intent,expectedRevision){
   if(!intent)throw error('DataError','Черновик пуст');
   const fault=this.enqueueFault;this.enqueueFault=null;
   const result=await this.transaction(['drafts','assets','outbox','meta'],'readwrite',(tx,done,fail)=>{
    const ds=tx.objectStore('drafts'),os=tx.objectStore('outbox'),as=tx.objectStore('assets'),ms=tx.objectStore('meta');
    const existing=os.get(intent);existing.onsuccess=()=>{try{
     if(existing.result){done({item:existing.result,deduplicated:true});return}
     const q=ds.get('draft');q.onsuccess=()=>{try{
      const d=q.result;
      if(!d||d.revision!==expectedRevision||d.intent!==intent){fail(error('ConflictError','Изменился черновик. Повторное добавление остановлено.'));return}
      const blocks=validate(d,false);
      if(blocks?.some(b=>b.pending)||d.recording){fail(error('InvalidStateError','Завершите запись голосового сообщения перед отправкой'));return}
      if(!d.text.trim()&&!d.files.length){fail(error('DataError','Пустое сообщение'));return}
      if(fault==='quota'||fault==='denied'){fail(error(fault==='quota'?'QuotaExceededError':'NotAllowedError','ТЕСТ: запись очереди отклонена; черновик сохранён'));return}
      const create=()=>{
       const m=ms.get('sequence');m.onsuccess=()=>{try{
        let n=m.result?.value||0;const messages=[];
        if(blocks!==null)messages.push({id:intent+':0',sequence:++n,kind:'rich',text:d.text,blocks});
        else{
         if(d.text.trim())messages.push({id:intent+':0',sequence:++n,kind:'text',text:d.text});
         for(const f of d.files)messages.push({id:intent+':'+messages.length,sequence:++n,kind:f.kind,assetId:f.id});
        }
        const item={id:intent,client_message_id:intent,source_revision:d.revision,first_sequence:messages[0].sequence,messages,
         files:d.files,state:'queued',retries:0,createdAt:new Date().toISOString(),server_ack:null,error:null,version:1};
        os.add(item);ms.put({id:'sequence',value:n});
        const cleared={id:'draft',schema:1,revision:d.revision+1,savedAt:new Date().toISOString(),...empty(),intent:null};
        ds.put(cleared);
        if(fault==='abort'){fail(error('AbortError','ТЕСТ: откат после добавления записи и очистки черновика'));return}
        done({item,draftRevision:cleared.revision,deduplicated:false});
       }catch(e){fail(e)}};
      };
      let left=d.files.length;if(!left)create();
      for(const f of d.files){const a=as.get(f.id);a.onsuccess=()=>{try{
       if(!a.result||!(a.result.blob instanceof Blob)||a.result.blob.size!==f.size){fail(error('DataError','Нет полных байтов вложения; перенос остановлен'));return}
       if(--left===0)create();
      }catch(e){fail(e)}}}
     }catch(e){fail(e)}};
    }catch(e){fail(e)}};
   });
   if(result.deduplicated)this.queueStats.deduplicated++;else this.queueStats.enqueues++;return result;
  }
 }
 window.PablicusRichStore=RichStore;
})();
