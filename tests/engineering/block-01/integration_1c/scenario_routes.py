from integration_case import asyncio, check, stage, A, B, C1, C2, CB, BOT, FILES, TEXT, TAIL, sha
from scenario_quiet import DialogResponses


async def bot_detail_survives_poll(a):
 observed=DialogResponses(a)
 try:
  await a.page.locator('.botCard .botMain').click()
  action=a.page.locator('.botPanel [data-action=scenario]')
  await action.wait_for(state='visible',timeout=8000)
  before=await a.state();offset=len(observed.entries)
  responses=await observed.wait_new(offset,count=2,timeout=5)
  # Both RPC bodies reached the real browser. Yield once for their normal render
  # microtasks before asserting; do not trigger a replacement navigation.
  await a.delay(100)
  after=await a.state()
  visible={'panel':await a.page.locator('.botPanel').is_visible(),
           'scenario_action':await action.is_visible()}
  check('1C-BOT-DETAIL-SURVIVES-POLL',
        before['route']==after['route'] and after['route']['screen']=='bots'
        and after['route']['section']=='bots' and after['uid']==A
        and after['homeVisible'] and not after['appVisible']
        and all(visible.values()),
        {'before':before,'after':after,'visible':visible,'actual_dialog_responses':responses})
  await action.click()
  await a.wait('!!document.querySelector(".scenarioList")')
 finally:
  await observed.close()

async def run(a):
 await a.login();await a.consistency('1C-ROUTE-HOME');await a.conversation();await a.consistency('1C-ROUTE-CONVERSATION');await a.canvas();await a.consistency('1C-ROUTE-CANVAS')
 await a.page.locator('#conversationTab').click();await a.delay();await a.consistency('1C-ROUTE-RETURN');await a.back();await a.bots();await a.consistency('1C-ROUTE-BOTS')
 await bot_detail_survives_poll(a);await a.delay(1800)
 d=await a.state();visible=await a.page.locator('.scenarioList').is_visible()
 content=await a.page.locator('.scenarioList textarea').evaluate_all('(nodes)=>nodes.map(n=>n.value)')
 d.update(scenario_visible=visible,scenario_text=content)
 check('1C-SCENARIO-SURVIVES-POLL',d['route']['screen']=='scenario' and d['route']['section']=='bots' and d['route']['resourceId']==BOT and d['route']['conversationId'] is None and d['uid']==A and visible and content==['Fixture greeting','Done'],d)
 await a.consistency('1C-ROUTE-SCENARIO');await a.nav('chats');await a.bots();await a.page.locator('[data-action=create-bot]').click();await a.delay(400)
 await a.page.wait_for_function('document.querySelector(".factorySection")?.innerText.includes("Проектов пока нет.")')
 d=await a.state();d['factory_visible']=await a.page.locator('.factoryLead').is_visible()
 d['factory_calls']=[call for call in a.net.calls if call.get('path')=='/rest/v1/rpc/factory_list_projects']
 check('1C-ROUTE-FACTORY',d['route']['screen']=='factory' and d['route']['section']=='bots' and d['route']['resourceId'] is None and d['route']['conversationId'] is None and d['uid']==A and d['selected']==['tasks'] and d['factory_visible'] and any(call.get('uid')==A and call.get('method')=='POST' and call.get('status')==200 for call in d['factory_calls']),d)
 await a.consistency('1C-ROUTE-FACTORY-VISIBLE')
 await a.nav('chats');await a.conversation();await a.consistency('1C-ROUTE-FINAL')
 globals=await a.page.evaluate("['supabase','PablicusController','PablicusChat','PablicusChatCanvas','PablicusBots','PablicusBotScenarioEditor','PablicusWorkspaceEditor','DraftVault','OutboxVault','PablicusStore','PablicusRichStore','PablicusRichComposer'].map(k=>[k,!!window[k]])")
 check('1C-REAL-MODULE-GRAPH',all(x[1] for x in globals),{'globals':globals,'loaded_source_sha256':a.net.local_files})
