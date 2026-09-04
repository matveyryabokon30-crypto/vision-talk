/* Vision Talk — runtime stability hotfix, v18 */
(()=>{
'use strict';

const VERSION='media-v18';

// media-v17 observes child-list changes. Its status-label write used to create
// another child-list change on every observer pass, preventing the browser
// from painting the opened chat. Make that write idempotent.
if(!Element.prototype.__visionTalkReplaceChildrenV18){
  const nativeReplaceChildren=Element.prototype.replaceChildren;
  Object.defineProperty(Element.prototype,'__visionTalkReplaceChildrenV18',{
    value:true,
    configurable:false,
    enumerable:false,
    writable:false
  });
  Element.prototype.replaceChildren=function(...nodes){
    if(this.classList?.contains('chatPresence')&&nodes.length===1){
      const node=nodes[0];
      const nextText=typeof node==='string'
        ? node
        : node?.nodeType===Node.TEXT_NODE
          ? node.nodeValue
          : null;
      if(nextText!==null&&this.textContent===nextText)return;
    }
    return nativeReplaceChildren.apply(this,nodes);
  };
}

let navigating=false;

async function navigateToDialog(card){
  if(navigating||!card?.dataset?.id)return;
  navigating=true;
  card.setAttribute('aria-busy','true');
  const id=card.dataset.id;
  const title=card.dataset.title||card.querySelector('.name')?.textContent||'Диалог';
  try{
    if(typeof openConversation!=='function')throw new Error('openConversation unavailable');
    await openConversation(id,title);
  }catch(error){
    console.error('dialog navigation failed',error);
    card.removeAttribute('aria-busy');
    if(typeof showStatus==='function')showStatus('Не удалось открыть диалог · повторите','bad');
  }finally{
    setTimeout(()=>{navigating=false},250);
  }
}

// Stable delegated handler: it survives every realtime redraw of the list.
document.addEventListener('click',event=>{
  const card=event.target.closest?.('.dialog[data-id]');
  if(!card)return;
  event.preventDefault();
  event.stopImmediatePropagation();
  navigateToDialog(card);
},true);

function markVersion(){
  const presence=document.querySelector('.chatPresence');
  const text=`Vision Talk · ${VERSION}`;
  if(presence&&presence.textContent!==text)presence.textContent=text;
  document.querySelectorAll('.small').forEach(node=>{
    if(node.textContent.includes('Vision talk')&&node.textContent!==`Vision talk · ${VERSION}`){
      node.textContent=`Vision talk · ${VERSION}`;
    }
  });
}

const root=document.getElementById('root');
if(root){
  const observer=new MutationObserver(markVersion);
  observer.observe(root,{childList:true,subtree:true});
}
setTimeout(markVersion,0);
})();