/* Targeted pre-Stage-3 runtime repair. Reads canvas editor state; never mutates canvas data. */
(function(){'use strict';
 const app=document.getElementById('app'),panel=document.getElementById('chatCanvasPanel');
 if(!app||!panel)return;
 let editorObserver=null,panelObserver=null,raf=0;
 function planEditor(){return panel.querySelector('.pccPlanEditor');}
 function syncProjectState(){
   const editor=planEditor();
   const editing=!!editor&&!editor.hidden&&editor.getClientRects().length>0;
   app.classList.toggle('project-editing',editing);
   if(editor&&!editorObserver){
     editorObserver=new MutationObserver(syncProjectState);
     editorObserver.observe(editor,{attributes:true,attributeFilter:['hidden','class']});
   }
 }
 function scheduleSync(){if(raf)return;raf=requestAnimationFrame(()=>{raf=0;syncProjectState();syncViewport();});}
 function syncViewport(){
   const vv=window.visualViewport;
   const canvas=app.classList.contains('canvas-active')||app.classList.contains('public-canvas-visible');
   if(!vv||!canvas){app.style.removeProperty('height');app.style.removeProperty('top');return;}
   const keyboard=Math.max(0,window.innerHeight-vv.height-vv.offsetTop)>80;
   if(keyboard){app.style.height=Math.round(vv.height)+'px';app.style.top=Math.round(vv.offsetTop)+'px';}
   else{app.style.removeProperty('height');app.style.removeProperty('top');}
 }
 panelObserver=new MutationObserver(scheduleSync);
 panelObserver.observe(panel,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden','class','aria-expanded']});
 window.visualViewport?.addEventListener('resize',scheduleSync,{passive:true});
 window.visualViewport?.addEventListener('scroll',scheduleSync,{passive:true});
 document.getElementById('canvasTab')?.addEventListener('click',scheduleSync);
 document.getElementById('conversationTab')?.addEventListener('click',()=>requestAnimationFrame(()=>{app.classList.remove('project-editing');app.style.removeProperty('height');app.style.removeProperty('top');}));
 syncProjectState();syncViewport();
})();