from integration_case import asyncio, check, stage, A, B, C1, C2, CB, BOT, FILES, TEXT, TAIL, sha

async def run(a):
 await a.login();await a.page.evaluate("__integration.observeQuiet('home','#screenContent')");await a.delay(4200)
 d=await a.page.evaluate("__integration.quiet('home')");check('1C-QUIET-LIST',d['records']==0,d)
 await a.conversation();await a.page.evaluate("__integration.observeQuiet('hidden-home','#screenContent');__integration.observeQuiet('messages','#canvas')")
 await a.delay(5400);d=await a.page.evaluate("({hidden:__integration.quiet('hidden-home'),messages:__integration.quiet('messages')})")
 check('1C-HIDDEN-LIST-QUIET',d['hidden']['records']==0 and d['messages']['records']==0,d)
