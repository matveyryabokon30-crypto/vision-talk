/* Public pre-Stage-3 hotfix v8: state/keyboard stabilizer. */
(function(){'use strict';
 const $=id=>document.getElementById(id);
 const app=$('app'),home=$('home'),canvas=$('chatCanvasPanel'),composer=$('composer');
 if(!app||!home)return;
 let raf=0;
 const later=fn=>{cancelAnimationFrame(raf);raf=requestAnimationFrame(fn)};
 function projectEditing(){return !!canvas?.querySelector('.pccPlanEditor:not([hidden])');}
 function canvasVisible(){return $('canvasTab')?.getAttribute('aria-selected')==='true'||app.classList.contains('canvas-active')||app.classList.contains('public-canvas-visible');}
 function stableComposer(){
   const editing=projectEditing();
   app.classList.toggle('public-project-editing',editing);
   if(!composer)return;
   if(editing){composer.hidden=true;return;}
   composer.hidden=false;
   composer.style.removeProperty('transform');
   composer.style.removeProperty('top');
   composer.style.removeProperty('left');
   composer.style.removeProperty('right');
   composer.style.removeProperty('bottom');
 }
 function stableCanvas(){
   if(!canvas)return;
   canvas.style.removeProperty('transform');
   canvas.style.removeProperty('height');
   canvas.style.removeProperty('max-height');
   if(canvasVisible()){
     app.classList.add('public-canvas-visible');
     stableComposer();
   }
 }
 function normalizeChatHeader(){
   const h=app.querySelector('.chatHeading');
   if(h){h.style.left='50%';h.style.right='auto';h.style.transform='translate(-50%,-50%)';}
 }
 function normalize(){stableCanvas();stableComposer();normalizeChatHeader();}

 /* Safari keyboard: do not translate the composer with visualViewport; let the layout viewport resize it. */
 app.addEventListener('focusin',e=>{
   if(e.target?.matches?.('#input,.pccPlanEditor textarea,.workspaceEditor textarea,[contenteditable="true"]')){
     app.classList.add('public-keyboard-open');
     later(()=>{stableComposer();stableCanvas();});
   }
 },true);
 app.addEventListener('focusout',e=>{
   if(e.target?.matches?.('#input,.pccPlanEditor textarea,.workspaceEditor textarea,[contenteditable="true"]')){
     setTimeout(()=>{if(!app.contains(document.activeElement)||!document.activeElement?.matches?.('textarea,input,[contenteditable="true"]'))app.classList.remove('public-keyboard-open');normalize();},30);
   }
 },true);

 /* Keep project editor state isolated from the conversation composer. */
 if(canvas){
   new MutationObserver(()=>later(normalize)).observe(canvas,{subtree:true,childList:true,attributes:true,attributeFilter:['hidden','class','aria-expanded']});
   canvas.addEventListener('focusin',()=>later(stableComposer),true);
   canvas.addEventListener('focusout',()=>setTimeout(stableComposer,20),true);
 }
 $('conversationTab')?.addEventListener('click',()=>setTimeout(normalize,0));
 $('canvasTab')?.addEventListener('click',()=>setTimeout(normalize,0));

 /* Main-page title is always the active section; never leak the Bots label. */
 const labels={chats:'Чаты',feed:'Лента',tasks:'Дела',bots:'Боты',profile:'Профиль'};
 function syncSectionTitle(){
   const active=$('mainNav')?.querySelector('button.selected[data-page]')?.dataset.page;
   const brand=$('brandTitle');
   if(brand&&active&&!$('screenContent')?.classList.contains('factory-active'))brand.textContent=labels[active]||'Public';
 }
 $('mainNav')?.addEventListener('click',()=>setTimeout(syncSectionTitle,0),true);
 new MutationObserver(syncSectionTitle).observe($('mainNav')||home,{subtree:true,attributes:true,attributeFilter:['class']});

 /* Favorites stay at the top; removed legacy home controls stay removed. */
 function cleanChats(){
   const active=$('mainNav')?.querySelector('button.selected[data-page]')?.dataset.page;
   if(active!=='chats')return;
   const root=$('screenContent');if(!root)return;
   for(const n of root.querySelectorAll('.findPeople,.savedConversation'))n.remove();
   if($('searchChats'))$('searchChats').hidden=true;
   if($('chatFilters'))$('chatFilters').hidden=true;
   const cards=[...root.querySelectorAll('.chatCard')];
   cards.sort((a,b)=>Number((b.querySelector('.focusBtn')?.textContent||'').includes('★'))-Number((a.querySelector('.focusBtn')?.textContent||'').includes('★'))).forEach(x=>root.append(x));
 }
 new MutationObserver(()=>later(()=>{cleanChats();normalize();})).observe($('screenContent')||home,{subtree:true,childList:true});

 /* Story rail can collapse/expand by a vertical pull on the chat list, without extra story navigation buttons. */
 let y0=null;
 const workspace=$('workspace');
 workspace?.addEventListener('touchstart',e=>{if(e.touches?.length===1)y0=e.touches[0].clientY;},{passive:true});
 workspace?.addEventListener('touchend',e=>{
   if(y0==null)return;const y=e.changedTouches?.[0]?.clientY,dy=Number.isFinite(y)?y-y0:0;y0=null;
   const active=$('mainNav')?.querySelector('button.selected[data-page]')?.dataset.page;if(active!=='chats'||Math.abs(dy)<55)return;
   home.classList.toggle('public-stories-collapsed',dy<0);
 },{passive:true});

 /* Profile/settings: remove duplicate inline back controls; keep only the screen-level top-left control. */
 function cleanProfile(){
   for(const screen of document.querySelectorAll('.publicSettingsScreen,.publicProfileScreen')){
     const backs=[...screen.querySelectorAll('button')].filter(b=>/назад|back/i.test((b.getAttribute('aria-label')||'')+' '+(b.title||'')));
     backs.slice(1).forEach(b=>b.classList.add('publicInlineBack'));
   }
 }
 new MutationObserver(()=>later(cleanProfile)).observe(document.body,{subtree:true,childList:true});

 window.addEventListener('pageshow',normalize);
 window.addEventListener('resize',()=>later(normalize),{passive:true});
 setTimeout(()=>{cleanChats();cleanProfile();normalize();syncSectionTitle();},0);
})();
