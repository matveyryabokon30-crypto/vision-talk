/* Public UX refinement before Stage 3: fixed chat chrome, canvas composer and profile avatar. */
(function(){'use strict';
 const $=id=>document.getElementById(id), nav=$('mainNav'), content=$('screenContent'), app=$('app');
 if(!nav||!content)return;
 const AVATAR_KEY='public:profile-avatar:v1';
 function ownAvatar(){try{return localStorage.getItem(AVATAR_KEY)||''}catch{return''}}
 function iconSvg(path){return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="'+path+'"/></svg>'}
 function ensureChatChrome(){
   if(!app)return;
   const composer=$('composer'), canvasTab=$('canvasTab'), conversationTab=$('conversationTab');
   const sync=()=>{
     const canvas=canvasTab?.getAttribute('aria-selected')==='true'||app.classList.contains('canvas-active');
     if(composer){composer.hidden=false;composer.removeAttribute('hidden');composer.style.removeProperty('display');}
     app.classList.toggle('public-canvas-visible',!!canvas);
     app.classList.remove('typing-header-shrink');
   };
   canvasTab?.addEventListener('click',()=>setTimeout(sync,0));conversationTab?.addEventListener('click',()=>setTimeout(sync,0));
   new MutationObserver(sync).observe(app,{attributes:true,subtree:true,attributeFilter:['class','hidden','aria-selected']});
   sync();
   const heading=app.querySelector('.chatHeading'), title=$('chatTitle');
   if(heading&&title&&!heading.querySelector('.publicChatAvatar')){
      const a=document.createElement('span');a.className='publicChatAvatar';a.textContent=(title.textContent||'?').trim().charAt(0).toUpperCase()||'?';heading.prepend(a);
   }
 }
 function resizeAvatar(file){return new Promise((resolve,reject)=>{const fr=new FileReader();fr.onerror=()=>reject(fr.error);fr.onload=()=>{const img=new Image();img.onerror=()=>reject(Error('Не удалось открыть фотографию'));img.onload=()=>{const s=Math.min(img.naturalWidth,img.naturalHeight),x=(img.naturalWidth-s)/2,y=(img.naturalHeight-s)/2,c=document.createElement('canvas');c.width=c.height=512;const g=c.getContext('2d');g.drawImage(img,x,y,s,s,0,0,512,512);resolve(c.toDataURL('image/jpeg',.86));};img.src=fr.result;};fr.readAsDataURL(file);});}
 function decorateProfile(){
   const card=content.querySelector('.profileCard');if(!card)return;
   card.classList.add('publicProfile');
   const avatar=card.querySelector('.profileAvatar');
   if(avatar&&!avatar.dataset.ready){
      avatar.dataset.ready='1';const saved=ownAvatar();if(saved){avatar.textContent='';avatar.style.backgroundImage='url("'+saved.replace(/"/g,'%22')+'")';avatar.classList.add('has-photo');}
      const input=document.createElement('input');input.type='file';input.accept='image/*';input.hidden=true;input.className='publicAvatarInput';
      const edit=document.createElement('button');edit.type='button';edit.className='publicAvatarEdit';edit.setAttribute('aria-label','Изменить фотографию');edit.innerHTML=iconSvg('M12 20h9 M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4 11.5-11.5Z');
      edit.onclick=()=>input.click();input.onchange=async()=>{const f=input.files?.[0];if(!f)return;try{const data=await resizeAvatar(f);localStorage.setItem(AVATAR_KEY,data);avatar.textContent='';avatar.style.backgroundImage='url("'+data+'")';avatar.classList.add('has-photo');document.querySelectorAll('.publicOwnAvatar').forEach(n=>{n.style.backgroundImage='url("'+data+'")';n.classList.add('has-photo');});}catch(e){console.error(e);}finally{input.value='';}};
      avatar.append(input,edit);
   }
   const map=[['Поделиться','M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7 M12 16V3 m-4 4 4-4 4 4'],['Скопировать','M8 8h11v11H8z M5 16H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h11a1 1 0 0 1 1 1v1'],['Добавить на главный','M12 5v14 M5 12h14'],['Выйти','M10 17l5-5-5-5 M15 12H3 M14 4h6a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-6']];
   for(const btn of card.querySelectorAll('button.setting,.setting')){if(btn.dataset.iconified)continue;const hit=map.find(([t])=>btn.textContent.includes(t));if(hit){btn.dataset.iconified='1';const span=document.createElement('span');span.className='publicSettingIcon';span.innerHTML=iconSvg(hit[1]);btn.prepend(span);}}
 }
 function watchHome(){const run=()=>{if(nav.querySelector('[data-page="profile"].selected'))decorateProfile();};new MutationObserver(run).observe(content,{childList:true,subtree:true});nav.addEventListener('click',()=>setTimeout(run,0));run();}
 ensureChatChrome();watchHome();
})();