"""Gate 01.4 live HTTPS tests; synthetic data only; not physical iOS."""
import hashlib, json, pathlib, subprocess, tempfile, time, traceback, urllib.request
from PIL import Image
from playwright.sync_api import sync_playwright

URL='https://fleeting-mesh-8c9pdyg.shipstatic.com/'
OUT=pathlib.Path('evidence/live');OUT.mkdir(parents=True,exist_ok=True)
SRC=OUT/'site';SRC.mkdir(exist_ok=True)
FIX=OUT/'fixtures';FIX.mkdir(exist_ok=True)
Image.new('RGB',(1800,1200),(62,131,102)).save(FIX/'fixture.jpg',quality=86)
(FIX/'fixture.txt').write_text('Original document\n\nТочный текст 🙂\n',encoding='utf-8')
subprocess.run(['ffmpeg','-y','-f','lavfi','-i','color=c=blue:s=320x240:r=12','-t','2','-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart',str(FIX/'fixture.mp4')],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
report={'candidate':URL,'date':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'environment':'GitHub Actions Linux headless native engines; live HTTPS page; NOT physical iOS','source':{},'engines':[]}

def save(): (OUT/'live-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
for name in ['index.html','style.css','vault.js','app.js']:
    data=urllib.request.urlopen(urllib.request.Request(URL+name,headers={'User-Agent':'VisionTalk-Gate014-Evidence'}),timeout=45).read()
    (SRC/name).write_bytes(data)
    report['source'][name]={'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()}
report['source']['committed_vault_matches']=hashlib.sha256(pathlib.Path('gates/gate-01-4-draft/vault.js').read_bytes()).hexdigest()==report['source']['vault.js']['sha256']
save()
assert report['source']['committed_vault_matches'],'Published storage module differs from tested commit'

with sync_playwright() as pw:
  for engine in ['chromium','webkit']:
    rec={'engine':engine,'steps':[],'errors':[],'requests_outside_static':[]};report['engines'].append(rec);save()
    profile=tempfile.mkdtemp(prefix='g014-live-'+engine)
    ctx=None;p=None
    try:
      launch=getattr(pw,engine).launch_persistent_context
      ctx=launch(profile,headless=True,viewport={'width':440,'height':766},has_touch=True,device_scale_factor=1)
      def ready(page):
        page.on('pageerror',lambda e:rec['errors'].append(str(e)))
        page.on('dialog',lambda d:d.accept())
        page.on('request',lambda r:rec['requests_outside_static'].append(r.url) if r.resource_type in ['fetch','xhr','websocket'] else None)
        response=page.goto(URL,wait_until='load',timeout=60000)
        assert response.status==200,response.status
        page.wait_for_function('window.vault && vault.ready && window.gate',timeout=25000)
      def step(name,data=True): rec['steps'].append({'name':name,'pass':True,'measured':data});save();print(engine,name,json.dumps(data,ensure_ascii=False),flush=True)
      p=ctx.new_page();ready(p);rec['version']=ctx.browser.version if ctx.browser else engine
      p.locator('#open').click();p.wait_for_function('gate.list && gate.list.messages.length===300')
      text='Точный черновик: русский 🙂 👨‍👩‍👧‍👦 e\u0301\n\n'+('Абзац сохраняется без сокращения. '+str(1)+'\n')*20+'Конец  '
      p.locator('#input').fill(text)
      p.locator('#galleryInput').set_input_files([str(FIX/'fixture.jpg'),str(FIX/'fixture.mp4')])
      p.locator('#documentInput').set_input_files(str(FIX/'fixture.txt'))
      p.evaluate('gate.previewsSettled')
      p.evaluate('async()=>{gate.draft.expanded=true;gate.syncComposer();const i=document.getElementById("input");i.setSelectionRange(7,19,"forward");vault.changed();await vault.flush()}')
      assert p.evaluate('gate.controlsGeometry().send_inside_shell')
      previews=p.evaluate('[...gate.assets.values()].map(a=>({kind:a.kind,state:a.state,duration:a.duration,preview:!!a.preview}))')
      assert previews[0]['state']=='ready',previews
      assert previews[2]['kind']=='document',previews
      step('original JPEG MP4 TXT selected; no upload',previews)
      puts=p.evaluate('vault.store.stats.blob_puts');reads=p.evaluate('gate.cm.metadata_reads')
      p.evaluate('async()=>{const i=document.getElementById("input");i.value+="После вложений";i.dispatchEvent(new Event("input",{bubbles:true}));i.setSelectionRange(7,19,"forward");vault.changed();await vault.flush()}')
      assert p.evaluate('vault.store.stats.blob_puts')==puts
      assert p.evaluate('gate.cm.metadata_reads')==reads
      step('typing does not rewrite original blobs or reread metadata')
      expected=p.evaluate('DraftVault.fingerprint(gate.captureDraft())')
      assert p.evaluate('vault.verify()')['pass']
      p.screenshot(path=str(OUT/(engine+'-fullscreen-saved.png')))
      p.reload(wait_until='load');p.wait_for_function('vault.ready');p.evaluate('gate.previewsSettled')
      assert p.evaluate('DraftVault.fingerprint(gate.captureDraft())')==expected,'reload mismatch'
      assert p.evaluate('gate.list.messages.length')==300,'restoration sent a message'
      assert p.evaluate('gate.draft.attachments.length')==3
      step('real page reload restores exact text selection full mode and original bytes; no send')
      p.evaluate('gate.toggleExpand()');p.locator('#input').blur();p.wait_for_timeout(550);p.evaluate('vault.changed(); vault.flush()')
      assert p.locator('#reloadSaved').is_visible()
      with p.expect_navigation(wait_until='load',timeout=30000): p.locator('#reloadSaved').click()
      p.wait_for_function('vault.ready && vault.reloadCheck',timeout=25000)
      assert p.evaluate('vault.reloadCheck.pass'),p.evaluate('vault.public()')
      step('Save and Reload button performs real navigation and passes fingerprint checkpoint',p.evaluate('vault.reloadCheck'))
      p.evaluate('gate.previewsSettled');p.screenshot(path=str(OUT/(engine+'-restored.png')))
      expected=p.evaluate('DraftVault.fingerprint(gate.captureDraft())');p.close();p=ctx.new_page();ready(p);p.evaluate('gate.previewsSettled')
      assert p.evaluate('DraftVault.fingerprint(gate.captureDraft())')==expected
      step('closing and opening new tab on same live origin restores originals')
      ctx.close();ctx=launch(profile,headless=True,viewport={'width':440,'height':766},has_touch=True);p=ctx.new_page();ready(p)
      assert p.evaluate('DraftVault.fingerprint(gate.captureDraft())')==expected
      step('real browser process restart restores exact live-origin draft')
      p.evaluate('gate.previewsSettled');p.locator('#tray .remove').nth(1).click();p.evaluate('vault.flush()');p.reload(wait_until='load');p.wait_for_function('vault.ready');p.evaluate('gate.previewsSettled')
      assert p.evaluate('gate.draft.attachments.length')==2
      assert not p.evaluate('[...gate.assets.values()].some(a=>a.kind==="video")')
      step('removed video remains removed after actual reload')
      before=p.locator('#input').input_value()
      p.evaluate('async()=>{await vault.flush();vault.store.fault="quota";vault.pending={snapshot:gate.captureDraft()};try{await vault.flush()}catch{}}')
      assert p.evaluate('vault.state')=='error'
      assert p.locator('#input').input_value()==before
      assert p.locator('#saveRetry').is_visible()
      p.locator('#saveRetry').click();p.wait_for_function('vault.state==="saved"')
      step('injected quota failure visible, draft retained, retry saves')
      p.locator('#input').blur();p.wait_for_timeout(550)
      p.locator('#attach').click();assert p.locator('#pop').is_visible();p.screenshot(path=str(OUT/(engine+'-restored-menu.png')));p.locator('#attach').click()
      assert p.locator('#input').input_value()==before
      step('compact menu retains recovered draft')
      p.evaluate('gate.list.go(130)');anchor=p.evaluate('gate.list.capture(false)')
      p.evaluate('async()=>{vault.changed();await vault.flush()}')
      assert p.evaluate('gate.list.capture(false)')==anchor
      step('saving without layout change preserves reading anchor')
      p.evaluate('gate.toggleExpand()');p.set_viewport_size({'width':440,'height':428});p.wait_for_timeout(300)
      geometry=p.evaluate('gate.controlsGeometry()');assert geometry['send_inside_shell'] and geometry['composer_height']>=426,geometry
      p.set_viewport_size({'width':844,'height':390});p.wait_for_timeout(300);assert p.evaluate('gate.controlsGeometry().send_inside_shell')
      p.set_viewport_size({'width':440,'height':766});p.wait_for_timeout(300);p.evaluate('gate.toggleExpand()')
      step('full editor with saved draft survives simulated height and width changes; not real keyboard')
      auto=p.evaluate('gate.run()');assert auto['overall']=='PASS',auto
      step('non-destructive public storage autotest',auto['summary'])
      p.evaluate('gate.clearDraft();vault.flush()');p.reload(wait_until='load');p.wait_for_function('vault.ready')
      assert p.locator('#input').input_value()=='' and p.evaluate('gate.draft.attachments.length')==0
      assert p.evaluate('vault.store.counts()')['assets']==0
      step('clear remains empty after actual reload; no unused stored blobs')
      assert not rec['requests_outside_static'],rec['requests_outside_static']
      assert not rec['errors'],rec['errors']
      step('no application HTTP upload/fetch and no JavaScript errors')
      rec['final_report']=p.evaluate('gate.report()');rec['overall']='PASS'
    except Exception as e:
      rec['overall']='FAIL';rec['failure']=str(e);rec['traceback']=traceback.format_exc()
      if p:
        try:p.screenshot(path=str(OUT/(engine+'-failure.png')));rec['failure_report']=p.evaluate('gate.report()')
        except:pass
      print(rec['traceback'],flush=True)
    finally:
      if ctx:ctx.close()
      save()
assert all(e['overall']=='PASS' for e in report['engines']),json.dumps(report,ensure_ascii=False)
print('LIVE_UI_PROOF_PASS',json.dumps({e['engine']:len(e['steps']) for e in report['engines']}),flush=True)
