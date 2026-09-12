"""Real-entrypoint 1C scenarios. Only network and native failure boundaries are controlled.
Every result records actual browser observations; no application's storage/view/SDK
module is replaced. Run each case via runner.py for a killable process deadline.
"""
from __future__ import annotations
import argparse, asyncio, copy, functools, hashlib, http.server, json, mimetypes, os, platform, threading, time, traceback
from pathlib import Path
from urllib.parse import urlparse,unquote
from playwright.async_api import async_playwright, TimeoutError as PlaywrightTimeoutError
from network import Boundary,A,B,C1,C2,CB,BOT
from collector import BrowserCollector,utc_now,DOM_STATE,APPLICATION_STATE,INSTRUMENT_STATE

HERE=Path(__file__).resolve().parent
ap=argparse.ArgumentParser();ap.add_argument('--case',required=True);ap.add_argument('--source-root',type=Path,required=True);ap.add_argument('--output',type=Path,required=True);args=ap.parse_args()
ROOT=args.source_root.resolve();OUT=args.output.resolve();OUT.mkdir(parents=True,exist_ok=True)
RESULT={'case':args.case,'status':'RUNNING','checks':[],'stages':[],'source_root':str(ROOT),'scope':'Actual local index, DOM, SDK, app/controller/chat/Canvas/bots/editor/vault/outbox/rich-store/transport-store. Synthetic API/Phoenix; native IDB failure injection only. No production traffic.'}

def save():
 p=OUT/'result.json';tmp=p.with_suffix('.tmp');tmp.write_text(json.dumps(RESULT,ensure_ascii=False,indent=2));tmp.replace(p)
def stage(name):RESULT['stages'].append({'name':name,'at':time.monotonic()});save()
def check(name,ok,actual):
 RESULT['checks'].append({'name':name,'status':'PASS' if ok else 'FAIL','actual':copy.deepcopy(actual)});save()
 if not ok:raise AssertionError(name)
def sha(b):return hashlib.sha256(b).hexdigest()

async def initial_snapshot(page,key,phase):
 record={'phase':phase,'start_time_utc':utc_now(),'capture_steps':{}}
 RESULT[key]=record
 for name,expression in [('dom_global_state',DOM_STATE),('application',APPLICATION_STATE),('instrument',INSTRUMENT_STATE)]:
  try:
   record[name]=await asyncio.wait_for(page.evaluate(expression),5)
   record['capture_steps'][name]={'status':'PASS'}
  except Exception as exc:record['capture_steps'][name]={'status':'ERROR','error':str(exc),'error_type':type(exc).__name__}
  save()
 record.update(end_time_utc=utc_now(),complete=all(row['status']=='PASS' for row in record['capture_steps'].values()));save()
 if not record['complete']:raise RuntimeError('INITIAL_STATE_CAPTURE_INCOMPLETE: '+key)

# Three original files with distinct binary lengths/content and UTF-8 names.
FILES=[{'name':'1-alpha.txt','mimeType':'text/plain','buffer':'Original alpha\nСтрока один\n'.encode()},
 {'name':'2-последовательность.bin','mimeType':'application/octet-stream','buffer':bytes(i%251 for i in range(4097))},
 {'name':'3-tail.dat','mimeType':'application/octet-stream','buffer':bytes((255-i)%256 for i in range(257))}]
TEXT='1C: точный черновик\nСтрока №2 — e\u0301 / العربية / 🙂'
TAIL='Конец после трёх файлов — stable-order'

FINGERPRINT="""async ({kind,uid,cid})=>{
 const digest=async b=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await b.arrayBuffer())),v=>v.toString(16).padStart(2,'0')).join('');
 const fp=async s=>s?({text:s.text,blocks:s.blocks||null,reply_to:s.reply_to||null,files:await Promise.all((s.files||[]).map(async f=>({id:f.id,name:f.name,type:f.type,kind:f.kind,size:f.size,lastModified:f.lastModified,sha256:await digest(f.file)})))}):null;
 if(kind==='live')return fp(PablicusChat.rich.capture());
 const store=uid?new PablicusRichStore(uid,cid):PablicusChat.store;
 try{if(kind==='queue'){const rows=await store.readQueue();return await Promise.all(rows.map(async r=>({id:r.id,client_message_id:r.client_message_id,first_sequence:r.first_sequence,messages:r.messages,files:(await fp({files:r.files})).files,state:r.state,retries:r.retries,parts:r.parts||{},lease:r.lease||null,error:r.error||null})));}return fp(await store.read());}finally{if(uid)store.close()}
}"""

