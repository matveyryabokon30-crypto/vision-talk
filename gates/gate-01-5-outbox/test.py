import os,json,time,tempfile,threading,http.server,functools,hashlib,traceback,subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright
from PIL import Image
B=Path(__file__).parent;E=Path('evidence/gate015');E.mkdir(parents=True,exist_ok=True)
F=E/'fixtures';F.mkdir(exist_ok=True)
Image.new('RGB',(800,600),(52,100,84)).save(F/'photo.jpg')
(F/'document.txt').write_text('Original bytes\n\nТекст документа🙂',encoding='utf-8')
(F/'large.bin').write_bytes(bytes(range(256))*65536)
subprocess.run(['ffmpeg','-y','-f','lavfi','-i','color=c=blue:s=160x120:r=12','-t','2','-c:v','libx264','-pix_fmt','yuv420p',str(F/'video.mp4')],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
url=os.environ.get('GATE015_URL')
if not url:
 handler=functools.partial(http.server.SimpleHTTPRequestHandler,directory=str(B/'site'))
 server=http.server.ThreadingHTTPServer(('127.0.0.1',0),handler);threading.Thread(target=server.serve_forever,daemon=True).start();url='http://127.0.0.1:'+str(server.server_port)+'/'

def until(page,expr,seconds=30):
 end=time.monotonic()+seconds
 while time.monotonic()<end:
  try:
   if page.evaluate('() => Boolean('+expr+')'):return
  except Exception as e:
   if not any(s in str(e).lower() for s in ['context was destroyed','cannot find context','frame was detached','navigation']):raise
  page.wait_for_timeout(80)
 raise AssertionError('Timeout: '+expr)
def ready(page):until(page,'window.gate && gate.queueSummary && window.vault && vault.ready && gate.queueSummary().state==="ready"')
def state(page):return page.evaluate('() => gate.report()')
def fill(page,text):
 page.locator('#input').fill(text);until(page,'!vault.pending && !vault.flight && vault.state==="saved"')
def assertion(results,name,value,detail=None):
 results.append({'name':name,'pass':bool(value),'detail':detail})
 if not value:raise AssertionError(name+': '+str(detail))
reports=[]
with sync_playwright() as p:
 for engine in ['chromium','webkit']:
  res={'engine':engine,'physical_ios':False,'url':url,'results':[]};reports.append(res);r=res['results'];ctx=None;page=None
  try:
   profile=tempfile.mkdtemp(prefix='gate015-'+engine)
   def launch():return getattr(p,engine).launch_persistent_context(profile,headless=True,viewport={'width':440,'height':766},has_touch=True)
   ctx=launch();page=ctx.pages[0];errors=[];requests=[]
   page.on('pageerror',lambda e:errors.append(str(e)))
   page.on('request',lambda q:requests.append(q.url) if q.resource_type in ['fetch','xhr','websocket'] else None)
   page.goto(url,wait_until='load');ready(page);page.locator('#open').click();until(page,'gate.list')
   auto=page.evaluate('() => gate.run()');res['autotest']=auto
   assertion(r,'Public non-destructive queue tests',auto['overall']=='PASS',auto['summary'])
   text='Передача в очередь\n\nТочный текст с эмодзи 🙂\n'+'Длинный текст. '*70
   fill(page,text)
   page.locator('#galleryInput').set_input_files([str(F/'photo.jpg'),str(F/'video.mp4')]);page.locator('#documentInput').set_input_files([str(F/'document.txt'),str(F/'large.bin')])
   until(page,'gate.draft.attachments.length===4 && !vault.pending && !vault.flight');page.evaluate('() => gate.previewsSettled')
   expected={hashlib.sha256(x.read_bytes()).hexdigest() for x in F.iterdir()}
   page.evaluate('() => {document.getElementById("send").click();document.getElementById("send").click()}');until(page,'gate.queueSummary().groups===1 && !gate.queueSummary().submit_in_progress')
   fp=page.evaluate('() => OutboxVault.queueFingerprint(gate.getQueueRows())')
   assertion(r,'Double activation: one atomic group with exact text and four original files',len(fp)==1 and len(fp[0]['messages'])==5 and {f['hash'] for f in fp[0]['files']}==expected and page.locator('#input').input_value()=='',{'groups':len(fp),'files':len(fp[0]['files'])})
   qid=fp[0]['id'];assertion(r,'No fictitious server acknowledgement',state(page)['outbox']['entries'][0]['server_ack'] is None and state(page)['outbox']['entries'][0]['state']=='queued')
   page.screenshot(path=str(E/(engine+'-queued.png')),full_page=True)
   fill(page,'Следующий неотправленный черновик')
   page.locator('#queueBtn').click();page.locator('#queueReload').click();ready(page)
   until(page,'gate.queueSummary().reload_check')
   fp2=page.evaluate('() => OutboxVault.queueFingerprint(gate.getQueueRows())')
   assertion(r,'Actual navigation restores exact queue and separate new draft',fp2==fp and page.locator('#input').input_value()=='Следующий неотправленный черновик' and state(page)['outbox']['reload_check']['pass'])
   page.locator('#queueBtn').click();page.get_by_role('button',name='Повторить',exact=True).click();until(page,'gate.queueSummary().entries[0].retries===1')
   assertion(r,'Retry does not add rows or alter payload',page.evaluate('() => OutboxVault.queueFingerprint(gate.getQueueRows())')==fp and state(page)['outbox']['groups']==1)
   page.locator('#closeQueue').click();second=ctx.new_page();second.goto(url);ready(second)
   assertion(r,'New tab restores original IDs and bytes',second.evaluate('() => OutboxVault.queueFingerprint(gate.getQueueRows())')==fp);second.close()
   ctx.close();ctx=launch();page=ctx.pages[0];page.goto(url);ready(page)
   assertion(r,'Browser process restart preserves exact queue bytes and new draft',page.evaluate('() => OutboxVault.queueFingerprint(gate.getQueueRows())')==fp and page.locator('#input').input_value()=='Следующий неотправленный черновик')
   ctx.set_offline(True);fill(page,'Запись без сети');page.locator('#send').click();until(page,'gate.queueSummary().groups===2 && !gate.queueSummary().submit_in_progress')
   assertion(r,'Loaded page can enqueue with browser network offline',not page.evaluate('navigator.onLine') and state(page)['outbox']['groups']==2);ctx.set_offline(False)
   fill(page,'Сбой не должен удалить этот текст');page.locator('#queueBtn').click();page.locator('#queueFail').click();page.locator('#closeQueue').click();page.locator('#send').click();until(page,'gate.queueSummary().commit_failures===1 && !gate.queueSummary().submit_in_progress')
   assertion(r,'Injected enqueue failure leaves text and saved draft intact',page.locator('#input').input_value()=='Сбой не должен удалить этот текст' and page.evaluate('(async()=> (await vault.store.read()).text)()')=='Сбой не должен удалить этот текст' and state(page)['outbox']['groups']==2)
   page.screenshot(path=str(E/(engine+'-injected-error.png')),full_page=True)
   page.locator('#send').click();until(page,'gate.queueSummary().groups===3 && !gate.queueSummary().submit_in_progress')
   assertion(r,'Retry after rejected transaction adds exactly one group',state(page)['outbox']['groups']==3 and not page.locator('#input').input_value())
   fill(page,'Committed before lost UI');oldboot=page.evaluate('vault.bootId');page.evaluate('() => {gate.crashAfterCommit=true;document.getElementById("send").click()}');page.wait_for_timeout(600);ready(page)
   until(page,'vault.bootId!=='+json.dumps(oldboot))
   assertion(r,'Reload after commit before UI clear: outgoing exists once, draft empty',state(page)['outbox']['groups']==4 and page.locator('#input').input_value()=='')
   page.locator('#queueBtn').click();page.on('dialog',lambda d:d.accept());page.get_by_role('button',name='Отменить',exact=True).first.click();until(page,'gate.queueSummary().groups===3');page.locator('#closeQueue').click();page.reload();ready(page)
   assertion(r,'Cancellation survives actual page reload',state(page)['outbox']['groups']==3 and state(page)['outbox']['cancelled']==1 and qid not in [e['client_message_id'] for e in state(page)['outbox']['entries']])
   fill(page,'Line\n'*20);before=page.locator('#input').input_value();page.locator('#expand').click();page.locator('#input').press('End');page.locator('#input').type('more');assertion(r,'Full editor still expands and retains continued typing',page.evaluate('gate.draft.expanded') and before.strip() in page.locator('#input').input_value())
   page.locator('#expand').click();page.locator('#attach').click();page.locator('#outside').click(position={'x':5,'y':5});assertion(r,'Compact menu closes with draft retained',page.locator('#input').input_value().startswith('Line'))
   ctx.set_viewport_size if False else None
   page.set_viewport_size({'width':844,'height':390});page.wait_for_timeout(300);assertion(r,'Simulated narrow height keeps Send accessible',state(page)['controls']['send_inside_shell'])
   page.set_viewport_size({'width':440,'height':766});page.wait_for_timeout(300);page.screenshot(path=str(E/(engine+'-restored.png')),full_page=True)
   assertion(r,'No application upload or JavaScript error recorded',not requests and not errors,{'application_requests':requests,'errors':errors})
   # Fault injection applies only to temporary self-test databases in separate page JS realms.
   negatives=[]
   for fault in ['erase_on_failure','duplicate_on_retry','fake_ack']:
    n=ctx.new_page();n.goto(url);ready(n)
    n.evaluate("""fault=>{const C=OutboxVault.OutboxStore,original=C.prototype.enqueue;C.prototype.enqueue=async function(id,rev){try{const result=await original.call(this,id,rev);if(fault==='duplicate_on_retry'&&result.deduplicated){await this.transaction(['outbox'],'readwrite',tx=>tx.objectStore('outbox').put({...result.item,id:id+'-bad-duplicate'}))}if(fault==='fake_ack'){await this.transaction(['outbox'],'readwrite',tx=>tx.objectStore('outbox').put({...result.item,state:'sent',server_ack:'FAKE'}))}return result}catch(e){if(fault==='erase_on_failure'){const d=await this.read();if(d)await this.write(DraftVault.empty(),d.revision)}throw e}}}""",fault)
    bad=n.evaluate('() => OutboxVault.tests()');negatives.append({'fault':fault,'detected':bad['overall']=='FAIL','failed_checks':[x['name'] for x in bad['results'] if not x['pass']]});n.close()
   assertion(r,'Negative controls detect lost draft, duplicates and fabricated ACK',all(x['detected'] for x in negatives),negatives)
   res['report']=state(page);res['overall']='PASS'
  except Exception as ex:
   res['overall']='FAIL';res['error']=traceback.format_exc()
   if page:
    try:page.screenshot(path=str(E/(engine+'-failure.png')),full_page=True);res['report']=state(page)
    except Exception:pass
  finally:
   if ctx:ctx.close()
   (E/'results.json').write_text(json.dumps(reports,ensure_ascii=False,indent=2))
print(json.dumps([{'engine':x['engine'],'overall':x['overall'],'checks':len(x['results']),'error':x.get('error')} for x in reports],ensure_ascii=False))
assert all(x['overall']=='PASS' for x in reports)
