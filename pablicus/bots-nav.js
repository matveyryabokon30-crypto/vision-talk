/* Main-navigation adapter for Bot Core. Loaded after app.js and reuses the same persisted Public session. */
(function(){'use strict';
 const PROJECT_URL='https://ctcoqgsztdtsazdiwcmd.supabase.co',KEY='sb_publishable_kMGqZAM2vadfXbBr8r5uzw_l9EiBtIw',STORAGE='sb-ctcoqgsztdtsazdiwcmd-auth-token';
 const nav=document.getElementById('mainNav'),content=document.getElementById('screenContent'),title=document.getElementById('sectionTitle'),search=document.getElementById('searchChats'),filters=document.getElementById('chatFilters'),newChat=document.getElementById('newChat');if(!nav||!content||!window.PablicusBots||!window.supabase)return;
 const client=supabase.createClient(PROJECT_URL,KEY,{auth:{storageKey:STORAGE,persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});let user=null,mounted=false;
 const botButton=document.createElement('button');botButton.dataset.page='bots';botButton.innerHTML='<span class="botsNavMark">◈</span>Боты';nav.insertBefore(botButton,nav.querySelector('[data-page="profile"]'));
 const bots=PablicusBots.create({client,getUser:()=>user,onError:e=>{const toast=document.getElementById('toast');if(toast){toast.textContent=e?.message||'Ошибка Bot Core';toast.hidden=false;setTimeout(()=>toast.hidden=true,2500);}}});
 async function sessionUser(){const r=await client.auth.getSession();user=r.data?.session?.user||null;return user;}
 function selectBots(){title.textContent='Боты';title.hidden=true;search.hidden=true;filters.hidden=true;newChat.hidden=true;nav.querySelectorAll('button').forEach(b=>b.classList.toggle('selected',b===botButton));}
 async function openBots(){await sessionUser();if(!user){location.reload();return;}const neutral=nav.querySelector('[data-page="feed"]');if(neutral&&!mounted)neutral.click();mounted=true;selectBots();bots.mount(content);}
 botButton.onclick=()=>openBots().catch(()=>location.reload());
 nav.addEventListener('click',e=>{const button=e.target.closest('button[data-page]');if(!button||button===botButton)return;if(mounted){mounted=false;bots.reset();}},true);
 client.auth.onAuthStateChange((_event,session)=>{user=session?.user||null;if(!user&&mounted){mounted=false;bots.reset();}});sessionUser();
 const bridge=document.createElement('script');bridge.src='bot-scenario-bridge.js';bridge.defer=true;document.head.append(bridge);
})();