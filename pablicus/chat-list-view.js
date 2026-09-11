(function(root){'use strict';
 function ordered(items,favorites){return items.map((x,i)=>({x,i,f:favorites.has(x.id)?1:0})).sort((a,b)=>b.f-a.f||a.i-b.i).map(v=>v.x)}
 function reconcile(container,items,favorites){
  const next=ordered(items,favorites),ids=next.map(x=>x.id),current=[...container.querySelectorAll('[data-conversation-id]')].map(n=>n.dataset.conversationId);
  let changed=ids.length!==current.length||ids.some((id,i)=>id!==current[i]);
  if(!changed)return{changed:false,nodes:[...container.querySelectorAll('[data-conversation-id]')]};
  const byId=new Map([...container.querySelectorAll('[data-conversation-id]')].map(n=>[n.dataset.conversationId,n]));
  const frag=document.createDocumentFragment();for(const item of next){const n=byId.get(item.id);if(n)frag.append(n)}container.append(frag);return{changed:true,nodes:next.map(x=>byId.get(x.id)).filter(Boolean)};
 }
 root.PablicusChatListView={ordered,reconcile};
})(window);