class LocalBoundary(Boundary):
 def __init__(self,origin):super().__init__(origin);self.local_files={}
 async def handle(self,route):
  req=route.request;p=urlparse(req.url)
  if req.url.startswith(self.origin+'/'):
   name=unquote(p.path).lstrip('/') or 'index.html';target=(ROOT/name).resolve()
   if target.is_dir():target=target/'index.html'
   if not target.is_relative_to(ROOT):await route.abort('blockedbyclient');return
   if target.is_file():self.local_files[target.relative_to(ROOT).as_posix()]=sha(target.read_bytes())
   if self.offline:
    # Declared static-shell boundary during API-offline reload. Real unchanged
    # source bytes, not a production Service Worker/offline-shell qualification.
    if target.is_file():await route.fulfill(path=str(target),content_type=mimetypes.guess_type(str(target))[0] or 'application/octet-stream')
    else:await route.fulfill(status=404,body='Missing local fixture source')
    return
  await super().handle(route)
 def summary(self):return {**super().summary(),'local_source_sha256':self.local_files,'static_offline_shell':'Unchanged local files supplied on declared network boundary; Service Worker not tested'}

class QuietServer(http.server.SimpleHTTPRequestHandler):
 def log_message(self,*args):pass

class App:
 def __init__(self,page,ctx,boundary,origin):self.page=page;self.ctx=ctx;self.net=boundary;self.origin=origin
 async def wait(self,expr,timeout=8000):await self.page.wait_for_function(expr,timeout=timeout)
 async def delay(self,ms=200):await self.page.evaluate('(ms)=>__integration.delay(ms)',ms)
 async def state(self):
  return await self.page.evaluate("""()=>({route:PablicusController.state(),uid:PablicusDebug.user,current:PablicusDebug.current||null,scope:PablicusChat.scope,list:!!PablicusChat.list,ready:!!window.vault?.ready,vault:window.vault?.public(),homeVisible:!document.getElementById('home').hidden,appVisible:!document.getElementById('app').hidden,canvasVisible:!document.getElementById('chatCanvasPanel').hidden,selected:[...document.querySelectorAll('#mainNav .selected')].map(n=>n.dataset.page),cards:[...document.querySelectorAll('.chatCard')].map(n=>n.dataset.conversationId),text:document.getElementById('screenContent').innerText,toast:document.getElementById('toast').hidden?null:document.getElementById('toast').textContent})""")
 async def login(self,uid=A,restore=False):
  stage('real index / '+('restore' if restore else 'UI login'))
  await self.page.goto(self.origin+'/pablicus/',wait_until='load')
  if not restore:
   await self.page.locator('#email').fill(('a' if uid==A else 'b')+'@fixture.invalid');await self.page.locator('#password').fill('fixture-only-password');await self.page.locator('#loginSubmit').click()
  await self.wait(f'PablicusDebug.user==="{uid}" && !document.querySelector("#workspace").hidden')
  await self.wait('document.querySelectorAll(".chatCard").length>0')
  await self.delay(150)
  if 'initial_authenticated_state' not in RESULT:
   await initial_snapshot(self.page,'initial_authenticated_state','FIRST_AUTHENTICATED_HOME_BEFORE_SCENARIO_ACTIONS')
 async def switch(self,uid,wait=True):
  stage('public real SDK signIn '+uid)
  await self.page.evaluate("""async uid=>{const result=await PablicusController.getServices().client.auth.signInWithPassword({email:(uid.startsWith('111')?'a':'b')+'@fixture.invalid',password:'fixture-only-password'});if(result.error)throw result.error}""",uid)
  if wait:
   await self.wait(f'PablicusDebug.user==="{uid}" && !document.querySelector("#workspace").hidden')
   await self.delay(100)
 async def conversation(self,cid=C1):
  stage('UI open conversation '+cid)
  await self.page.locator(f'[data-conversation-id="{cid}"] .chatMain').click()
  await self.wait(f'PablicusDebug.current==="{cid}" && PablicusChat.scope.chat==="{cid}" && !!PablicusChat.list && !!window.vault?.ready && !document.querySelector("#app").inert')
  await self.delay(100)
 async def back(self):
  stage('UI Back')
  await self.page.locator('#chatBack').click()
  await self.wait('PablicusController.state().screen==="home" && !PablicusDebug.current && !PablicusChat.list')
  await self.delay(100)
 async def canvas(self):
  stage('UI Canvas')
  await self.page.locator('#canvasTab').click()
  await self.wait('PablicusController.state().screen==="canvas" && document.querySelector(".pablicusChatCanvas")?.dataset.state==="ready"')
  await self.delay(100)
 async def fp(self,kind='live',uid=None,cid=None):return await self.page.evaluate(FINGERPRINT,{'kind':kind,'uid':uid,'cid':cid})
 async def write(self,text=TEXT,files=FILES,tail=TAIL):
  stage('UI write text and attach original files')
  await self.page.locator('#input').fill(text)
  if files:
   await self.page.locator('#documentInput').set_input_files(files)
   await self.wait(f'PablicusChat.rich.capture().files.length==={len(files)}')
   if tail:await self.page.locator('#editor textarea').last.fill(tail)
  await self.page.locator('#chatTitle').focus() # Blur persists selection through the actual composer.
  await self.wait('vault.state==="saved" && !vault.pending && !vault.flight')
  return await self.fp()
 async def clear_toast(self):
  await self.page.locator('#toast').wait_for(state='hidden',timeout=7000)
 async def resources(self):
  await self.delay(200)
  cd=await self.ctx.new_cdp_session(self.page)
  await cd.send('HeapProfiler.collectGarbage');await cd.detach();await self.delay(100)
  return await self.page.evaluate('__integration.snapshot()')
 async def consistency(self,name):
  d=await self.state();r=d['route'];s=r['screen']
  visible={key:await self.page.locator(selector).is_visible() for key,selector in [('home','#home'),('app','#app'),('canvas','#chatCanvasPanel')]};d['actual_visibility']=visible
  if s in ['conversation','canvas']:ok=d['appVisible'] and not d['homeVisible'] and d['list'] and d['ready'] and d['scope']['chat']==r['conversationId']==d['current'] and d['scope']['user']==d['uid'] and not r['resourceId'] and d['canvasVisible']==(s=='canvas')
  else:ok=d['homeVisible'] and not d['appVisible'] and not d['list'] and d['current'] is None and d['selected']==[{'bots':'tasks','feed':'chats'}.get(r['section'],r['section'])]
  ok=ok and r['sessionUserId']==d['uid'] and visible['app']==(s in ['conversation','canvas']) and visible['home']==(s not in ['conversation','canvas']) and visible['canvas']==(s=='canvas')
  check(name,ok,d)
 async def bots(self):
  stage('UI Bots')
  await self.page.locator('#openBots').click();await self.wait('!!document.querySelector(".botCard")')
 async def scenario(self):
  await self.page.locator('.botCard .botMain').click();await self.page.locator('[data-action=scenario]').click();await self.wait('!!document.querySelector(".scenarioList")')
 async def nav(self,section):
  await self.page.locator(f'#mainNav [data-page="{section}"]').click();await self.delay(100)
 async def queue_wait(self,expr='rows.length===1',uid=None,cid=None,timeout=8000):
  deadline=time.monotonic()+timeout/1000
  while time.monotonic()<deadline:
   rows=await self.fp('queue',uid,cid)
   if await self.page.evaluate('(rows)=>'+expr,rows):return rows
   await self.delay(50)
  raise RuntimeError('QUEUE_WAIT_TIMEOUT '+expr)
 async def pump(self):await self.page.evaluate('PablicusDebug.pump()')

