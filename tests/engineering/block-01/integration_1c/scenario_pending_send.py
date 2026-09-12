from integration_case import asyncio, check, stage, A, B, C1, C2, CB, BOT, FILES, TEXT, TAIL, sha
from integration_case import RESULT,save
from scenario_isolation import account_snapshot,profile_ui,owned_request,completed_response
import json

async def run(a):
 await a.login();await a.switch(B);await a.wait('document.querySelectorAll(".chatCard").length>0');await a.conversation(CB);b_draft=await a.write(text='B never receives A draft',files=FILES[1:2],tail='B tail');await a.switch(A);await a.wait('document.querySelectorAll(".chatCard").length>0');await a.conversation();a_draft=await a.write(text='A pending transport',files=FILES[:1],tail='A tail')
 held=a.net.hold('/rest/v1/rpc/send_rich_message',A)
 async with a.page.expect_request(lambda r:owned_request(r,'POST','/rest/v1/rpc/send_rich_message',A,C1),timeout=10000) as request_info:
  await a.page.locator('#send').click()
 request=await request_info.value;await asyncio.wait_for(held['entered'].wait(),10);q=await a.fp('queue');check('1C-PENDING-SEND-COMMITTED-ONCE',len(q)==1 and len(a.net.effects)==1 and q[0]['files']==a_draft['files'] and q[0]['messages'][0]['blocks']==a_draft['blocks'] and q[0]['messages'][0]['text']==a_draft['text'],{'queue':q,'effects':a.net.effects})
 committed_key=a.net.effects[0]['key']
 await a.switch(B);await a.wait('document.querySelectorAll(".chatCard").length>0');await a.conversation(CB);before_b=await account_snapshot(a,B,CB)
 operation={'operation_key':committed_key,'queue_id':q[0]['id'],'before_release':{'hold_entered':held['entered'].is_set(),'hold_released':held['release'].is_set(),'request_timing':request.timing}}
 RESULT.setdefault('late_operations',{})['send']=operation;save()
 if request.timing.get('responseStart',-1)>=0 or request.failure:raise RuntimeError('LATE_SEND_NOT_HELD_BEFORE_RELEASE')
 held['release'].set();reply=await completed_response(request,operation)
 operation['ack']={'client_message_id':reply.get('client_message_id'),'conversation_id':reply.get('conversation_id'),'id':reply.get('id')};save()
 if reply.get('client_message_id')!=committed_key or reply.get('conversation_id')!=C1:raise RuntimeError('LATE_SEND_RESPONSE_IDENTITY_MISMATCH')
 # The original pump must process its late ACK and persist the account-change
 # failure in A's actual IndexedDB queue, releasing its lease. After this await,
 # its remaining store-close/finally work is synchronous; settle that event turn.
 try:
  operation['settled_queue_A']=await a.queue_wait('rows.length===1 && rows[0].id==='+json.dumps(q[0]['id'])+' && rows[0].state==="error" && rows[0].lease===null',uid=A,cid=C1,timeout=8000)
 except BaseException:
  operation['unsettled_queue_A']=await a.fp('queue',A,C1);save();raise
 if operation['settled_queue_A'][0].get('error',{}).get('message')!='Аккаунт изменился':
  save();raise RuntimeError('LATE_SEND_FAILURE_NOT_ACCOUNT_CHANGE')
 await a.delay(0)
 operation['application_settlement']='Original A queue failure persisted and lease released; continuation event turn completed';save()
 after_b=await account_snapshot(a,B,CB);check('1C-PENDING-SEND-B-ISOLATION',after_b==before_b and after_b['live']==after_b['stored']==b_draft and not after_b['queue'] and after_b['uid']==B and after_b['current']==CB and after_b['route']['resourceId'] is None and after_b['profile_cache']['id']==B,{'before_B':before_b,'after_B':after_b,'queue_A':await a.fp('queue',A,C1),'completed_old_operation':operation})
 await profile_ui(a,B,CB,'1C-LATE-SEND-PROFILE-B')
 await a.switch(A);await a.wait('document.querySelectorAll(".chatCard").length>0');await a.conversation();qa=await a.fp('queue')
 keys=['id','client_message_id','first_sequence','messages','files']
 check('1C-PENDING-SEND-A-RECOVERY',len(qa)==1 and {k:qa[0][k] for k in keys}=={k:q[0][k] for k in keys},{'original':q,'restored':qa})
 await a.clear_toast();await a.page.locator('#reportBtn').click();await a.page.locator('#dialogContent button').filter(has_text='Повторить').first.click();await a.queue_wait('rows.length===0',timeout=10000)
 sends=[x for x in a.net.calls if x['path'].endswith('send_rich_message')]
 check('1C-PENDING-SEND-NO-DUPLICATE',len(a.net.effects)==1 and a.net.effects[0]['key']==committed_key and all(x['operation_key']==committed_key for x in sends),{'effects':a.net.effects,'send_calls':sends,'operation_key':committed_key})
