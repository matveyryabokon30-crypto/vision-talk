/* Pablicus: authenticated transport metadata extends the verified atomic outbox.
   DraftStore/OutboxStore transaction semantics are retained. No service secrets. */
(() => {'use strict';
 const live = r => !['sent','cancelled'].includes(r.state);
 class TransportStore extends OutboxVault.OutboxStore {
  static nameFor(user,chat){if(!/^[0-9a-f-]{36}$/i.test(user)||!/^[0-9a-f-]{36}$/i.test(chat))throw Error('Некорректный аккаунт или чат');return `pablicus-v1:${user}:${chat}`}
  constructor(user,chat){super(TransportStore.nameFor(user,chat));this.account=user;this.conversation=chat}
  async change(id,fn){return this.transaction(['outbox'],'readwrite',(tx,done,fail)=>{const s=tx.objectStore('outbox'),q=s.get(id);q.onsuccess=()=>{try{const r=q.result;if(!r)throw Error('Запись очереди не найдена');const x=fn(r);if(x===false){done(null);return}s.put(r);done(r)}catch(e){fail(e)}}})}
  async claim(id,owner){return this.change(id,r=>{if(!live(r))return false;if(r.lease&&r.lease.owner!==owner&&r.lease.until>Date.now())return false;r.state='sending';r.error=null;r.nextAttemptAt=0;r.lease={owner,until:Date.now()+60000};r.version++})}
  async progress(id,owner,part,patch){return this.change(id,r=>{if(r.lease?.owner!==owner)throw Error('Вкладка больше не владеет отправкой');r.parts||={};r.parts[part]={...r.parts[part],...patch};r.lease.until=Date.now()+60000;r.version++})}
  async finish(id,owner){return this.transaction(['drafts','assets','outbox'],'readwrite',(tx,done,fail)=>{
   const os=tx.objectStore('outbox'),q=os.get(id);q.onsuccess=()=>{try{const r=q.result;if(!r)throw Error('Исходящее не найдено');if(r.lease?.owner!==owner)throw Error('Отправка уже обрабатывается');if(!r.messages.every(m=>r.parts?.[m.id]?.ack?.id))throw Error('Не все сообщения подтверждены сервером');
    const draft=tx.objectStore('drafts').get('draft');draft.onsuccess=()=>{const all=os.getAll();all.onsuccess=()=>{const held=new Set([...(draft.result?.files||[]).map(f=>f.id),...all.result.filter(x=>x.id!==id&&live(x)).flatMap(x=>x.files.map(f=>f.id))]);for(const f of r.files)if(!held.has(f.id))tx.objectStore('assets').delete(f.id);os.delete(id);done({server_ack:{messages:r.messages.map(m=>r.parts[m.id].ack),at:new Date().toISOString()}})}};
   }catch(e){fail(e)}}
  })}
  async failed(id,owner,e,offline=false){return this.change(id,r=>{if(r.lease?.owner!==owner)return false;const text=String(e?.message||e),transient=offline||e?.name==='AbortError'||e?.name==='TypeError'||/network|fetch|timeout|temporar|429|500|502|503|504|загрузк.*(прерван|ошиб)/i.test(text);r.attempts=(r.attempts||0)+1;r.retryable=transient;r.state=offline?'queued':'error';r.nextAttemptAt=transient?Date.now()+Math.min(30000,1000*2**Math.min(r.attempts-1,5)):0;r.error={message:text,at:new Date().toISOString(),retryable:transient};r.lease=null;r.version++})}
  async retry(id){return this.change(id,r=>{if(!live(r))throw Error('Повтор не требуется');if(r.lease&&r.lease.until>Date.now())throw Error('Отправка ещё выполняется');r.state='queued';r.error=null;r.lease=null;r.nextAttemptAt=0;r.retries++;r.version++})}
  async cancel(id){return this.change(id,r=>{if(r.state==='sending')throw Error('Нельзя отменить отправку с неизвестным результатом. Дождитесь ответа сервера.');if(r.state==='sent')throw Error('Сообщение уже отправлено');r.state='cancelled';r.lease=null;r.version++})}
 }
 window.PablicusStore=TransportStore;
 window.pablicusClientId=async function(group,part){const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode('pablicus/send/v1/'+group+'/'+part)));bytes[6]=(bytes[6]&15)|80;bytes[8]=(bytes[8]&63)|128;const h=[...bytes.slice(0,16)].map(n=>n.toString(16).padStart(2,'0')).join('');return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20)};
})();
