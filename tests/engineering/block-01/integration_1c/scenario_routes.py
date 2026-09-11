from integration_case import asyncio, check, stage, A, B, C1, C2, CB, BOT, FILES, TEXT, TAIL, sha

async def run(a):
 await a.login();await a.consistency('1C-ROUTE-HOME');await a.conversation();await a.consistency('1C-ROUTE-CONVERSATION');await a.canvas();await a.consistency('1C-ROUTE-CANVAS')
 await a.page.locator('#conversationTab').click();await a.delay();await a.consistency('1C-ROUTE-RETURN');await a.back();await a.bots();await a.consistency('1C-ROUTE-BOTS')
 await a.scenario();await a.delay(1800)
 d=await a.state();check('1C-SCENARIO-SURVIVES-POLL',d['route']['screen']=='scenario' and d['route']['resourceId']==BOT and await a.page.locator('.scenarioList').count()==1,d)
 await a.consistency('1C-ROUTE-SCENARIO');await a.nav('chats');await a.bots();await a.page.locator('[data-action=create-bot]').click();await a.delay(400)
 d=await a.state();check('1C-ROUTE-FACTORY',d['route']['screen']=='factory' and await a.page.locator('.factoryLead').count()>0,d)
 await a.nav('chats');await a.conversation();await a.consistency('1C-ROUTE-FINAL')
 globals=await a.page.evaluate("['supabase','PablicusController','PablicusChat','PablicusChatCanvas','PablicusBots','PablicusBotScenarioEditor','PablicusWorkspaceEditor','DraftVault','OutboxVault','PablicusStore','PablicusRichStore','PablicusRichComposer'].map(k=>[k,!!window[k]])")
 check('1C-REAL-MODULE-GRAPH',all(x[1] for x in globals),{'globals':globals,'loaded_source_sha256':a.net.local_files})
