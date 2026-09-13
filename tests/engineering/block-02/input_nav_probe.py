"""Regression probe: real Pablicus UI, synthetic backend, no external forwarding."""
import argparse, asyncio, hashlib, http.server, json, mimetypes, os, sys, threading
from pathlib import Path
from urllib.parse import urlsplit
from playwright.async_api import async_playwright

ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT/'tests/engineering/block-01/integration_1c'))
from network import Boundary,A,C1

KEYBOARD="""{const native=visualViewport;window.__keyboard={height:null,top:0};Object.defineProperty(window,'visualViewport',{configurable:true,value:new Proxy(native,{get(t,k){if(k==='height'&&__keyboard.height!==null)return __keyboard.height;if((k==='offsetTop'||k==='pageTop')&&__keyboard.height!==null)return __keyboard.top;const v=Reflect.get(t,k,t);return typeof v==='function'?v.bind(t):v;}})});} """
GEOMETRY="""()=>{const box=id=>{const n=document.getElementById(id),r=n.getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:r.height,scroll:n.scrollHeight,client:n.clientHeight,overflow:getComputedStyle(n).overflowY}};return {app:box('app'),input:box('input'),editor:box('editor'),composer:box('composer'),header:document.querySelector('#app>header').getBoundingClientRect().top,list:box('vp'),scrollY,top:visualViewport.offsetTop,height:visualViewport.height}}"""

class Server(http.server.BaseHTTPRequestHandler):
    def log_message(self,*args): pass
    def do_GET(self):
        path=urlsplit(self.path).path
        if path=='/pablicus/':path+='index.html'
        data=self.files.get(path)
        if data is None:self.send_error(404);return
        self.send_response(200);self.send_header('Content-Type',mimetypes.guess_type(path)[0] or 'application/octet-stream');self.send_header('Cache-Control','no-store');self.end_headers();self.wfile.write(data)