import importlib, sys
sys.modules['integration_case']=sys.modules[__name__]
async def main():
 started=time.monotonic();RESULT.update(test_id='1C-'+args.case.upper(),start_time_utc=utc_now(),tested_sha=os.environ.get('PABLICUS_TESTED_SHA') or os.environ.get('GITHUB_SHA'))
 RESULT['source_sha256']={str(p.relative_to(ROOT)):sha(p.read_bytes()) for folder in [ROOT/'pablicus',HERE] for p in sorted(folder.rglob('*')) if p.is_file() and p.is_relative_to(ROOT) and '__pycache__' not in p.parts}
 save();server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(QuietServer,directory=str(ROOT)));thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start();origin='http://127.0.0.1:'+str(server.server_port);boundary=LocalBoundary(origin);page=None;ctx=None;b=None;collector=None
 RESULT['environment']={'python':platform.python_version(),'platform':platform.platform(),'origin':origin,'service_workers':'blocked','real_browser':'Playwright pinned Chromium'}
 try:
  async with async_playwright() as pw:
   b=await pw.chromium.launch(headless=True,args=['--no-sandbox','--disable-dev-shm-usage','--disable-background-networking','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'])
   ctx=await b.new_context(service_workers='block',viewport={'width':430,'height':900});await ctx.add_init_script(path=str(HERE/'instrument.js'));await ctx.route('**/*',boundary.handle);await ctx.route_web_socket('**/*',boundary.websocket)
   page=await ctx.new_page();page.set_default_timeout(8000);page.set_default_navigation_timeout(15000);RESULT['browser_version']=b.version
   await boundary.attach_page(page)
   collector=BrowserCollector(page,boundary,OUT)
   app=App(page,ctx,boundary,origin)
   try:
    await initial_snapshot(page,'initial_state','FRESH_CONTEXT_BEFORE_NAVIGATION_AND_SCENARIO')
    await asyncio.wait_for(importlib.import_module('scenario_'+args.case.replace('-','_')).run(app),105)
    if not RESULT.get('initial_authenticated_state',{}).get('complete'):raise RuntimeError('INITIAL_AUTHENTICATED_STATE_NOT_CAPTURED')
    if collector.events['page_errors']:raise RuntimeError('UNHANDLED_PAGE_ERROR: '+collector.events['page_errors'][0]['message'])
    check('1C-NETWORK-BOUNDARY-COMPLETE',not boundary.unknown and not boundary.blocked,{'unknown':boundary.unknown,'blocked':boundary.blocked})
    observed=await page.evaluate('__integration.snapshot()');check('1C-NO-UNHANDLED-ERRORS',not observed['errors'],observed['errors']);RESULT['final_resources']=observed;RESULT['status']='PASS'
   except AssertionError as exc:RESULT.update(status='FAIL',reason=str(exc),traceback=traceback.format_exc())
   except BaseException as exc:RESULT.update(status='TIMEOUT' if isinstance(exc,(asyncio.TimeoutError,PlaywrightTimeoutError)) else 'ERROR',reason=str(exc),traceback=traceback.format_exc())
   finally:
    for h in boundary.holds:h['release'].set()
    try:await boundary.drain()
    except Exception as exc:RESULT.update(unqualified_behavioral_status=RESULT['status'],status='ERROR',reason='Network callback drain failed: '+str(exc))
    RESULT.update(await collector.capture());collector.enforce_result(RESULT);save()
    RESULT['browser_cleanup']={}
    for name,resource in [('context',ctx),('browser',b)]:
     try:await asyncio.wait_for(resource.close(),5);RESULT['browser_cleanup'][name]='CLOSED'
     except Exception as exc:
      RESULT['browser_cleanup'][name]={'error':str(exc)}
      if RESULT['status']=='PASS':RESULT.update(status='ERROR',reason='Browser cleanup failed: '+name)
    try:await boundary.drain()
    except Exception as exc:RESULT.update(unqualified_behavioral_status=RESULT['status'],status='ERROR',reason='Network cleanup callback failed: '+str(exc))
    RESULT['network_after_cleanup']=boundary.summary()
    if boundary.ws_channels or boundary.ws_jobs or boundary.ws_errors:
     RESULT.update(unqualified_behavioral_status=RESULT['status'],status='ERROR',reason='WebSocket channels/jobs/errors remain after browser cleanup')
 except BaseException as exc:RESULT.update(status='ERROR',reason=str(exc),traceback=traceback.format_exc())
 finally:
  server.shutdown();server.server_close();thread.join(2);RESULT['network']=boundary.summary();RESULT['closed']={'server':True,'thread_alive':thread.is_alive()}
  if RESULT['status']=='PASS' and (boundary.unknown or boundary.blocked or thread.is_alive()):RESULT.update(status='ERROR',reason='Final network boundary or server cleanup failed')
  if collector:collector.enforce_result(RESULT)
  RESULT.update(end_time_utc=utc_now(),duration_ms=round((time.monotonic()-started)*1000));save();print(json.dumps({'case':args.case,'status':RESULT['status'],'reason':RESULT.get('reason'),'checks':[(x['name'],x['status']) for x in RESULT['checks']]}))
 return 0 if RESULT['status']=='PASS' else 1
raise SystemExit(asyncio.run(main()))
