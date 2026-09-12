"""Independent, bounded browser evidence capture, attached before navigation."""
from __future__ import annotations

import asyncio
import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path


def utc_now():
    return datetime.now(timezone.utc).isoformat()


DOM_STATE = """() => {
 const node = id => {
  const n = document.getElementById(id);
  if (!n) return {present:false};
  const style = getComputedStyle(n), rect = n.getBoundingClientRect();
  return {present:true,hidden:n.hidden,inert:n.inert,
   visible:!!n.getClientRects().length && rect.width>0 && rect.height>0 &&
    style.visibility!=='hidden' && style.visibility!=='collapse' && style.display!=='none'};
 };
 return {readyState:document.readyState,url:location.href,origin:location.origin,
  legacyLogin:node('legacyLogin'),email:node('email'),workspace:node('workspace'),
  home:node('home'),app:node('app'),canvas:node('chatCanvasPanel'),
  globals:{PablicusDebug:typeof window.PablicusDebug!=='undefined',
   PablicusController:typeof window.PablicusController!=='undefined',
   PablicusChat:typeof window.PablicusChat!=='undefined',
   __integration:typeof window.__integration!=='undefined',indexedDB:typeof indexedDB!=='undefined'}};
}"""

APPLICATION_STATE = """() => {
 const d=window.PablicusDebug,c=window.PablicusController,chat=window.PablicusChat;
 const visible=id=>{const n=document.getElementById(id);return n?!n.hidden:null};
 return {available:!!d,route:typeof c?.state==='function'?c.state():null,
  uid:d?.user??null,current:d?.current??null,scope:chat?.scope??null,
  list:chat?!!chat.list:null,ready:window.vault?!!window.vault.ready:null,
  vault:typeof window.vault?.public==='function'?window.vault.public():null,
  homeVisible:visible('home'),appVisible:visible('app'),canvasVisible:visible('chatCanvasPanel'),
  selected:[...document.querySelectorAll('#mainNav .selected')].map(n=>n.dataset.page),
  cards:[...document.querySelectorAll('.chatCard')].map(n=>n.dataset.conversationId),
  text:document.getElementById('screenContent')?.innerText??null,
  toast:document.getElementById('toast')?.hidden?null:document.getElementById('toast')?.textContent??null};
}"""

INSTRUMENT_STATE = """() => {
 const i=window.__integration;
 return i?{available:true,resources:typeof i.snapshot==='function'?i.snapshot():null,
  native:i.idbEvents??null,navigations:i.controllerStats?.navigations??null}:{available:false};
}"""


class BrowserCollector:
    def __init__(self, page, boundary, output, timeout_seconds=5):
        self.page = page
        self.boundary = boundary
        self.output = Path(output)
        self.timeout_seconds = timeout_seconds
        self.events = {'page_errors': [], 'console': [], 'request_failures': [],
                       'http_failures': [], 'navigation_responses': []}
        self.collector_errors = []
        self.output.mkdir(parents=True, exist_ok=True)
        # Registration is synchronous and happens before any page.goto call.
        page.on('pageerror', self._page_error)
        page.on('console', self._console)
        page.on('requestfailed', self._request_failed)
        page.on('response', self._response)
        self._persist_events()

    def _persist_events(self):
        try:
            target = self.output / 'browser-events.json'
            temporary = target.with_suffix('.tmp')
            temporary.write_text(json.dumps(self.event_snapshot(), ensure_ascii=False, indent=2), encoding='utf-8')
            temporary.replace(target)
        except Exception as exc:
            self.collector_errors.append({'step': 'persist_events', 'error': str(exc), 'at': utc_now()})

    def _record(self, kind, entry):
        self.events[kind].append({'at': utc_now(), **entry})
        self._persist_events()

    def _page_error(self, error):
        stack = getattr(error, 'stack', None)
        # Playwright supplies the stack; preserve it verbatim and derive the
        # first available source/line/column without replacing missing fields.
        match = re.search(r'(https?://[^\s)]+):(\d+):(\d+)\)?', stack or '')
        location = {'url': match[1], 'line': int(match[2]), 'column': int(match[3])} if match else None
        self._record('page_errors', {'name': getattr(error, 'name', type(error).__name__),
                                    'message': getattr(error, 'message', str(error)),
                                    'stack': stack, 'location': location})

    def _console(self, message):
        self._record('console', {'type': message.type, 'text': message.text, 'location': message.location})

    def _request_failed(self, request):
        self._record('request_failures', {'method': request.method, 'url': request.url,
                                         'resource_type': request.resource_type, 'failure': request.failure})

    def _response(self, response):
        entry = {'method': response.request.method, 'url': response.url,
                 'status': response.status, 'status_text': response.status_text}
        if response.status >= 400:
            self._record('http_failures', entry)
        if response.request.is_navigation_request():
            self._record('navigation_responses', entry)

    def event_snapshot(self):
        return {**self.events, 'first_error': self.events['page_errors'][0] if self.events['page_errors'] else None,
                'collector_errors': self.collector_errors}

    async def capture(self):
        captured = {'capture_steps': {}}

        async def step(name, operation, mandatory=True):
            try:
                captured[name] = await asyncio.wait_for(operation(), self.timeout_seconds)
                captured['capture_steps'][name] = {'status': 'PASS', 'mandatory': mandatory}
            except Exception as exc:
                captured['capture_steps'][name] = {'status': 'ERROR', 'mandatory': mandatory,
                                                    'error': str(exc), 'error_type': type(exc).__name__}

        async def screenshot():
            target = self.output / 'final.png'
            await self.page.screenshot(path=str(target), timeout=int(self.timeout_seconds * 1000))
            return [{'path': target.name, 'sha256': hashlib.sha256(target.read_bytes()).hexdigest()}]

        async def html():
            target = self.output / 'final.html'
            target.write_text(await self.page.content(), encoding='utf-8')
            return {'path': target.name, 'sha256': hashlib.sha256(target.read_bytes()).hexdigest()}

        async def network():
            return self.boundary.summary()

        # Releasing a held native write is also guarded, never a prerequisite
        # for error/DOM/screenshot collection. No application global is created.
        await step('release_write', lambda: self.page.evaluate("() => {const i=window.__integration; if(typeof i?.releaseWrite==='function')i.releaseWrite();}"), mandatory=False)
        await step('dom_global_state', lambda: self.page.evaluate(DOM_STATE))
        await step('final_state', lambda: self.page.evaluate(APPLICATION_STATE))
        await step('instrument', lambda: self.page.evaluate(INSTRUMENT_STATE))
        await step('screenshots', screenshot)
        await step('html_reference', html)
        await step('network', network)
        self._persist_events()
        captured.update(self.event_snapshot())
        captured['browser_events_reference'] = 'browser-events.json'
        captured['mandatory_evidence_complete'] = not self.collector_errors and all(
            item['status'] == 'PASS' for item in captured['capture_steps'].values() if item['mandatory'])
        return captured

    def enforce_result(self, result):
        """Never let ignored early errors or lost mandatory evidence become PASS."""
        result.update(self.event_snapshot())
        if result.get('status') == 'PASS':
            if self.events['page_errors']:
                result.update(status='ERROR', failure_class='UNHANDLED_PAGE_ERROR',
                              reason=self.events['page_errors'][0]['message'])
            elif not result.get('mandatory_evidence_complete', False):
                result.update(status='ERROR', failure_class='MANDATORY_EVIDENCE_MISSING',
                              reason='One or more independent evidence captures failed')
