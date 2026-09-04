/* Vision Talk — merge Files into Documents, v16 */
(()=>{
'use strict';
const VERSION='documents-v16';
const versionText='Vision Talk · '+VERSION;
const fileIcon=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/></svg>`;

function updateVersion(){
  const presence=document.querySelector('.chatPresence');
  if(presence&&presence.textContent!==versionText)presence.textContent=versionText;
  document.querySelectorAll('.small').forEach(el=>{
    if(el.textContent.includes('Vision talk')&&el.textContent!==versionText)el.textContent=versionText;
  });
}

function enhanceDocuments(hub){
  if(!hub?.isConnected)return;
  const documentTab=hub.querySelector('.attachmentTab[data-tab="document"]');
  if(!documentTab?.classList.contains('active'))return;
  const panel=hub.querySelector('#attachmentBodyV14 .attachmentPanel');
  const documentButton=hub.querySelector('#documentV14');
  if(!panel||!documentButton||hub.querySelector('#documentFileV16'))return;

  const fileButton=document.createElement('button');
  fileButton.id='documentFileV16';
  fileButton.className='panelAction';
  fileButton.innerHTML=`${fileIcon}<span><strong>Выбрать из файлов</strong><small>Любой файл из приложения «Файлы»</small></span>`;
  fileButton.addEventListener('click',()=>document.getElementById('filePickerV14')?.click());
  documentButton.insertAdjacentElement('afterend',fileButton);
}

function patchHub(hub){
  if(!hub||hub.dataset.documentsV16==='1')return;
  hub.dataset.documentsV16='1';

  const nav=hub.querySelector('.attachmentNav');
  hub.querySelector('.attachmentTab[data-tab="file"]')?.remove();
  if(nav)nav.style.gridTemplateColumns='repeat(5,minmax(0,1fr))';

  const documentTab=hub.querySelector('.attachmentTab[data-tab="document"]');
  const label=documentTab?.querySelector('span');
  if(label&&label.textContent!=='Документы')label.textContent='Документы';

  const body=hub.querySelector('#attachmentBodyV14');
  if(body){
    const bodyObserver=new MutationObserver(()=>enhanceDocuments(hub));
    bodyObserver.observe(body,{childList:true,subtree:true});
  }

  hub.addEventListener('click',()=>requestAnimationFrame(()=>enhanceDocuments(hub)),true);
  enhanceDocuments(hub);
  updateVersion();
}

const observer=new MutationObserver(()=>{
  const hub=document.getElementById('attachmentBackdrop');
  if(hub)patchHub(hub);
  updateVersion();
});
observer.observe(document.documentElement,{childList:true,subtree:true});

setTimeout(()=>{
  const hub=document.getElementById('attachmentBackdrop');
  if(hub)patchHub(hub);
  updateVersion();
},0);
})();