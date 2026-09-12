from integration_case import asyncio, check, stage, A, B, C1, C2, CB, BOT, FILES, TEXT, TAIL, sha

async def account_snapshot(a,uid,cid):
 d=await a.state()
 profile=await a.page.evaluate('(uid)=>JSON.parse(localStorage.getItem("pablicus:"+uid+":profile"))',uid)
 store=await a.page.evaluate('({account:PablicusChat.store.account,conversation:PablicusChat.store.conversation,name:PablicusChat.store.name})')
 return {'uid':d['uid'],'current':d['current'],'scope':d['scope'],'route':d['route'],'selected':d['selected'],'list':d['list'],'ready':d['ready'],'profile_cache':profile,'store':store,'live':await a.fp(),'stored':await a.fp('stored',uid,cid),'queue':await a.fp('queue',uid,cid)}

def account_content(snapshot):
 # Re-entering B legitimately changes route and session generations; its user data and selected
 # route/resource must remain identical to the saved B baseline.
 return {**snapshot,'route':{k:v for k,v in snapshot['route'].items() if k not in ['generation','sessionGeneration']}}

async def profile_ui(a,uid,cid,label):
 # The runtime keeps profile in a closure. Read its actual rendered profile,
 # in addition to observing the cache, without adding a runtime debug hook.
 await a.back();await a.nav('profile');await a.page.locator('.profileCard > h2').first.wait_for(state='visible')
 heading=await a.page.locator('.profileCard > h2').first.inner_text();handle=await a.page.locator('.profileCard > p.muted').first.inner_text()
 check(label,heading==('Fixture A' if uid==A else 'Fixture B') and handle==('@fixture_a' if uid==A else '@fixture_b'),{'heading':heading,'handle':handle})
 await a.nav('chats');await a.wait('document.querySelectorAll(".chatCard").length>0');await a.conversation(cid)

async def run(a):
 await a.login();await a.conversation();own_a=await a.write(text='Account A private marker',files=FILES[:1],tail='A tail');await a.switch(B);await a.wait(f'!!document.querySelector("[data-conversation-id={CB}]")');await a.conversation(CB);own_b=await a.write(text='Account B private marker',files=FILES[1:2],tail='B tail')
 await a.switch(A);await a.wait(f'!!document.querySelector("[data-conversation-id={C1}]")');await a.conversation();check('1C-ACCOUNT-A-RESTORED',await a.fp()==own_a and await a.fp('stored',A,C1)==own_a,{'A':await a.fp(),'stored_A':await a.fp('stored',A,C1),'expected':own_a});await a.back()
 # Old actual conversation read is paused at its HTTP response boundary.
 held=a.net.hold('/rest/v1/messages',A);await a.page.locator(f'[data-conversation-id="{C1}"] .chatMain').click();await asyncio.wait_for(held['entered'].wait(),8)
 await a.switch(B);await a.wait('document.querySelectorAll(".chatCard").length>0');await a.conversation(CB);before_b=await account_snapshot(a,B,CB);held['release'].set();await a.delay(500)
 after_b=await account_snapshot(a,B,CB);check('1C-LATE-ACCOUNT-ISOLATION',after_b==before_b and after_b['live']==after_b['stored']==own_b and after_b['uid']==B and after_b['current']==CB and after_b['scope']=={'user':B,'chat':CB} and after_b['route']['conversationId']==CB and after_b['route']['resourceId'] is None and after_b['profile_cache']['id']==B and not after_b['queue'],{'before':before_b,'after':after_b})
 await profile_ui(a,B,CB,'1C-LATE-READ-PROFILE-B')
 refresh_before=await account_snapshot(a,B,CB);boot=await a.page.evaluate('vault.bootId');counter=await a.page.evaluate('PablicusChat.snapshot.counters.destroyed');await a.page.evaluate('PablicusController.getServices().client.auth.refreshSession()');await a.delay(300)
 refresh_after=await account_snapshot(a,B,CB);check('1C-TOKEN-REFRESH-PRESERVES',refresh_after==refresh_before and await a.page.evaluate('vault.bootId')==boot and await a.page.evaluate('PablicusChat.snapshot.counters.destroyed')==counter,{'before':refresh_before,'after':refresh_after})
 # Real pending native save A -> B. B cannot acquire A's vault or draft.
 await a.switch(A);await a.wait('document.querySelectorAll(".chatCard").length>0');await a.conversation();db=await a.page.evaluate('PablicusChat.store.name');await a.page.evaluate('(database)=>__integration.holdWrite({database})',db);await a.page.locator('#input').fill('A pending save before B');await a.wait('__integration.held()?.entered');pending_a=await a.fp()
 await a.switch(B,wait=False);await a.delay(100);during=await a.state();await a.page.evaluate('__integration.releaseWrite()');await a.wait(f'PablicusDebug.user==="{B}" && !document.querySelector("#workspace").hidden');await a.wait('document.querySelectorAll(".chatCard").length>0');await a.conversation(CB)
 saved_b=await account_snapshot(a,B,CB);stored_a=await a.fp('stored',A,C1)
 check('1C-PENDING-SAVE-ISOLATION',account_content(saved_b)==account_content(refresh_after) and saved_b['route']['sessionGeneration']==refresh_after['route']['sessionGeneration']+2 and saved_b['live']==saved_b['stored']==own_b and stored_a==pending_a,{'during':during,'before_B':refresh_after,'after_B':saved_b,'stored_A':stored_a,'native':await a.page.evaluate('__integration.idbEvents')})
 await profile_ui(a,B,CB,'1C-LATE-WRITE-PROFILE-B')
 await a.switch(A);await a.wait('document.querySelectorAll(".chatCard").length>0');await a.conversation();restored=await a.fp();check('1C-PENDING-SAVE-A-RESTORED',restored==pending_a==await a.fp('stored',A,C1) and restored['files']==own_a['files'],{'expected':pending_a,'restored':restored})
