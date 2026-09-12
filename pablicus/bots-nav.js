/* Block 01 Bot Core navigation adapter: shared session/client and explicit routes. */
(function(){'use strict';
 const home=document.getElementById('home'),nav=document.getElementById('mainNav'),content=document.getElementById('screenContent'),search=document.getElementById('searchChats'),filters=document.getElementById('chatFilters'),newChat=document.getElementById('newChat');
 const controller=window.PablicusController,services=controller?.getServices();if(!home||!nav||!content||!controller||!services?.client||!window.PablicusBots)return;
 function css(href){if(document.querySelector(`link[href="${href}"]`))return;const l=document.createElement('link');l.rel='stylesheet';l.href=href;document.head.append(l)}
 function script(src,signal){if(document.querySelector(`script[src="${src}"]`))return Promise.resolve();return new Promise((res,rej)=>{const s=document.createElement('script'),abort=()=>{s.remove();rej(new DOMException('Aborted','AbortError'))};s.src=src;s.onload=()=>{signal?.removeEventListener('abort',abort);res()};s.onerror=()=>{signal?.removeEventListener('abort',abort);rej(Error('Не удалось загрузить '+src))};if(signal?.aborted)return abort();signal?.addEventListener('abort',abort,{once:true});document.head.append(s)})}
 css('bot-factory.css');
 let factory=null;const ensureFactory=signal=>factory?Promise.resolve(factory):script('bot-factory.js',signal).then(()=>factory=window.PublicBotFactory.create({client:services.client,getUser:()=>services.getUser?.()}));
 const bots=PablicusBots.create({client:services.client,getUser:()=>services.getUser?.(),onError:e=>services.notify?.(e?.message||'Ошибка Bot Core'),onFactory:()=>controller.navigate({section:'bots',screen:'factory'}),onScenario:id=>controller.navigate({section:'bots',screen:'scenario',resourceId:id})});
 controller.register('bots',async({isCurrent,onCleanup})=>{if(!isCurrent())return;bots.mount(content);onCleanup(()=>bots.reset())});
 controller.register('factory',async({isCurrent,onCleanup,signal})=>{const f=await ensureFactory(signal);if(!isCurrent())return;f.mount(content,()=>controller.navigate({section:'bots',screen:'bots'}));onCleanup(()=>f.reset?.())});
 script('bot-scenario-bridge.js');
})();
