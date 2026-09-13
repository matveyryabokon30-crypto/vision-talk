"""Installed-shell update from the published revision; synthetic account only."""
import argparse,asyncio,io,json,os,subprocess,tarfile,threading,http.server
from pathlib import Path
from playwright.async_api import async_playwright
from input_nav_probe import ROOT,Server,Boundary,A,C1

async def main(output):
    output.parent.mkdir(parents=True,exist_ok=True);r={'status':'RUNNING','checks':[]}
    new={'/'+str(p.relative_to(ROOT)):p.read_bytes() for p in (ROOT/'pablicus').rglob('*') if p.is_file() and p.suffix in {'.js','.mjs','.css','.html','.json','.webmanifest','.svg','.png'}}
    old={}
    with tarfile.open(fileobj=io.BytesIO(subprocess.check_output(['git','archive','0e953322eac69e6f3e79458ac32323b564acaf55','pablicus'],cwd=ROOT))) as archive:
        for m in archive.getmembers():
            if m.isfile() and '/'+m.name in new:old['/'+m.name]=archive.extractfile(m).read()
    Server.files=old;server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Server);threading.Thread(target=server.serve_forever,daemon=True).start();origin='http://127.0.0.1:'+str(server.server_port)
    def check(name,ok,actual=None):
        r['checks'].append({'name':name,'pass':bool(ok),'actual':actual});output.write_text(json.dumps(r,ensure_ascii=False,indent=2)+'\n');assert ok,name
    try:
        async with async_playwright() as pw:
            b=await pw.chromium.launch(executable_path=os.environ['PABLICUS_TEST_CHROME'],headless=True,chromium_sandbox=True,args=['--disable-background-networking'])
            try:
                ctx=await b.new_context(viewport={'width':390,'height':844},service_workers='allow');n=Boundary(origin);await ctx.route('**/*',n.handle);await ctx.route_web_socket('**/*',n.websocket);p=await ctx.new_page();await n.attach_page(p);p.set_default_timeout(30000)
                await p.goto(origin+'/pablicus/',wait_until='domcontentloaded',timeout=45000);await asyncio.wait_for(p.evaluate('navigator.serviceWorker.ready.then(()=>true)'),45);await p.reload(wait_until='domcontentloaded');await p.wait_for_function('!!navigator.serviceWorker.controller')
                check('old-cache-active','pablicus-shell-block02-2b-candidate' in await p.evaluate('caches.keys()'))
                await p.locator('#email').fill('a@fixture.invalid');await p.locator('#password').fill('fixture-only-password');await p.locator('#loginSubmit').click();await p.wait_for_function('PablicusDebug.user==="'+A+'" && document.querySelectorAll(".chatCard").length>0')
                await p.locator('[data-conversation-id="'+C1+'"] .chatMain').click();await p.wait_for_function('!!PablicusChat.list && !!window.vault?.ready && !document.querySelector("#app").inert')
                await p.locator('#input').fill('Черновик перед обновлением');await p.evaluate('PablicusChat.flush()');Server.files=new
                await p.evaluate('async()=>{const r=await navigator.serviceWorker.getRegistration();await r.update()}');await p.locator('#updateNotice').wait_for(state='visible');check('update-offered',True)
                async with p.expect_navigation(wait_until='domcontentloaded'):await p.locator('#applyUpdate').click()
                await p.wait_for_function('!!window.PablicusController && document.querySelectorAll(".chatCard").length>0')
                caches=await p.evaluate('caches.keys()');check('new-generation-active','pablicus-shell-input-nav-20260913-r1' in caches and 'pablicus-shell-block02-2b-candidate' not in caches,caches)
                check('new-navigation',await p.locator('#mainNav>button').count()==5 and await p.locator('#mainNav [data-page=agent]').is_disabled())
                await p.locator('[data-conversation-id="'+C1+'"] .chatMain').click();await p.wait_for_function('!!PablicusChat.list && !!window.vault?.ready && !document.querySelector("#app").inert');await p.wait_for_function('document.querySelector("#input").value==="Черновик перед обновлением"');check('draft-survived-update',True)
                check('network-isolated',not n.unknown and not n.blocked,{'unknown':len(n.unknown),'blocked':len(n.blocked)})
                r.update(status='PASS',browser=b.version);await ctx.close();await n.drain()
            finally:await b.close()
    except Exception as e:r.update(status='ERROR',error=str(e))
    finally:server.shutdown();server.server_close();output.write_text(json.dumps(r,ensure_ascii=False,indent=2)+'\n');print(json.dumps(r,ensure_ascii=False),flush=True)

if __name__=='__main__':
    a=argparse.ArgumentParser();a.add_argument('--output',type=Path,required=True);args=a.parse_args();asyncio.run(main(args.output))