async def probe(browser,origin,out,candidate):
    n=Boundary(origin);ctx=await browser.new_context(viewport={'width':390,'height':844},has_touch=True,service_workers='block')
    await ctx.add_init_script(KEYBOARD);await ctx.route('**/*',n.handle);await ctx.route_web_socket('**/*',n.websocket)
    p=await ctx.new_page();await n.attach_page(p);p.set_default_timeout(12000)
    r={'browser':browser.version,'checks':[],'errors':[],'scope':'Desktop engine, synthetic visual viewport keyboard. Physical iPhone remains owner verification.'}
    p.on('pageerror',lambda e:r['errors'].append(str(e)))
    def check(name,ok,actual=None):
        r['checks'].append({'name':name,'pass':bool(ok),'actual':actual});(out/'result.json').write_text(json.dumps(r,ensure_ascii=False,indent=2)+'\n')
    async def settle():await p.evaluate('()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
    async def open_chat():
        await p.locator('[data-conversation-id="'+C1+'"] .chatMain').click()
        await p.wait_for_function('!!PablicusChat.list && !!window.vault?.ready && !document.querySelector("#app").inert')
    async def geometry(name):
        await settle();v=await p.evaluate(GEOMETRY)
        check(name+'-input-contained',v['input']['bottom']<=v['editor']['bottom']+1 and v['input']['top']>=v['editor']['top']-1,v)
        check(name+'-shell-visible',abs(v['app']['top']-v['top'])<1 and v['header']>=v['top'] and v['composer']['bottom']<=v['top']+v['height']+1,v)
        check(name+'-compact',v['input']['height']<=144 and v['editor']['height']<=144,v)
        return v
    try:
        await p.goto(origin+'/pablicus/',wait_until='domcontentloaded',timeout=45000);await p.locator('#email').fill('a@fixture.invalid');await p.locator('#password').fill('fixture-only-password');await p.locator('#loginSubmit').click()
        await p.wait_for_function('PablicusDebug.user==="'+A+'" && document.querySelectorAll(".chatCard").length>0')
        await p.locator('#toast').wait_for(state='hidden',timeout=8000)
        if candidate:
            buttons=await p.locator('#mainNav>button').evaluate_all('ns=>ns.map(n=>({id:n.dataset.page,disabled:n.disabled,svg:!!n.querySelector("svg")}))')
            check('five-tabs-bots-agent', [b['id'] for b in buttons]==['chats','tasks','bots','agent','profile'] and buttons[3]['disabled'] and all(b['svg'] for b in buttons),buttons)
            check('bots-removed-from-header',await p.locator('.homeHeader #openBots').count()==0)
            for width in [320,390,768,1280]:
                await p.set_viewport_size({'width':width,'height':844});await settle()
                ok=await p.locator('#mainNav>button').evaluate_all('ns=>ns.every(n=>{const r=n.getBoundingClientRect();return r.x>=0&&r.right<=innerWidth&&r.width>=44&&r.height>=44})')
                check('nav-targets-'+str(width),ok)
            await p.set_viewport_size({'width':390,'height':844})
            await p.locator('#mainNav [data-page=bots]').click();await p.locator('.botCard').first.wait_for()
            check('bots-route',await p.evaluate('PablicusController.state().screen')=='bots')
            check('bots-selected',await p.locator('#mainNav [aria-current=page]').get_attribute('data-page')=='bots')
            await p.screenshot(path=str(out/'navigation.png'))
            for section in ['tasks','profile','chats']:
                await p.locator('#mainNav [data-page='+section+']').click();await p.wait_for_function('(s)=>PablicusController.state().section===s&&PablicusController.state().screen==="home"',arg=section)
                check('existing-root-'+section,True)
        await open_chat();await p.locator('#input').fill('Проверка ввода')
        await geometry('initial')
        await p.evaluate('__keyboard.height=430;visualViewport.dispatchEvent(new Event("resize"))');await settle()
        for i in range(30):await p.locator('#input').press('Enter')
        text=await p.locator('#input').input_value();check('enter-keeps-text',text=='Проверка ввода'+'\n'*30)
        await geometry('thirty-enters');await p.screenshot(path=str(out/'thirty-enters.png'))
        if candidate:
            for top in [90,180,12,0]:
                await p.evaluate('(top)=>{__keyboard.top=top;visualViewport.dispatchEvent(new Event("scroll"))}',top);await geometry('viewport-pan-'+str(top))
            await p.locator('#input').fill('Коротко');await geometry('shortened')
            await p.locator('#input').fill('Строка\n'*40);await geometry('long-paste')
            await p.locator('#expand').click();await settle();check('explicit-fullscreen',await p.locator('#app').evaluate('n=>n.classList.contains("composer-fullscreen")'))
            await p.locator('#expand').click();await geometry('fullscreen-return')
            await p.evaluate('__keyboard.height=null;__keyboard.top=0;visualViewport.dispatchEvent(new Event("resize"))');await geometry('keyboard-closed')
            await p.locator('#input').fill('Сохранить черновик');await p.evaluate('PablicusChat.flush()')
            await p.locator('#canvasTab').click();await p.locator('#conversationTab').click();check('canvas-return-preserves-draft',await p.locator('#input').input_value()=='Сохранить черновик')
            await p.reload();await p.wait_for_function('document.querySelectorAll(".chatCard").length>0');await open_chat()
            check('reload-preserves-draft',await p.locator('#input').input_value()=='Сохранить черновик')
            await p.locator('#input').fill('Новое сообщение');before_send=len(n.messages[C1]);await p.locator('#send').click()
            async def sent():
                while len(n.messages[C1])==before_send:await asyncio.sleep(.05)
            await asyncio.wait_for(sent(),10)
            await p.wait_for_function('document.querySelector("#input").value===""')
            check('send-once',len(n.messages[C1])==before_send+1,{'before':before_send,'after':len(n.messages[C1])})
            await p.screenshot(path=str(out/'final.png'))
        check('no-page-errors',not r['errors'],r['errors']);check('isolated-network',not n.unknown and not n.blocked,{'unknown':len(n.unknown),'blocked':len(n.blocked)})
        r['status']='PASS' if all(c['pass'] for c in r['checks']) else 'FAIL'
    except Exception as e:r.update(status='ERROR',error=str(e))
    finally:
        await ctx.close();await n.drain();(out/'result.json').write_text(json.dumps(r,ensure_ascii=False,indent=2)+'\n')
    return r

async def main(args):
    out=args.output.resolve();out.mkdir(parents=True,exist_ok=True)
    Server.files={'/'+str(p.relative_to(ROOT)):p.read_bytes() for p in (ROOT/'pablicus').rglob('*') if p.is_file() and p.suffix in {'.js','.mjs','.css','.html','.json','.webmanifest','.svg','.png'}}
    server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Server);threading.Thread(target=server.serve_forever,daemon=True).start();results={}
    try:
        async with async_playwright() as pw:
            for name in args.engines.split(','):
                engine=getattr(pw,name);kwargs={'headless':True}
                if name=='chromium':kwargs.update(executable_path=os.environ['PABLICUS_TEST_CHROME'],chromium_sandbox=True,args=['--disable-background-networking'])
                b=await engine.launch(**kwargs)
                try:
                    target=out/name;target.mkdir(exist_ok=True);r=await probe(b,'http://127.0.0.1:'+str(server.server_port),target,args.candidate);results[name]={'status':r['status'],'checks':len(r['checks']),'failed':[c['name'] for c in r['checks'] if not c['pass']],'error':r.get('error')}
                finally:await b.close()
                print(json.dumps({name:results[name]},ensure_ascii=False),flush=True)
    finally:server.shutdown();server.server_close()
    (out/'summary.json').write_text(json.dumps(results,ensure_ascii=False,indent=2)+'\n')

if __name__=='__main__':
    a=argparse.ArgumentParser();a.add_argument('--output',type=Path,required=True);a.add_argument('--engines',default='chromium,webkit');a.add_argument('--candidate',action='store_true');asyncio.run(main(a.parse_args()))
