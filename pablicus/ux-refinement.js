/* Public UX refinement before Stage 3: stable chat chrome, unified headers, profile grouping. */
(function(){'use strict';
 const $=id=>document.getElementById(id), nav=$('mainNav'), content=$('screenContent'), app=$('app'), brand=$('brandTitle');
 if(!nav||!content)return;
 const AVATAR_KEY='public:profile-avatar:v1';
 const PAGE_LABELS={chats:'Чаты',feed:'Лента',tasks:'Дела',bots:'Боты',profile:'Профиль'};
 const ownAvatar=()=>{try{return localStorage.getItem(AVATAR_KEY)||''}catch{return''}};
 const iconSvg=path=>'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="'+path+'"/></svg>';
 function selectedPage(){const b=nav.querySelector('button.selected[data-page]');return b?.dataset.page||'chats'}
 function syncHomeTitle(){
   const factory=content.classList.contains('factory-active');
   const label=factory?'Фабрика':PAGE_LABELS[selectedPage()]||'Public';
   if(brand&&brand.textContent!==label)brand.textContent=label;
   const section=$('sectionTitle');if(section){section.textContent=label;section.hidden=true;}
 }
 nav.addEventListener('click',()=>setTimeout(syncHomeTitle,0));
 new MutationObserver(()=>requestAnimationFrame(syncHomeTitle)).observe(nav,{subtree:true,attributes:true,attributeFilter:['class']});
 new MutationObserver(()=>requestAnimationFrame(syncHomeTitle)).observe(content,{attributes:true,attributeFilter:['class']});
 syncHomeTitle();

 function syncChatChrome(){
   if(!app)return;
   const title=$('chatTitle'), heading=app.querySelector('.chatHeading'), canvasTab=$('canvasTab');
   const canvas=canvasTab?.getAttribute('aria-selected')==='true'||app.classList.contains('canvas-active');
   app.classList.toggle('public-canvas-visible',!!canvas);
   const composer=$('composer');if(composer?.hidden)composer.hidden=false;
   if(heading&&title){
     let avatar=heading.querySelector('.publicChatAvatar');
     if(!avatar){avatar=document.createElement('span');avatar.className='publicChatAvatar';heading.prepend(avatar);}
     const name=(title.textContent||'Разговор').trim();
     avatar.textContent=name.replace('@','').charAt(0).toUpperCase()||'?';
   }
 }
 if(app){
   $('canvasTab')?.addEventListener('click',()=>requestAnimationFrame(syncChatChrome));
   $('conversationTab')?.addEventListener('click',()=>requestAnimationFrame(syncChatChrome));
   const title=$('chatTitle');if(title)new MutationObserver(syncChatChrome).observe(title,{childList:true,characterData:true,subtree:true});
   syncChatChrome();
 }

 function resizeAvatar(file){return new Promise((resolve,reject)=>{const fr=new FileReader();fr.onerror=()=>reject(fr.error);fr.onload=()=>{const img=new Image();img.onerror=()=>reject(Error('Не удалось открыть фотографию'));img.onload=()=>{const s=Math.min(img.naturalWidth,img.naturalHeight),x=(img.naturalWidth-s)/2,y=(img.naturalHeight-s)/2,c=document.createElement('canvas');c.width=c.height=512;const g=c.getContext('2d');g.drawImage(img,x,y,s,s,0,0,512,512);resolve(c.toDataURL('image/jpeg',.86));};img.src=fr.result;};fr.readAsDataURL(file);});}
 function settingIcon(node,path){if(!node||node.querySelector('.publicSettingIcon'))return;const span=document.createElement('span');span.className='publicSettingIcon';span.innerHTML=iconSvg(path);node.prepend(span)}
 function decorateProfile(){
   const card=content.querySelector('.profileCard');if(!card)return;
   card.classList.add('publicProfile');
   const avatar=card.querySelector('.profileAvatar');
   const name=card.querySelector('h2');
   const username=name?.nextElementSibling?.classList.contains('muted')?name.nextElementSibling:null;
   if(name)name.classList.add('publicProfileName');if(username)username.classList.add('publicProfileUsername');
   if(avatar&&!avatar.dataset.ready){
     avatar.dataset.ready='1';const saved=ownAvatar();if(saved){avatar.textContent='';avatar.style.backgroundImage='url("'+saved.replace(/"/g,'%22')+'")';avatar.classList.add('has-photo');}
     const input=document.createElement('input');input.type='file';input.accept='image/*';input.hidden=true;input.className='publicAvatarInput';
     const edit=document.createElement('button');edit.type='button';edit.className='publicAvatarEdit';edit.setAttribute('aria-label','Изменить фотографию');edit.innerHTML=iconSvg('M12 20h9 M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4 11.5-11.5Z');
     edit.onclick=()=>input.click();input.onchange=async()=>{const f=input.files?.[0];if(!f)return;try{const data=await resizeAvatar(f);localStorage.setItem(AVATAR_KEY,data);avatar.textContent='';avatar.style.backgroundImage='url("'+data+'")';avatar.classList.add('has-photo');}finally{input.value='';}};
     avatar.append(input,edit);
   }
   let settingsEntry=card.querySelector('.publicSettingsEntry'), settingsPanel=card.querySelector('.publicSettingsPanel');
   if(!settingsEntry){settingsEntry=document.createElement('button');settingsEntry.type='button';settingsEntry.className='setting publicSettingsEntry';settingsEntry.innerHTML='<span class="publicSettingIcon">'+iconSvg('M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2 3.46-.08-.02a1.7 1.7 0 0 0-1.86.34l-.72.42a1.7 1.7 0 0 0-.82 1.72V23h-4v-.14a1.7 1.7 0 0 0-.82-1.72l-.72-.42a1.7 1.7 0 0 0-1.86-.34l-.08.02-2-3.46.06-.06A1.7 1.7 0 0 0 5.24 15l-.42-.72A1.7 1.7 0 0 0 3.1 13.5H3v-4h.1a1.7 1.7 0 0 0 1.72-.82l.42-.72A1.7 1.7 0 0 0 4.9 6.08L4.84 6l2-3.46.08.02a1.7 1.7 0 0 0 1.86-.34l.72-.42A1.7 1.7 0 0 0 10.32.08V0h4v.08a1.7 1.7 0 0 0 .82 1.72l.72.42a1.7 1.7 0 0 0 1.86.34l.08-.02 2 3.46-.06.08a1.7 1.7 0 0 0-.34 1.88l.42.72a1.7 1.7 0 0 0 1.72.82H22v4h-.46a1.7 1.7 0 0 0-1.72.82Z')+'</span><span>Настройки</span><span class="publicChevron">›</span>';card.append(settingsEntry);}
   if(!settingsPanel){settingsPanel=document.createElement('section');settingsPanel.className='publicSettingsPanel';settingsPanel.hidden=true;const head=document.createElement('div');head.className='publicSettingsHead';const back=document.createElement('button');back.type='button';back.className='publicSettingsBack';back.textContent='‹';const h=document.createElement('h3');h.textContent='Настройки';head.append(back,h);settingsPanel.append(head);back.onclick=()=>{settingsPanel.hidden=true;settingsEntry.hidden=false;};card.append(settingsPanel);settingsEntry.onclick=()=>{settingsEntry.hidden=true;settingsPanel.hidden=false;};}
   const keep=new Set([avatar,name,username,settingsEntry,settingsPanel].filter(Boolean));
   const share=card.querySelector('#shareProfile'),copy=card.querySelector('#copyProfileLink');if(share){keep.add(share);settingIcon(share,'M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7 M12 16V3 m-4 4 4-4 4 4')}if(copy){keep.add(copy);settingIcon(copy,'M8 8h11v11H8z M5 16H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h11a1 1 0 0 1 1 1v1')}
   for(const child of [...card.children]){if(keep.has(child)||child===settingsPanel)continue;settingsPanel.append(child);}
   for(const node of settingsPanel.querySelectorAll('button.setting')){
     const text=node.textContent||'';
     if(text.includes('главный экран'))settingIcon(node,'M12 5v14 M5 12h14');
     else if(text.includes('Выйти'))settingIcon(node,'M10 17l5-5-5-5 M15 12H3 M14 4h6a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-6');
     else if(text.includes('ключ')||text.includes('Ключ'))settingIcon(node,'M7 14a4 4 0 1 1 2.8 1.2L7 18H5v2H3v-3l4-3Z');
     else if(text.includes('уведом'))settingIcon(node,'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9 M10 21h4');
   }
 }
 let profileScheduled=false;
 const profileObserver=new MutationObserver(()=>{if(profileScheduled)return;profileScheduled=true;requestAnimationFrame(()=>{profileScheduled=false;if(selectedPage()==='profile')decorateProfile();});});
 profileObserver.observe(content,{childList:true,subtree:true});
 nav.addEventListener('click',()=>setTimeout(()=>{if(selectedPage()==='profile')decorateProfile();},0));
 if(selectedPage()==='profile')decorateProfile();
})();