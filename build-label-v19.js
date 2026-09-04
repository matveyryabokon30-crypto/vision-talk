/* Vision Talk — build marker v19 */
(()=>{
  'use strict';
  const LABEL='media-v19';
  const mark=()=>{
    const presence=document.querySelector('.chatPresence');
    const text=`Vision Talk · ${LABEL}`;
    if(presence&&presence.textContent!==text)presence.textContent=text;
    document.querySelectorAll('.small').forEach(node=>{
      if(node.textContent.includes('Vision talk')&&node.textContent!==`Vision talk · ${LABEL}`){
        node.textContent=`Vision talk · ${LABEL}`;
      }
    });
  };
  if(typeof openConversation==='function'){
    const previous=openConversation;
    openConversation=async function(...args){
      const result=await previous(...args);
      mark();
      return result;
    };
  }
  const root=document.getElementById('root');
  if(root){
    const observer=new MutationObserver(()=>mark());
    observer.observe(root,{childList:true,subtree:true});
  }
  mark();
})();