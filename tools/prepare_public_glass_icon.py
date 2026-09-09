"""Prepare an icon-only patch against the verified Pablicus source snapshot."""
from pathlib import Path
import argparse, hashlib, subprocess, sys

EXPORTER = '''"""Re-export the owner-selected glass artwork, without redrawing it.

The 512px runtime master was derived from the approved 1254px image by
cropping only its presentation margin, Lanczos resizing and WebP quality=100.
The approved original remains identified by its SHA-256 in PROVENANCE.json.
Run with Pillow 11.3.0 for byte-reproducible PNG exports.
"""
from pathlib import Path
import hashlib, json
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
MASTER = ROOT / 'branding/glass-icon-master.webp'
MASTER_SHA = '3d1138fc4d4dff99cbdb31674f9a4ba9e54f562474ec947db284b1b660d10419'
REVISION = 'glass-20260909'
SIZES = (32, 180, 192, 512)
WORDMARKS = {
    'wordmark-dark.png': 'fd04f676a7cbfecb2b8aef1b3da0aeb05715e48184a302f9d93000381ea5a212',
    'wordmark-light.png': 'b2b4356783dcf2f67c39673d0905ae96cc8f4f7db1e022aea4d3b51724276368',
}

def export():
    assert hashlib.sha256(MASTER.read_bytes()).hexdigest() == MASTER_SHA
    assets = ROOT / 'assets'
    for name, expected in WORDMARKS.items():
        assert hashlib.sha256((assets / name).read_bytes()).hexdigest() == expected, name
    with Image.open(MASTER) as raw:
        assert raw.size == (512, 512)
        master = raw.convert('RGB')
    exports = []
    for size in SIZES:
        image = master.resize((size, size), Image.Resampling.LANCZOS)
        versioned = assets / f'icon-{REVISION}-{size}.png'
        image.save(versioned, format='PNG', optimize=True)
        legacy = assets / f'icon-{size}.png'
        legacy.write_bytes(versioned.read_bytes())
        for path in (versioned, legacy):
            exports.append({'path': path.name, 'size': [size, size],
                            'sha256': hashlib.sha256(path.read_bytes()).hexdigest()})
    provenance = {
        'decision': 'Owner-selected glass speech-bubble icon, 2026-09-09',
        'icon_revision': REVISION,
        'original_icon_sha256': 'e410d1c9077a66a33f68b4bb5efbd5d11dea041819607b4991e7057788c81207',
        'original_dimensions': [1254, 1254],
        'presentation_margin_crop_xyxy': [181, 166, 1073, 1058],
        'runtime_master': {'path': '../branding/glass-icon-master.webp',
                           'size': [512, 512], 'sha256': MASTER_SHA,
                           'encoding': 'WebP quality=100, method=6; not a lossless original'},
        'process': 'Approved raster artwork only. Presentation margin cropped, aspect ratio preserved, Lanczos resizing. No redrawing, new symbol, text, recolouring or generated glass effect.',
        'exports': exports,
        'original_wordmark_sha256': '908faa4f67adb8b811f3c0bcbd2ea58e2b7b142ab3c4b1cfac48d2a1e54eafc9',
        'wordmarks_preserved_byte_for_byte': WORDMARKS,
        'compatibility': 'Versioned icon URLs for new shell and manifest; previous filenames contain identical new PNG bytes. PWA id, name, start_url, scope, backend and user storage unchanged.'
    }
    (assets / 'PROVENANCE.json').write_text(json.dumps(provenance, indent=2) + '\\n')

if __name__ == '__main__':
    export()
'''

TEST = '''"""Icon provenance and built-PWA integration checks; no live user data access."""
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
output.write_text(json.dumps({'status':'PASS', 'checks': checks, 'count':len(checks), 'asset_revision':v['asset_revision'], 'limitations':'Automated file and PWA integration checks; not a physical iPhone home-screen refresh confirmation.'}, indent=2) + '\\n')
print(f'Glass icon integrity: {len(checks)} checks PASS')
'''

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--source',type=Path,required=True);parser.add_argument('--master',type=Path,required=True);args=parser.parse_args()
    root=args.source/'apps/pablicus'; brand=root/'branding';brand.mkdir(exist_ok=True)
    data=args.master.read_bytes();assert hashlib.sha256(data).hexdigest()=='3d1138fc4d4dff99cbdb31674f9a4ba9e54f562474ec947db284b1b660d10419'
    (brand/'glass-icon-master.webp').write_bytes(data)
    (brand/'export_glass_icons.py').write_text(EXPORTER)
    (root/'tests/glass_icon_integrity.py').write_text(TEST)
    subprocess.run([sys.executable,str(brand/'export_glass_icons.py')],check=True)
    for rel in ['build.py','src/access.html','src/manifest.webmanifest']:
        path=root/rel;text=path.read_text();old=text
        for size in (32,180,192,512):text=text.replace(f'assets/icon-{size}.png',f'assets/icon-glass-20260909-{size}.png')
        assert text != old, f'No expected icon references in {rel}'
        path.write_text(text)
    path=root/'src/sw.js';text=path.read_text()
    needle="'assets/wordmark-light.png'";assert text.count(needle)==1
    additions=','.join(f"'assets/icon-glass-20260909-{s}.png'" for s in (32,180,192,512))
    text=text.replace(needle,additions+','+needle)
    needle="new URL('assets/icon-192.png',self.registration.scope)";assert text.count(needle)==1
    text=text.replace(needle,"new URL('assets/icon-glass-20260909-192.png',self.registration.scope)")
    path.write_text(text)
    path=root/'finalize.py';text=path.read_text();assert 'glass_icon_integrity' not in text
    path.write_text(text+"\n# Keep approved icon provenance and platform links inside the existing release gate.\nimport sys\nsubprocess.run([sys.executable,str(R/'tests/glass_icon_integrity.py')],check=True)\n")
    print('Prepared icon-only source patch; no application, backend, account or data-store logic changed')

if __name__=='__main__':main()
