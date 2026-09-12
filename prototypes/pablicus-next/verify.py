"""Behavioral checks in a fresh context of our own test Chrome. No backend."""
import argparse, asyncio, hashlib, json
from pathlib import Path
from playwright.async_api import async_playwright

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'docs/pablicus/design/2026-09-13-new-foundation/verification'
URL='http://127.0.0.1:8129/prototypes/pablicus-next/'
BOX="e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,right:r.right,bottom:r.bottom}}"

async def run(cdp):
    OUT.mkdir(parents=True,exist_ok=True)
    report={'status':'RUNNING','scope':'Chrome desktop/mobile viewport simulation; isolated local fixture; not physical iPhone qualification','checks':[],'errors':[],'external_requests':[]}
    def check(id,ok,detail=None):
        report['checks'].append({'id':id,'pass':bool(ok),'detail':detail})
        assert ok, f'{id}: {detail}'
    async with async_playwright() as pw:
        browser=await pw.chromium.connect_over_cdp(cdp)
        report['browser']=browser.version
        ctx=await browser.new_context(viewport={'width':390,'height':844},has_touch=True,service_workers='block')
        page=await ctx.new_page();page.set_default_timeout(10000)
        page.on('pageerror',lambda e:report['errors'].append(str(e)))
        page.on('request',lambda r:report['external_requests'].append(r.url) if not r.url.startswith('http://127.0.0.1:8129/') else None)
        try:
            await page.goto(URL)
            for width,height in [(320,640),(390,844),(700,800),(768,1024),(1280,900),(844,390)]:
                await page.set_viewport_size({'width':width,'height':height})
                await page.goto(URL+'#chats/launch/talk')
                await page.locator('#message').wait_for()
                await page.wait_for_function('() => Math.abs(document.querySelector("#app").getBoundingClientRect().height-visualViewport.height)<1')
                before=await page.locator('#workspace').evaluate(BOX)
                nav=await page.locator('#primary-nav a').evaluate_all('els=>els.map(e=>{const r=e.getBoundingClientRect();return {name:e.textContent.trim(),x:r.x,y:r.y,right:r.right,bottom:r.bottom,hit:e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}})')
                check(f'nav-{width}x{height}',len(nav)==4 and all(n['hit'] and n['x']>=0 and n['right']<=width+.5 and n['bottom']<=height+.5 for n in nav),nav)
                if width<=700: check(f'bottom-nav-{width}',all(n['y']>height-100 for n in nav))
                await page.locator('#message').fill('Первая строка')
                box=await page.locator('#message').evaluate(BOX)
                for _ in range(18): await page.locator('#message').press('Enter')
                after=await page.locator('#message').evaluate(BOX)
                check(f'enter-stable-{width}',box==after and after['h']==72,{'before':box,'after':after})
                draft=await page.locator('#message').input_value()
                for view in ['materials','tasks','talk']:
                    await page.get_by_role('button',name='Сменить представление',exact=True).click()
                    await page.locator(f'[data-view="{view}"]').click()
                    check(f'workspace-fixed-{width}-{view}',before==await page.locator('#workspace').evaluate(BOX))
                check(f'draft-retained-{width}',draft==await page.locator('#message').input_value())
                check(f'no-horizontal-scroll-{width}',await page.evaluate('document.documentElement.scrollWidth===innerWidth && scrollY===0'))
                if width in [390,1280]:
                    await page.get_by_role('button',name='Сменить представление',exact=True).click()
                    await page.screenshot(animations='disabled',path=str(OUT/f'conversation-{width}.png'))
                    await page.keyboard.press('Escape')
            # Return from a reduced visible viewport without accumulated offsets.
            await page.set_viewport_size({'width':390,'height':844}); await page.goto(URL+'#chats/launch/talk')
            await page.locator('#message').fill('Черновик после клавиатуры')
            await page.set_viewport_size({'width':390,'height':430})
            await page.wait_for_function('() => document.querySelector("#app").getBoundingClientRect().height===430')
            small=await page.locator('#message').evaluate(BOX)
            check('reduced-viewport-input-visible',small['bottom']<430 and small['h']==72,small)
            await page.set_viewport_size({'width':390,'height':844})
            await page.wait_for_function('() => document.querySelector("#app").getBoundingClientRect().height===844')
            full=await page.locator('#message').evaluate(BOX)
            check('viewport-restored',full['bottom']<844 and full['y']>small['y'] and full['h']==72,full)
            # Pointer capture drag moves only the control; it does not choose a view.
            trigger=page.get_by_role('button',name='Сменить представление',exact=True)
            await trigger.click(); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter')
            check('keyboard-view-selection',page.url.endswith('/materials'))
            await trigger.click(); await page.keyboard.press('Escape')
            check('escape-focus-return',await trigger.evaluate('e=>e===document.activeElement && e.getAttribute("aria-expanded")==="false"'))
            before=await page.locator('#workspace').evaluate(BOX); b=await trigger.bounding_box(); oldurl=page.url
            await page.mouse.move(b['x']+23,b['y']+46);await page.mouse.down();await page.mouse.move(b['x']+23,800,steps=12);await page.mouse.up()
            check('drag-no-selection-or-shift',oldurl==page.url and before==await page.locator('#workspace').evaluate(BOX))
            await trigger.click(); bounds=await page.locator('.pb-edge-options').evaluate(BOX)
            check('edge-menu-clamped',bounds['bottom']<=before['bottom'] and bounds['y']>=before['y'],bounds)
            await page.keyboard.press('Escape')
            # Browser back returns to the previous representation.
            await page.go_back(); await page.locator('#message').wait_for()
            check('history-and-draft',await page.locator('#message').input_value()=='Черновик после клавиатуры')
            await page.locator('#send').click()
            check('message-once',await page.locator('.message').filter(has_text='Черновик после клавиатуры').count()==1)
            await page.reload(); check('message-persisted',await page.locator('.message').filter(has_text='Черновик после клавиатуры').count()==1)
            await page.locator('#message').fill('Сохранить при уходе')
            await page.get_by_role('link',name='Дела',exact=True).click()
            await page.locator('#task-title').fill('Проверить новую основу')
            await page.get_by_role('button',name='Добавить дело',exact=True).click()
            await page.get_by_label('Проверить новую основу',exact=True).check()
            await page.reload()
            check('task-persisted',await page.get_by_label('Проверить новую основу',exact=True).is_checked())
            await page.screenshot(animations='disabled',path=str(OUT/'tasks-390.png'))
            await page.get_by_role('link',name='Боты',exact=True).click()
            await page.get_by_role('button',name='О помощнике').first.click()
            check('bot-info-dialog',await page.locator('#details').is_visible())
            await page.keyboard.press('Escape');check('dialog-dismissed',not await page.locator('#details').is_visible())
            await page.get_by_role('link',name='Вы',exact=True).click()
            await page.locator('#theme').select_option('dark');await page.locator('#edge').select_option('left')
            await page.reload();check('settings-persisted',await page.locator('#theme').input_value()=='dark' and await page.locator('#edge').input_value()=='left')
            await page.get_by_role('link',name='Чаты',exact=True).click()
            await page.screenshot(animations='disabled',path=str(OUT/'chats-dark-390.png'))
            await page.locator('#search').fill('Черновик после клавиатуры')
            check('search-message-content',await page.locator('.chat-row').count()==1)
            await page.locator('.chat-row').click()
            check('draft-across-tabs',await page.locator('#message').input_value()=='Сохранить при уходе')
            await trigger.click();check('left-edge',await page.locator('.pb-edge').get_attribute('data-edge')=='left')
            await page.keyboard.press('Escape')
            await page.emulate_media(reduced_motion='reduce')
            await trigger.click();check('reduced-motion',await page.locator('.pb-edge-options').evaluate('e=>getComputedStyle(e).animationName')=='none')
            await page.keyboard.press('Escape')
            # Falsify the two central invariants with temporary faults, then remove them.
            b=await page.locator('#workspace').evaluate(BOX)
            fault=await page.add_style_tag(content='#workspace {transform:translateX(24px)!important}')
            check('negative-control-shift-detected',b!=await page.locator('#workspace').evaluate(BOX));await fault.evaluate('e=>e.remove()')
            b=await page.locator('#message').evaluate(BOX)
            fault=await page.add_style_tag(content='#message {height:300px!important;min-height:300px!important;max-height:300px!important}')
            check('negative-control-grow-detected',b!=await page.locator('#message').evaluate(BOX));await fault.evaluate('e=>e.remove()')
            check('restored-after-negative-controls',await page.locator('#message').evaluate('e=>e.getBoundingClientRect().height')==72)
            for path in ['/.git/config','/PABLICUS_CONTEXT.md','/pablicus/index.html','/prototypes/pablicus-next/serve.py','/../.git/config']:
                response=await ctx.request.get('http://127.0.0.1:8129'+path)
                check('server-denies-'+path,response.status==404)
            check('no-external-requests',not report['external_requests'])
            check('no-page-errors',not report['errors'])
            report['status']='PASS'
        except Exception as e:
            report['status']='FAIL';report['failure']=str(e)
            await page.screenshot(animations='disabled',path=str(OUT/'failure.png'))
        finally:
            await ctx.close()
            report['source_hashes']={str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for folder in ['prototypes/pablicus-next','library/pablicus-ui'] for p in (ROOT/folder).rglob('*') if p.is_file() and '__pycache__' not in str(p)}
            (OUT/'RESULTS.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
            print(json.dumps({'status':report['status'],'checks':len(report['checks']),'failure':report.get('failure')}))
            if report['status']!='PASS': raise SystemExit(1)

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--cdp',required=True)
    asyncio.run(run(parser.parse_args().cdp))
