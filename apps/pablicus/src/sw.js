/* Public-shell allowlist only. Auth, API, messages, signed media and local drafts are NEVER cached here. */
const VERSION='pablicus-shell-__ASSET_REVISION__';
const FILES=['./','index.html','style.css','pablicus.css','vault.js','outbox.js','transport-store.js','chat.js','app.js','auth-local.js','auth-config.js','oauth-login.js','oauth-session.js','passkey-login.js','vendor/supabase.js','manifest.webmanifest','assets/icon-32.png','assets/icon-180.png','assets/icon-192.png','assets/icon-512.png','assets/wordmark-light.png','assets/wordmark-dark.png'];
const urls=FILES.map(p=>new URL(p,self.registration.scope).href);
self.addEventListener('install',e=>e.waitUntil((async()=>{const c=await caches.open(VERSION);for(const url of urls){const r=await fetch(new Request(url,{cache:'reload'}));if(!r.ok)throw Error('Shell asset unavailable');await c.put(url,r)}})()));
self.addEventListener('message',e=>{if(e.data==='ACTIVATE')self.skipWaiting()});
self.addEventListener('activate',e=>e.waitUntil((async()=>{for(const key of await caches.keys())if(key.startsWith('pablicus-shell-')&&key!==VERSION)await caches.delete(key);await self.clients.claim()})()));
self.addEventListener('fetch',e=>{if(e.request.method!=='GET')return;const u=new URL(e.request.url);if(!urls.includes(u.href))return;e.respondWith(caches.open(VERSION).then(async c=>(await c.match(e.request))||fetch(e.request)));});
