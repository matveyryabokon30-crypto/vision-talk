/* Vision Talk — private Supabase media transport, v17 */
(()=>{
'use strict';

const VERSION='media-v17';
const BUCKET='message-media';
const MAX_BYTES=100*1024*1024;
const baseAppendMessages=typeof appendMessages==='function'?appendMessages:null;
const baseOpenConversation=typeof openConversation==='function'?openConversation:null;
const baseRenderDialogs=typeof renderDialogs==='function'?renderDialogs:null;
const signedCache=new Map();
const selection=[];
const selectionUrls=[];
const jobs=[];
let activeTab='gallery';
let processing=false;

const icon={
  close:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>`,
  camera:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 6 13 4h-2L9.5 6H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-4.5Z"/><circle cx="12" cy="12.5" r="3.5"/></svg>`,
  photo:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.5"/><path d="m21 15-5-5L5 20"/></svg>`,
  file:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/></svg>`,
  pin:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></svg>`,
  contact:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>`,
  scan:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4M7 12h10"/></svg>`,
  live:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="2"/><path d="M8.5 8.5a5 5 0 0 0 0 7M15.5 8.5a5 5 0 0 1 0 7M5.5 5.5a9 9 0 0 0 0 13M18.5 5.5a9 9 0 0 1 0 13"/></svg>`
};

const html=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const newId=()=>globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random().toString(36).slice(2)}`;
const isMediaMessage=m=>Boolean(m?.attachment_path&&['image','video','document','file'].includes(m.type));
const totalSelectedBytes=()=>selection.reduce((sum,x)=>sum+x.file.size,0);

function formatSize(bytes){
  const n=Number(bytes||0);
  if(n<1024)return `${n} Б`;
  if(n<1048576)return `${(n/1024).toFixed(n<10240?1:0)} КБ`;
  return `${(n/1048576).toFixed(n<10485760?1:0)} МБ`;
}

function safeName(name,mime){
  const raw=String(name||'attachment').normalize('NFKC').replace(/[\\/]+/g,'-').replace(/[\u0000-\u001f\u007f]+/g,'').trim();
  const cleaned=(raw||'attachment').replace(/\s+/g,' ').slice(0,100);
  if(cleaned.includes('.'))return cleaned;
  const ext=String(mime||'').split('/')[1]?.replace(/[^a-z0-9]/gi,'').slice(0,8);
  return ext?`${cleaned}.${ext}`:cleaned;
}

function classify(file,source){
  if(source==='document'||source==='files'||source==='scan')return 'document';
  if(String(file.type).startsWith('image/'))return 'image';
  if(String(file.type).startsWith('video/'))return 'video';
  return 'document';
}

function clearSelection(){
  for(const url of selectionUrls.splice(0))URL.revokeObjectURL(url);
  selection.splice(0);
}

function closeHub(discard=true){
  document.getElementById('attachmentBackdrop')?.remove();
  if(discard)clearSelection();
}

function picker(id){document.getElementById(id)?.click()}

function ensureInputs(){
  const shell=document.querySelector('.chatShell');
  if(!shell||document.getElementById('vtGalleryInput'))return;
  const defs=[
    ['vtGalleryInput','image/*,video/*',true,'gallery',''],
    ['vtCameraInput','image/*,video/*',false,'camera','environment'],
    ['vtDocumentInput','.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.rtf,.zip,.rar,.7z',true,'document',''],
    ['vtFilesInput','',true,'files',''],
    ['vtScanInput','image/*',false,'scan','environment'],
    ['vtContactInput','.vcf,text/vcard,text/x-vcard',false,'contact','']
  ];
  for(const [id,accept,multiple,source,capture] of defs){
    const input=document.createElement('input');
    input.id=id;
    input.type='file';
    input.hidden=true;
    if(accept)input.accept=accept;
    if(multiple)input.multiple=true;
    if(capture)input.setAttribute('capture',capture);
    input.dataset.source=source;
    shell.appendChild(input);
  }
  for(const id of ['vtGalleryInput','vtCameraInput','vtDocumentInput','vtFilesInput','vtScanInput']){
    const input=document.getElementById(id);
    input.addEventListener('change',()=>{
      addSelectedFiles(input.files,input.dataset.source);
      input.value='';
    });
  }
  document.getElementById('vtContactInput').addEventListener('change',readContactFile);
}

function addSelectedFiles(fileList,source){
  let rejected=0;
  for(const file of Array.from(fileList||[])){
    if(!file||file.size<=0)continue;
    if(file.size>MAX_BYTES){rejected++;continue}
    const key=`${file.name}:${file.size}:${file.lastModified}`;
    if(selection.some(x=>x.key===key))continue;
    const kind=classify(file,source);
    let url='';
    if(kind==='image'||kind==='video'){
      url=URL.createObjectURL(file);
      selectionUrls.push(url);
    }
    selection.push({key,file,kind,source,url});
  }
  if(rejected)showStatus(`Файл больше 100 МБ не добавлен`,'bad');
  renderHub();
}

function removeSelected(key){
  const index=selection.findIndex(x=>x.key===key);
  if(index<0)return;
  const [entry]=selection.splice(index,1);
  if(entry.url){URL.revokeObjectURL(entry.url);const i=selectionUrls.indexOf(entry.url);if(i>=0)selectionUrls.splice(i,1)}
  renderHub();
}

async function readContactFile(event){
  const input=event.currentTarget;
  const file=input.files?.[0];
  input.value='';
  if(!file)return;
  try{
    const text=await file.text();
    const name=(text.match(/^FN:(.+)$/mi)?.[1]||file.name).trim();
    const tel=(text.match(/^TEL[^:]*:(.+)$/mi)?.[1]||'').trim();
    const email=(text.match(/^EMAIL[^:]*:(.+)$/mi)?.[1]||'').trim();
    sendTextPayload(['👤 '+name,tel,email].filter(Boolean).join('\n'));
  }catch{
    showStatus('Не удалось прочитать контакт','bad');
  }
}

function tab(id,label,svg){
  return `<button class="attachmentTab ${activeTab===id?'active':''}" data-tab="${id}">${svg}<span>${label}</span></button>`;
}

function selectedFileList(predicate=()=>true){
  const list=selection.filter(predicate);
  if(!list.length)return '';
  return `<div class="selectedFiles">${list.map(entry=>`<div class="selectedFile"><div class="selectedFileIcon">${entry.kind==='image'?icon.photo:entry.kind==='video'?icon.camera:icon.file}</div><div><div class="selectedFileName">${html(entry.file.name)}</div><div class="selectedFileMeta">${formatSize(entry.file.size)}</div></div></div>`).join('')}</div>`;
}

function galleryPanel(){
  const media=selection.filter(x=>x.kind==='image'||x.kind==='video');
  const thumbs=media.map(entry=>`<button class="mediaThumb isRemovable" data-remove="${html(entry.key)}">${entry.kind==='video'?`<video src="${entry.url}" muted playsinline preload="metadata"></video><span class="mediaType">Видео</span>`:`<img src="${entry.url}" alt="">`}<span class="mediaCheck">✓</span></button>`).join('');
  const empty=Math.max(0,3-media.length);
  return `<div class="galleryLead"><button id="vtCameraTile" class="cameraTile">${icon.camera}<span>Камера</span></button><div class="gallerySide">${thumbs}${Array.from({length:empty},()=>'<button class="galleryPlaceholder" data-gallery-open></button>').join('')}<button id="vtGalleryOpen" class="galleryOpen">${icon.photo}<span>Открыть галерею</span></button></div></div>`;
}

function attachmentPanel(){
  switch(activeTab){
    case 'gallery': return galleryPanel();
    case 'location': return `<div class="attachmentPanel"><button id="vtLocationNow" class="panelAction">${icon.pin}<span><strong>Отправить геопозицию</strong><small>Текущая точка по GPS</small></span></button><button id="vtLocationLive" class="panelAction">${icon.live}<span><strong>Транслировать геопозицию</strong><small>Live-геопозиция — отдельный серверный блок</small></span></button></div>`;
    case 'contact': return `<div class="attachmentPanel"><button id="vtContact" class="panelHero">${icon.contact}<h3>Контакт</h3><p>Выберите контакт из системного списка или карточку vCard.</p></button></div>`;
    case 'document': return `<div class="attachmentPanel"><button id="vtDocument" class="panelAction">${icon.file}<span><strong>Выбрать документ</strong><small>PDF, Word, Excel, презентации и архивы</small></span></button><button id="vtFiles" class="panelAction">${icon.file}<span><strong>Выбрать из файлов</strong><small>Любой файл из приложения «Файлы»</small></span></button><button id="vtDocumentScan" class="panelAction">${icon.scan}<span><strong>Сканировать документ</strong><small>Открыть камеру для скана</small></span></button>${selectedFileList(x=>x.kind==='document')}</div>`;
    case 'scan': return `<div class="attachmentPanel"><button id="vtScan" class="panelHero">${icon.scan}<h3>Сканер документов</h3><p>Откройте камеру и снимите документ.</p></button>${selectedFileList(x=>x.source==='scan')}</div>`;
    default: return galleryPanel();
  }
}

function hubTitle(){
  return ({gallery:'Недавние',location:'Геопозиция',contact:'Контакты',document:'Документы',scan:'Сканер'}[activeTab]||'Вложения');
}

function renderHub(){
  const body=document.getElementById('attachmentBodyV17');
  const title=document.getElementById('attachmentTitleV17');
  const dock=document.getElementById('attachmentSendDockV17');
  const button=document.getElementById('attachmentSendV17');
  if(!body)return;
  body.innerHTML=attachmentPanel();
  if(title)title.innerHTML=`${hubTitle()}<span class="sheetSubtitle">${selection.length?`Выбрано: ${selection.length}`:VERSION}</span>`;
  document.querySelectorAll('.attachmentTab').forEach(x=>x.classList.toggle('active',x.dataset.tab===activeTab));
  if(dock)dock.classList.toggle('visible',selection.length>0);
  if(button){button.disabled=processing;button.innerHTML=`Отправить ${selection.length||''}${selection.length?`<span class="sendSize">${formatSize(totalSelectedBytes())}</span>`:''}`}
  bindHub();
}

function bindHub(){
  document.getElementById('vtCameraTile')?.addEventListener('click',()=>picker('vtCameraInput'));
  document.getElementById('vtGalleryOpen')?.addEventListener('click',()=>picker('vtGalleryInput'));
  document.querySelectorAll('[data-gallery-open]').forEach(x=>x.addEventListener('click',()=>picker('vtGalleryInput')));
  document.querySelectorAll('[data-remove]').forEach(x=>x.addEventListener('click',()=>removeSelected(x.dataset.remove)));
  document.getElementById('vtDocument')?.addEventListener('click',()=>picker('vtDocumentInput'));
  document.getElementById('vtFiles')?.addEventListener('click',()=>picker('vtFilesInput'));
  document.getElementById('vtDocumentScan')?.addEventListener('click',()=>picker('vtScanInput'));
  document.getElementById('vtScan')?.addEventListener('click',()=>picker('vtScanInput'));
  document.getElementById('vtLocationNow')?.addEventListener('click',sendCurrentLocation);
  document.getElementById('vtLocationLive')?.addEventListener('click',()=>showStatus('Live-геопозицию подключаем отдельным серверным блоком'));
  document.getElementById('vtContact')?.addEventListener('click',chooseContact);
}

function openHub(){
  if(document.getElementById('attachmentBackdrop')){closeHub();return}
  const shell=document.querySelector('.chatShell');
  if(!shell)return;
  clearSelection();
  activeTab='gallery';
  ensureInputs();
  document.getElementById('message')?.blur();
  const backdrop=document.createElement('div');
  backdrop.id='attachmentBackdrop';
  backdrop.className='attachmentBackdrop';
  backdrop.innerHTML=`<section class="attachmentSheet" role="dialog" aria-modal="true"><header class="attachmentHeader"><button id="attachmentCloseV17" class="iconBtn sheetClose" aria-label="Закрыть">${icon.close}</button><div id="attachmentTitleV17" class="sheetTitle"></div><span class="sheetSpacer"></span></header><main id="attachmentBodyV17" class="attachmentBody"></main><div id="attachmentSendDockV17" class="attachmentSendDock"><button id="attachmentSendV17" class="attachmentSendButton">Отправить</button></div><nav class="attachmentNav">${tab('gallery','Галерея',icon.photo)}${tab('location','Геопозиция',icon.pin)}${tab('contact','Контакт',icon.contact)}${tab('document','Документы',icon.file)}${tab('scan','Сканер',icon.scan)}</nav></section>`;
  shell.appendChild(backdrop);
  backdrop.addEventListener('click',event=>{if(event.target===backdrop)closeHub()});
  backdrop.querySelector('.attachmentSheet').addEventListener('click',event=>event.stopPropagation());
  document.getElementById('attachmentCloseV17').onclick=()=>closeHub();
  document.getElementById('attachmentSendV17').onclick=sendSelection;
  backdrop.querySelectorAll('.attachmentTab').forEach(x=>x.onclick=()=>{activeTab=x.dataset.tab;renderHub()});
  renderHub();
}

async function chooseContact(){
  try{
    if(navigator.contacts?.select){
      const result=await navigator.contacts.select(['name','tel','email'],{multiple:false});
      const contact=result?.[0];
      if(!contact)return;
      sendTextPayload(['👤 '+(contact.name?.[0]||'Контакт'),contact.tel?.[0]||'',contact.email?.[0]||''].filter(Boolean).join('\n'));
      return;
    }
  }catch(error){console.warn(error)}
  picker('vtContactInput');
}

function sendCurrentLocation(){
  if(!navigator.geolocation){showStatus('Геолокация недоступна','bad');return}
  showStatus('Определяю геопозицию…');
  navigator.geolocation.getCurrentPosition(position=>{
    const lat=position.coords.latitude.toFixed(6);
    const lng=position.coords.longitude.toFixed(6);
    sendTextPayload(`📍 Геопозиция\nhttps://maps.google.com/?q=${lat},${lng}`);
  },error=>showStatus(error.message||'Не удалось получить геопозицию','bad'),{enableHighAccuracy:true,timeout:12000,maximumAge:30000});
}

function sendTextPayload(text){
  const input=document.getElementById('message');
  if(!input||!text)return;
  closeHub();
  input.value=text;
  input.dispatchEvent(new Event('input',{bubbles:true}));
  sendCurrent();
}

function buildJob(entry){
  const clientId=newId();
  const previewUrl=(entry.kind==='image'||entry.kind==='video')?URL.createObjectURL(entry.file):'';
  return {
    clientId,
    conversationId:currentConversation.id,
    file:entry.file,
    kind:entry.kind,
    mime:entry.file.type||'application/octet-stream',
    name:entry.file.name||'Файл',
    size:entry.file.size,
    path:`${currentConversation.id}/${session.user.id}/${clientId}/${safeName(entry.file.name,entry.file.type)}`,
    previewUrl,
    status:'queued',
    uploaded:false,
    error:''
  };
}

function sendSelection(){
  if(!selection.length||!currentConversation||processing)return;
  const entries=selection.slice();
  const created=entries.map(buildJob);
  jobs.push(...created);
  closeHub();
  for(const job of created)appendPendingMedia(job,true);
  processJobs();
}

function pendingMediaMarkup(job){
  const status=job.status==='uploading'?'Загрузка в защищённое хранилище…':job.status==='sending'?'Создаю сообщение…':job.status==='error'?'Не удалось отправить':'Ожидает сети';
  if(job.kind==='document'){
    return `<div class="mediaPendingDocument"><div class="documentIcon">${icon.file}</div><div><div class="documentTitle">${html(job.name)}</div><div class="documentMeta">${formatSize(job.size)}</div></div></div><div class="mediaPendingStatus">${html(status)}${job.status==='error'?`<br><button class="mediaRetry" data-retry="${job.clientId}">Повторить</button>`:''}</div>`;
  }
  return `<div class="mediaPendingPreview">${job.kind==='video'?`<video src="${job.previewUrl}" muted playsinline preload="metadata"></video>`:`<img src="${job.previewUrl}" alt="">`}<div class="mediaProgressOverlay">${job.status==='error'?'':`<span class="mediaProgressSpinner"></span>`}<span>${html(status)}</span>${job.status==='error'?`<button class="mediaRetry" data-retry="${job.clientId}">Повторить</button>`:''}</div></div>`;
}

function appendPendingMedia(job,forceScroll=false){
  if(!currentConversation||job.conversationId!==currentConversation.id)return;
  const messages=document.getElementById('messages');
  if(!messages||document.getElementById(`media-pending-${job.clientId}`))return;
  const near=(messages.scrollHeight-messages.scrollTop-messages.clientHeight)<=140;
  const row=document.createElement('div');
  row.id=`media-pending-${job.clientId}`;
  row.className='row mine pending mediaMessage';
  row.dataset.mine='1';
  const bubble=document.createElement('div');
  bubble.className='bubble';
  bubble.innerHTML=pendingMediaMarkup(job);
  row.appendChild(bubble);
  messages.appendChild(row);
  bindRetry(row);
  if(forceScroll||near)requestAnimationFrame(()=>{messages.scrollTop=messages.scrollHeight});
}

function repaintJob(job){
  const row=document.getElementById(`media-pending-${job.clientId}`);
  if(!row)return;
  row.querySelector('.bubble').innerHTML=pendingMediaMarkup(job);
  bindRetry(row);
}

function bindRetry(scope){
  scope.querySelectorAll('[data-retry]').forEach(button=>button.onclick=()=>{
    const job=jobs.find(x=>x.clientId===button.dataset.retry);
    if(!job)return;
    job.status='queued';
    job.error='';
    repaintJob(job);
    processJobs();
  });
}

function isNetworkError(error){
  const text=String(error?.message||error||'').toLowerCase();
  return !navigator.onLine||text.includes('fetch')||text.includes('network')||text.includes('offline')||text.includes('load failed');
}

async function uploadJob(job){
  if(!job.uploaded){
    job.status='uploading';
    repaintJob(job);
    const {error}=await sb.storage.from(BUCKET).upload(job.path,job.file,{cacheControl:'3600',contentType:job.mime,upsert:false});
    if(error&&!/already exists|duplicate|resource exists/i.test(String(error.message||error)))throw error;
    job.uploaded=true;
  }
  job.status='sending';
  repaintJob(job);
  const {data,error}=await sb.rpc('send_attachment_message',{
    p_conversation_id:job.conversationId,
    p_client_message_id:job.clientId,
    p_type:job.kind,
    p_attachment_path:job.path,
    p_attachment_name:job.name,
    p_mime_type:job.mime,
    p_size_bytes:job.size,
    p_caption:null
  });
  if(error)throw error;
  if(data&&currentConversation?.id===job.conversationId)appendMessages([data],true);
  job.status='done';
  setTimeout(()=>{if(job.previewUrl)URL.revokeObjectURL(job.previewUrl)},5000);
}

async function processJobs(){
  if(processing||!navigator.onLine||!session)return;
  processing=true;
  try{
    for(const job of jobs){
      if(job.status==='done'||job.status==='error')continue;
      try{
        await uploadJob(job);
      }catch(error){
        console.error(error);
        job.error=String(error?.message||error||'Ошибка загрузки');
        if(isNetworkError(error)){
          job.status='queued';
          repaintJob(job);
          showStatus('Сеть потеряна · медиа останется в очереди','bad');
          break;
        }
        job.status='error';
        repaintJob(job);
        showStatus(job.error,'bad');
      }
    }
  }finally{
    processing=false;
  }
}

function metadataOf(message){
  const meta=message?.attachment_metadata;
  if(meta&&typeof meta==='object')return meta;
  if(typeof meta==='string'){try{return JSON.parse(meta)}catch{return {}}}
  return {};
}

async function signedUrl(path){
  const cached=signedCache.get(path);
  if(cached&&cached.expires>Date.now())return cached.url;
  const {data,error}=await sb.storage.from(BUCKET).createSignedUrl(path,3600);
  if(error)throw error;
  const url=data?.signedUrl;
  if(!url)throw new Error('signed URL missing');
  signedCache.set(path,{url,expires:Date.now()+50*60*1000});
  return url;
}

function mediaBubbleHtml(message){
  const meta=metadataOf(message);
  const name=meta.name||'Файл';
  const sizeText=formatSize(meta.size_bytes||0);
  const caption=message.body?`<div class="mediaCaption">${html(message.body)}</div>`:'';
  const footer=`<div class="mediaFooter"><span class="mediaName">${html(name)}</span><span class="seq">${html(metaText(message.server_seq,message.sender_id===session.user.id))}</span></div>`;
  if(message.type==='document'||message.type==='file'){
    return `<a class="documentCard" data-media-link href="#" target="_blank" rel="noopener"><div class="documentIcon">${icon.file}</div><div><div class="documentTitle">${html(name)}</div><div class="documentMeta">${html(sizeText||'Документ')}</div></div></a>${caption}${footer}`;
  }
  return `<div class="mediaFrame mediaLoading" data-media-frame>Загрузка…</div>${caption}${footer}`;
}

async function hydrateMedia(row,message){
  try{
    const url=await signedUrl(message.attachment_path);
    if(!row.isConnected)return;
    if(message.type==='document'||message.type==='file'){
      const link=row.querySelector('[data-media-link]');
      if(link)link.href=url;
      return;
    }
    const frame=row.querySelector('[data-media-frame]');
    if(!frame)return;
    frame.classList.remove('mediaLoading');
    if(message.type==='video')frame.innerHTML=`<video src="${html(url)}" controls playsinline preload="metadata"></video>`;
    else frame.innerHTML=`<a href="${html(url)}" target="_blank" rel="noopener"><img src="${html(url)}" alt="${html(metadataOf(message).name||'Фото')}"></a>`;
  }catch(error){
    const target=row.querySelector('[data-media-frame]')||row.querySelector('.documentCard');
    if(target)target.outerHTML=`<div class="mediaError">Не удалось загрузить вложение<br><button class="mediaRetry" data-reload-media>Повторить</button></div>`;
    row.querySelector('[data-reload-media]')?.addEventListener('click',()=>hydrateMedia(row,message));
  }
}

function appendMediaMessage(message){
  const messages=document.getElementById('messages');
  if(!messages)return false;
  const key=message.client_message_id||message.id;
  if(renderedIds.has(key))return false;
  const mine=message.sender_id===session.user.id;
  let row=document.getElementById(`media-pending-${key}`);
  if(!row){
    row=document.createElement('div');
    row.className=`row ${mine?'mine':''} mediaMessage`;
    const bubble=document.createElement('div');
    bubble.className='bubble';
    row.appendChild(bubble);
  }else{
    row.removeAttribute('id');
    row.classList.remove('pending');
  }
  row.classList.add('mediaMessage');
  row.dataset.mine=mine?'1':'0';
  row.querySelector('.bubble').innerHTML=mediaBubbleHtml(message);
  renderedIds.add(key);
  lastRenderedSeq=Math.max(lastRenderedSeq,Number(message.server_seq||0));
  insertConfirmedRow(messages,row,message.server_seq);
  hydrateMedia(row,message);
  return true;
}

if(baseAppendMessages){
  appendMessages=function(list,forceScroll=false){
    const messages=document.getElementById('messages');
    const near=messages?(messages.scrollHeight-messages.scrollTop-messages.clientHeight)<=140:false;
    const text=[];
    let changed=false;
    for(const message of list||[]){
      if(isMediaMessage(message))changed=appendMediaMessage(message)||changed;
      else text.push(message);
    }
    if(text.length)baseAppendMessages(text,false);
    if(messages&&(forceScroll||near)&&(changed||text.length))requestAnimationFrame(()=>{messages.scrollTop=messages.scrollHeight});
  };
}

loadInitialMessages=async function(conversation){
  if(!conversation||currentConversation?.id!==conversation.id)return;
  const {data,error}=await sb.from('messages').select('id,client_message_id,conversation_id,server_seq,sender_id,type,body,attachment_path,attachment_metadata,created_at').eq('conversation_id',conversation.id).order('server_seq',{ascending:true});
  const messages=document.getElementById('messages');
  if(!messages)return;
  if(error){messages.innerHTML=`<div class="error">${html(error.message)}</div>`;return}
  renderedIds.clear();
  messages.textContent='';
  appendMessages(data||[],true);
};

syncNewMessages=async function(conversation,forceScroll=false){
  if(!conversation||currentConversation?.id!==conversation.id)return;
  const {data,error}=await sb.from('messages').select('id,client_message_id,conversation_id,server_seq,sender_id,type,body,attachment_path,attachment_metadata,created_at').eq('conversation_id',conversation.id).gt('server_seq',lastRenderedSeq).order('server_seq',{ascending:true});
  if(error||currentConversation?.id!==conversation.id)return;
  if(data?.length)appendMessages(data,forceScroll);
  updatePendingRows();
};

function install(){
  const shell=document.querySelector('.chatShell');
  if(!shell)return;
  ensureInputs();
  const attach=document.getElementById('attach');
  const camera=document.getElementById('camera');
  const messages=document.getElementById('messages');
  const input=document.getElementById('message');
  if(attach)attach.onclick=openHub;
  if(camera)camera.onclick=()=>picker('vtCameraInput');
  if(messages&&!messages.dataset.mediaClose){
    messages.dataset.mediaClose='1';
    messages.addEventListener('pointerdown',()=>{if(document.getElementById('attachmentBackdrop'))closeHub()},{passive:true});
  }
  if(input&&!input.dataset.mediaClose){
    input.dataset.mediaClose='1';
    input.addEventListener('focus',()=>{if(document.getElementById('attachmentBackdrop'))closeHub()});
  }
  document.querySelector('.chatPresence')?.replaceChildren(document.createTextNode(`Vision Talk · ${VERSION}`));
  for(const job of jobs.filter(x=>x.status!=='done'&&x.conversationId===currentConversation?.id))appendPendingMedia(job,false);
}

try{openTools=openHub;closeTools=closeHub}catch{}

if(baseOpenConversation){
  openConversation=async function(...args){
    const result=await baseOpenConversation(...args);
    install();
    return result;
  };
}

if(baseRenderDialogs){
  renderDialogs=async function(...args){
    closeHub();
    const result=await baseRenderDialogs(...args);
    document.querySelectorAll('.small').forEach(x=>{if(x.textContent.includes('Vision talk'))x.textContent=`Vision talk · ${VERSION}`});
    return result;
  };
}

window.addEventListener('online',processJobs);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)processJobs()});
const observer=new MutationObserver(()=>{if(document.querySelector('.chatShell'))install()});
observer.observe(document.documentElement,{childList:true,subtree:true});
setTimeout(install,0);
window.VisionTalkMediaTransport={version:VERSION,open:openHub,process:processJobs,jobs};
})();