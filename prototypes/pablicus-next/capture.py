import asyncio,sys
from pathlib import Path
from playwright.async_api import async_playwright
OUT=Path(__file__).resolve().parents[2]/'docs/pablicus/design/2026-09-13-new-foundation/verification'
async def run():
 async with async_playwright() as pw:
  b=await pw.chromium.connect_over_cdp(sys.argv[1]);ctx=await b.new_context(viewport={'width':390,'height':844},service_workers='block');p=await ctx.new_page()
  try:
   for width,height in [(390,844),(1280,900)]:
    await p.set_viewport_size({'width':width,'height':height});await p.goto('http://127.0.0.1:8129/prototypes/pablicus-next/#chats/launch/talk');await p.bring_to_front();await p.get_by_role('button',name='Сменить представление',exact=True).click();await p.locator('.pb-edge-options').wait_for(state='visible');await p.screenshot(path=str(OUT/f'conversation-{width}.png'),animations='disabled');await p.keyboard.press('Escape')
   await p.set_viewport_size({'width':390,'height':844});await p.goto('http://127.0.0.1:8129/prototypes/pablicus-next/#chats');await p.screenshot(path=str(OUT/'chats-390.png'),animations='disabled')
   print('3 stable screenshots saved')
  finally: await ctx.close()
asyncio.run(run())
