from pathlib import Path
from html.parser import HTMLParser
from urllib.parse import urlsplit
import hashlib,json,subprocess
R=Path(__file__).resolve().parent;D=R/'dist'
# The accepted Gate owns its list for its entire lifetime. The product has
# multiple screens: disconnect that list BEFORE the host hides its container.
p=D/'chat.js';s=p.read_text()
old='async leave(){await this.flush();input.blur();closeMenu(false);},'
new='async leave(){await this.flush();input.blur();closeMenu(false);list?.destroy();list=null;},'
assert s.count(old)==1,'Chat lifecycle bridge changed; review required'
p.write_text(s.replace(old,new))
class References(HTMLParser):
 def __init__(self):super().__init__();self.refs=[]
 def handle_starttag(self,tag,attrs):
  a=dict(attrs)
  if tag in ('script','link'):self.refs.append(a.get('src') or a.get('href'))
p=References();p.feed((D/'index.html').read_text())
for ref in filter(None,p.refs):
 if not urlsplit(ref).scheme:assert (D/ref).is_file(),f'Missing required asset: {ref}'
for n in (180,192,512):
 from PIL import Image
 assert Image.open(D/f'assets/icon-{n}.png').size==(n,n)
manifest=json.loads((D/'manifest.webmanifest').read_text())
assert manifest['id']=='./' and manifest['scope']=='./' and manifest['display']=='standalone'
sha=hashlib.sha256()
for f in sorted(D.rglob('*')):
 if f.is_file() and f.name not in ('sw.js','version.json','ASSET_MANIFEST.json'):sha.update(str(f.relative_to(D)).encode()+f.read_bytes())
rev=sha.hexdigest()[:16]
sw=(D/'sw.js').read_text().replace('__ASSET_REVISION__',rev);(D/'sw.js').write_text(sw)
try:commit=subprocess.check_output(['git','rev-parse','HEAD'],cwd=R,text=True).strip()
except subprocess.CalledProcessError:commit='local-uncommitted'
(D/'version.json').write_text(json.dumps({'product':'Pablicus','version':json.loads((D/'version.json').read_text())['version'],'commit':commit,'asset_revision':rev,'stage':'CANDIDATE_PENDING_LIVE_TWO_ACCOUNT_AND_DEVICE_ACCEPTANCE'},indent=2))
(D/'ASSET_MANIFEST.json').write_text(json.dumps({str(f.relative_to(D)):hashlib.sha256(f.read_bytes()).hexdigest() for f in sorted(D.rglob('*')) if f.is_file() and f.name!='ASSET_MANIFEST.json'},indent=2))
print('PWA artifact complete; asset revision',rev,'commit',commit)

# Keep approved icon provenance and platform links inside the existing release gate.
import sys
subprocess.run([sys.executable,str(R/'tests/glass_icon_integrity.py')],check=True)
