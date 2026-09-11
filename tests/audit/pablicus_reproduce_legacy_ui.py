"""Offline audit of the exact GitHub Pages artifact; no production writes/auth."""
from pathlib import Path
import json, re, hashlib, argparse, shutil
from playwright.sync_api import sync_playwright
from bs4 import BeautifulSoup
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--source-root',type=Path,default=Path.cwd())
parser.add_argument('--output-dir',type=Path,default=Path('audit-output'))
parser.add_argument('--browser',default=shutil.which('chromium'))
args=parser.parse_args()
SITE=args.source_root.resolve()/'pablicus'
if not (SITE/'index.html').is_file():parser.error('--source-root must contain pablicus/index.html')
OUT=args.output_dir.resolve();OUT.mkdir(parents=True,exist_ok=True)
FIXTURE='''<!doctype html><html><body>
<div id="home"><header class="homeHeader"><span id="brandTitle">Чаты</span></header>
<section id="loginPane" hidden></section><section id="workspace"><div class="workspaceTop"><h1 id="sectionTitle">Чаты</h1><input id="searchChats"><div id="chatFilters"></div><button id="newChat"></button></div><div id="screenContent">
<section class="chatCard"><button class="chatMain"><span class="chatText"><strong>Alpha</strong><span class="previewText">Hello</span></span></button><button class="focusBtn">☆</button></section>
<section class="chatCard"><button class="chatMain"><span class="chatText"><strong>Beta</strong><span class="previewText">Hello</span></span></button><button class="focusBtn">★</button></section>
<section class="chatCard"><button class="chatMain"><span class="chatText"><strong>Gamma</strong><span class="previewText">Hello</span></span></button><button class="focusBtn">☆</button></section>
</div></section><nav id="mainNav"><button data-page="chats" class="selected">Чаты</button><button data-page="profile">Профиль</button></nav></div>
<div id="app"><header><div class="chatHeading"><button id="chatTitle">Example</button></div></header>
<button id="conversationTab" aria-selected="true">Разговор</button><button id="canvasTab" aria-selected="false">Полотно</button>
<section id="chatCanvasPanel"><button class="pccProjectCard">Project</button><div class="pccProjectView" hidden>Read-only</div><div class="pccPlanEditor" hidden><textarea></textarea></div><button class="pccPlanEdit">Edit</button></section>
<footer id="composer"><textarea id="input"></textarea></footer></div><div id="toast" hidden></div></body></html>'''
INSTRUMENT='''() => {
 const Native=window.MutationObserver;window.auditMetrics={callbacks:0,records:0,childList:0,attributes:0};
 window.MutationObserver=class extends Native {constructor(callback){super((records,obs)=>{auditMetrics.callbacks++;auditMetrics.records+=records.length;for(const r of records){if(r.type==='childList')auditMetrics.childList++;if(r.type==='attributes')auditMetrics.attributes++;}callback(records,obs)});}};
 window.projectEvents={read:0,edit:0};
 document.querySelector('.pccProjectCard').onclick=()=>{projectEvents.read++;document.querySelector('.pccProjectView').hidden=false};
 document.querySelector('.pccPlanEdit').onclick=()=>{projectEvents.edit++;document.querySelector('.pccPlanEditor').hidden=false};
}'''
results={'reference_baseline':'GitHub Pages artifact 10179479816, commit f348aceacc3acdb315387a4066f6f495ce269b54','environment':'Offline Chromium; synthetic DOM/data; not authenticated production E2E or physical iPhone','input_sha256':{f:hashlib.sha256((SITE/f).read_bytes()).hexdigest() for f in ['index.html','ux-refinement.js','public-hotfix-v8.js','creation-flows.js']},'tests':[]}
with sync_playwright() as p:
 b=p.chromium.launch(executable_path=args.browser,headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
 for name,scripts in [('baseline',[]),('ux_only',['ux-refinement.js']),('hotfix_only',['public-hotfix-v8.js']),('combined',['ux-refinement.js','public-hotfix-v8.js','creation-flows.js']),('combined_hidden_chats',['ux-refinement.js','public-hotfix-v8.js','creation-flows.js']),('combined_empty_chats',['ux-refinement.js','public-hotfix-v8.js','creation-flows.js'])]:
  ctx=b.new_context();ctx.route('**/*',lambda route:route.abort());page=ctx.new_page()
  page.set_content(FIXTURE);page.evaluate(INSTRUMENT)
  if name=='combined_hidden_chats':page.evaluate("document.getElementById('home').hidden=true;document.getElementById('canvasTab').setAttribute('aria-selected','true');document.getElementById('conversationTab').setAttribute('aria-selected','false');document.getElementById('app').classList.add('canvas-active')")
  if name=='combined_empty_chats':page.evaluate("document.getElementById('screenContent').replaceChildren()")
  for script in scripts:page.add_script_tag(path=str(SITE/script))
  page.wait_for_timeout(400);before=page.evaluate('({...auditMetrics})');page.wait_for_timeout(1000);after=page.evaluate('({...auditMetrics})')
  delta={k:after[k]-before[k] for k in before}
  page.locator('.pccProjectCard').click(timeout=3000);page.wait_for_timeout(80)
  events=page.evaluate('({...projectEvents})')
  results['tests'].append({'name':name,'scripts':scripts,'idle_window_ms':1000,'idle_delta':delta,'single_project_click':events,'idle_gate_pass':delta['records']==0,'read_only_click_gate_pass':events=={'read':1,'edit':0}})
  ctx.close()
 # Render production HTML and exact stylesheet order WITHOUT JS/network/auth.
 soup=BeautifulSoup((SITE/'index.html').read_text(),'html.parser')
 for script in soup.find_all('script'):script.decompose()
 for link in soup.find_all('link'):
  if 'stylesheet' in link.get('rel',[]):
   style=soup.new_tag('style');style.string=(SITE/link['href']).read_text();link.replace_with(style)
  else:link.decompose()
 for f in ['public-ui-foundation.css','creation-flows.css','public-hotfix-v8.css','bot-factory.css']:
  style=soup.new_tag('style');style.string=(SITE/f).read_text();soup.head.append(style)
 soup.find(id='home')['hidden']='';soup.find(id='app').attrs.pop('hidden',None)
 soup.find(id='chatTitle').string='@mot'
 avatar=soup.new_tag('span',attrs={'class':'publicChatAvatar'});avatar.string='M';soup.select_one('.chatHeading').insert(0,avatar)
 for width,height in [(390,844),(815,890),(1440,900)]:
  page=b.new_page(viewport={'width':width,'height':height});page.route('**/*',lambda route:route.abort());page.set_content(str(soup));page.wait_for_timeout(80)
  details=page.evaluate('''() => Object.fromEntries(['#app>header','.chatHeading','#chatTitle','#chatLibraryOpen','#reportBtn'].map(s=>{const e=document.querySelector(s),r=e.getBoundingClientRect(),c=getComputedStyle(e);return [s,{x:r.x,y:r.y,w:r.width,h:r.height,gridColumn:c.gridColumn,position:c.position,display:c.display,flexDirection:c.flexDirection}]}))''')
  details['center_error_px']=round(abs(details['.chatHeading']['x']+details['.chatHeading']['w']/2 - (details['#app>header']['x']+details['#app>header']['w']/2)),2)
  results['tests'].append({'name':'header_geometry','viewport':[width,height],'geometry':details,'center_gate_pass':details['center_error_px']<=2})
  page.screenshot(path=str(OUT/f'header_{width}_baseline.png'))
  page.evaluate('''() => {for(const sheet of document.styleSheets)for(const rule of sheet.cssRules){if(rule.selectorText?.includes('.chatHeading')){rule.style.removeProperty('grid-column');rule.style.removeProperty('grid-row');rule.style.removeProperty('flex-direction');}}}''')
  corrected=page.evaluate('''() => {const h=document.querySelector('#app>header').getBoundingClientRect(),n=document.querySelector('.chatHeading').getBoundingClientRect(),t=document.querySelector('#chatTitle').getBoundingClientRect();return {center_error_px:Math.abs(n.x+n.width/2-h.x-h.width/2),title_height:t.height}}''')
  results['tests'].append({'name':'header_causal_isolation','viewport':[width,height],'diagnostic_only':'Remove inherited grid-column/grid-row/flex-direction declarations from existing .chatHeading rules in local CSSOM. Not a shipped repair.', 'result':corrected})
  page.screenshot(path=str(OUT/f'header_{width}_isolated.png'));page.close()
 b.close()
(OUT/'regression_results.json').write_text(json.dumps(results,indent=2,ensure_ascii=False))
print(json.dumps(results,indent=2,ensure_ascii=False))
