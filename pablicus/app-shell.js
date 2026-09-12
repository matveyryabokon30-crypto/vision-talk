/* Stateless shell projection. Route, identity and lifecycle stay in the controller. */
(function(root){
 'use strict';
 if(root.PablicusShell)throw Error('DUPLICATE_SHELL_OWNER');
 const $=id=>document.getElementById(id);
 function project(state){
  const section=root.PablicusUI.rootSection(state.section),nav=$('mainNav');
  if(nav)for(const button of nav.querySelectorAll('button[data-page]')){
   const selected=button.dataset.page===section;button.classList.toggle('selected',selected);
   if(selected)button.setAttribute('aria-current','page');else button.removeAttribute?.('aria-current');
  }
  const label={factory:'Фабрика',scenario:'Сценарий',bots:'Боты'}[state.screen]||root.PablicusUI.roots.find(x=>x.id===section)?.label||'Pablicus';
  if($('brandTitle'))$('brandTitle').textContent=label;
  if($('sectionTitle')){$('sectionTitle').textContent=label;$('sectionTitle').hidden=true;}
  if($('home')){$('home').dataset.page=state.section;$('home').classList.toggle('bot-shell-active',['bots','factory','scenario'].includes(state.screen));}
  const chats=state.screen==='home'&&state.section==='chats';
  for(const id of ['searchChats','chatFilters'])if($(id))$(id).hidden=!chats;
  if($('newChat'))$('newChat').hidden=!chats||!state.sessionUserId||!!nav?.hidden;
  if($('openBots'))$('openBots').hidden=!state.sessionUserId||!!nav?.hidden;
  if($('screenContent')){
   $('screenContent').classList.toggle('bots-active',state.screen==='bots');
   $('screenContent').classList.toggle('factory-active',state.screen==='factory');
  }
 }
 function show(view){if($('home'))$('home').hidden=view==='conversation';if($('app'))$('app').hidden=view!=='conversation';}
 function authentication(signedIn){
  if($('loginPane'))$('loginPane').hidden=signedIn;
  for(const id of ['workspace','mainNav'])if($(id))$(id).hidden=!signedIn;
  if(!signedIn)for(const id of ['newChat','openBots'])if($(id))$(id).hidden=true;
 }
 function conversationTitle(text){if($('chatTitle'))$('chatTitle').textContent=text||'Разговор';}
 function conversationReady(ready){const app=$('app');if(app){app.style.visibility=ready?'':'hidden';app.inert=!ready;}}
 function conversationMode(canvas){
  const app=$('app');if(app)app.classList.toggle('canvas-active',canvas);
  if($('chatCanvasPanel'))$('chatCanvasPanel').hidden=!canvas;
  if($('vp'))$('vp').inert=canvas;
  if($('composer'))$('composer').hidden=false;
  for(const [id,selected]of [['conversationTab',!canvas],['canvasTab',canvas]])if($(id)){$(id).setAttribute('aria-selected',String(selected));$(id).tabIndex=selected?0:-1;}
 }
 function viewport({width,height,left,top,keyboardOpen}){
  const app=$('app');if(!app)return;
  document.documentElement.style.setProperty('--viewport-height',height+'px');
  document.documentElement.style.setProperty('--viewport-top',top+'px');
  app.classList.toggle('keyboard-open',keyboardOpen);
  app.style.transform='translate3d('+left+'px,'+top+'px,0)';app.style.width=width+'px';app.style.height=height+'px';
 }
 root.PablicusShell=Object.freeze({project,show,authentication,conversationTitle,conversationReady,conversationMode,viewport});
})(window);
