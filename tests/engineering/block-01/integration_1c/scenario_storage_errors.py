from integration_case import asyncio, check, stage, A, B, C1, C2, CB, BOT, FILES, TEXT, TAIL, sha

async def run(a):
 await a.login();await a.conversation();original=await a.write(files=FILES[:1]);await a.page.evaluate("PablicusChat.store.fault='abort'");await a.page.locator('#input').fill('Write refused; must stay visible');await a.wait('vault.state==="error"')
 d=await a.state();live=await a.fp();stored=await a.fp('stored');check('1C-WRITE-FAILURE-RETAINED',d['vault']['pending'] and 'Write refused' in live['text'] and stored==original and await a.page.locator('#vaultLine').is_visible(),{'state':d,'live':live,'stored':stored})
 await a.page.locator('#saveRetry').click();await a.wait('vault.state==="saved"');check('1C-WRITE-FAILURE-RETRY',await a.fp()==await a.fp('stored'),{'live':await a.fp(),'stored':await a.fp('stored')})
 # Real enqueue abort occurs after attempted outbox add+draft clear in one tx.
 expected=await a.fp();await a.page.evaluate("PablicusChat.store.enqueueFault='abort'");await a.page.locator('#send').click();await a.wait('PablicusChat.snapshot.outbox.state==="error"')
 check('1C-ENQUEUE-ATOMIC-FAILURE',await a.fp()==expected and await a.fp('stored')==expected and not await a.fp('queue') and await a.page.locator('#queueError').is_visible(),{'live':await a.fp(),'stored':await a.fp('stored'),'queue':await a.fp('queue'),'snapshot':await a.page.evaluate('PablicusChat.snapshot.outbox')})
 # Next actual load fails at the native IDB transaction boundary. Reload is a
 # real user retry; no replacement read() or pre-populated recovery answer.
 await a.back();database=f'pablicus-v1:{A}:{C1}';await a.page.evaluate('(database)=>__integration.armFault({database,mode:"readonly",store:"drafts",name:"UnknownError"})',database);await a.page.locator(f'[data-conversation-id="{C1}"] .chatMain').click();await a.wait('window.vault?.state==="load-error"');await a.delay(150)
 d=await a.state();check('1C-LOAD-FAILURE-NOT-SAVED',not d['ready'] and d['vault']['state']=='load-error' and (d['toast'] is not None or await a.page.locator('#vaultLine').is_visible()),{'state':d,'native':await a.page.evaluate('__integration.idbEvents')})
 await a.page.reload(wait_until='load');await a.wait('document.querySelectorAll(".chatCard").length>0');await a.conversation();check('1C-LOAD-FAILURE-RETRY',await a.fp()==expected and await a.fp('stored')==expected,{'live':await a.fp(),'stored':await a.fp('stored')})
