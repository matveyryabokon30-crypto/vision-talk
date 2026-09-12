"""Controlled A/B0/B1 and gated preflight on the unchanged real application."""
from __future__ import annotations
import argparse, asyncio, functools, hashlib, http.server, json, os, platform, subprocess, threading, time
from pathlib import Path
from playwright.async_api import async_playwright, TimeoutError as PlaywrightTimeoutError
from collector import BrowserCollector, APPLICATION_STATE, utc_now
from network import Boundary, A, C1

HERE = Path(__file__).resolve().parent
ORIGINAL_SHA = 'f00f253ca2adfe7afc07e64cc3a1dc8f53c5692d'
ORIGINAL_BLOB = 'c489098780ef7bfe7ee4fbbfbe58884000fdc128'
FLAGS = ['--no-sandbox', '--disable-dev-shm-usage', '--disable-background-networking',
         '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1']
VIEWPORT = {'width': 430, 'height': 900}

def digest(data): return hashlib.sha256(data).hexdigest()
def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')
    temporary.replace(path)

class QuietServer(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args): pass

def error_fingerprint(result):
    error = result.get('first_error') or {}
    location = error.get('location') or {}
    # Origin is held fixed within the experiment; strip only its variable port.
    source = location.get('url', '').replace(result.get('origin', ''), '<origin>')
    fields = {'class': error.get('name', result.get('status')),
              'message': error.get('message', result.get('reason')),
              'source': source, 'line': location.get('line'), 'column': location.get('column')}
    return {'fields': fields, 'sha256': digest(json.dumps(fields, sort_keys=True).encode())}

