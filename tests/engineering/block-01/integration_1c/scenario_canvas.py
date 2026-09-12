from integration_case import asyncio, check, stage, A, B, C1, C2, CB, BOT, FILES, TEXT, TAIL, sha

async def run(a):
 await a.login();await a.conversation();before=await a.write(files=FILES[:1]);await a.canvas();await a.page.locator('.pccProjectCard').click();await a.page.locator('.pccPlanEdit').click();await a.page.locator('.pccPlanEditor textarea').first.fill('Unsaved Canvas 1C marker')
 route0=(await a.state())['route'];resources=await a.resources();a.page.once('dialog',lambda d:d.dismiss());await a.page.locator('#chatBack').click();await a.delay(150)
 d=await a.state();edit=await a.page.locator('.pccPlanEditor textarea').first.input_value();check('1C-REAL-CANVAS-DENY',d['route']==route0 and d['list'] and edit=='Unsaved Canvas 1C marker' and (await a.fp())==before,{'state':d,'editor':edit,'list':await a.page.evaluate('PablicusChat.snapshot.counters')})
 # Accept the real Canvas leave while retaining the saved chat draft. Canvas
 # deliberately hides the composer; edit only after returning to conversation.
 a.page.once('dialog',lambda dialog:dialog.accept());await a.page.locator('#conversationTab').click();await a.wait('PablicusController.state().screen==="conversation" && document.querySelector("#chatCanvasPanel").hidden')
 await a.page.locator('#input').wait_for(state='visible');check('1C-REAL-CANVAS-ACCEPT',await a.fp()==before and (await a.state())['list'],{'state':await a.state(),'draft':await a.fp()})
 # Hold an actual native write transaction. Real chat.leave flushes this vault.
 db=await a.page.evaluate('PablicusChat.store.name');await a.page.evaluate('(database)=>__integration.holdWrite({database,store:"drafts"})',db)
 await a.page.locator('#input').fill(TEXT+' pending saved on exit');await a.wait('__integration.held()?.entered')
 await a.page.locator('#chatBack').click();await a.delay(100)
 # Click the real conversation tab while accepted Back is awaiting its write.
 await a.page.locator('#conversationTab').click();await a.delay(100)
 pending=await a.page.evaluate('__integration.controllerStats.navigations.slice(-2)');check('1C-REAL-LEAVE-WAITS',pending[-1]['status']=='pending',pending)
 await a.page.evaluate('__integration.releaseWrite()');await a.wait('PablicusController.state().screen==="conversation" && !!PablicusChat.list && vault.ready && __integration.controllerStats.navigations.at(-1).status==="fulfilled"')
 await a.consistency('1C-REAL-LEAVE-RESUME');after=await a.fp();stored=await a.fp('stored');check('1C-REAL-LEAVE-BYTES',after==stored and after['files']==before['files'] and 'pending saved on exit' in after['text'],{'live':after,'stored':stored,'idb_events':await a.page.evaluate('__integration.idbEvents')})
