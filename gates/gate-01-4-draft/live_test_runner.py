"""Run live acceptance predicates without Playwright's eval-based wait.
Site CSP remains unchanged. Polling also waits for the diagnostic capture API,
which is exported after asynchronous restore-checkpoint verification. vault.ready
alone marks data restored, not completion of that diagnostic API installation.
"""
import pathlib, time
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
exec(compile(source.read_text(encoding='utf-8'),str(source),'exec'))
