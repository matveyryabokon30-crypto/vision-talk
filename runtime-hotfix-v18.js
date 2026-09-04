/* Vision Talk — runtime stability hotfix, v18 */
(()=>{
'use strict';

// media-v17 watches child-list mutations. Its status-label write used to
// produce the same mutation again and could keep Safari inside a repaint loop.
// Ignore only identical writes to that exact status node.
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

// Delegation survives every realtime replacement of the dialog card.
document.addEventListener('click',event=>{
  const card=event.target.closest?.('.dialog[data-id]');
  if(!card)return;
  event.preventDefault();
  event.stopImmediatePropagation();
  navigateToDialog(card);
},true);
})();