async def variant(browser, root, origin, output, label, instrument, full_preflight, tested_sha, session_epoch):
    started = time.monotonic()
    net = Boundary(origin, session_epoch=session_epoch)
    result = {'test_id': '1C-PREFLIGHT' if full_preflight else '1C-AB-'+label,
              'variant': label, 'tested_sha': tested_sha, 'status': 'RUNNING',
              'start_time_utc': utc_now(), 'origin': origin, 'checks': [], 'actions': [],
              'synthetic_user': A, 'synthetic_conversation': C1,
              'instrument_sha256': digest(instrument.encode()) if instrument else None,
              'environment': {'python': platform.python_version(), 'platform': platform.platform(),
                              'browser': browser.version, 'launch_flags': FLAGS, 'viewport': VIEWPORT,
                              'service_workers': 'block', 'timeouts_ms': {'action': 8000, 'navigation': 15000},
                              'external_forwarding': False}}
    ctx = await browser.new_context(service_workers='block', viewport=VIEWPORT)
    if instrument is not None: await ctx.add_init_script(script=instrument)
    await ctx.route('**/*', net.handle)
    await ctx.route_web_socket('**/*', net.websocket)
    page = await ctx.new_page()
    page.set_default_timeout(8000)
    page.set_default_navigation_timeout(15000)
    collector = BrowserCollector(page, net, output)

    def check(name, ok, actual):
        result['checks'].append({'name': name, 'status': 'PASS' if ok else 'FAIL', 'actual': actual})
        write(output/'result.json', result)
        if not ok: raise AssertionError(name)

    async def screen(name, expected):
        state = await page.evaluate(APPLICATION_STATE)
        visible = {key: await page.locator(selector).is_visible() for key,selector in
                   [('home','#home'),('app','#app'),('canvas','#chatCanvasPanel')]}
        state['actual_visibility'] = visible
        route = state['route'] or {}
        ok = route.get('screen') == expected
        if expected == 'home':
            ok = ok and visible['home'] and not visible['app'] and not state['list']
        else:
            ok = (ok and visible['app'] and not visible['home'] and state['list']
                  and state['ready'] and state['uid'] == A and state['current'] == C1
                  and state['scope'] == {'user': A, 'chat': C1}
                  and route.get('conversationId') == C1 and not route.get('resourceId')
                  and visible['canvas'] == (expected == 'canvas'))
        check(name, ok, state)

    async def sequence():
        result['actions'].append('GET real index')
        response = await page.goto(origin+'/pablicus/', wait_until='load')
        check('HTTP-200', response is not None and response.status == 200, response.status if response else None)
        instrumentation = await page.evaluate('() => ({present:typeof window.__integration!=="undefined",usable:typeof window.__integration?.snapshot==="function"})')
        check('EXPECTED-INSTRUMENT', instrumentation['present'] == (label!='A') and
              (label=='A' or instrumentation['usable']), instrumentation)
        if collector.events['page_errors']: raise RuntimeError('STARTUP_PAGE_ERROR')
        await page.locator('#email').wait_for(state='visible')
        check('INTENDED-LOGIN', await page.locator('#legacyLogin').is_visible(),
              await page.evaluate('({hidden:document.getElementById("legacyLogin").hidden,sdk:!!window.supabase})'))
        result['actions'].append('Real UI + SDK password login synthetic A')
        await page.locator('#email').fill('a@fixture.invalid')
        await page.locator('#password').fill('fixture-only-password')
        await page.locator('#loginSubmit').click()
        await page.wait_for_function('window.PablicusDebug?.user === "'+A+'" && document.querySelectorAll(".chatCard").length > 0')
        await screen('DIALOGS', 'home')
        result['actions'].append('Open conversation A1 through real UI')
        await page.locator('[data-conversation-id="'+C1+'"] .chatMain').click()
        await page.wait_for_function('window.PablicusDebug?.current === "'+C1+'" && !!window.PablicusChat?.list && !!window.vault?.ready && !document.querySelector("#app").inert')
        await screen('WORKING-MESSAGE-LIST', 'conversation')
        stores = await page.evaluate('async () => ({indexedDB:typeof indexedDB!=="undefined",databases:await indexedDB.databases(),vault:window.vault.public()})')
        check('INDEXEDDB-READY', stores['indexedDB'] and bool(stores['databases']), stores)
        if full_preflight:
            result['actions'].append('Canvas ready then real return conversation')
            await page.locator('#canvasTab').click()
            await page.wait_for_function('window.PablicusController?.state().screen === "canvas" && document.querySelector(".pablicusChatCanvas")?.dataset.state === "ready"')
            await screen('CANVAS-READY', 'canvas')
            await page.locator('#conversationTab').click()
            await page.wait_for_function('window.PablicusController?.state().screen === "conversation" && !!window.PablicusChat?.list')
            await screen('RETURN-CONVERSATION', 'conversation')
        await asyncio.sleep(.2)
        check('NETWORK-CONTRACT', not net.unknown and not net.blocked,
              {'unknown': net.unknown, 'blocked': net.blocked, 'calls': net.calls})
        if collector.events['page_errors']: raise RuntimeError('UNHANDLED_PAGE_ERROR')
        result['status'] = 'PASS'

    write(output/'result.json', result)
    try:
        await asyncio.wait_for(sequence(), 60)
    except AssertionError as exc: result.update(status='FAIL', reason=str(exc))
    except Exception as exc:
        result.update(status='TIMEOUT' if isinstance(exc, (asyncio.TimeoutError, PlaywrightTimeoutError)) else 'ERROR',
                      reason=str(exc), error_type=type(exc).__name__)
    finally:
        for hold in net.holds: hold['release'].set()
        try:
            result.update(await collector.capture())
            collector.enforce_result(result)
            if result['status'] == 'PASS' and (net.unknown or net.blocked):
                result.update(status='ERROR', reason='LATE_UNMODELED_BOUNDARY')
        except Exception as exc:
            result.update(status='ERROR', reason='COLLECTOR_FAILURE: '+str(exc), mandatory_evidence_complete=False)
        try:
            await asyncio.wait_for(ctx.close(), 5)
            result['context_closed'] = True
        except Exception as exc:
            result['context_closed'] = False
            result['cleanup_error'] = str(exc)
            if result['status'] == 'PASS': result.update(status='ERROR', reason='CONTEXT_CLEANUP')
        collector.enforce_result(result)
        result.update(end_time_utc=utc_now(), duration_ms=round((time.monotonic()-started)*1000))
        if result['status'] != 'PASS': result['fingerprint'] = error_fingerprint(result)
        write(output/'result.json', result)
    return result

