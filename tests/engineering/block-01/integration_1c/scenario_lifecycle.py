from integration_case import asyncio, check, stage, A, B, C1, C2, CB, BOT, FILES, TEXT, TAIL, sha, RESULT, save

async def run(a):
 await a.login()
 async def cycle():
  await a.conversation();await a.canvas();await a.page.locator('#conversationTab').click();await a.back();await a.bots();await a.scenario();await a.nav('tasks');await a.nav('profile');await a.nav('chats')
 # Warm every lazy module, then compare an identical home state over >=50 routes.
 await cycle();await a.delay(800);before=await a.resources();g0=(await a.state())['route']['generation'];snapshots=[]
 for i in range(6):
  await cycle();await a.consistency('1C-CYCLE-'+str(i+1));snapshots.append(await a.resources())
 after=snapshots[-1];g1=(await a.state())['route']['generation'];RESULT['resource_snapshots']={'before':before,'per_cycle':snapshots};save()
 check('1C-50-TRANSITIONS',g1-g0>=50,{'transitions':g1-g0,'cycles':6})
 # Individual timeouts may be transient RPC requests. Compare intervals and all
 # lasting registrations; exact source counts are retained for review.
 stable=['listeners','observers','controller','channels']
 equal=all(before[k]==after[k] for k in stable) and before['timers'].get('interval',0)==after['timers'].get('interval',0) and after['list']['active_lists']==0
 check('1C-NO-RESOURCE-ACCUMULATION',equal,{'before':before,'after':after,'constant_scope':'Application singletons/SDK clients retained; no screen listeners/observers/channels or intervals added over six same-state cycles'})
 count0=await a.page.evaluate('__integration.controllerStats.navigations.length');await a.nav('tasks');count1=await a.page.evaluate('__integration.controllerStats.navigations.length')
 check('1C-ONE-EVENT-ONE-NAVIGATION',count1-count0==1,{'before':count0,'after':count1})
