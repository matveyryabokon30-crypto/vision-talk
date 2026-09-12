"""Structural ownership/contract checks, paired with real browser shell_probe.
Source inspection proves registration boundaries; it does not prove usability.
"""
import argparse, hashlib, json, re, subprocess
from html.parser import HTMLParser
from pathlib import Path

class Entry(HTMLParser):
 def __init__(self):super().__init__();self.scripts=[];self.styles=[]
 def handle_starttag(self,tag,attrs):
  a=dict(attrs)
  if tag=='script' and a.get('src'):self.scripts.append(a['src'])
  if tag=='link' and a.get('rel')=='stylesheet':self.styles.append(a['href'])

def main(args):
 root=args.source_root.resolve();ui=root/'pablicus';entry=Entry();entry.feed((ui/'index.html').read_text())
 active=set(entry.scripts+entry.styles)
 # Follow only explicit local script/css helper calls and dynamic script src.
 pending=list(entry.scripts)
 while pending:
  name=pending.pop()
  if name.startswith('vendor/'):continue
  text=(ui/name).read_text()
  for child in re.findall(r"(?:\bscript\(|\bcss\(|\.src\s*=\s*)['\"]([^'\"]+\.(?:js|css))['\"]",text):
   if child not in active:active.add(child);pending.extend([child] if child.endswith('.js') else [])
 scripts={name:(ui/name).read_text() for name in active if name.endswith('.js') and not name.startswith('vendor/')}
 styles={name:(ui/name).read_text() for name in active if name.endswith('.css')}
 checks=[]
 def check(id,name,ok,actual):checks.append({'id':id,'name':name,'status':'PASS' if ok else 'FAIL','actual':actual})
 exports=[name for name,text in scripts.items() if re.search(r'\b(?:root|window)\.PablicusController\s*=',text)]
 check('2A-T01','One route state/controller export',exports==['app-controller.js'],exports)
 heading=[name for name,text in scripts.items() if re.search('brandTitle|sectionTitle',text) and 'textContent' in text]
 outer=[name for name,text in scripts.items() if re.search(r"app\.style\.(?:transform|width|height)\s*=",text)]
 css_owners=sorted(name for name,text in styles.items() if re.search(r'#app\s*>\s*header|\.homeHeader|#mainNav|#(?:chatBack|chatTitle|chatHint|chatLibraryOpen|reportBtn|queueBtn)\b|\.chatHeading',text))
 check('2A-T02','One shared heading and outer geometry writer',heading==['app-shell.js'] and outer==['app-shell.js'] and css_owners==['shell.css'],{'headings':heading,'outer_geometry':outer,'shared_shell_styles':css_owners})
 dispatch=[name for name,text in scripts.items() if '#mainNav button' in text and 'b.onclick=' in text]
 forbidden=[name for name,text in scripts.items() if name not in ['app.js','app-shell.js'] and ('botButton.onclick=' in text or "nav.insertBefore(" in text)]
 check('2A-T03','One root click binding, no legacy root insertion',dispatch==['app.js'] and not forbidden,{'dispatch':dispatch,'legacy':forbidden})
 observers=sorted(name for name,text in scripts.items() if 'MutationObserver' in text)
 allowed={'rich-message.js':'detached-media disposal only','inbox-monitor.js':'own notification positioning only'}
 check('2A-T04','No loaded permanent shell-correction MutationObserver',set(observers)<=set(allowed),{'observed':observers,'qualified_boundaries':allowed})
 root_styles=sorted(name for name,text in styles.items() if ':root' in text)
 check('2A-T05','One global token source',root_styles==['design-tokens.css'],root_styles)
 registry=None
 if (ui/'component-registry.js').exists():
  js="const fs=require('fs'),vm=require('vm');const ctx={};ctx.window=ctx;const source=fs.readFileSync(process.argv[1],'utf8');vm.runInNewContext(source,ctx);let duplicate=false,unknown=false;try{vm.runInNewContext(source,ctx)}catch(e){duplicate=e.message==='DUPLICATE_COMPONENT_REGISTRY'}try{ctx.PablicusUI.get('Unknown')}catch(e){unknown=e.message.startsWith('UNKNOWN_COMPONENT')}console.log(JSON.stringify({registry:ctx.PablicusUI,frozen:Object.isFrozen(ctx.PablicusUI)&&Object.values(ctx.PablicusUI.components).every(Object.isFrozen),duplicate,unknown}));"
  proc=subprocess.run(['node','-e',js,str(ui/'component-registry.js')],capture_output=True,text=True,timeout=10)
  if proc.returncode==0:registry=json.loads(proc.stdout)
 expected=['AppShell','TopBar','BottomNavigation','Tab/SegmentedControl','Button','IconButton','Input','Composer','SearchField','List','ListItem','Avatar','Badge','Chip','Card','Modal','Sheet','Toast','EmptyState','LoadingState','ErrorState','Menu','ContextMenu','AgentTaskCard','PrivateAgentResult','ActionConfirmation','WorkObjectPreview','SidePanel','FullScreenObjectView']
 check('2A-T06','Registry evaluated, unique, frozen and complete',bool(registry and registry['frozen'] and registry['duplicate'] and registry['unknown'] and set(registry['registry']['components'])==set(expected)),registry)
 r=(registry or {}).get('registry',{})
 check('2A-T09','One semantic registry for all responsive surfaces',entry.scripts.count('component-registry.js')==1 and entry.scripts.count('app-shell.js')==1 and not any(re.search(r'(mobile|desktop).*shell',s) for s in entry.scripts),{'entrypoint':entry.scripts,'physical_layout_proof':'Separate browser variants required'})
 extensions=['text','attachments','richBlocks','commands','aiInlineActions','mentions','agentInvocation','taskCreation','workObjectLinking']
 c=r.get('composer',{})
 check('2A-T10','Existing composer with declared extension slots; no v2 engine',c.get('extensionPoints')==extensions and c.get('messageDocV2Implemented') is False and c.get('agentExecutionImplemented') is False and c.get('implementation')=='PablicusRichComposer.create',c)
 ia=r.get('informationArchitecture',{});roots=[x['id'] for x in r.get('roots',[])]
 check('2A-T11','Amendment 02 IA fits approved roots',roots==['chats','tasks','profile'] and all(k in ia for k in ['Spaces','Threads','Search','Saved','AIComposer','PublicIdentity']) and all(v.get('root') in roots for v in ia.values()),ia)
 calls=r.get('calls',{});new_runtime='\n'.join(scripts.get(name,'') for name in ['component-registry.js','app-shell.js'])
 check('2A-T12','Calls slots without call implementation',calls.get('implemented') is False and set(calls.get('slots',[]))=={'audioCallAction','videoCallAction','activeCallSurface','screenShareState','voiceLiveEntry'} and not re.search(r'RTCPeerConnection|new WebSocket|getUserMedia\(',new_runtime),calls)
 result={'status':'PASS' if all(c['status']=='PASS' for c in checks) else 'FAIL','checks':checks,'active_paths':sorted(active),
  'sources':{name:hashlib.sha256((ui/name).read_bytes()).hexdigest() for name in sorted(active)},
  'scope':'Structural contracts only. T07/T08 and dispatch/visibility behavior require shell_probe; T13 requires accepted regression execution.'}
 args.output.parent.mkdir(parents=True,exist_ok=True);args.output.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
 print(json.dumps([(c['id'],c['status']) for c in checks]));return 0 if result['status']=='PASS' else 1
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--source-root',type=Path,required=True);p.add_argument('--output',type=Path,required=True);raise SystemExit(main(p.parse_args()))
