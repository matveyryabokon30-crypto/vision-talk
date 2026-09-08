/* Message actions are explicit user operations. Immutable delivery payloads stay untouched. */
(function(scope){
 'use strict';
 const EMOJIS=['👍','❤️','🔥','😂','😮','😢','🙏'];
 const FIELDS=['message_revision','edited_body','edited_content','edited_at','deleted_at'];
 const clone=value=>value==null?value:structuredClone(value);
 function effective(raw){
  if(!raw)return raw;
  if(raw.deleted_at)return{...raw,type:'text',body:'Сообщение удалено',attachment_path:null,attachment_metadata:null};
  return{...raw,body:raw.edited_body??raw.body,attachment_metadata:raw.edited_content??raw.attachment_metadata};
 }
 function textOf(raw,blockId=null){const m=effective(raw);if(!m||m.deleted_at)return'';if(m.type==='rich'){const blocks=m.attachment_metadata?.blocks||[];return blocks.filter(b=>b.type==='text'&&(!blockId||b.id===blockId)).map(b=>b.text||'').join('\n\n')}return m.body||''}
 function mediaOf(raw,blockId=null){const m=effective(raw);if(!m||m.deleted_at)return[];if(m.type==='rich')return(m.attachment_metadata?.blocks||[]).filter(b=>b.type!=='text'&&b.path&&(!blockId||b.id===blockId)).map(b=>({...b,blockId:b.id}));if(!m.attachment_path)return[];const md=m.attachment_metadata||{};return[{type:m.type,path:m.attachment_path,name:md.name||'Вложение',mime:md.mime_type||'',size:md.size_bytes||0}]}
 function create(options){
  const document=scope.document, node=(tag,className='',text)=>{const el=document.createElement(tag);el.className=className;if(text!==undefined)el.textContent=text;return el};
  const state=new Map(),uiRevision=new Map(),selected=new Set();
  let contextKey='',generation=0,inflight=null,pinFlight=null,pinsLoaded=false,lastPinsAt=0,pins=[],pinIndex=0,toolbar=null,pinBar=null,destroyed=false;
  const menu=scope.PablicusMessageMenu.create({onError:error=>options.onError?.(error)});
  const getContext=()=>options.getContext?.()||{};
  const keyOf=c=>[c.userId||'',c.conversationId||'',c.epoch??''].join(':');
  const icon=name=>scope.PablicusMessageMenu.icon(name);
  function clear(){generation++;menu.close({restoreFocus:false});state.clear();uiRevision.clear();selected.clear();contextKey='';inflight=null;pinFlight=null;pinsLoaded=false;lastPinsAt=0;pins=[];pinIndex=0;toolbar?.remove();toolbar=null;pinBar?.remove();pinBar=null;document.querySelector('#app>header')?.classList.remove('has-pinned');document.querySelectorAll('.messageSelected').forEach(el=>el.classList.remove('messageSelected'))}
  function context(){const c=getContext(),key=keyOf(c);if(key!==contextKey){clear();contextKey=key}return{...c,key,generation}}
  const live=c=>!destroyed&&c.generation===generation&&keyOf(getContext())===c.key;
  const messageById=(id,c=getContext())=>(c.rows||[]).find(m=>m.id===id);
  const currentMessage=raw=>messageById(raw.id)||raw;
  function bump(id){uiRevision.set(id,(uiRevision.get(id)||0)+1)}
  function revision(raw){return`${raw.message_revision||0}:${uiRevision.get(raw.id)||0}`}
  function repaint(){const c=getContext();options.onRows?.([...(c.rows||[])]);paintSelection()}
  async function rpc(name,args,c){const r=await options.rpc(name,args);if(!live(c))return null;if(r?.error)throw r.error;return r?.data}
  function notify(error,c){if(!c||live(c))options.onError?.(error)}
  function mergeRow(updated,c){if(!updated||!live(c))return;const list=getContext().rows||[],found=list.find(m=>m.id===updated.id);if(!found||Number(updated.message_revision||0)<Number(found.message_revision||0))return;options.onRows?.(list.map(m=>m.id===updated.id?{...m,...updated}:m));if(updated.deleted_at){selected.delete(updated.id);state.delete(updated.id);paintSelection()}}
  function summary(raw){const text=textOf(raw).replace(/\s+/g,' ').trim();if(text)return text.slice(0,130);const medias=mediaOf(raw);return medias.length===1?({audio:'Голосовое сообщение',image:'Фото',video:'Видео',document:'Документ'}[medias[0].type]||'Вложение'):medias.length+' вложения'}
  function paintPins(){
   const header=document.querySelector('#app>header');if(!header)return;
   if(!pins.length){pinBar?.remove();pinBar=null;header.classList.remove('has-pinned');return}
   if(!pinBar){pinBar=node('div');pinBar.id='pinnedMessages';header.append(pinBar)}
   header.classList.add('has-pinned');pinBar.replaceChildren();pinIndex%=pins.length;
   const raw=pins[pinIndex],button=node('button','pinnedMessage');button.type='button';button.dataset.pinnedMessageId=raw.id;button.setAttribute('aria-label','Перейти к закреплённому сообщению');
   const content=node('span','pinnedMessageText');content.append(node('small','','Закреплённое'+(pins.length>1?' · '+(pinIndex+1)+'/'+pins.length:'')),node('span','',summary(raw)));
   button.append(icon('pin'),content);button.onclick=()=>Promise.resolve(options.onLocate?.(effective(raw))).catch(options.onError);pinBar.append(button);
   if(pins.length>1){const next=node('button','pinnedNext');next.type='button';next.setAttribute('aria-label','Следующее закреплённое сообщение');next.append(icon('forward'));next.onclick=()=>{pinIndex=(pinIndex+1)%pins.length;paintPins()};pinBar.append(next)}
  }
  async function syncPins(c,force=false){if(!live(c)||pinsLoaded&&!force)return;if(pinFlight){await pinFlight;if(!force||!live(c))return}
   const job=(async()=>{const data=await rpc('get_pinned_messages',{p_conversation_id:c.conversationId},c);if(!live(c)||data===null)return;pins=(Array.isArray(data)?data:[]).filter(m=>!m.deleted_at);pinsLoaded=true;lastPinsAt=Date.now();paintPins()})();pinFlight=job;try{await job}finally{if(pinFlight===job)pinFlight=null}
  }
  async function sync({force=false}={}){
   const c=context();if(!c.userId||!c.conversationId||destroyed)return;
   if(inflight){if(!force)return inflight;await inflight.catch(()=>{});if(!live(c))return}
   const job=(async()=>{
    const list=c.rows||[],known=new Set(list.map(m=>m.id)),visible=[...document.querySelectorAll('#canvas .row[data-id]')].map(row=>row.dataset.id).filter(id=>known.has(id));
    const ids=[...new Set([...visible,...list.slice(-200).reverse().map(m=>m.id)])].slice(0,200);let pinChanged=false,changed=false;
    if(ids.length){const data=await rpc('get_message_actions',{p_conversation_id:c.conversationId,p_message_ids:ids},c);if(!live(c)||data===null)return;
     const metadata=new Map((Array.isArray(data)?data:[]).map(item=>[item.message_id,item]));
     const next=(getContext().rows||[]).map(raw=>{const action=metadata.get(raw.id);if(!action)return raw;const previous=state.get(raw.id);if(previous?.pinned!==action.pinned&&previous!==undefined)pinChanged=true;
      const visual={pinned:!!action.pinned,reactions:Array.isArray(action.reactions)?action.reactions:[]};
      if(JSON.stringify(previous)!==JSON.stringify(visual)){state.set(raw.id,visual);bump(raw.id);changed=true}
      if(Number(action.message_revision||0)<Number(raw.message_revision||0))return raw;
      const update={};for(const name of FIELDS){if(Object.prototype.hasOwnProperty.call(action,name)&&JSON.stringify(raw[name]??null)!==JSON.stringify(action[name]??null)){update[name]=action[name];changed=true}}
      if(action.deleted_at)selected.delete(raw.id);return Object.keys(update).length?{...raw,...update}:raw;
     });if(changed){options.onRows?.(next);paintSelection()}
    }
    await syncPins(c,force||pinChanged||Date.now()-lastPinsAt>=15000);
   })();inflight=job;try{await job}catch(error){notify(error,c)}finally{if(inflight===job)inflight=null}
  }
  async function setReaction(raw,emoji){const c=context(),m=currentMessage(raw);if(!live(c)||m.deleted_at)return;const mine=state.get(m.id)?.reactions?.find(r=>r.mine)?.emoji;await rpc('set_message_reaction',{p_conversation_id:c.conversationId,p_message_id:m.id,p_emoji:emoji,p_active:mine!==emoji},c);if(live(c))await sync({force:true})}
  async function togglePin(raw){const c=context(),m=currentMessage(raw);await rpc('set_message_pin',{p_conversation_id:c.conversationId,p_message_id:m.id,p_pinned:!state.get(m.id)?.pinned},c);if(live(c))await sync({force:true})}
  function failForm(error,status,button,c){if(!live(c))return;status.textContent=error?.code==='40001'?'Сообщение уже изменилось. Закройте окно и откройте редактирование снова.':error?.message||'Не удалось сохранить. Попробуйте ещё раз.';button.disabled=false}
  function editForm(raw,anchor,blockId){const c=context(),m=currentMessage(raw),form=node('form','chatActionEdit'),label=node('label','','Изменить сообщение'),textarea=node('textarea'),status=node('p','chatActionStatus'),save=node('button','chatActionSave','Сохранить');textarea.name='messageText';textarea.setAttribute('aria-label','Текст сообщения');textarea.rows=4;textarea.maxLength=12000;textarea.value=textOf(m,blockId);save.type='submit';status.setAttribute('role','status');label.append(textarea);form.append(label,status,save);const expected=+m.message_revision||0;
   form.onsubmit=async event=>{event.preventDefault();if(save.disabled||!live(c))return;if(!textarea.value.trim()){status.textContent='Введите текст сообщения.';return}save.disabled=true;status.textContent='';try{const updated=await rpc('edit_message_text',{p_conversation_id:c.conversationId,p_message_id:m.id,p_expected_revision:expected,p_text:textarea.value,p_block_id:blockId||null},c);if(!live(c))return;menu.close({restoreFocus:false});mergeRow(Array.isArray(updated)?updated[0]:updated,c);await sync({force:true})}catch(error){failForm(error,status,save,c)}};
   menu.open({anchor,content:form,title:'Редактировать сообщение'});
  }
  function edit(raw,anchor,blockId){const m=effective(currentMessage(raw)),texts=m.type==='rich'?(m.attachment_metadata?.blocks||[]).filter(b=>b.type==='text'):[];
   if(m.type!=='rich')return editForm(raw,anchor,null);if(blockId&&texts.some(b=>b.id===blockId))return editForm(raw,anchor,blockId);if(texts.length===1)return editForm(raw,anchor,texts[0].id);
   const picker=node('div','chatEditPicker');picker.append(node('p','chatActionCaption','Какой фрагмент изменить?'));for(const block of texts){const button=node('button','chatPickerRow',(block.text||'Текст').slice(0,120));button.type='button';button.dataset.blockId=block.id;button.onclick=()=>editForm(raw,anchor,block.id);picker.append(button)}menu.open({anchor,content:picker,title:'Выбрать фрагмент сообщения'});
  }
  function confirmDelete(messages,anchor){const c=context(),ids=messages.map(m=>m.id),form=node('div','chatActionDelete'),status=node('p','chatActionStatus'),buttons=node('div','chatActionButtons'),cancel=node('button','','Отмена'),remove=node('button','chatActionDanger','Удалить');remove.dataset.confirmDelete='';cancel.type=remove.type='button';status.setAttribute('role','status');form.append(node('p','chatActionCaption',ids.length===1?'Удалить сообщение у всех участников?':'Удалить выбранные сообщения у всех участников?'),status,buttons);buttons.append(cancel,remove);cancel.onclick=()=>menu.close();
   remove.onclick=async()=>{if(remove.disabled||!live(c))return;remove.disabled=true;status.textContent='';try{for(const id of ids){if(!live(c))return;const m=messageById(id);if(!m||m.deleted_at)continue;const updated=await rpc('delete_message',{p_conversation_id:c.conversationId,p_message_id:id,p_expected_revision:+m.message_revision||0},c);if(!live(c))return;mergeRow(Array.isArray(updated)?updated[0]:updated,c)}menu.close({restoreFocus:false});await sync({force:true})}catch(error){failForm(error,status,remove,c)}};
   menu.open({anchor,content:form,title:'Удалить сообщение'});
  }
  async function forward(messages,anchor){const c=context(),picker=node('div','chatForwardPicker'),heading=node('p','chatActionCaption','Куда переслать?'),status=node('p','chatActionStatus','Загружаем чаты…');picker.append(heading,status);menu.open({anchor,content:picker,title:'Переслать сообщение'});const data=await options.getDialogs();if(!live(c))return;status.textContent='';const list=Array.isArray(data)?data:[];
   if(!list.length){status.textContent='Сначала создайте разговор с получателем.';return}
   for(const d of list){const button=node('button','chatPickerRow',d.title||'Разговор');button.type='button';button.dataset.conversationId=d.id;button.onclick=async()=>{if(!live(c))return;menu.close({restoreFocus:false});const latest=messages.map(m=>messageById(m.id)||m).filter(m=>!m.deleted_at).map(effective);if(!latest.length)return;selected.clear();paintSelection();try{await options.onForward?.(d.id,latest)}catch(error){options.onError?.(error)}};picker.append(button)}
  }
  function download(raw,anchor,blockId){const items=mediaOf(currentMessage(raw),blockId);if(items.length===1)return options.onDownload?.(items[0]);const picker=node('div','chatDownloadPicker');for(const item of items){const button=node('button','chatPickerRow',item.name||'Вложение');button.type='button';button.onclick=()=>{menu.close({restoreFocus:false});Promise.resolve(options.onDownload?.(item)).catch(options.onError)};picker.append(button)}menu.open({anchor,content:picker,title:'Скачать вложение'})}
  function selectedMessages(){return(getContext().rows||[]).filter(m=>selected.has(m.id)&&!m.deleted_at)}
  function paintSelection(){
   const items=selectedMessages();if(!items.length){selected.clear();toolbar?.remove();toolbar=null}else{
    const composer=document.getElementById('composer');if(!composer)return;if(!toolbar){toolbar=node('div');toolbar.id='messageSelectionToolbar';toolbar.setAttribute('role','toolbar');toolbar.setAttribute('aria-label','Выбранные сообщения');composer.prepend(toolbar)}toolbar.replaceChildren();toolbar.append(node('span','selectionCount','Выбрано: '+items.length));
    const controls=[['copy','Скопировать выбранное',()=>scope.navigator.clipboard.writeText(items.map(m=>textOf(m)).filter(Boolean).join('\n\n'))],['forward','Переслать выбранное',button=>forward(items,button)]];
    if(items.every(m=>m.sender_id===getContext().userId))controls.push(['delete','Удалить выбранное',button=>confirmDelete(items,button)]);
    controls.push(['cancel','Отменить выбор',()=>{selected.clear();paintSelection()}]);
    for(const[id,label,run]of controls){const button=node('button','selectionAction');button.type='button';button.dataset.selectionAction=id;button.setAttribute('aria-label',label);button.append(icon(id==='cancel'?'close':id));if(id==='copy'&&!items.some(m=>textOf(m)))button.disabled=true;button.onclick=()=>Promise.resolve(run(button)).catch(options.onError);toolbar.append(button)}
   }
   document.querySelectorAll('#canvas .row[data-id]').forEach(row=>{const active=selected.has(row.dataset.id);row.classList.toggle('messageSelected',active);row.setAttribute('aria-selected',String(active));const mark=row.querySelector('.messageSelectMark');if(mark)mark.hidden=!active});options.onLayout?.();
  }
  function select(raw){if(selected.has(raw.id))selected.delete(raw.id);else{if(selected.size>=20)throw Error('За один раз можно выбрать до 20 сообщений.');selected.add(raw.id)}paintSelection()}
  function open(raw,{anchor,point,blockId=null}={}){
   const c=context(),m=currentMessage(raw);if(!c.userId||!c.conversationId||m.conversation_id!==c.conversationId||m.deleted_at||!anchor?.isConnected)return;
   const actions=[{id:'reply',label:'Ответить',onSelect:()=>options.onReply?.(effective(m),blockId)}];const text=textOf(m,blockId);if(text)actions.push({id:'copy',label:'Скопировать',onSelect:()=>scope.navigator.clipboard.writeText(text)});
   actions.push({id:'pin',label:state.get(m.id)?.pinned?'Открепить':'Закрепить',onSelect:()=>togglePin(m)},{id:'forward',label:'Переслать',onSelect:()=>forward([m],anchor)});
   if(m.sender_id===c.userId&&textOf(m))actions.push({id:'edit',label:'Редактировать',onSelect:()=>edit(m,anchor,blockId)});
   if(mediaOf(m,blockId).length)actions.push({id:'download',label:'Скачать',onSelect:()=>download(m,anchor,blockId)});
   if(m.sender_id===c.userId)actions.push({id:'delete',label:'Удалить',danger:true,onSelect:()=>confirmDelete([m],anchor)});
   actions.push({id:'select',label:'Выбрать',separator:true,onSelect:()=>select(m)});
   const reactions=EMOJIS.map(emoji=>({id:emoji,emoji,label:emoji,selected:!!state.get(m.id)?.reactions?.some(r=>r.emoji===emoji&&r.mine)}));menu.open({anchor,point,actions,reactions,onReaction:emoji=>setReaction(m,emoji),onError:error=>notify(error,c)});
  }
  function decorate(row,bubble,raw){
   if(raw.deleted_at){bubble.classList.add('deletedMessage');return}
   const button=node('button','messageActions');button.type='button';button.setAttribute('aria-label','Действия с сообщением');button.textContent='⋯';button.onclick=event=>{event.stopPropagation();open(raw,{anchor:bubble})};bubble.append(button);
   const mark=node('span','messageSelectMark');mark.hidden=!selected.has(raw.id);mark.append(icon('check'));mark.setAttribute('aria-hidden','true');row.append(mark);row.classList.toggle('messageSelected',selected.has(raw.id));
   const metadata=state.get(raw.id);if(metadata?.reactions?.length){const reactions=node('div','messageReactions');for(const r of metadata.reactions){const react=node('button','messageReaction',r.emoji+' '+r.count);react.type='button';react.dataset.emoji=r.emoji;react.setAttribute('aria-label',r.emoji+' · '+r.count);react.setAttribute('aria-pressed',r.mine?'true':'false');react.onclick=event=>{event.stopPropagation();setReaction(raw,r.emoji).catch(options.onError)};reactions.append(react)}bubble.append(reactions)}
   if(raw.edited_at){const meta=bubble.querySelector('.meta');if(meta&&!meta.querySelector('.messageEdited'))meta.append(node('span','messageEdited',' · изм.'))}
   let timer=0,start=null,suppressUntil=0;const blockFor=event=>raw.type==='rich'?event.target.closest('[data-block-id]')?.dataset.blockId||null:null;
   const cancel=()=>{if(timer)scope.clearTimeout(timer);timer=0;start=null};
   bubble.addEventListener('contextmenu',event=>{event.preventDefault();event.stopPropagation();open(raw,{anchor:bubble,point:{x:event.clientX,y:event.clientY},blockId:blockFor(event)})});
   bubble.addEventListener('pointerdown',event=>{if(event.pointerType==='mouse'||event.button!==0||event.target.closest('button,input,a,video,audio,textarea'))return;cancel();start={x:event.clientX,y:event.clientY};timer=scope.setTimeout(()=>{timer=0;if(!bubble.isConnected)return;suppressUntil=Date.now()+900;open(raw,{anchor:bubble,point:{x:event.clientX,y:event.clientY},blockId:blockFor(event)})},500)});
   bubble.addEventListener('pointermove',event=>{if(start&&Math.hypot(event.clientX-start.x,event.clientY-start.y)>10)cancel()});for(const name of['pointerup','pointercancel','pointerleave'])bubble.addEventListener(name,cancel);
   bubble.addEventListener('click',event=>{if(Date.now()<suppressUntil){event.preventDefault();event.stopImmediatePropagation();return}if(selected.size){event.preventDefault();event.stopImmediatePropagation();try{select(raw)}catch(error){options.onError?.(error)}return}if(event.target.closest('button,input,a,video,audio,textarea')||scope.getSelection?.().toString())return;open(raw,{anchor:bubble,point:{x:event.clientX,y:event.clientY},blockId:blockFor(event)})},true);
  }
  function destroy(){clear();destroyed=true;menu.destroy()}
  return Object.freeze({open,decorate,revision,sync,clear,destroy,effective,get selected(){return [...selected]}});
 }
 scope.PablicusChatActions=Object.freeze({create,effective});
})(typeof window==='undefined'?globalThis:window);
