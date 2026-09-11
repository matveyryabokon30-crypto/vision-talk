/* Block 01: presentation-only compatibility adapter. Navigation/state are owned by PablicusController. */
(function(){'use strict';
 const $=id=>document.getElementById(id),content=$('screenContent'),home=$('home');
 if(!content||!home)return;
 function cleanLegacyHome(state){
   if(state.screen!=='home'||state.section!=='chats')return;
   for(const node of content.querySelectorAll('.findPeople,.savedConversation'))node.remove();
   const search=$('searchChats'),filters=$('chatFilters');if(search)search.hidden=true;if(filters)filters.hidden=true;
 }
 function present(state){cleanLegacyHome(state);home.dataset.page=state.section||'chats';}
 const unsubscribe=window.PablicusController?.subscribe(present)||(()=>{});
 window.PablicusUxRefinement={dispose:unsubscribe};
})();
