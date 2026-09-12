"""Idle DOM observation correlated with actual, unchanged dialog RPC bodies."""
import asyncio
import time
from urllib.parse import urlparse

from integration_case import check, sha, RESULT, save, A, C1, C2
from network import API_HOST


class DialogResponses:
    """Read actual browser responses; never supply or change fixture data."""
    def __init__(self, a):
        self.a = a
        self.entries = []
        self.tasks = set()
        RESULT['observed_dialog_responses'] = self.entries
        a.page.on('response', self.on_response)

    def on_response(self, response):
        request = response.request
        parsed = urlparse(response.url)
        if (parsed.scheme != 'https' or parsed.hostname != API_HOST
                or parsed.port not in [None, 443] or request.method != 'POST'
                or parsed.path != '/rest/v1/rpc/my_conversations_v3'):
            return
        entry = {'method': request.method, 'url': response.url,
                 'status': response.status, 'received_epoch_ms': time.time()*1000,
                 'received_monotonic': time.monotonic(), 'body_capture': 'RUNNING'}
        timing = request.timing
        entry['request_start_epoch_ms'] = timing.get('startTime')
        if timing.get('startTime', -1) >= 0 and timing.get('responseStart', -1) >= 0:
            entry['response_start_epoch_ms'] = timing['startTime']+timing['responseStart']
        self.entries.append(entry)
        task = asyncio.create_task(self.capture(response, entry))
        self.tasks.add(task)
        task.add_done_callback(self.tasks.discard)

    async def capture(self, response, entry):
        try:
            body = await asyncio.wait_for(response.body(), 5)
            entry.update(body_capture='PASS', body_sha256=sha(body), body_bytes=len(body))
        except BaseException as exc:
            entry.update(body_capture='TIMEOUT' if isinstance(exc, asyncio.TimeoutError) else 'ERROR',
                         error=str(exc))
        save()

    async def wait_new(self, offset, count=2, timeout=5):
        deadline = time.monotonic()+timeout
        while time.monotonic() < deadline:
            entries = self.entries[offset:]
            if any(e['body_capture'] in ['ERROR', 'TIMEOUT'] for e in entries):
                raise RuntimeError('DIALOG_RESPONSE_CAPTURE_FAILED')
            ready = [e for e in entries if e['body_capture'] == 'PASS' and e['status'] == 200]
            if len(ready) >= count:
                return ready
            await asyncio.sleep(.05)
        save()
        raise asyncio.TimeoutError('DIALOG_RESPONSE_OBSERVATION_TIMEOUT')

    async def drain(self):
        if self.tasks:
            await asyncio.wait_for(asyncio.gather(*list(self.tasks)), 6)

    async def close(self):
        self.a.page.remove_listener('response', self.on_response)
        await self.drain()

    def window(self, observation):
        start, end = observation['started_epoch_ms'], observation['ended_epoch_ms']
        return [e for e in self.entries if start <= e['received_epoch_ms'] <= end]


async def run(a):
    observed = DialogResponses(a)
    RESULT['quiet_observations'] = {}
    try:
        await a.login()
        await observed.drain()
        previous = [e for e in observed.entries if e['body_capture'] == 'PASS' and e['status'] == 200]
        if not previous:
            raise RuntimeError('QUIET_FIXTURE_BASELINE_NOT_OBSERVED')
        baseline = previous[-1]
        await a.page.evaluate("__integration.observeQuiet('home','#screenContent')")
        await a.delay(4200)
        home = await a.page.evaluate("__integration.quiet('home')")
        await observed.drain()
        responses = observed.window(home)
        fixture_unchanged = (len(responses) >= 2 and all(
            e['status'] == 200 and e['body_capture'] == 'PASS'
            and e['body_sha256'] == baseline['body_sha256'] for e in responses))
        home.update(baseline_response=baseline, actual_responses=responses,
                    fixture_unchanged=fixture_unchanged,
                    boundary_calls=[c for c in a.net.calls if c['path'] == '/rest/v1/rpc/my_conversations_v3'])
        RESULT['quiet_observations']['home'] = home
        save()
        if not fixture_unchanged or home['dropped_records']:
            raise RuntimeError('QUIET_FIXTURE_OR_MUTATION_EVIDENCE_INCOMPLETE')
        check('1C-QUIET-LIST', home['records'] == 0 and home['connected'], home)

        # A real changed network response must still refresh the visible list.
        # Change only the synthetic server's A1 message, never the application.
        before = await a.state()
        marker = '1C_UPDATED_PREVIEW_A1'
        original_body = a.net.messages[C1][-1]['body']
        offset = len(observed.entries)
        a.net.messages[C1][-1]['body'] = marker
        responses = await observed.wait_new(offset, count=2, timeout=5)
        changed_responses = [e for e in responses if e['body_sha256'] != baseline['body_sha256']]
        await a.delay(100)
        after = await a.state()
        preview = await a.page.evaluate("""cid => {
            const node = document.querySelector('.chatCard[data-conversation-id="'+cid+'"] .previewText');
            return {text:node?.textContent||null, visible:!!node && !!node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden'};
        }""", C1)
        refresh = {'fixture_change': {'owner': A, 'conversation': C1,
                                     'original_body': original_body, 'body': marker,
                                     'scope': 'Synthetic network fixture only'},
                   'before': before, 'after': after, 'preview': preview,
                   'actual_responses': responses, 'changed_responses': changed_responses}
        RESULT['quiet_observations']['changed_fixture'] = refresh
        save()
        if not changed_responses:
            raise RuntimeError('CHANGED_DIALOG_RESPONSE_NOT_OBSERVED')
        check('1C-CHANGED-DIALOG-REFRESH',
              before['uid'] == after['uid'] == A and a.net.owns(A, C1)
              and before['cards'] == after['cards'] == [C1, C2]
              and before['route'] == after['route']
              and after['route']['screen'] == 'home' and after['route']['section'] == 'chats'
              and after['route']['sessionUserId'] == A and after['current'] is None
              and after['homeVisible'] and not after['appVisible']
              and preview['visible'] and preview['text'] == marker, refresh)
        await a.conversation()
        await a.page.evaluate("__integration.observeQuiet('hidden-home','#screenContent');__integration.observeQuiet('messages','#canvas')")
        await a.delay(5400)
        quiet = await a.page.evaluate("({hidden:__integration.quiet('hidden-home'),messages:__integration.quiet('messages')})")
        await observed.drain()
        quiet['actual_dialog_responses'] = observed.window(quiet['hidden'])
        RESULT['quiet_observations']['conversation'] = quiet
        save()
        if quiet['hidden']['dropped_records'] or quiet['messages']['dropped_records']:
            raise RuntimeError('QUIET_MUTATION_EVIDENCE_INCOMPLETE')
        check('1C-HIDDEN-LIST-QUIET', all(
            quiet[name]['records'] == 0 and quiet[name]['connected'] for name in ['hidden', 'messages']), quiet)
    finally:
        await observed.close()
