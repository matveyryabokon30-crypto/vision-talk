"""Actual Playwright callback/lifecycle qualification; synthetic browser only."""
from __future__ import annotations
import argparse, asyncio, hashlib, importlib.metadata, json, platform, subprocess, time, traceback, warnings
from pathlib import Path
from playwright.async_api import async_playwright
from network import Boundary, A, B, C1, API_HOST, jwt
from diagnostics import FLAGS, VIEWPORT, write
from collector import BrowserCollector, utc_now

HTML='''<!doctype html><title>Synthetic WebSocket qualification</title>
<h1>Synthetic browser boundary control</h1><script>
window.sockets={};window.frames={};window.closes={};
window.openSocket=(id,url)=>new Promise((resolve,reject)=>{
 const socket=new WebSocket(url);sockets[id]=socket;frames[id]=[];
 socket.onmessage=event=>frames[id].push(JSON.parse(event.data));
 socket.onerror=()=>reject(Error('Synthetic socket open failed'));
 socket.onclose=event=>closes[id]={code:event.code,reason:event.reason,wasClean:event.wasClean};
 socket.onopen=()=>resolve({url:socket.url,protocol:socket.protocol,readyState:socket.readyState,
  instanceof:socket instanceof WebSocket,prototype:Object.getPrototypeOf(socket)===WebSocket.prototype,
  preservation:window.__integrationBoundarySocketAPI.compare(socket),
  constants:[WebSocket.CONNECTING,WebSocket.OPEN,WebSocket.CLOSING,WebSocket.CLOSED]});
});
</script>'''

async def until(predicate,seconds=5):
    async def wait():
        while not predicate():await asyncio.sleep(.01)
    await asyncio.wait_for(wait(),seconds)

