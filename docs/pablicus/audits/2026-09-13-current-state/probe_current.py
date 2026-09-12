"""Current UI audit: unmodified application, synthetic HTTP/Phoenix boundary.

Connects to the audit's existing isolated Chrome. Creates and closes new contexts;
does not use any existing logged-in page or forward synthetic requests externally.
The temporary CSS A/B is diagnostic only and is removed immediately.
"""
from pathlib import Path
import asyncio, base64, functools, http.server, json, sys, threading, traceback
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(ROOT/'tests/engineering/block-01/integration_1c'))
from network import Boundary, A, C1
OUT = Path('/tmp/pablicus-audit-20260913/browser')
SOURCE = Path('/tmp/pablicus-audit-20260913/published')
CDP = 'http://127.0.0.1:51467'
PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aHxoAAAAASUVORK5CYII=')

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args): pass

def write(record):
    OUT.mkdir(parents=True,exist_ok=True)
    (OUT/'result.json').write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n')

GEOMETRY = '''()=>[...document.querySelectorAll('.chatCard')].map(row=>{
 const get=n=>{const r=n.getBoundingClientRect();const s=getComputedStyle(n);return {left:r.left,right:r.right,width:r.width,display:s.display,shrink:s.flexShrink,hit:n.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}};
 return {row:get(row),main:get(row.querySelector('.chatMain')),focus:get(row.querySelector('.focusBtn')),viewport:innerWidth};})'''

