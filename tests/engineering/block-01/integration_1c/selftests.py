"""Gate 2: qualify native forwarding and the independent early-error collector.

All pages are isolated synthetic fixtures. No application or production endpoint
is used. The collector's deliberately erroneous inner process must stay nonzero;
its outer supervisor's PASS is harness evidence, never product acceptance.
"""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
import platform
import signal
import sys
import time
import traceback
from pathlib import Path
from urllib.parse import urlsplit

from playwright.async_api import async_playwright
from collector import BrowserCollector, utc_now

HERE = Path(__file__).resolve().parent
ORIGIN = 'http://127.0.0.1:43187'
FLAGS = ['--no-sandbox', '--disable-dev-shm-usage', '--disable-background-networking',
         '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1']
SENTINEL = 'COLLECTOR-EARLY-ERROR-01 deliberate startup sentinel'
APIS = ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
        'requestAnimationFrame', 'cancelAnimationFrame']


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def save(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')
    temporary.replace(path)


def check(result, name, condition, actual):
    result['checks'].append({'name': name, 'status': 'PASS' if condition else 'FAIL', 'actual': actual})
    if not condition:
        raise AssertionError(name)


class FixtureBoundary:
    def __init__(self):
        self.calls = []
        self.blocked = []

    async def handle(self, route):
        request = route.request
        parsed = urlsplit(request.url)
        entry = {'method': request.method, 'url': request.url}
        self.calls.append(entry)
        if parsed.scheme + '://' + parsed.netloc != ORIGIN or request.method != 'GET':
            entry['status'] = 'BLOCKED_EXTERNAL'
            self.blocked.append(entry.copy())
            await route.abort('blockedbyclient')
            return
        if parsed.path == '/request-failed':
            entry['status'] = 'EXPECTED_REQUEST_ABORT'
            await route.abort('failed')
        elif parsed.path == '/http-failure':
            entry['status'] = 503
            await route.fulfill(status=503, content_type='text/plain', body='Deliberate fixture HTTP failure')
        elif parsed.path == '/collector':
            entry['status'] = 200
            await route.fulfill(content_type='text/html', body='''<!doctype html>
<html><head><title>Early collector error fixture</title></head><body>
<p id="sentinel">Independent diagnostic evidence survives startup failure.</p>
<script>
console.error('COLLECTOR-EARLY-ERROR-01 console sentinel');
fetch('/request-failed').catch(() => {});
fetch('/http-failure').then(() => {document.documentElement.dataset.probesSettled='yes';});
throw new Error(''' + json.dumps(SENTINEL) + ''');
</script></body></html>''')
        elif parsed.path == '/receiver':
            entry['status'] = 200
            await route.fulfill(content_type='text/html', body='<!doctype html><title>Native receiver fixture</title><p>Actual Chromium primitives</p>')
        else:
            entry['status'] = 501
            await route.fulfill(status=501, content_type='text/plain', body='UNMODELED_BOUNDARY')

    def summary(self):
        return {'calls': self.calls, 'blocked': self.blocked,
                'external_forwarding': False, 'fixture_only': True}


RECEIVER_ACTIONS = """async () => {
 const p=window.__receiverProbe, callbacks={timeout:[],interval:[],raf:[]};
 let timeoutCancelled=0,frameCancelled=0;
 const before=window.__integration?.snapshot()??null;
 const timeout=window.setTimeout(function(...args){callbacks.timeout.push({receiver_is_window:this===window,args});},15,'timeout-argument',37);
 const cancelledTimeout=window.setTimeout(function(){timeoutCancelled++;},30);
 const clearTimeoutResult=window.clearTimeout(cancelledTimeout);
 let interval;
 interval=window.setInterval(function(...args){
  callbacks.interval.push({receiver_is_window:this===window,args});
  if(callbacks.interval.length===3)window.clearInterval(interval);
 },10,'interval-argument',73);
 const frame=window.requestAnimationFrame(function(timestamp){callbacks.raf.push({receiver_is_window:this===window,timestamp});});
 const cancelledFrame=window.requestAnimationFrame(function(){frameCancelled++;});
 const cancelFrameResult=window.cancelAnimationFrame(cancelledFrame);
 const active=window.__integration?.snapshot()??null;
 // Wait through original natives so observation machinery adds no measured
 // timer and cannot turn a wrong wrapper into a passing result.
 const deadline=performance.now()+4000;
 while(callbacks.timeout.length<1 || callbacks.interval.length<3 || callbacks.raf.length<1){
  if(performance.now()>deadline)throw Error('NATIVE_CALLBACK_SETTLEMENT_TIMEOUT '+JSON.stringify({callbacks,visibility:document.visibilityState}));
  await new Promise(resolve=>Reflect.apply(p.original.setTimeout,window,[resolve,20]));
 }
 const intervalCountAtStop=callbacks.interval.length;
 await new Promise(resolve=>Reflect.apply(p.original.setTimeout,window,[resolve,60]));
 const after=window.__integration?.snapshot()??null;
 return {calls:p.calls,callbacks,timeoutCancelled,frameCancelled,intervalCountAtStop,
  intervalCountAfterWait:callbacks.interval.length,
  ids:{timeout,cancelledTimeout,interval,frame,cancelledFrame},
  cancelResults:{clearTimeout:typeof clearTimeoutResult,cancelAnimationFrame:typeof cancelFrameResult},
  resources:{before,active,after}};
}"""


def assert_receiver(result, variant, observed):
    calls = observed['calls']
    grouped = {name: [call for call in calls if call['name'] == name] for name in APIS}
    for api in APIS:
        entries = grouped[api]
        check(result, variant + '/' + api + '/native-window-receiver', bool(entries) and all(call['receiver_is_window'] for call in entries), entries)
        setter = api in ['setTimeout', 'setInterval', 'requestAnimationFrame']
        valid = all(call['result_type'] == ('number' if setter else 'undefined') and
                    (isinstance(call['result'], (int, float)) and call['result'] > 0 if setter else call['result'] is None)
                    for call in entries)
        check(result, variant + '/' + api + '/native-return', valid, entries)
    expected_arguments = {
        'setTimeout': [['<function>', 15, 'timeout-argument', 37], ['<function>', 30]],
        'clearTimeout': [[observed['ids']['cancelledTimeout']]],
        'setInterval': [['<function>', 10, 'interval-argument', 73]],
        'clearInterval': [[observed['ids']['interval']]],
        'requestAnimationFrame': [['<function>'], ['<function>']],
        'cancelAnimationFrame': [[observed['ids']['cancelledFrame']]],
    }
    for api, arguments in expected_arguments.items():
        actual = [call['args'] for call in grouped[api]]
        check(result, variant + '/' + api + '/arguments', actual == arguments, actual)
    callbacks = observed['callbacks']
    check(result, variant + '/timeout-once-this-and-arguments', callbacks['timeout'] == [{'receiver_is_window': True, 'args': ['timeout-argument', 37]}], callbacks['timeout'])
    check(result, variant + '/clear-timeout-cancels', observed['timeoutCancelled'] == 0, observed['timeoutCancelled'])
    check(result, variant + '/interval-runs-and-clear-stops', callbacks['interval'] == [{'receiver_is_window': True, 'args': ['interval-argument', 73]}] * 3 and observed['intervalCountAtStop'] == observed['intervalCountAfterWait'] == 3, callbacks['interval'])
    raf = callbacks['raf']
    check(result, variant + '/raf-once-this-and-timestamp', len(raf) == 1 and raf[0]['receiver_is_window'] and isinstance(raf[0]['timestamp'], (int, float)) and raf[0]['timestamp'] >= 0, raf)
    check(result, variant + '/cancel-raf-cancels', observed['frameCancelled'] == 0, observed['frameCancelled'])


async def receiver_test(output, source_root):
    output.mkdir(parents=True, exist_ok=True)
    result = {'test_id': 'INSTRUMENT-NATIVE-RECEIVER-01', 'status': 'RUNNING', 'checks': [],
              'start_time_utc': utc_now(), 'variants': {}, 'behavioral_product_assertions': 0}
    started = time.monotonic()
    instrument = source_root / 'tests/engineering/block-01/integration_1c/instrument.js'
    recorder = HERE / 'receiver_selftest.js'
    result['source_sha256'] = {'instrument.js': digest(instrument), 'receiver_selftest.js': digest(recorder)}
    browser = None
    try:
        async with async_playwright() as pw:
            browser = await pw.chromium.launch(headless=True, args=FLAGS)
            result['browser_version'] = browser.version
            for variant in ['baseline', 'instrumented']:
                context = await browser.new_context(service_workers='block', viewport={'width': 430, 'height': 900})
                boundary = FixtureBoundary()
                await context.route('**/*', boundary.handle)
                # One initialization script gives recording wrappers and the
                # instrument a deterministic order before page scripts execute.
                script = recorder.read_text() + ('\n' + instrument.read_text() if variant == 'instrumented' else '')
                await context.add_init_script(script=script)
                page = await context.new_page()
                collector = BrowserCollector(page, boundary, output / variant)
                observation = {'status': 'RUNNING'}
                try:
                    response = await page.goto(ORIGIN + '/receiver', timeout=10000, wait_until='load')
                    await page.bring_to_front()
                    check(result, variant + '/http-200', response.status == 200, response.status)
                    observed = await asyncio.wait_for(page.evaluate(RECEIVER_ACTIONS), 8)
                    observation['observed'] = observed
                    assert_receiver(result, variant, observed)
                    if variant == 'instrumented':
                        resources = observed['resources']
                        check(result, variant + '/live-resource-observation', resources['active']['timers'] == {'timeout': 1, 'interval': 1} and resources['active']['frames'] == 1, resources['active'])
                        check(result, variant + '/resources-return-to-baseline', resources['before']['timers'] == resources['after']['timers'] == {} and resources['before']['frames'] == resources['after']['frames'] == 0, resources)
                    observation['status'] = 'PASS'
                except AssertionError as exc:
                    observation.update(status='FAIL', reason=str(exc))
                    raise
                except Exception as exc:
                    observation.update(status='ERROR', reason=str(exc))
                    raise
                finally:
                    observation.update(await collector.capture())
                    collector.enforce_result(observation)
                    result['variants'][variant] = observation
                    save(output / variant / 'result.json', observation)
                    await asyncio.wait_for(context.close(), 5)
                check(result, variant + '/independent-evidence', observation['status'] == 'PASS', observation['capture_steps'])
            result['status'] = 'PASS'
            await asyncio.wait_for(browser.close(), 5)
            result['browser_closed'] = True
    except AssertionError as exc:
        result.update(status='FAIL', reason=str(exc), traceback=traceback.format_exc())
    except Exception as exc:
        result.update(status='TIMEOUT' if isinstance(exc, asyncio.TimeoutError) else 'ERROR', reason=str(exc), traceback=traceback.format_exc())
    result.update(end_time_utc=utc_now(), duration_ms=round((time.monotonic() - started) * 1000))
    save(output / 'result.json', result)
    return result


async def collector_inner(output):
    output.mkdir(parents=True, exist_ok=True)
    result = {'test_id': 'COLLECTOR-EARLY-ERROR-01/inner', 'status': 'RUNNING', 'checks': [],
              'behavioral_product_assertions': 0, 'start_time_utc': utc_now()}
    boundary = FixtureBoundary()
    save(output / 'result.json', result)
    try:
        async with async_playwright() as pw:
            browser = await pw.chromium.launch(headless=True, args=FLAGS)
            result['browser_version'] = browser.version
            context = await browser.new_context(service_workers='block', viewport={'width': 430, 'height': 900})
            await context.route('**/*', boundary.handle)
            page = await context.new_page()
            collector = BrowserCollector(page, boundary, output)
            try:
                await page.goto(ORIGIN + '/collector', timeout=10000, wait_until='load')
                deadline = time.monotonic() + 5
                while not (collector.events['page_errors'] and collector.events['request_failures'] and collector.events['http_failures']):
                    if time.monotonic() > deadline:
                        raise TimeoutError('Deliberate collector event fixtures did not settle')
                    await asyncio.sleep(0.01)
                # A scenario that overlooks the startup error would propose
                # PASS here. The shared collector must turn it into ERROR.
                result['status'] = 'PASS'
            except Exception as exc:
                result.update(status='ERROR', reason=str(exc), traceback=traceback.format_exc())
            finally:
                result.update(await collector.capture())
                collector.enforce_result(result)
                save(output / 'result.json', result)
                await asyncio.wait_for(context.close(), 5)
                await asyncio.wait_for(browser.close(), 5)
                result['browser_closed'] = True
    except Exception as exc:
        result.update(status='ERROR', reason=str(exc), traceback=traceback.format_exc())
    result['end_time_utc'] = utc_now()
    save(output / 'result.json', result)
    return 0 if result['status'] == 'PASS' else 1


async def collector_test(output, source_root):
    output.mkdir(parents=True, exist_ok=True)
    result = {'test_id': 'COLLECTOR-EARLY-ERROR-01', 'status': 'RUNNING', 'checks': [],
              'behavioral_product_assertions': 0, 'start_time_utc': utc_now()}
    inner = output / 'inner'
    command = [sys.executable, str(HERE / 'selftests.py'), '--source-root', str(source_root), '--output', str(inner), '--inner-collector']
    result['inner_command'] = command
    process = None
    try:
        with (output / 'inner-process.log').open('w') as log:
            process = await asyncio.create_subprocess_exec(*command, stdout=log, stderr=asyncio.subprocess.STDOUT, start_new_session=True)
            code = await asyncio.wait_for(process.wait(), 65)
        result['inner_exit_code'] = code
        payload = json.loads((inner / 'result.json').read_text())
        result['inner_result'] = 'inner/result.json'
        if not payload.get('dom_global_state'):
            raise RuntimeError('Inner browser did not reach collector fixture: ' + payload.get('reason', 'no DOM evidence'))
        check(result, 'inner-is-error-and-nonzero', code != 0 and payload['status'] == 'ERROR' and payload.get('failure_class') == 'UNHANDLED_PAGE_ERROR', {'exit_code': code, 'status': payload['status'], 'failure_class': payload.get('failure_class')})
        first = payload.get('first_error') or {}
        check(result, 'first-message-stack-location-retained', SENTINEL in first.get('message', '') and SENTINEL in (first.get('stack') or '') and (first.get('location') or {}).get('url') == ORIGIN + '/collector' and first['location']['line'] > 0 and first['location']['column'] > 0, first)
        check(result, 'console-retained', any('console sentinel' in item['text'] and item['type'] == 'error' for item in payload['console']), payload['console'])
        check(result, 'requestfailed-retained', any(item['url'] == ORIGIN + '/request-failed' and item['failure'] for item in payload['request_failures']), payload['request_failures'])
        check(result, 'http-failure-retained', any(item['url'] == ORIGIN + '/http-failure' and item['status'] == 503 for item in payload['http_failures']), payload['http_failures'])
        globals_state = payload['dom_global_state']['globals']
        check(result, 'missing-globals-recorded-as-state', all(globals_state[name] is False for name in ['PablicusDebug', 'PablicusController', '__integration']) and payload['final_state']['available'] is False and payload['instrument']['available'] is False, globals_state)
        check(result, 'independent-captures-complete', payload['mandatory_evidence_complete'], payload['capture_steps'])
        for name in ['final.png', 'final.html', 'browser-events.json']:
            file = inner / name
            check(result, name + '/preserved', file.is_file() and file.stat().st_size > 0, {'path': str(file), 'sha256': digest(file) if file.is_file() else None})
        check(result, 'no-behavioral-product-credit', payload['checks'] == [] and payload['behavioral_product_assertions'] == 0, payload['checks'])
        check(result, 'production-blocked-and-cleanup', not payload['network']['blocked'] and payload['network']['external_forwarding'] is False and payload.get('browser_closed') is True, payload['network'])
        result['status'] = 'PASS'
    except AssertionError as exc:
        result.update(status='FAIL', reason=str(exc), traceback=traceback.format_exc())
    except Exception as exc:
        result.update(status='TIMEOUT' if isinstance(exc, asyncio.TimeoutError) else 'ERROR', reason=str(exc), traceback=traceback.format_exc())
    finally:
        if process:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            if process.returncode is None:
                await asyncio.wait_for(process.wait(), 5)
        result['inner_process_group_cleaned'] = process is not None
    result['end_time_utc'] = utc_now()
    save(output / 'result.json', result)
    return result


async def main(args):
    output = args.output.resolve()
    source_root = args.source_root.resolve()
    if args.inner_collector:
        return await collector_inner(output)
    output.mkdir(parents=True, exist_ok=True)
    result = {'status': 'RUNNING', 'start_time_utc': utc_now(), 'tests': {},
              'tested_sha': os.environ.get('PABLICUS_TESTED_SHA') or os.environ.get('GITHUB_SHA'),
              'environment': {'python': platform.python_version(), 'platform': platform.platform(),
                              'origin': ORIGIN, 'launch_flags': FLAGS, 'service_workers': 'block'},
              'behavioral_product_assertions': 0,
              'source_sha256': {path.name: digest(path) for path in [HERE / 'selftests.py', HERE / 'receiver_selftest.js', HERE / 'collector.py']}}
    save(output / 'results.json', result)
    result['tests']['INSTRUMENT-NATIVE-RECEIVER-01'] = await receiver_test(output / 'receiver', source_root)
    save(output / 'results.json', result)
    result['tests']['COLLECTOR-EARLY-ERROR-01'] = await collector_test(output / 'collector', source_root)
    result['status'] = 'PASS' if all(test['status'] == 'PASS' for test in result['tests'].values()) else 'FAIL'
    result['end_time_utc'] = utc_now()
    result['evidence_sha256'] = {str(path.relative_to(output)): digest(path) for path in output.rglob('*') if path.is_file() and path != output / 'results.json'}
    save(output / 'results.json', result)
    print(json.dumps({'status': result['status'], 'tests': {name: value['status'] for name, value in result['tests'].items()}}))
    return 0 if result['status'] == 'PASS' else 1


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--source-root', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--inner-collector', action='store_true')
    raise SystemExit(asyncio.run(main(parser.parse_args())))
