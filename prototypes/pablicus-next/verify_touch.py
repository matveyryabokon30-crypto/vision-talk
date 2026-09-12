"""Additional real CDP touch/cancel coverage, separate from mouse/keyboard suite."""
import asyncio,json,sys
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'docs/pablicus/design/2026-09-13-new-foundation/verification/TOUCH.json'
async def run():
    checks=[]
    def check(id,ok):
        checks.append({'id':id,'pass':bool(ok)});assert ok,id
    async with async_playwright() as pw:
        browser=await pw.chromium.connect_over_cdp(sys.argv[1])
        context=await browser.new_context(viewport={'width':390,'height':844},has_touch=True,service_workers='block')
        try:
            page=await context.new_page();await page.goto('http://127.0.0.1:8129/prototypes/pablicus-next/#chats/launch/talk')
            trigger=page.get_by_role('button',name='Сменить представление',exact=True)
            await trigger.tap();check('touch-opens',await trigger.get_attribute('aria-expanded')=='true')
            await page.locator('[data-view="materials"]').tap();check('touch-selects',page.url.endswith('/materials'))
            client=await context.new_cdp_session(page);before=await trigger.bounding_box();url=page.url
            def point(y):return {'x':before['x']+23,'y':y,'id':1,'radiusX':2,'radiusY':2,'force':1}
            await client.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[point(before['y']+30)]})
            await client.send('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':[point(before['y']+90)]})
            moved=await trigger.bounding_box();check('touch-drag-moves',abs(moved['y']-before['y'])>10)
            await client.send('Input.dispatchTouchEvent',{'type':'touchCancel','touchPoints':[]})
            after=await trigger.bounding_box();check('touch-cancel-restores',abs(after['y']-before['y'])<1)
            check('touch-cancel-no-selection',page.url==url and await trigger.get_attribute('aria-expanded')=='false')
            await trigger.tap();check('tap-after-cancel-works',await trigger.get_attribute('aria-expanded')=='true')
            await page.locator('[data-view="talk"]').tap();check('input-returned',await page.locator('#message').is_visible())
            # Pure geometry exports exercise clamping/edge mapping independent of rendering.
            result=await page.evaluate("""async()=>{const g=await import('/library/pablicus-ui/notch-geometry.js');let throws=false;try{g.notchPath(NaN,20)}catch{throws=true}return{throws,right:g.edgePoint('right',100,200,40,10),left:g.edgePoint('left',100,200,40,10),small:g.clampPosition(100,40,90),path:g.notchPath(10,40)}}""")
            check('geometry-input-and-axes',result['throws'] and result['right']=={'x':90,'y':40} and result['left']=={'x':10,'y':40})
            check('geometry-small-viewport-safe',result['small']==12 and 'NaN' not in result['path'])
            status='PASS'
        except Exception as e:
            status='FAIL';checks.append({'error':str(e)})
        finally:
            await context.close()
            OUT.write_text(json.dumps({'status':status,'scope':'CDP-emitted touch events in Chrome, not physical iPhone','checks':checks},indent=2)+'\n')
            print(status,len(checks))
            if status!='PASS':raise SystemExit(1)
asyncio.run(run())
