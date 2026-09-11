"""Baseline real-entrypoint probe; no 1C acceptance is inferred from this probe."""
from __future__ import annotations
import asyncio,functools,http.server,json,os,threading,traceback
from pathlib import Path
from playwright.async_api import async_playwright
from network import Boundary,A,C1
ROOT=Path(__file__).resolve().parents[4]
OUT=Path(os.environ.get('INTEGRATION_1C_OUTPUT','integration-1c-results/probe'))
class Quiet(http.server.SimpleHTTPRequestHandler):
 def log_message(self,*args):pass
async def main():
 OUT.mkdir(parents=True,exist_ok=True)
 server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Quiet,directory=str(ROOT)))
 thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start();origin='http://127.0.0.1:'+str(server.server_port)
 boundary=Boundary(origin);result={'status':'RUNNING','boundary':'Real index/SDK/storage/DOM; synthetic HTTP/Phoenix only; service workers blocked; zero external forwarding'};page=None
 try:
  async with async_playwright() as p:
   b=await p.chromium.launch(headless=True,args=['--no-sandbox','--disable-dev-shm-usage','--disable-background-networking','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'])
   ctx=await b.new_context(service_workers='block',viewport={'width':430,'height':900})
   await ctx.route('**/*',boundary.handle);await ctx.route_web_socket('**/*',boundary.websocket)
   page=await ctx.new_page();page.set_default_timeout(8000);errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
   try:
    response=await page.goto(origin+'/pablicus/',wait_until='load');result['http_status']=response.status
    await page.locator('#email').fill('a@fixture.invalid');await page.locator('#password').fill('fixture-only-password');await page.locator('#loginSubmit').click()
    await page.wait_for_function('PablicusDebug.user === "'+A+'" && document.querySelector(".chatCard")')
    result['login']=await page.evaluate('({uid:PablicusDebug.user,route:PablicusController.state()})')
    await page.locator('[data-conversation-id="'+C1+'"] .chatMain').click()
    await page.wait_for_function('!!PablicusChat.list')
    result['chat']=await page.evaluate('({route:PablicusController.state(),scope:PablicusChat.scope,store:PablicusChat.store?.name,vault:vault.public(),snapshot:PablicusChat.snapshot})')
    await page.screenshot(path=str(OUT/'chat.png'))
    await page.locator('#canvasTab').click();await page.wait_for_timeout(500)
    result['canvas_text']=await page.locator('#chatCanvasPanel').inner_text();await page.screenshot(path=str(OUT/'canvas.png'))
    result['errors']=errors;result['status']='BASELINE_PROBE_COMPLETED_NOT_1C_ACCEPTANCE'
   except Exception as exc:
    result.update(status='ERROR',error=str(exc),traceback=traceback.format_exc(),errors=errors)
    try:await page.screenshot(path=str(OUT/'failure.png'));(OUT/'failure.html').write_text(await page.content())
    except Exception:pass
   finally:await ctx.close();await b.close()
 finally:
  server.shutdown();server.server_close();thread.join(2);result['network']=boundary.summary();(OUT/'results.json').write_text(json.dumps(result,ensure_ascii=False,indent=2));print(json.dumps(result,ensure_ascii=False))
 return 1 if result['status']=='ERROR' else 0
raise SystemExit(asyncio.run(main()))
