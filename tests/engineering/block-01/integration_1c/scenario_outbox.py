from integration_case import asyncio, check, stage, A, B, C1, C2, CB, BOT, FILES, TEXT, TAIL, sha
from urllib.parse import urlparse,parse_qs
from network import API_HOST,uid_of

async def run(a):
 await a.login();await a.conversation();before=await a.write(files=FILES[:2]);a.net.offline=True;await a.ctx.set_offline(True)
 stage('UI enqueue offline');await a.page.locator('#send').click();q0=await a.queue_wait();check('1C-OUTBOX-OFFLINE-COMMIT',q0[0]['files']==before['files'] and q0[0]['messages'][0]['text']==before['text'] and q0[0]['messages'][0]['blocks']==before['blocks'] and not q0[0]['parts'],q0)
 stage('actual offline page reload with declared local static shell');await a.page.reload(wait_until='load');await a.wait('document.querySelectorAll(".chatCard").length>0');await a.conversation();q1=await a.fp('queue')
 def identity(q):return [{k:r[k] for k in ['id','client_message_id','first_sequence','messages','files']} for r in q]
 check('1C-OUTBOX-OFFLINE-RELOAD',identity(q1)==identity(q0),{'before':q0,'after':q1,'online':await a.page.evaluate('navigator.onLine')})
 # Hold actual send after synthetic server effect; abort only ACK, then stop API
 # again so the unacknowledged durable record can be inspected before retry.
 a.net.lose_ack=True;held=a.net.hold('/rest/v1/rpc/send_rich_message',A);a.net.offline=False;await a.ctx.set_offline(False);await a.page.evaluate('window.dispatchEvent(new Event("online"))')
 await asyncio.wait_for(held['entered'].wait(),10);q_pending=await a.fp('queue');check('1C-OUTBOX-NO-PREMATURE-DELETE',identity(q_pending)==identity(q0) and len(a.net.effects)==1,{'queue':q_pending,'effects':a.net.effects})
 a.net.offline=True;await a.ctx.set_offline(True);held['release'].set()
 async def lost_ack_delivered():
  while not any(call.get('status')=='COMMITTED_ACK_LOST' for call in a.net.calls):await asyncio.sleep(.02)
 await asyncio.wait_for(lost_ack_delivered(),5)
 q_lost=await a.queue_wait('rows.length===1 && rows[0].state==="queued" && rows[0].lease===null && !!rows[0].error',timeout=8000)
 lost_calls=[call for call in a.net.calls if call.get('status')=='COMMITTED_ACK_LOST']
 check('1C-OUTBOX-ACK-LOST-DURABLE',identity(q_lost)==identity(q0) and len(lost_calls)==1 and lost_calls[0].get('operation_key')==a.net.effects[0]['key'],{'queue':q_lost,'lost_ack_calls':lost_calls})
 # Real online recovery retries the durable queued operation; offline polling
 # can keep an error toast visible, so hiding that toast is not a prerequisite.
 stage('restore network; actual online handler retries lost ACK')
 operation_key=a.net.effects[0]['key']
 def same_key_ack(response):
  request=response.request;url=urlparse(request.url);query=parse_qs(url.query)
  return request.method=='GET' and url.scheme=='https' and url.hostname==API_HOST and url.path=='/rest/v1/messages' and query.get('sender_id')==['eq.'+A] and query.get('client_message_id')==['eq.'+operation_key] and uid_of(request.headers.get('authorization',''))==A
 async with a.page.expect_response(same_key_ack,timeout=10000) as ack_info:
  a.net.offline=False;await a.ctx.set_offline(False)
 ack_response=await ack_info.value
 await ack_response.finished();ack_payload=await ack_response.json()
 ack_body=ack_payload[0] if isinstance(ack_payload,list) and len(ack_payload)==1 else ack_payload
 await a.queue_wait('rows.length===0',timeout=10000);sends=[x for x in a.net.calls if x['path'].endswith('send_rich_message')]
 check('1C-OUTBOX-IDEMPOTENT',len(a.net.effects)==1 and bool(sends) and all(x['operation_key']==operation_key for x in sends) and ack_response.status==200 and isinstance(ack_body,dict) and ack_body.get('client_message_id')==operation_key and ack_body.get('conversation_id')==C1 and ack_body.get('sender_id')==A and ack_body.get('server_seq',0)>0,{'effects':a.net.effects,'send_calls':sends,'original_queue':identity(q0),'recovery_ack':{'url':ack_response.url,'status':ack_response.status,'raw_body':ack_payload,'body':ack_body}})
 refusal_draft=await a.write(text='Explicit refusal then retry',files=FILES[2:],tail='');call_start=len(a.net.calls);a.net.deny_send=True;await a.page.locator('#send').click();denied=await a.queue_wait('rows.length===1 && rows[0].state==="error"')
 check('1C-OUTBOX-EXPLICIT-REFUSAL',len(a.net.effects)==1 and denied[0]['error']['message']=='FIXTURE_EXPLICIT_REJECTION' and denied[0]['files']==refusal_draft['files'] and denied[0]['messages'][0]['blocks']==refusal_draft['blocks'] and denied[0]['messages'][0]['text']==refusal_draft['text'],{'queue':denied,'original':refusal_draft})
 await a.clear_toast();await a.page.locator('#reportBtn').click();error_ui=a.page.locator('.outboxItem .danger').first
 check('1C-OUTBOX-REFUSAL-VISIBLE',await error_ui.is_visible() and await error_ui.inner_text()==denied[0]['error']['message'],{'visible_reason':await error_ui.inner_text(),'stored_reason':denied[0]['error']})
 a.net.deny_send=False;await a.page.locator('#dialogContent button').filter(has_text='Повторить').first.click();await a.queue_wait('rows.length===0',timeout=10000)
 refusal_calls=[x for x in a.net.calls[call_start:] if x['path'].endswith('send_rich_message')]
 check('1C-OUTBOX-REFUSAL-RETRY',len(a.net.effects)==2 and len({(e['uid'],e['key']) for e in a.net.effects})==2 and len(refusal_calls)>=2 and len({x['operation_key'] for x in refusal_calls})==1 and refusal_calls[-1]['operation_key']==a.net.effects[-1]['key'],{'effects':a.net.effects,'denied_record':denied,'send_calls':refusal_calls})
