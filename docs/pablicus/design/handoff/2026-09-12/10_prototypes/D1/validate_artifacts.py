from pathlib import Path
import xml.etree.ElementTree as ET,json,hashlib,re,csv
P=Path(__file__).parent
s=(P/'index.html').read_text()
result={'mobile_ids':{},'icon_counts':{},'xml_valid':True,'font_cmap':json.loads((P/'fonts/VALIDATION.json').read_text()),'links_missing':[]}
for t in 'ABC':
 result['mobile_ids'][t]=all(f'id="{t}-{n:02}"' in s for n in range(1,27))
 icons=list((P/'icons'/t).glob('*.svg'));result['icon_counts'][t]=len(icons)
 for p in icons:ET.parse(p)
for link in re.findall(r'(?:src|href)="([^"#]+)"',s):
 if not link.startswith(('http:','https:')) and not (P/link).exists():result['links_missing'].append(link)
result['scenario_rows']=len(list(csv.DictReader((P/'SCENARIO_MATRIX.csv').open())))
result['report_embedded']=(P/'D1_REPORT.md').read_text().replace('&','&amp;').replace('<','&lt;').replace('>','&gt;').replace('"','&quot;').replace("'",'&#x27;') in s
result['copy_button_present']='id="copy"' in s
result['runtime_browser_qa']='Not completed: CUA timeouts; isolated Opera headless also failed to capture. HTTP200 and structural validation only.'
def lum(h):
 rgb=[int(h[i:i+2],16)/255 for i in (1,3,5)];rgb=[x/12.92 if x<=.04045 else ((x+.055)/1.055)**2.4 for x in rgb];return sum(a*b for a,b in zip(rgb,[.2126,.7152,.0722]))
def cr(a,b):x,y=sorted([lum(a),lum(b)]);return round((y+.05)/(x+.05),2)
result['contrast_pairs']={t:{'text_on_base':cr(i,b),'white_on_primary':cr('#ffffff',a)} for t,i,b,a in [('A','#142f29','#eef3f0','#255e4c'),('B','#272b34','#f6f2e9','#304cad'),('C','#172a45','#edf0f5','#2449c8')]}
(P/'VALIDATION.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
manifest={'stage':'D1','revision':'R1','status':'D1_DELIVERED_FOR_OWNER_REVIEW','d0_status':'D0_COMPLETE_READY_FOR_D1','owner_decision':'PENDING_DIRECTION_SELECTION','design_approved':False,'d2_started':False,'source_sha':'d791adc19aade1015f4ba34cf4beb5ce2069c93f','engineering_status_changed':False,'runtime_modified':False,'icons':63,'common_scenario_steps':26,'files':{str(p.relative_to(P)):hashlib.sha256(p.read_bytes()).hexdigest() for p in P.rglob('*') if p.is_file() and p.name!='MANIFEST.json'}}
(P/'MANIFEST.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2))
print(json.dumps(result,ensure_ascii=False,indent=2))
