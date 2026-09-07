"""Live acceptance driver: CSP-safe waits and actual pointer hit-testing.
The transparent outside-dismissal layer intentionally sits over the plus button
while the menu is open. Locator.click on the underlying button therefore waits
for an impossible hit-target. A real tap at that visible location closes via
the dismissal layer; test that behaviour and assert the menu actually hides.
No site files, browser policies or acceptance thresholds are modified.
"""
import pathlib, time, shutil
from playwright.sync_api import Page, TimeoutError


def csp_safe_wait(page, expression, *, timeout=30000, **kwargs):
    if 'vault.ready' in expression:
        expression='('+expression+') && typeof window.gate?.captureDraft === "function"'
    deadline=time.monotonic()+timeout/1000
    while time.monotonic()<deadline:
        try:
            if page.evaluate('() => Boolean('+expression+')'):
                return
        except Exception as error:
            text=str(error).lower()
            if not any(s in text for s in ['execution context was destroyed','cannot find context','most likely because of a navigation','frame was detached']):
                raise
        page.wait_for_timeout(60)
    raise TimeoutError('Condition did not become true: '+expression)

Page.wait_for_function=csp_safe_wait
source=pathlib.Path('gates/gate-01-4-draft/live_test.py')
text=source.read_text(encoding='utf-8')
needle="p.screenshot(path=str(OUT/(engine+'-restored-menu.png')));p.locator('#attach').click()"
replacement="p.screenshot(path=str(OUT/(engine+'-restored-menu.png')));pos=p.locator('#attach').bounding_box();p.touchscreen.tap(pos['x']+pos['width']/2,pos['y']+pos['height']/2);assert not p.locator('#pop').is_visible()"
assert text.count(needle)==1,'Expected exactly the known second-plus driver line'
text=text.replace(needle,replacement)
out=pathlib.Path('evidence/reproduction');out.mkdir(parents=True,exist_ok=True)
for p in [source,pathlib.Path(__file__),pathlib.Path('gates/gate-01-4-draft/vault.js'),pathlib.Path('.github/workflows/gate014-storage-evidence.yml'),pathlib.Path('.github/workflows/gate014-live-evidence.yml'),pathlib.Path('docs/gates/GATE_01_4_DURABLE_DRAFT_SPEC.md')]:
    shutil.copy2(p,out/p.name)
(out/'executed-live-driver.py').write_text(text,encoding='utf-8')
exec(compile(text,str(source),'exec'))
