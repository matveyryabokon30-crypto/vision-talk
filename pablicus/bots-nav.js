/* Main-navigation adapter for Bot Core. Loaded after app.js and reuses the same persisted Public session. */
(function(){'use strict';
 const PROJECT_URL='https://ctcoqgsztdtsazdiwcmd.supabase.co',KEY='sb_publishable_kMGqZAM2vadfXbBr8r5uzw_l9EiBtIw',STORAGE='sb-ctcoqgsztdtsazdiwcmd-auth-token';
 const home=document.getElementById('home'),nav=document.getElementById('mainNav'),content=document.getElementById('screenContent'),title=document.getElementById('sectionTitle'),brand=document.getElementById('brandTitle'),search=document.getElementById('searchChats'),filters=document.getElementById('chatFilters'),newChat=document.getElementById('newChat');if(!nav||!content||!window.PablicusBots||!window.supabase)return;
 const uiCss=document.createElement('link');uiCss.rel='stylesheet';uiCss.href='public-ui-foundation.css';document.head.append(uiCss);
 const client=supabase.createClient(PROJECT_URL,KEY,{auth:{storageKey:STORAGE,persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});let user=null,mounted=false,factory=null;
 const factoryCss=document.createElement('link');factoryCss.rel='stylesheet';factoryCss.href='bot-factory.css';document.head.append(factoryCss);
 const factoryScript=document.createElement('script');factoryScript.src='bot-factory.js';factoryScript.onload=()=>{if(window.PublicBotFactory)factory=window.PublicBotFactory.create({client,getUser:()=>user});};document.head.append(factoryScript);
 const botButton=document.createElement('button');botButton.dataset.page='bots';botButton.innerHTML='<span class="botsNavMark">◈</span>Боты';nav.insertBefore(botButton,nav.querySelector('[data-page="profile"]'));
 const bots=PablicusBots.create({client,getUser:()=>user,onError:e=>{const toast=document.getElementById('toast');if(toast){toast.textContent=e?.message||'Ошибка Bot Core';toast.hidden=false;setTimeout(()=>toast.hidden=true,2500);}}});
 async function sessionUser(){const r=await client.auth.getSession();user=r.data?.session?.user||null;return user;}
 function shell(name,mode='bots'){title.textContent=name;title.hidden=true;if(brand)brand.textContent=name;if(home)home.classList.add('bot-shell-active');search.hidden=true;filters.hidden=true;newChat.hidden=true;content.classList.toggle('bots-active',mode==='bots');content.classList.toggle('factory-active',mode==='factory');nav.querySelectorAll('button').forEach(b=>b.classList.toggle('selected',b===botButton));}
 function leaveShell(){if(home)home.classList.remove('bot-shell-active');content.classList.remove('bots-active','factory-active');}
 async function openBots(){await sessionUser();if(!user){location.reload();return;}const neutral=nav.querySelector('[data-page="feed"]');if(neutral&&!mounted)neutral.click();mounted=true;shell('Боты','bots');bots.mount(content);}
 botButton.onclick=()=>openBots().catch(()=>location.reload());
 content.addEventListener('click',e=>{const b=e.target.closest('button');if(!mounted||!factory||!b||b.textContent.trim()!=='Создать бота')return;e.preventDefault();e.stopImmediatePropagation();shell('Фабрика','factory');factory.mount(content,()=>{shell('Боты','bots');bots.mount(content);});},true);
 nav.addEventListener('click',e=>{const button=e.target.closest('button[data-page]');if(!button||button===botButton)return;if(mounted){mounted=false;leaveShell();bots.reset();}},true);
 client.auth.onAuthStateChange((_event,session)=>{user=session?.user||null;if(!user&&mounted){mounted=false;leaveShell();bots.reset();}});sessionUser();
 const bridge=document.createElement('script');bridge.src='bot-scenario-bridge.js';bridge.defer=true;document.head.append(bridge);
})();