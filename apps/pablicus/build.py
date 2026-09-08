from pathlib import Path
import re,shutil,json,hashlib
ROOT=Path(__file__).parent
BASE=ROOT/'inherited'/'gate015'
OUT=ROOT/'dist'; OUT.mkdir(exist_ok=True)
for n in ('vault.js','outbox.js','style.css'):shutil.copy2(BASE/n,OUT/n)
s=(BASE/'app.js').read_text()
s=re.sub(r"const BUILD='[^']+'", "const BUILD='pablicus-0.1.0-rc3'",s,count=1)
s=s.replace('COUNT=300','COUNT=0')
s=s.replace("let list=null", "let sourceMessages=[],scopeUser=null,scopeChat=null,vaultBound=false;let list=null",1)
s=s.replace("function nodeFor(m){", "function nodeFor(m){if(m.remote)return window.PablicusHost.renderMessage(m);",1)
s=s.replace("dataset(1,COUNT).concat(queueMessages())", "sourceMessages.concat(queueMessages())")
s=s.replace("last_id:list.messages.at(-1).id", "last_id:list.messages.at(-1)?.id||null")
s=s.replace("this.scheduleRender();\n};", "this.scheduleRender();if(vp.scrollTop<180)window.PablicusHost?.historyTop?.();\n};",1)
s=s.replace("go(i){i=", "go(i){if(!this.messages.length)return;i=")
s=s.replace("if(this.destroyed||this.busy)return;\nthis.busy=true;", "if(this.destroyed||this.busy||vp.clientWidth<2||vp.clientHeight<2)return;\nthis.busy=true;",1)
s=s.replace("queueRows.filter(OutboxVault.active).flatMap", "queueRows.filter(r=>!['sent','cancelled'].includes(r.state)).flatMap")
s=s.replace("meta.textContent='◷ В очереди · не отправлено'", "meta.textContent=({queued:'◷ В очереди',sending:'Отправляется…',error:'Ошибка · открыть очередь'})[m.queueState]||'В очереди'")
s=s.replace("vault.store=new OutboxVault.OutboxStore();", "vault.store=new PablicusStore(scopeUser,scopeChat);")
s=s.replace("status('В очереди · не отправлено. Сервер в этом стенде не подключён.');", "status('В очереди');window.dispatchEvent(new Event('pablicus:queued'));" )
s=s.replace("if(!list||submitBusy||draft.composing", "if(!list||submitBusy||!window.PablicusHost?.canSend()||draft.composing")
s=s.replace("const selected=Array.from(files||[]),s=selection();", "const selected=Array.from(files||[]).filter(f=>window.PablicusHost.acceptFile(f)),s=selection();")
s=s.replace("if(['message','assistant','task'].includes(action)){", "if(['assistant','task','modes','tasks'].includes(action)){closeMenu(true);window.PablicusHost.unavailable('Помощник');return}if(['message'].includes(action)){")
s=s.replace("if(['documents','modes','back'].includes(action))", "if(['documents','back'].includes(action))")
s=s.replace("['modes','Помощник'],", "")
s=s.replace("$('taskMenu').onclick=e=>openMenu('tasks',$('taskMenu'),e.detail===0);", "$('taskMenu').onclick=()=>window.PablicusHost.unavailable('Помощник');")
s=s.replace("draft.mode==='message'?'Сохранить в исходящие; не доставка'", "draft.mode==='message'?'Отправить сообщение'")
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
h=re.sub(r'<header>.*?</header>', '<header><button id="chatBack" aria-label="К чатам">‹</button><div class="chatHeading"><strong id="chatTitle">Разговор</strong><small id="chatHint">Pablicus</small></div><button id="queueBtn" hidden aria-hidden="true" tabindex="-1"></button><button id="reportBtn" aria-label="Исходящие сообщения">⋯</button></header>',h,flags=re.S)
h=h.replace('<div id="app">','<div id="app" hidden>')
h=h.replace('<body>','<body>'+ (ROOT/'src'/'home.html').read_text())
h=re.sub(r'<script src="[^"]+"[^>]*></script>','',h)
h=h.replace('</body>', '<script src="vendor/supabase.js"></script><script src="vault.js"></script><script src="outbox.js"></script><script src="transport-store.js"></script><script src="chat.js"></script><script src="app.js"></script></body>')
h=h.replace('VISION TALK','Pablicus').replace('Vision Talk','Pablicus')
(OUT/'index.html').write_text(h)
(OUT/'chat.js').write_text(s)
for n in ['transport-store.js','app.js','pablicus.css','sw.js','manifest.webmanifest']:shutil.copy2(ROOT/'src'/n,OUT/n)
# Pablicus app transport and authentication adaptations.
app=(OUT/'app.js').read_text()
app=app.replace('0.1.0-rc2','0.1.0-rc3')
app=app.replace('detectSessionInUrl:false','detectSessionInUrl:true',1)
magic=r'''
 $('magicForm').onsubmit=async e=>{e.preventDefault();const button=$('magicSubmit'),email=$('email').value.trim();button.disabled=true;$('loginError').textContent='';$('loginNotice').textContent='';try{const redirect=location.origin+location.pathname;const r=await sb.auth.signInWithOtp({email,options:{shouldCreateUser:false,emailRedirectTo:redirect}});if(r.error)throw r.error;$('loginNotice').textContent='Ссылка отправлена. Откройте письмо на этом iPhone и нажмите «Войти в Pablicus». Пароль не нужен.'}catch(e){$('loginError').textContent=e.message||'Не удалось отправить ссылку'}finally{button.disabled=false}};
'''
needle=" $('loginForm').onsubmit=async e=>"
if magic.strip() not in app:
    app=app.replace(needle,magic+needle,1)
app=app.replace('refreshing=false,worker=false,channel=null', 'refreshing=false,worker=false,pumpPending=false,channel=null',1)
app=app.replace("async function pump(){if(worker||!user||!navigator.onLine||document.hidden)return;worker=true;", "async function pump(){if(worker){pumpPending=true;return}if(!user||!navigator.onLine||document.hidden)return;worker=true;",1)
app=app.replace("}catch(e){problem(e)}finally{worker=false}}\n async function showOutbox()", "}catch(e){problem(e)}finally{worker=false;if(pumpPending){pumpPending=false;setTimeout(()=>pump(),0)}}}\n async function showOutbox()",1)
(OUT/'app.js').write_text(app)
shutil.copytree(ROOT/'assets',OUT/'assets',dirs_exist_ok=True)
(OUT/'vendor').mkdir(exist_ok=True)
vendor=ROOT/'vendor'/'supabase.js'
if not vendor.exists():vendor=ROOT.parents[1]/'vendor'/'supabase-2.45.3.js'
shutil.copy2(vendor,OUT/'vendor'/'supabase.js')
(OUT/'version.json').write_text(json.dumps({'version':'0.1.0-rc3','product':'Pablicus','stage':'RELEASE_CANDIDATE_NOT_DEVICE_ACCEPTED'}))
print('Built',len(list(OUT.rglob('*'))),'paths')