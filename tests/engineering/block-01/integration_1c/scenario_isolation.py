from integration_case import asyncio, check, stage, A, B, C1, C2, CB, BOT, FILES, TEXT, TAIL, sha

async def run(a):
 await a.login();await a.conversation();own_a=await a.write(text='Account A private marker',files=FILES[:1],tail='A tail');await a.switch(B);await a.wait(f'!!document.querySelector("[data-conversation-id={CB}]")');await a.conversation(CB);own_b=await a.write(text='Account B private marker',files=FILES[1:2],tail='B tail')
 await a.switch(A);await a.wait(f'!!document.querySelector("[data-conversation-id={C1}]")');await a.conversation();check('1C-ACCOUNT-A-RESTORED',await a.fp()==own_a,{'A':await a.fp(),'expected':own_a});await a.back()
 # Old actual conversation read is paused at its HTTP response boundary.
 held=a.net.hold('/rest/v1/messages',A);await a.page.locator(f'[data-conversation-id="{C1}"] .chatMain').click();await asyncio.wait_for(held['entered'].wait(),8)
 await a.switch(B);await a.wait('document.querySelectorAll(".chatCard").length>0');await a.conversation(CB);before_b=await a.fp();held['release'].set();await a.delay(500)
 d=await a.state();after_b=await a.fp();queue_b=await a.fp('queue');check('1C-LATE-ACCOUNT-ISOLATION',after_b==own_b==before_b and d['uid']==B and d['current']==CB and d['scope']=={'user':B,'chat':CB} and d['route']['conversationId']==CB and not queue_b,{'state':d,'before':before_b,'after':after_b,'queue':queue_b})
 route0=d['route'];boot=await a.page.evaluate('vault.bootId');counter=await a.page.evaluate('PablicusChat.snapshot.counters.destroyed');await a.page.evaluate('PablicusController.getServices().client.auth.refreshSession()');await a.delay(300)
 d=await a.state();check('1C-TOKEN-REFRESH-PRESERVES',d['route']==route0 and await a.page.evaluate('vault.bootId')==boot and await a.page.evaluate('PablicusChat.snapshot.counters.destroyed')==counter and await a.fp()==own_b,d)
 # Real pending native save A -> B. B cannot acquire A's vault or draft.
 await a.switch(A);await a.wait('document.querySelectorAll(".chatCard").length>0');await a.conversation();db=await a.page.evaluate('PablicusChat.store.name');await a.page.evaluate('(database)=>__integration.holdWrite({database})',db);await a.page.locator('#input').fill('A pending save before B');await a.wait('__integration.held()?.entered')
 await a.switch(B,wait=False);await a.delay(100);during=await a.state();await a.page.evaluate('__integration.releaseWrite()');await a.wait(f'PablicusDebug.user==="{B}" && !document.querySelector("#workspace").hidden');await a.wait('document.querySelectorAll(".chatCard").length>0');await a.conversation(CB)
 check('1C-PENDING-SAVE-ISOLATION',await a.fp()==own_b,{'during':during,'B':await a.fp(),'stored_A':await a.fp('stored',A,C1),'native':await a.page.evaluate('__integration.idbEvents')})
 await a.switch(A);await a.wait('document.querySelectorAll(".chatCard").length>0');await a.conversation();restored=await a.fp();check('1C-PENDING-SAVE-A-RESTORED','A pending save before B' in restored['text'] and restored['files']==own_a['files'],restored)
