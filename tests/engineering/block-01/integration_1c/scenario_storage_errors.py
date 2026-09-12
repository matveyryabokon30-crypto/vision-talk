from integration_case import asyncio, check, stage, A, B, C1, C2, CB, BOT, FILES, TEXT, TAIL, sha

async def run(a):
 await a.login();await a.conversation();original=await a.write(files=FILES[:1]);await a.page.evaluate("PablicusChat.store.fault='abort'");await a.page.locator('#input').fill('Write refused; must stay visible');await a.wait('vault.state==="error"')
 d=await a.state();live=await a.fp();stored=await a.fp('stored');save_ui={'text':await a.page.locator('#saveState').inner_text(),'reason':await a.page.locator('#saveState').get_attribute('title')}
 check('1C-WRITE-FAILURE-RETAINED',d['vault']['pending'] and 'Write refused' in live['text'] and live['files']==original['files'] and stored==original and await a.page.locator('#vaultLine').is_visible() and 'Не сохранено' in save_ui['text'] and save_ui['reason']==d['vault']['error']['message'],{'state':d,'live':live,'stored':stored,'visible_save_error':save_ui})
 await a.page.locator('#saveRetry').click();await a.wait('vault.state==="saved"');check('1C-WRITE-FAILURE-RETRY',await a.fp()==await a.fp('stored'),{'live':await a.fp(),'stored':await a.fp('stored')})
 # Real enqueue abort occurs after attempted outbox add+draft clear in one tx.
 expected=await a.fp();await a.page.evaluate("PablicusChat.store.enqueueFault='abort'");await a.page.locator('#send').click();await a.wait('PablicusChat.snapshot.outbox.state==="error"')
 enqueue_error=await a.page.evaluate('PablicusChat.snapshot.outbox');enqueue_ui=await a.page.locator('#queueError').inner_text()
 check('1C-ENQUEUE-ATOMIC-FAILURE',await a.fp()==expected and await a.fp('stored')==expected and not await a.fp('queue') and await a.page.locator('#queueError').is_visible() and enqueue_error['error']['message'] in enqueue_ui,{'live':await a.fp(),'stored':await a.fp('stored'),'queue':await a.fp('queue'),'snapshot':enqueue_error,'visible_reason':enqueue_ui})
 # Retry the same real UI enqueue while offline; preserve a second operation's
 # text/blocks/bytes, then resume transport before the independent load fault.
 a.net.offline=True;await a.ctx.set_offline(True);await a.page.locator('#send').click();retried=await a.queue_wait()
 check('1C-ENQUEUE-FAILURE-RETRY',len(retried)==1 and retried[0]['files']==expected['files'] and retried[0]['messages'][0]['text']==expected['text'] and retried[0]['messages'][0]['blocks']==expected['blocks'],{'expected':expected,'queue':retried})
 a.net.offline=False;await a.ctx.set_offline(False);await a.page.evaluate('window.dispatchEvent(new Event("online"))');await a.queue_wait('rows.length===0',timeout=10000)
 expected=await a.write(text='Load failure retained draft',files=FILES[:1],tail='Load recovery tail')
 # Next actual load fails at the native IDB transaction boundary. Reload is a
 # real user retry; no replacement read() or pre-populated recovery answer.
 await a.back();database=f'pablicus-v1:{A}:{C1}';await a.page.evaluate('(database)=>__integration.armFault({database,mode:"readonly",store:"drafts",name:"UnknownError"})',database);await a.page.locator(f'[data-conversation-id="{C1}"] .chatMain').click();await a.wait('window.vault?.state==="load-error"');await a.delay(150)
 d=await a.state();check('1C-LOAD-FAILURE-NOT-SAVED',not d['ready'] and d['vault']['state']=='load-error' and (d['toast'] is not None or await a.page.locator('#vaultLine').is_visible()),{'state':d,'native':await a.page.evaluate('__integration.idbEvents')})
 await a.page.reload(wait_until='load');await a.wait('document.querySelectorAll(".chatCard").length>0');await a.conversation();check('1C-LOAD-FAILURE-RETRY',await a.fp()==expected and await a.fp('stored')==expected,{'live':await a.fp(),'stored':await a.fp('stored')})
