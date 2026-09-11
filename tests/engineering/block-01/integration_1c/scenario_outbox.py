from integration_case import asyncio, check, stage, A, B, C1, C2, CB, BOT, FILES, TEXT, TAIL, sha

async def run(a):
 await a.login();await a.conversation();before=await a.write(files=FILES[:2]);a.net.offline=True;await a.ctx.set_offline(True)
 stage('UI enqueue offline');await a.page.locator('#send').click();q0=await a.queue_wait();check('1C-OUTBOX-OFFLINE-COMMIT',q0[0]['files']==before['files'] and not q0[0]['parts'],q0)
 stage('actual offline page reload with declared local static shell');await a.page.reload(wait_until='load');await a.wait('document.querySelectorAll(".chatCard").length>0');await a.conversation();q1=await a.fp('queue')
 def identity(q):return [{k:r[k] for k in ['id','client_message_id','first_sequence','messages','files']} for r in q]
 check('1C-OUTBOX-OFFLINE-RELOAD',identity(q1)==identity(q0),{'before':q0,'after':q1,'online':await a.page.evaluate('navigator.onLine')})
 # Hold actual send after synthetic server effect; abort only ACK, then stop API
 # again so the unacknowledged durable record can be inspected before retry.
 a.net.lose_ack=True;held=a.net.hold('/rest/v1/rpc/send_rich_message',A);a.net.offline=False;await a.ctx.set_offline(False);await a.page.evaluate('window.dispatchEvent(new Event("online"))')
 await asyncio.wait_for(held['entered'].wait(),10);q_pending=await a.fp('queue');check('1C-OUTBOX-NO-PREMATURE-DELETE',identity(q_pending)==identity(q0) and len(a.net.effects)==1,{'queue':q_pending,'effects':a.net.effects})
 a.net.offline=True;await a.ctx.set_offline(True);held['release'].set();await a.delay(400);q_lost=await a.fp('queue');check('1C-OUTBOX-ACK-LOST-DURABLE',identity(q_lost)==identity(q0),q_lost)
 await a.clear_toast();await a.page.locator('#reportBtn').click();await a.page.locator('#dialogContent button').filter(has_text='Повторить').first.click();a.net.offline=False;await a.ctx.set_offline(False)
 await a.queue_wait('rows.length===0',timeout=10000);check('1C-OUTBOX-IDEMPOTENT',len(a.net.effects)==1,{'effects':a.net.effects,'send_calls':[x for x in a.net.calls if x['path'].endswith('send_rich_message')],'original_queue':identity(q0)})
 await a.write(text='Explicit refusal then retry',files=FILES[2:],tail='');a.net.deny_send=True;await a.page.locator('#send').click();denied=await a.queue_wait('rows.length===1 && rows[0].state==="error"')
 check('1C-OUTBOX-EXPLICIT-REFUSAL',len(a.net.effects)==1 and denied[0]['error'] and denied[0]['files'][0]['sha256']==sha(FILES[2]['buffer']),denied)
 a.net.deny_send=False;await a.clear_toast();await a.page.locator('#reportBtn').click();await a.page.locator('#dialogContent button').filter(has_text='Повторить').first.click();await a.queue_wait('rows.length===0',timeout=10000)
 check('1C-OUTBOX-REFUSAL-RETRY',len(a.net.effects)==2 and len({(e['uid'],e['key']) for e in a.net.effects})==2,{'effects':a.net.effects,'denied_record':denied})
