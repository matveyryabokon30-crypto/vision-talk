from pathlib import Path
import urllib.request,hashlib,re,shutil
B=Path(__file__).parent
S=B/'site';S.mkdir(exist_ok=True)
base=B/'base';base.mkdir(exist_ok=True)
expected={'index.html':'d62b1f119e847fa3d18fe47b8cf9d77b21699b3de42a99ec12c9b40d0435e9b4','style.css':'060871a0fdb14a79c3687869eb3d41da3429170ee581c5e39be63584e93a490a','vault.js':'696bb399a47aa831ec80c23c7afb86ddd10746d850ae3f4e80f2e7355176167a','app.js':'a2eece2ed630f5fc48a91063a4a7c3500153c32b16fd4bf594e7cd943a17c331'}
for name,sha in expected.items():
 p=base/name
 if not p.exists():p.write_bytes(urllib.request.urlopen('https://fleeting-mesh-8c9pdyg.shipstatic.com/'+name,timeout=25).read())
 assert hashlib.sha256(p.read_bytes()).hexdigest()==sha,('Base mismatch',name)
 text=p.read_text().replace('gate-01.4.0-durable-draft','gate-01.5.0-outbox').replace('Gate 01.4','Gate 01.5')
 text=text.replace('?_ship=8c9pdyg','')
 (S/name).write_text(text)
v=(S/'vault.js').read_text().replace("'vision-talk-gate-014-v1'","'vision-talk-gate-015-v1'").replace("['drafts','assets','proofs']","['drafts','assets','proofs','outbox','meta']")
(S/'vault.js').write_text(v)
shutil.copyfile(B/'outbox.js',S/'outbox.js')
s=(S/'app.js').read_text();start=s.index('function localSend()');end=s.index('const menuIcons=',start);s=s[:start]+s[end:]
s=s.replace('if(!m.attachmentId)return baseNodeFor(m);','if(!m.attachmentId)return decorateQueueRow(baseNodeFor(m),m);').replace('bubble.append(slot,text,meta);row.append(bubble);return row;','bubble.append(slot,text,meta);row.append(bubble);return decorateQueueRow(row,m);')
s=s.replace('list=new NaturalList(dataset(1,COUNT))','list=new NaturalList(dataset(1,COUNT).concat(queueMessages()))').replace("'Отправить локально'","'Сохранить в исходящие; не доставка'")
s=s.replace('vault=new DraftVault.Controller({capture:captureDraft,restore:restoreDraft,paint:paintVault,lock:lockDraft});','vault=new DraftVault.Controller({capture:captureDraft,restore:restoreDraft,paint:paintVault,lock:lockDraft});vault.store=new OutboxVault.OutboxStore();')
s=s.replace("$('auto').onclick=runStorageTests;","$('auto').onclick=runQueueTests;").replace("$('reloadSaved').onclick=()=>vault.reload().catch(notifyError);","$('reloadSaved').onclick=()=>reloadQueue().catch(notifyError);")
s=s.replace("$('reset').onclick=()=>{if(confirm('Очистить локальную тестовую ленту и сохранённый черновик?'))resetAll().then(()=>vault.flush()).catch(notifyError)};","$('reset').onclick=()=>{if(confirm('Очистить только черновик? Исходящая очередь не удаляется.')){clearDraft();vault.flush().catch(notifyError)}};")
old='await vault.init();\n window.gate.run=runStorageTests;window.gate.report=publicSnapshot;window.gate.captureDraft=captureDraft;'
assert old in s
s=s.replace(old,"""try{queueRows=await vault.store.readQueue();queueLoaded=true;queueStats.restored_groups=queueRows.filter(OutboxVault.active).length;ingestQueue(queueRows);}catch(e){queueError=e;paintQueue();throw e}
 await vault.init();if(!list&&queueRows.some(OutboxVault.active))await openChat();await verifyQueueCheckpoint();
 $('queueBtn').onclick=showQueue;$('closeQueue').onclick=()=>$('queueDialog').close();$('queueVerify').onclick=()=>verifyQueue().catch(()=>{});$('queueReload').onclick=()=>reloadQueue().catch(notifyError);
 $('queueFail').onclick=()=>{vault.store.enqueueFault='quota';status('ТЕСТ: следующая запись в очередь будет отклонена. Напиши текст и нажми отправку.');};
 Object.assign(window.gate,{run:runQueueTests,report:publicSnapshot,captureDraft,queueSummary,verifyQueue,reloadQueue,retryQueued,cancelQueued,refreshQueue,getQueueRows:()=>queueRows,enqueue:localSend});paintQueue();""")
