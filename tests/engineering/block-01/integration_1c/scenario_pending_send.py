from integration_case import asyncio, check, stage, A, B, C1, C2, CB, BOT, FILES, TEXT, TAIL, sha
from scenario_isolation import account_snapshot,profile_ui

async def run(a):
 await a.login();await a.switch(B);await a.wait('document.querySelectorAll(".chatCard").length>0');await a.conversation(CB);b_draft=await a.write(text='B never receives A draft',files=FILES[1:2],tail='B tail');await a.switch(A);await a.wait('document.querySelectorAll(".chatCard").length>0');await a.conversation();a_draft=await a.write(text='A pending transport',files=FILES[:1],tail='A tail')
 held=a.net.hold('/rest/v1/rpc/send_rich_message',A);await a.page.locator('#send').click();await asyncio.wait_for(held['entered'].wait(),10);q=await a.fp('queue');check('1C-PENDING-SEND-COMMITTED-ONCE',len(q)==1 and len(a.net.effects)==1 and q[0]['files']==a_draft['files'] and q[0]['messages'][0]['blocks']==a_draft['blocks'] and q[0]['messages'][0]['text']==a_draft['text'],{'queue':q,'effects':a.net.effects})
 committed_key=a.net.effects[0]['key']
 await a.switch(B);await a.wait('document.querySelectorAll(".chatCard").length>0');await a.conversation(CB);before_b=await account_snapshot(a,B,CB);held['release'].set();await a.delay(500)
 after_b=await account_snapshot(a,B,CB);check('1C-PENDING-SEND-B-ISOLATION',after_b==before_b and after_b['live']==after_b['stored']==b_draft and not after_b['queue'] and after_b['uid']==B and after_b['current']==CB and after_b['route']['resourceId'] is None and after_b['profile_cache']['id']==B,{'before_B':before_b,'after_B':after_b,'queue_A':await a.fp('queue',A,C1)})
 await profile_ui(a,B,CB,'1C-LATE-SEND-PROFILE-B')
 await a.switch(A);await a.wait('document.querySelectorAll(".chatCard").length>0');await a.conversation();qa=await a.fp('queue')
 keys=['id','client_message_id','first_sequence','messages','files']
 check('1C-PENDING-SEND-A-RECOVERY',len(qa)==1 and {k:qa[0][k] for k in keys}=={k:q[0][k] for k in keys},{'original':q,'restored':qa})
 await a.clear_toast();await a.page.locator('#reportBtn').click();await a.page.locator('#dialogContent button').filter(has_text='Повторить').first.click();await a.queue_wait('rows.length===0',timeout=10000)
 sends=[x for x in a.net.calls if x['path'].endswith('send_rich_message')]
 check('1C-PENDING-SEND-NO-DUPLICATE',len(a.net.effects)==1 and a.net.effects[0]['key']==committed_key and all(x['operation_key']==committed_key for x in sends),{'effects':a.net.effects,'send_calls':sends,'operation_key':committed_key})
