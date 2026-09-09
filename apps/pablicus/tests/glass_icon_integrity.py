"""Icon provenance and built-PWA integration checks; no live user data access."""
from pathlib import Path
from html.parser import HTMLParser
import hashlib, json
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / 'dist'
REV = 'glass-20260909'
checks = []

def check(name, condition):
    if not condition:
        raise AssertionError(name)
    checks.append(name)

class Links(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links = {}
    def handle_starttag(self, tag, attrs):
        if tag == 'link':
            a = dict(attrs)
            self.links[a.get('rel')] = a.get('href')

p = json.loads((DIST / 'assets/PROVENANCE.json').read_text())
check('approved source identity', p['original_icon_sha256'] == 'e410d1c9077a66a33f68b4bb5efbd5d11dea041819607b4991e7057788c81207')
master_path = ROOT / 'branding/glass-icon-master.webp'
check('runtime master identity', hashlib.sha256(master_path.read_bytes()).hexdigest() == p['runtime_master']['sha256'])
master = Image.open(master_path).convert('RGB')
for size in (32, 180, 192, 512):
    name = f'assets/icon-{REV}-{size}.png'
    target = DIST / name
    with Image.open(target) as im:
        check(f'{size}: opaque RGB PNG and dimensions', im.format == 'PNG' and im.mode == 'RGB' and im.size == (size, size))
        check(f'{size}: same artwork, resize only', im.tobytes() == master.resize((size, size), Image.Resampling.LANCZOS).tobytes())
    check(f'{size}: legacy alias', target.read_bytes() == (DIST / f'assets/icon-{size}.png').read_bytes())
for item in p['exports']:
    check('export checksum ' + item['path'], hashlib.sha256((DIST / 'assets' / item['path']).read_bytes()).hexdigest() == item['sha256'])
for name, expected in p['wordmarks_preserved_byte_for_byte'].items():
    check('unchanged wordmark ' + name, hashlib.sha256((DIST / 'assets' / name).read_bytes()).hexdigest() == expected)
m = json.loads((DIST / 'manifest.webmanifest').read_text())
check('existing app identity and scope', all(m[k] == v for k, v in {'id':'./', 'name':'Pablicus', 'short_name':'Pablicus', 'start_url':'./', 'scope':'./', 'display':'standalone'}.items()))
check('manifest uses new icon URLs', [i['src'] for i in m['icons']] == [f'assets/icon-{REV}-192.png', f'assets/icon-{REV}-512.png'])
links = Links(); links.feed((DIST / 'index.html').read_text())
check('iPhone apple-touch-icon', links.links.get('apple-touch-icon') == f'assets/icon-{REV}-180.png')
check('browser favicon', links.links.get('icon') == f'assets/icon-{REV}-32.png')
access = Links(); access.feed((DIST / 'access.html').read_text())
check('password page favicon', access.links.get('icon') == f'assets/icon-{REV}-32.png')
sw = (DIST / 'sw.js').read_text()
for size in (32, 180, 192, 512):
    check(f'offline shell caches versioned icon {size}', f"'assets/icon-{REV}-{size}.png'" in sw)
check('notification icon uses new artwork', f"new URL('assets/icon-{REV}-192.png',self.registration.scope)" in sw)
v = json.loads((DIST / 'version.json').read_text())
check('new shell revision substituted', '__ASSET_REVISION__' not in sw and v['asset_revision'] in sw)
manifest = json.loads((DIST / 'ASSET_MANIFEST.json').read_text())
check('complete built bytes match published manifest', all(hashlib.sha256((DIST / name).read_bytes()).hexdigest() == sha for name, sha in manifest.items()))
output = ROOT / 'evidence/glass-icon-integrity.json'
output.parent.mkdir(exist_ok=True)
output.write_text(json.dumps({'status':'PASS', 'checks': checks, 'count':len(checks), 'asset_revision':v['asset_revision'], 'limitations':'Automated file and PWA integration checks; not a physical iPhone home-screen refresh confirmation.'}, indent=2) + '\n')
print(f'Glass icon integrity: {len(checks)} checks PASS')