async def run():
    OUT.mkdir(parents=True,exist_ok=True)
    server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Quiet,directory=str(SOURCE)))
    thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    origin='http://127.0.0.1:'+str(server.server_port)
    r={'status':'RUNNING','boundary':'Published static bytes; synthetic HTTP/Phoenix only; SW blocked; no external forwarding','observations':[],'errors':[]}
    ctx=None;n=None
    def record(id,actual):
        r['observations'].append({'id':id,'actual':actual});write(r)
    try:
        async with async_playwright() as pw:
            browser=await pw.chromium.connect_over_cdp(CDP)
            r['browser']=browser.version
            n=Boundary(origin)
            ctx=await browser.new_context(viewport={'width':390,'height':844},service_workers='block')
            await ctx.route('**/*',n.handle);await ctx.route_web_socket('**/*',n.websocket)
            p=await ctx.new_page();await n.attach_page(p)
            p.set_default_timeout(12000);p.on('pageerror',lambda e:r['errors'].append(str(e)))
            response=await p.goto(origin+'/pablicus/',wait_until='load',timeout=30000)
            record('ENTRY',{'http':response.status})
            await p.locator('#email').fill('a@fixture.invalid')
            await p.locator('#password').fill('fixture-only-password')
            await p.locator('#loginSubmit').click()
            await p.wait_for_function('PablicusDebug.user==="'+A+'" && document.querySelectorAll(".chatCard").length===2')
            record('HOME',await p.locator('#home').inner_text())
            record('HIDDEN_ENTRIES',await p.evaluate('''()=>['.savedConversation','.findPeople'].map(sel=>{const n=document.querySelector(sel);return {selector:sel,exists:!!n,display:n&&getComputedStyle(n).display,rects:n?.getClientRects().length}})'''))
            for w,h in [(320,568),(390,844),(768,1024),(1280,900)]:
                await p.set_viewport_size({'width':w,'height':h})
                await p.evaluate('()=>new Promise(requestAnimationFrame)')
                before=await p.evaluate(GEOMETRY)
                await p.screenshot(path=str(OUT/f'chats-{w}.png'))
                temporary=await p.add_style_tag(content='.chatMain[data-ui-control="button"]{flex-shrink:1}')
                await p.evaluate('()=>new Promise(requestAnimationFrame)')
                after=await p.evaluate(GEOMETRY)
                await temporary.evaluate('n=>n.remove()')
                record('FOCUS_AB_'+str(w),{'before':before,'temporary_css_after':after,'source_changed':False})
            await p.set_viewport_size({'width':390,'height':844})
            await p.locator('#searchChats').fill('Fixture conversation')
            record('SEARCH_PREVIEW',{'query':'Fixture conversation','fixture_matching_previews':2,'visible_rows':await p.locator('.chatCard').count()})
            await p.locator('#searchChats').fill('A conversation 1')
            record('SEARCH_TITLE',{'visible_rows':await p.locator('.chatCard').count()})
            await p.locator('#searchChats').fill('')
            await p.locator('#mainNav [data-page=profile]').click()
            record('PROFILE',{'text':await p.locator('#screenContent').inner_text(),'file_inputs':await p.locator('#screenContent input[type=file]').count()})
            await p.screenshot(path=str(OUT/'profile.png'),full_page=True)
            await p.locator('#mainNav [data-page=tasks]').click()
            record('TASKS',await p.locator('#screenContent').inner_text())
            await p.locator('#openBots').click();await p.locator('.botCard').first.wait_for()
            record('BOTS',await p.locator('#screenContent').inner_text())
            await p.get_by_role('button',name='Создать бота',exact=True).click()
            await p.get_by_role('button',name='Новый проект',exact=True).wait_for()
            record('FACTORY_HOME',await p.locator('#screenContent').inner_text())
            await p.get_by_role('button',name='Новый проект',exact=True).click()
            record('FACTORY_FORM',await p.locator('#screenContent').inner_text())
            await p.locator('#mainNav [data-page=chats]').click()
            await p.locator('[data-conversation-id="'+C1+'"] .chatMain').click()
            await p.wait_for_function('PablicusDebug.current==="'+C1+'" && !!PablicusChat.list && !document.getElementById("app").inert')
            record('CONVERSATION',{'title':await p.locator('#chatTitle').inner_text(),'registry':await p.evaluate('()=>({ia:PablicusUI.informationArchitecture,composer:PablicusUI.composer,calls:PablicusUI.calls})')})
            await p.locator('#input').fill('Audit preserved draft')
            await p.locator('#documentInput').set_input_files({'name':'IMG_AUDIT.png','mimeType':'image/png','buffer':PNG})
            await p.wait_for_function('PablicusChat.rich.capture().files.length===1')
            record('COMPOSER_MEDIA',await p.locator('#composer .richMediaHead').inner_text())
            await p.screenshot(path=str(OUT/'composer-media.png'))
            await p.locator('#expand').click()
            await p.locator('#input').focus();await p.keyboard.press('Escape')
            record('COMPOSER_COLLAPSE',await p.evaluate('()=>({expanded:document.getElementById("expand").getAttribute("aria-expanded"),text:PablicusChat.rich.capture().text,files:PablicusChat.rich.capture().files.length})'))
            await p.locator('#canvasTab').click();await p.locator('.pccProjectCard').click()
            await p.locator('.pccPlanEdit').click()
            await p.locator('.pccPlanEditor input[type=file]').set_input_files({'name':'IMG_CANVAS_AUDIT.png','mimeType':'image/png','buffer':PNG})
            await p.locator('.pccPlanEditor .richMediaHead').wait_for(state='attached')
            inspect='''()=>{const scope=document.querySelector('.pccPlanEditor'),head=scope.querySelector('.richMediaHead'),button=head.querySelector('button');return {head_text:head.innerText,head_display:getComputedStyle(head).display,remove_exists:!!button,remove_rects:button.getClientRects().length,buttons:[...scope.querySelectorAll('button')].filter(b=>b.getClientRects().length).map(b=>b.getAttribute('aria-label')||b.innerText)}}'''
            record('CANVAS_MEDIA_INLINE',await p.evaluate(inspect))
            await p.screenshot(path=str(OUT/'canvas-inline.png'))
            await p.locator('.pccPlanEditor .workspaceEditorExpand').click()
            record('CANVAS_MEDIA_EXPANDED',await p.evaluate(inspect))
            await p.screenshot(path=str(OUT/'canvas-expanded.png'))
            await p.locator('.pccPlanEditor textarea').first.focus();await p.keyboard.press('Escape')
            await p.locator('.pccPlanCancel').click()
            record('CANVAS_CANCEL',{'editor_count':await p.locator('.pccPlanEditor').count()})
            r['status']='OBSERVED' if not r['errors'] and not n.unknown and not n.blocked else 'HARNESS_ERROR'
            await ctx.close();ctx=None;await n.drain()
    except Exception as e:
        r.update(status='ERROR',error=str(e),traceback=traceback.format_exc())
    finally:
        if ctx:
            try:await ctx.close()
            except Exception:pass
        if n:r['network']=n.summary()
        server.shutdown();server.server_close();thread.join(3)
        r['server_closed']=not thread.is_alive();r['owned_context_closed']=True
        write(r);print(json.dumps({'status':r['status'],'observations':len(r['observations']),'error':r.get('error')}))

if __name__=='__main__':asyncio.run(run())