async def run(args):
    root=args.source_root.resolve();output=args.output.resolve()
    if output.exists() and any(path.name!='process.log' for path in output.iterdir()):raise RuntimeError('Output directory must contain only the supervisor process.log, if present')
    output.mkdir(parents=True,exist_ok=True)
    origin='http://127.0.0.1:19731';url='wss://'+API_HOST+'/realtime/v1/websocket?apikey=fixture-public-key&vsn=2.0.0'
    result={'test_id':'NETWORK-BROWSER-BOUNDARY-01','status':'RUNNING','start_time_utc':utc_now(),
            'checks':[],'behavioral_product_assertions':0,'python_warnings':[],'loop_errors':[],
            'tested_sha':subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True,timeout=5).strip(),
            'source_sha256':{name:hashlib.sha256((Path(__file__).parent/name).read_bytes()).hexdigest()
                             for name in ['network.py','network_browser_selftest.py','collector.py','diagnostics.py']},
            'environment':{'python':platform.python_version(),'platform':platform.platform(),
                           'playwright':importlib.metadata.version('playwright'),'launch_flags':FLAGS,
                           'viewport':VIEWPORT,'service_workers':'block','external_forwarding':False},'cleanup':{}}
    net=Boundary(origin);browser=None;ctx=None;collector=None;page=None
    loop=asyncio.get_running_loop();old_handler=loop.get_exception_handler()
    def loop_error(loop,context):
        result['loop_errors'].append({'message':context.get('message'),'exception':repr(context.get('exception'))})
        if old_handler:old_handler(loop,context)
        else:loop.default_exception_handler(context)
    loop.set_exception_handler(loop_error)
    deadline=loop.call_later(100,asyncio.current_task().cancel)
    write(output/'results.json',result)
    def check(name,ok,actual):
        result['checks'].append({'name':name,'status':'PASS' if ok else 'FAIL','actual':actual})
        write(output/'results.json',result)
        if not ok:raise AssertionError(name)
    topic='realtime:pablicus-inbox-'+A;chat='realtime:pablicus-chat-'+C1
    config={'broadcast':{'ack':False,'self':False},'presence':{'key':'','enabled':False},'private':False,
            'postgres_changes':[{'event':'INSERT','schema':'public','table':'messages'}]}
    async def open_socket(name):
        observed=await asyncio.wait_for(page.evaluate('([id,url])=>openSocket(id,url)',[name,url]),8)
        check('NATIVE-CONSTRUCTOR-'+name,observed=={'url':url,'protocol':'','readyState':1,'instanceof':True,
              'prototype':True,'constants':[0,1,2,3],
              'preservation':{'constructorIdentityChanged':True,'prototypePreserved':True,
                  'instancePrototypePreserved':True,'instanceofBefore':True,'sendPreserved':True,
                  'closePreserved':True,'constantsPreserved':True}},observed)
        await until(lambda:any(e.get('source')=='native.WebSocket.open' for e in net.ws_events))
        return net.ws_serial
    async def frame(name,connection,topic,event,payload,status,ref,reply=True):
        before=len(net.ws_events)
        await page.evaluate('([id,frame])=>sockets[id].send(JSON.stringify(frame))',[name,['1',ref,topic,event,payload]])
        await until(lambda:any(e.get('connection')==connection and e.get('event')==event and e.get('status')==status for e in net.ws_events[before:]))
        observed=[e for e in net.ws_events[before:] if e.get('connection')==connection and e.get('event')==event][-1]
        if reply:
            await page.wait_for_function('([id,ref])=>frames[id].some(frame=>frame[1]===ref)',arg=[name,ref],timeout=5000)
            received=await page.evaluate('([id,ref])=>frames[id].find(frame=>frame[1]===ref)',[name,ref])
            check('NATIVE-FRAME-'+ref,received[3]=='phx_reply' and received[4]['status']==('error' if status.startswith(('UNAUTHORIZED','FORBIDDEN','UNMODELED')) else 'ok'),received)
        check('CALLBACK-'+event+'-'+ref,observed['source']=='playwright.WebSocketRoute.on_message',observed)
    async def join(name,connection,topic,ref,uid=A):
        declared=config if topic.startswith('realtime:pablicus-inbox-') else {**config,'postgres_changes':[dict(config['postgres_changes'][0],filter='conversation_id=eq.'+C1)]}
        await frame(name,connection,topic,'phx_join',{'config':declared,'access_token':jwt(uid)},'JOINED',ref)
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter('always')
        try:
            async with async_playwright() as pw:
                # Evidence and every browser operation finish before __aexit__
                # stops Playwright, on both the success and failure paths.
                try:
                    browser=await pw.chromium.launch(headless=True,args=FLAGS,timeout=20000)
                    result['environment']['browser']=browser.version
                    ctx=await asyncio.wait_for(browser.new_context(service_workers='block',viewport=VIEWPORT),8)
                    async def route(request):
                        if request.request.url in [origin+'/',origin+'/reload']:
                            await request.fulfill(status=200,content_type='text/html',body=HTML)
                        else:await net.handle(request)
                    await ctx.route('**/*',route);await ctx.route_web_socket('**/*',net.websocket)
                    page=await asyncio.wait_for(ctx.new_page(),10);page.set_default_timeout(5000)
                    collector=BrowserCollector(page,net,output)
                    await net.attach_page(page)
                    await page.goto(origin+'/',wait_until='load',timeout=10000)
                    first=await open_socket('first');await join('first',first,topic,'1');await join('first',first,chat,'2')
                    check('AUTHENTICATED-INBOX-AND-CHAT',net.ws_connections[first]=={topic:A,chat:A},net.summary())
                    await frame('first',first,'phoenix','heartbeat',{},'OK','3')
                    await frame('first',first,topic,'access_token',{'access_token':jwt(A,int(time.time())+1)},'TOKEN_REFRESHED','4',False)
                    check('SAME-USER-REFRESH-RETAINS',net.ws_connections[first]=={topic:A,chat:A},net.ws_connections[first].copy())
                    await frame('first',first,chat,'phx_leave',{},'LEFT','5')
                    second=await open_socket('second');await join('second',second,chat,'6')
                    await page.evaluate("sockets.second.close(1000,'Fixture explicit close')")
                    await until(lambda:not net.ws_connections[second] and any(e.get('connection')==second and e.get('source')=='native.WebSocket.close' and e.get('code')==1000 for e in net.ws_events))
                    check('EXPLICIT-CLOSE-ATTRIBUTION',net.ws_connections[first]=={topic:A} and not net.ws_connections[second],net.summary())
                    await page.evaluate('sockets.first.close()')
                    # Pinned Playwright WebSocketMock forwards an omitted code
                    # into new CloseEvent; its default code is 0 (not wire 1005).
                    await until(lambda:not net.ws_connections[first] and any(e.get('connection')==first and e.get('source')=='native.WebSocket.close' and e.get('code')==0 for e in net.ws_events))
                    default_close=await page.evaluate('closes.first')
                    check('DEFAULT-CLOSE-NO-CODE',not net.ws_channels and default_close=={'code':0,'reason':'','wasClean':True},default_close)
                    third=await open_socket('offline');await join('offline',third,topic,'7');net.offline=True
                    await frame('offline',third,'phoenix','heartbeat',{},'NETWORK_UNAVAILABLE','8',False)
                    await net.drain();await page.wait_for_function('closes.offline?.code===1013')
                    check('OFFLINE-CLOSE',not net.ws_channels,await page.evaluate('closes.offline'))
                    net.offline=False
                    fourth=await open_socket('reload');await join('reload',fourth,topic,'9')
                    await page.goto(origin+'/reload',wait_until='load',timeout=10000)
                    await until(lambda:not net.ws_channels)
                    check('NAVIGATION-DISPOSES-OLD-CONTEXT',not net.ws_channels,[e for e in net.ws_events if e.get('connection')==fourth and e.get('event')=='close'])
                    fifth=await open_socket('afterReload');await join('afterReload',fifth,topic,'10')
                    check('RELOAD-TOKEN-UNIQUE',len(net.ws_lifecycle)==5 and len({item['connection'] for item in net.ws_lifecycle.values()})==5,net.ws_lifecycle)
                    await frame('afterReload',fifth,topic,'access_token',{'access_token':jwt(B)},'STALE_CHANNEL_REVOKED','11',False)
                    check('ACCOUNT-CHANGE-REVOKES',not net.ws_channels,net.summary())
                    await page.evaluate('sockets.afterReload.close()')
                    await until(lambda:all(item['closed'] for item in net.ws_lifecycle.values()))
                    await net.drain()
                    check('NO-QUALIFICATION-ERRORS',not net.unknown and not net.blocked and not net.ws_errors and not collector.events['page_errors'],net.summary())
                    result['status']='PASS'
                except AssertionError as exc:
                    result.update(status='FAIL',reason=str(exc),traceback=traceback.format_exc())
                except asyncio.CancelledError:
                    result.update(status='ERROR',reason='GATE_DEADLINE_OR_INTERRUPTION',traceback=traceback.format_exc())
                except Exception as exc:
                    result.update(status='ERROR',reason=str(exc),traceback=traceback.format_exc())
                finally:
                    deadline.cancel()
                    # A boundary error must not prevent independent browser capture.
                    try:await net.drain()
                    except Exception as exc:result['drain_error']=str(exc);result['status']='ERROR'
                    if collector:
                        try:result.update(await collector.capture());collector.enforce_result(result)
                        except Exception as exc:result['capture_error']=str(exc);result['status']='ERROR'
                    if page and not page.is_closed():
                        try:
                            await asyncio.wait_for(page.evaluate("""() => Promise.all(
                              Object.values(window.sockets||{}).filter(socket=>socket.readyState<2)
                                .map(socket=>new Promise(resolve=>{
                                  socket.addEventListener('close',resolve,{once:true});socket.close();
                                })))"""),5)
                            await until(lambda:all(item['closed'] for item in net.ws_lifecycle.values()))
                            result['socket_cleanup']='CLOSED'
                        except Exception as exc:result['socket_cleanup']=str(exc);result['status']='ERROR'
                    for name,target in [('context',ctx),('browser',browser)]:
                        if target:
                            try:
                                await asyncio.wait_for(target.close(),5)
                                result['cleanup'][name]='CLOSED'
                            except Exception as exc:result['cleanup'][name]=str(exc);result['status']='ERROR'
                    try:await net.drain()
                    except Exception as exc:result['drain_error']=str(exc);result['status']='ERROR'
                    if result['status']=='PASS':
                        try:
                            check('ALL-CONNECTIONS-AND-JOBS-CLOSED',not net.ws_channels and not net.ws_jobs
                                  and all(item['closed'] for item in net.ws_lifecycle.values()),net.summary())
                        except AssertionError as exc:result.update(status='FAIL',reason=str(exc))
                    write(output/'results.json',result)
        except asyncio.CancelledError:
            result.update(status='ERROR',reason='PLAYWRIGHT_LIFETIME_INTERRUPTED',traceback=traceback.format_exc())
        except Exception as exc:
            result.update(status='ERROR',reason='PLAYWRIGHT_LIFETIME: '+str(exc),traceback=traceback.format_exc())
        finally:
            deadline.cancel()
            result['python_warnings']=[{'category':w.category.__name__,'message':str(w.message),'file':w.filename,'line':w.lineno} for w in caught]
            write(output/'results.json',result)
    if collector:collector.enforce_result(result)
    if result['python_warnings'] or result['loop_errors']:result.update(status='ERROR',reason='PROCESS_QUALIFICATION_ERRORS')
    result.update(network=net.summary(),end_time_utc=utc_now())
    loop.set_exception_handler(old_handler);write(output/'results.json',result)
    print(json.dumps({'test_id':result['test_id'],'status':result['status'],'checks':len(result['checks']),'reason':result.get('reason')}))
    return 0 if result['status']=='PASS' else 1

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--source-root',type=Path,required=True);parser.add_argument('--output',type=Path,required=True)
    raise SystemExit(asyncio.run(run(parser.parse_args())))
