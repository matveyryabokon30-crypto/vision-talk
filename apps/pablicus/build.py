from pathlib import Path
import re,shutil,json,hashlib,subprocess,sys
from rich_bridge import adapt_chat, adapt_vault
ROOT=Path(__file__).parent
subprocess.run([sys.executable,str(ROOT/'vendor'/'verify-supabase.py')],check=True)
BASE=ROOT/'inherited'/'gate015'
OUT=ROOT/'dist'; OUT.mkdir(exist_ok=True)
for n in ('vault.js','outbox.js','style.css'):shutil.copy2(BASE/n,OUT/n)
(OUT/'vault.js').write_text(adapt_vault((OUT/'vault.js').read_text()))
(OUT/'outbox.js').write_text((OUT/'outbox.js').read_text().replace('kind:m.kind,assetId:m.assetId||null,text:', 'kind:m.kind,blocks:m.blocks,reply_to:m.reply_to||null,assetId:m.assetId||null,text:'))
s=(BASE/'app.js').read_text()
s=re.sub(r"const BUILD='[^']+'", "const BUILD='pablicus-0.1.0-rc5'",s,count=1)
s=s.replace('COUNT=300','COUNT=0')
s=s.replace("let list=null", "let sourceMessages=[],scopeUser=null,scopeChat=null,vaultBound=false;let list=null",1)
s=s.replace("function nodeFor(m){", "function nodeFor(m){if(m.remote)return window.PablicusHost.renderMessage(m);",1)
s=s.replace("dataset(1,COUNT).concat(queueMessages())", "sourceMessages.concat(queueMessages())")
s=s.replace("last_id:list.messages.at(-1).id", "last_id:list.messages.at(-1)?.id||null")
s=s.replace("this.scheduleRender();\n};", "this.scheduleRender();if(vp.scrollTop<180)window.PablicusHost?.historyTop?.();\n};",1)
s=s.replace("go(i){i=", "go(i){if(!this.messages.length)return;i=")
s=s.replace("if(this.destroyed||this.busy)return;\nthis.busy=true;", "if(this.destroyed||this.busy||vp.clientWidth<2||vp.clientHeight<2)return;\nthis.busy=true;",1)
# ResizeObserver delivery must not synchronously resize its observed viewport.
# Keep the archived gate unchanged; coalesce the live adapter's work per frame.
observer_source="""this.observer=new ResizeObserver(()=>{
if(this.destroyed||this.busy)return;
if(Math.abs(vp.clientWidth-this.width)>.5||Math.abs(vp.clientHeight-this.height)>.5)
this.sync(this.lastAnchor,this.follow,'viewport-size');
});this.observer.observe(vp);"""
observer_deferred="""this.resizeFrame=0;
this.observer=new ResizeObserver(()=>{
if(this.destroyed||this.resizeFrame)return;
this.resizeFrame=requestAnimationFrame(()=>{
this.resizeFrame=0;
if(this.destroyed||this.busy||vp.clientWidth<2||vp.clientHeight<2)return;
if(Math.abs(vp.clientWidth-this.width)>.5||Math.abs(vp.clientHeight-this.height)>.5)
this.sync(this.lastAnchor,this.follow,'viewport-size');
});
});this.observer.observe(vp);"""
assert s.count(observer_source)==1,'List resize observer changed; review required'
s=s.replace(observer_source,observer_deferred,1)
observer_cleanup='cancelAnimationFrame(this.frame);this.observer.disconnect();'
assert s.count(observer_cleanup)==1,'List resize cleanup changed; review required'
s=s.replace(observer_cleanup,'cancelAnimationFrame(this.frame);cancelAnimationFrame(this.resizeFrame);this.observer.disconnect();',1)
s=s.replace("queueRows.filter(OutboxVault.active).flatMap", "queueRows.filter(r=>!['sent','cancelled'].includes(r.state)).flatMap")
s=s.replace("meta.textContent='◷ В очереди · не отправлено'", "meta.replaceChildren(...window.PablicusHost.messageMeta({state:m.queueState||'queued'}).childNodes)")
s=s.replace("vault.store=new OutboxVault.OutboxStore();", "vault.store=new PablicusStore(scopeUser,scopeChat);")
s=s.replace("status('В очереди · не отправлено. Сервер в этом стенде не подключён.');", "status('В очереди');window.dispatchEvent(new Event('pablicus:queued'));" )
s=s.replace("if(!list||submitBusy||draft.composing", "if(!list||submitBusy||!window.PablicusHost?.canSend()||draft.composing")
s=s.replace("const selected=Array.from(files||[]),s=selection();", "const selected=Array.from(files||[]).filter(f=>window.PablicusHost.acceptFile(f)),s=selection();")
s=s.replace("if(['message','assistant','task'].includes(action)){", "if(['assistant','task','modes','tasks'].includes(action)){closeMenu(true);window.PablicusHost.unavailable('Помощник');return}if(['message'].includes(action)){")
s=s.replace("if(['documents','modes','back'].includes(action))", "if(['documents','back'].includes(action))")
s=s.replace("['modes','Помощник'],", "")
s=s.replace("$('taskMenu').onclick=e=>openMenu('tasks',$('taskMenu'),e.detail===0);", "$('taskMenu').onclick=()=>window.PablicusHost.unavailable('Помощник');")
s=s.replace("app.querySelector('.tools'),$('status'),app.querySelector('.stage')", "app.querySelector('.tools'),$('chatViewTabs'),$('status'),app.querySelector('.stage')")
s=s.replace("app.querySelector('header').offsetHeight+app.querySelector('.tools').offsetHeight", "app.querySelector('header').offsetHeight+$('chatViewTabs').offsetHeight+app.querySelector('.tools').offsetHeight")
s=s.replace("draft.mode==='message'?'Сохранить в исходящие; не доставка'", "draft.mode==='message'?'Отправить сообщение'")
s=s.replace("empty:'Черновик пуст · только этот браузер'", "empty:''").replace("saved:'Сохранено в этом браузере'", "saved:'Черновик сохранён'").replace("restored:'Восстановлено · файлов: '+s.restored_files", "restored:'Черновик восстановлен'")
s=s.replace("labels[s.state]||s.state", "labels[s.state]??''")
s=s.replace("status('Черновик сохраняется в этом браузере · без отправки')", "status('')")
s=s.replace("initializeVault().catch(fatal);", r'''
window.PablicusChat={
 async open(user,chat,messages){
  if(submitBusy)throw Error('Дождитесь сохранения отправки');
  if(vault){draftChanged();await vault.flush();vault.restoring=true;vault.ready=false;clearTimeout(vault.timer);vault.store.close();}
  closeMenu(false);input.blur();list?.destroy();list=null;
  for(const u of [...liveUrls])urlRevoke(u);assets.clear();queueRows=[];queueLoaded=false;queueError=null;
  input.value='';draft.attachments=[];draft.expanded=false;draft.mode='message';draft.task=null;$('tray').replaceChildren();renderTask();
  sourceMessages=messages;scopeUser=user;scopeChat=chat;
  if(!vaultBound){vaultBound=true;await initializeVault()}
  else{vault=new DraftVault.Controller({capture:captureDraft,restore:restoreDraft,paint:paintVault,lock:lockDraft});vault.store=new PablicusStore(user,chat);window.vault=vault;queueRows=await vault.store.readQueue();queueLoaded=true;ingestQueue(queueRows);await vault.init();}
  if(!list)await openChat();if(!vault.ready)throw Error('Локальное хранилище недоступно: черновик не будет потерян молча');
  $('reportBtn').onclick=()=>window.PablicusHost.showOutbox();
  syncComposer();return publicSnapshot();
 },
 prepend(messages){if(!messages?.length||!list)return;sourceMessages=messages.concat(sourceMessages);list.prepend(messages);},
 update(messages){sourceMessages=messages;if(!list)return;const a=list.capture(),f=list.follow;
  const incoming=messages.filter(m=>!list.index.has(m.id)).length;
  list.messages=sourceMessages.concat(queueMessages());if(!f)list.pendingBelow+=incoming;
  list.sync(a,f,'server-update');
 },
 async flush(){if(vault){draftChanged();await vault.flush()}},
 async persistDraft(){if(vault){draftChanged();await vault.flush()}},
 async refreshQueue(){if(vault)return refreshQueue()},
 get scope(){return{user:scopeUser,chat:scopeChat}},
 get store(){return vault?.store},get snapshot(){return publicSnapshot()},
 async leave(){await this.flush();input.blur();closeMenu(false);},
 addFiles,fillDraft,get list(){return list},get draft(){return draft},get assets(){return assets},
};
''')
h=(BASE/'index.html').read_text()
h=re.sub(r'<meta http-equiv="Content-Security-Policy"[^>]*>', '',h)
h=re.sub(r'<title>.*?</title>','<title>Pablicus</title>',h)
h=re.sub(r'\?_ship=[^"\s]+','',h)
h=h.replace('</head>', '<link rel="manifest" href="manifest.webmanifest"><link rel="apple-touch-icon" href="assets/icon-180.png"><link rel="icon" href="assets/icon-32.png"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="Pablicus"><meta name="apple-mobile-web-app-status-bar-style" content="default"><link rel="stylesheet" href="pablicus.css"></head>')
h=re.sub(r'<header>.*?</header>', '<header><button id="chatBack" aria-label="К чатам">‹</button><div class="chatHeading"><span class="chatSectionLabel">Чат</span><button id="chatTitle" type="button" aria-label="Материалы разговора">Разговор</button><small id="chatHint" hidden></small></div><button id="chatLibraryOpen" type="button" aria-label="Поиск по переписке"></button><button id="queueBtn" hidden aria-hidden="true" tabindex="-1"></button><button id="reportBtn" aria-label="Исходящие сообщения"></button></header>',h,flags=re.S)
h=h.replace('</header>', '</header><nav id="chatViewTabs" role="tablist" aria-label="Раздел разговора"><button id="conversationTab" type="button" role="tab" aria-selected="true" aria-controls="vp">Разговор</button><button id="canvasTab" type="button" role="tab" aria-selected="false" aria-controls="chatCanvasPanel" tabindex="-1">Полотно</button></nav>',1)
h=h.replace('<main class="stage">', '<main class="stage"><section id="chatCanvasPanel" role="tabpanel" aria-labelledby="canvasTab" hidden></section>')
h=h.replace('<div id="app">','<div id="app" hidden>')
h=h.replace('<footer id="composer">','<footer id="composer"><div id="replyDraft" hidden><div id="replyDraftText"></div><button id="cancelReply" type="button" aria-label="Отменить ответ">×</button></div>')
h=h.replace('<body>','<body>'+ (ROOT/'src'/'home.html').read_text())
h=re.sub(r'<script src="[^"]+"[^>]*></script>','',h)
h=h.replace('</body>', '<script src="vendor/supabase.js"></script><script src="vault.js"></script><script src="outbox.js"></script><script src="transport-store.js"></script><script src="rich-store.js"></script><script src="rich-composer.js"></script><script src="message-menu.js"></script><script src="rich-message.js"></script><script src="chat.js"></script><script src="auth-local.js"></script><script src="auth-config.js"></script><script src="oauth-login.js"></script><script src="oauth-session.js"></script><script src="passkey-login.js"></script><script src="public-passkey.js"></script><script src="app.js"></script></body>')
h=h.replace('</head>', '<link rel="stylesheet" href="rich-composer.css"><link rel="stylesheet" href="rich-message.css"></head>')
h=h.replace('<script src="app.js">','<script src="media-viewer.js"></script><script src="inbox-monitor.js"></script><script src="people.js"></script><script src="chat-actions.js"></script><script src="push-notifications.js"></script><script src="chat-library.js"></script><script src="chat-canvas.js"></script><script src="app.js">')
h=h.replace('</head>','<link rel="stylesheet" href="media-viewer.css"><link rel="stylesheet" href="inbox-monitor.css"><link rel="stylesheet" href="message-menu.css"><link rel="stylesheet" href="people.css"><link rel="stylesheet" href="chat-actions.css"><link rel="stylesheet" href="chat-minimal.css"><link rel="stylesheet" href="profile-discovery.css"><link rel="stylesheet" href="chat-library.css"><link rel="stylesheet" href="chat-canvas.css"></head>')
h=h.replace('VISION TALK','Pablicus').replace('Vision Talk','Pablicus')
(OUT/'index.html').write_text(h)
(OUT/'chat.js').write_text(adapt_chat(s))
for n in ['push-notifications.js','transport-store.js','app.js','auth-local.js','auth-config.js','oauth-login.js','oauth-session.js','passkey-login.js','public-passkey.js','passkey-start.html','passkey-start.js','passkey-start.css','pablicus.css','sw.js','manifest.webmanifest']:shutil.copy2(ROOT/'src'/n,OUT/n)
for n in ['rich-store.js','rich-composer.js','rich-composer.css','rich-message.js','rich-message.css']:shutil.copy2(ROOT/'src'/n,OUT/n)
for n in ['media-viewer.js','media-viewer.css','inbox-monitor.js','inbox-monitor.css']:shutil.copy2(ROOT/'src'/n,OUT/n)
for n in ['chat-canvas.js','chat-canvas.css','chat-library.js','chat-library.css','message-menu.js','message-menu.css','people.js','people.css','chat-actions.js','chat-actions.css','chat-minimal.css','profile-discovery.css']:shutil.copy2(ROOT/'src'/n,OUT/n)
# Pablicus app transport and authentication adaptations.
app=(OUT/'app.js').read_text()
app=app.replace('0.1.0-rc2','0.1.0-rc5')
# OAuth callback exchange completes explicitly in the requesting browser.
needle=" sb.auth.onAuthStateChange("
assert app.count(needle)==1,'Auth event binding changed; review required'
app=app.replace(needle," passwordLogin=PablicusLogin.mount({client:sb,recoveryClient,projectUrl:URL,canSignIn:()=>!passkeySigninActive&&!publicKeyFlow.snapshot().busy,authenticate:session=>{trustExplicitSignIn();return authenticate(session)}});\n"+needle,1)
app=app.replace('refreshing=false,worker=false,channel=null', 'refreshing=false,worker=false,pumpPending=false,channel=null',1)
app=app.replace("async function pump(){if(worker||!user||!navigator.onLine||document.hidden)return;worker=true;", "async function pump(){if(worker){pumpPending=true;return}if(!user||!navigator.onLine||document.hidden)return;worker=true;",1)
app=app.replace("}catch(e){problem(e)}finally{worker=false}}\n async function showOutbox()", "}catch(e){problem(e)}finally{worker=false;if(pumpPending){pumpPending=false;setTimeout(()=>pump(),0)}}}\n async function showOutbox()",1)
(OUT/'app.js').write_text(app)
shutil.copytree(ROOT/'assets',OUT/'assets',dirs_exist_ok=True)
(OUT/'vendor').mkdir(exist_ok=True)
vendor=ROOT/'vendor'/'supabase.js'
shutil.copy2(vendor,OUT/'vendor'/'supabase.js')
shutil.copy2(ROOT/'vendor'/'LICENSE.supabase',OUT/'vendor'/'LICENSE.supabase')
(OUT/'version.json').write_text(json.dumps({'version':'0.1.0-rc5','product':'Pablicus','stage':'RELEASE_CANDIDATE_NOT_DEVICE_ACCEPTED'}))
for n in ['access.html','access.js','access.css']:shutil.copy2(ROOT/'src'/n,OUT/n)
print('Built',len(list(OUT.rglob('*'))),'paths')
