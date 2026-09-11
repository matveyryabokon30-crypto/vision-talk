from integration_case import asyncio, check, stage, A, B, C1, C2, CB, BOT, FILES, TEXT, TAIL, sha

async def run(a):
 await a.login();await a.switch(B);await a.wait('document.querySelectorAll(".chatCard").length>0');await a.conversation(CB);b_draft=await a.write(text='B never receives A draft',files=FILES[1:2],tail='B tail');await a.switch(A);await a.wait('document.querySelectorAll(".chatCard").length>0');await a.conversation();a_draft=await a.write(text='A pending transport',files=FILES[:1],tail='A tail')
 held=a.net.hold('/rest/v1/rpc/send_rich_message',A);await a.page.locator('#send').click();await asyncio.wait_for(held['entered'].wait(),10);q=await a.fp('queue');check('1C-PENDING-SEND-COMMITTED-ONCE',len(a.net.effects)==1 and q[0]['files']==a_draft['files'],{'queue':q,'effects':a.net.effects})
 await a.switch(B);await a.wait('document.querySelectorAll(".chatCard").length>0');await a.conversation(CB);held['release'].set();await a.delay(500)
 d=await a.state();check('1C-PENDING-SEND-B-ISOLATION',await a.fp()==b_draft and not await a.fp('queue') and d['uid']==B and d['current']==CB,{'B':await a.fp(),'state':d,'queue_A':await a.fp('queue',A,C1)})
 await a.switch(A);await a.wait('document.querySelectorAll(".chatCard").length>0');await a.conversation();qa=await a.fp('queue')
 check('1C-PENDING-SEND-A-RECOVERY',len(qa)==1 and qa[0]['id']==q[0]['id'] and qa[0]['files']==q[0]['files'],qa)
 await a.clear_toast();await a.page.locator('#reportBtn').click();await a.page.locator('#dialogContent button').filter(has_text='Повторить').first.click();await a.queue_wait('rows.length===0',timeout=10000);check('1C-PENDING-SEND-NO-DUPLICATE',len(a.net.effects)==1,a.net.effects)