start=s.index('function publicSnapshot()');end=s.index('function showStorageReport()',start)
s=s[:start]+"""function publicSnapshot(){const old=snapshot();return {...old,scope:'Local durable outbox; atomic draft handoff, original attachment bytes and stable IDs. Same origin/browser; no transport, auth, server ACK, offline shell or background delivery.',overall:queueTests?.overall||'NOT_RUN',generated_at:queueTests?.generated_at||null,results:queueTests?.results||[],summary:queueTests?.summary||null,storage:vault?.public()||null,outbox:queueSummary(),editor_regression:report.overall,manual:{...old.manual,status:'PENDING_DEVICE_ACCEPTANCE'},integration:'BLOCKED_PENDING_DEVICE_AND_REAL_TRANSPORT_GATES'}}
"""+s[end:]
s=s.replace('initComposer();\nwindow.gate=',(B/'integration.js').read_text()+'\ninitComposer();\nwindow.gate=')
(S/'app.js').write_text(s)
h=(S/'index.html').read_text().replace('Черновик · сохранение · восстановление','Исходящие · сохранение · без сервера')
h=h.replace('<button id="reportBtn">Отчёт</button>','<div class="headActions"><button id="queueBtn">Очередь</button><button id="reportBtn">Отчёт</button></div>').replace('Сверить байты','Сверить черновик').replace('Черновик не теряется','Исходящие не теряются')
h=h.replace('Напиши текст, добавь фото, короткое видео или документ. Дождись «Сохранено в этом браузере» и обнови эту же страницу.','Напиши тестовый текст и добавь файл. Нажми отправку — пакет будет сохранён в локальную очередь, не собеседнику. После этого обнови страницу и открой «Очередь».')
h=h.replace('<footer id="composer">','<div id="queueError" role="alert" hidden></div><footer id="composer">').replace('Очистить стенд','Очистить черновик')
h=h.replace('<h2>Gate 01.5 · Сохранность черновика</h2>','<h2>Gate 01.5 · Очередь исходящих</h2><p>Отправка в этом стенде означает только локальную очередь. Подтверждений сервера, доставки и автозагрузки нет. При перезапуске сохраняются ожидающие исходящие и черновик.</p>')
h=h.replace('<script src="app.js"','<script src="outbox.js"></script><script src="app.js"')
dialog='<dialog id="queueDialog"><div class="modalActions"><button id="closeQueue">Закрыть</button><button id="queueVerify">Сверить очередь</button><button id="queueReload">Проверить обновлением</button></div><h2>Исходящая очередь</h2><p id="queueOverview"></p><p id="queueNote" role="status"></p><button id="queueFail">Тест: отказ следующей записи</button><div id="queueItems"></div><p>Сохраняется только в этом браузере. Данные не переносятся из старых стендов или другого браузера. Для повторного открытия сайта может понадобиться сеть.</p></dialog>'
h=h.replace('<div id="fatal"',dialog+'<div id="fatal"')
(S/'index.html').write_text(h)
with (S/'style.css').open('a') as f:f.write('\n.headActions{display:flex;gap:6px;flex:none}header strong{font-size:14px}.headActions button{font-size:12px;padding:6px 8px}#queueDialog{width:min(94vw,680px);max-height:88vh;background:#111b26;color:#ecf4ef;border:1px solid #3b4856;border-radius:20px;padding:16px}#queueDialog::backdrop{background:#0009}#queueDialog p{font-size:14px;line-height:1.45;overflow-wrap:anywhere}.queueItem{padding:15px 0;border-bottom:1px solid #3b4856}.queueItem strong{color:#b8dbc6}.queueItem button{margin:4px 6px 0 0}.outgoing-pending .meta{opacity:1;color:inherit}#queueError{position:absolute;z-index:45;top:50px;left:10px;right:10px;background:#513923;color:#fff4df;border-radius:12px;padding:10px;font-size:13px}#queueDialog .modalActions{display:flex;flex-wrap:wrap;gap:5px}#queueDialog .modalActions button{font-size:13px}')
print('Built isolated Gate 01.5',[(p.name,p.stat().st_size) for p in S.iterdir()])