async def main(args):
    root = args.source_root.resolve()
    output = args.output.resolve()
    tested_sha = subprocess.check_output(['git','rev-parse','HEAD'], cwd=root, text=True, timeout=5).strip()
    fixed = (HERE/'instrument.js').read_text()
    original = subprocess.check_output(['git','show', ORIGINAL_SHA+':tests/engineering/block-01/integration_1c/instrument.js'], cwd=root, timeout=5)
    assert hashlib.sha1(b'blob '+str(len(original)).encode()+b'\0'+original).hexdigest() == ORIGINAL_BLOB
    server = http.server.ThreadingHTTPServer(('127.0.0.1',0), functools.partial(QuietServer,directory=str(root)))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    origin = 'http://127.0.0.1:'+str(server.server_port)
    session_epoch = int(time.time())
    summary = {'tested_sha': tested_sha, 'mode': args.mode, 'origin': origin, 'results': {},
               'synthetic_session_epoch': session_epoch,
               'working_tree_status': subprocess.check_output(['git','status','--porcelain'],cwd=root,text=True,timeout=5),
               'original_instrument_git_blob': ORIGINAL_BLOB,
               'source_sha256': {str(p.relative_to(root)):digest(p.read_bytes()) for folder in [root/'pablicus', HERE] for p in folder.rglob('*') if p.is_file() and '__pycache__' not in p.parts},
               'status':'RUNNING'}
    try:
        async with async_playwright() as pw:
            browser = await pw.chromium.launch(headless=True, args=FLAGS)
            try:
                variants = [('B1',fixed)] if args.mode=='preflight' else [('A',None),('B0',original.decode()),('B1',fixed)]
                for label,instrument in variants:
                    summary['results'][label] = await variant(browser,root,origin,output/label,label,instrument,args.mode=='preflight',tested_sha,session_epoch)
                    write(output/'summary.json',summary)
            finally:
                await asyncio.wait_for(browser.close(), 5)
                summary['browser_closed'] = True
        results = summary['results']
        if args.mode=='ab':
            a,b0,b1 = (results[k] for k in ['A','B0','B1'])
            original_error = (b0.get('first_error') or {})
            receiver_error = 'Illegal invocation' in original_error.get('message','') and any(s in (original_error.get('stack') or '') for s in ['clearTimeout','setTimeout','setInterval','clearInterval','requestAnimationFrame','cancelAnimationFrame'])
            baseline_complete = (b0['status']=='ERROR' and b0.get('mandatory_evidence_complete')
                                 and b0.get('context_closed') and not b0.get('collector_errors')
                                 and not b0['network']['unknown'] and not b0['network']['blocked'])
            baseline_dom = b0.get('dom_global_state', {})
            baseline_symptom = (baseline_dom.get('legacyLogin',{}).get('hidden') is True
                                and baseline_dom.get('email',{}).get('visible') is False
                                and baseline_dom.get('globals',{}).get('PablicusDebug') is False
                                and baseline_dom.get('globals',{}).get('__integration') is True)
            if a['status']=='PASS' and b1['status']=='PASS' and baseline_complete and baseline_symptom and receiver_error:
                summary['hypothesis']='H1_REPRODUCED_IN_CURRENT_EXPERIMENT'
            elif b0['status']=='PASS': summary['hypothesis']='H1_NOT_REPRODUCED'
            else: summary['hypothesis']='INCONCLUSIVE_REQUIRES_DIAGNOSIS'
            summary['historical_first_error_recovered']=False
            summary['status']='PASS' if a['status']=='PASS' and b1['status']=='PASS' and summary['hypothesis']!='INCONCLUSIVE_REQUIRES_DIAGNOSIS' else 'BLOCKED'
        else: summary['status']=results['B1']['status']
    except Exception as exc:
        summary.update(status='ERROR',reason=str(exc),error_type=type(exc).__name__)
    finally:
        server.shutdown();server.server_close();thread.join(2)
        summary['cleanup']={'server_closed':True,'thread_alive':thread.is_alive()}
        if thread.is_alive(): summary.update(status='ERROR',reason='SERVER_THREAD_NOT_CLOSED')
        write(output/'summary.json',summary)
    print(json.dumps({'mode':args.mode,'status':summary['status'],'hypothesis':summary.get('hypothesis'),
                      'results':{k:v['status'] for k,v in summary['results'].items()}}))
    return 0 if summary['status']=='PASS' else 1

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--source-root',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--mode',choices=['ab','preflight'],required=True)
    raise SystemExit(asyncio.run(main(parser.parse_args())))
