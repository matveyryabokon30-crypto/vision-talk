"""Raster-only exports. Never redraw the approved Pablicus mark.
WebP transport derivatives preserve source crop and aspect ratio. Original
handoff hashes are recorded below; these are not newly invented logos.
"""
from pathlib import Path
import hashlib,json
from PIL import Image
R=Path(__file__).resolve().parent
S=R/'web-asset-source';O=R/'assets';O.mkdir(exist_ok=True)
icon=Image.open(S/'icon.webp').convert('RGB')
assert icon.width==icon.height
for n in (32,180,192,512):icon.resize((n,n),Image.Resampling.LANCZOS).save(O/f'icon-{n}.png',optimize=True)
for theme in ('light','dark'):
 im=Image.open(S/f'wordmark-{theme}.webp').convert('RGB')
 im.save(O/f'wordmark-{theme}.png',optimize=True)
manifest={'original_icon_sha256':'82d462b1c7f95b255501c1b0393c253bfe3af1dc88b404a5ade367e52a1f8713','original_wordmark_sha256':'908faa4f67adb8b811f3c0bcbd2ea58e2b7b142ab3c4b1cfac48d2a1e54eafc9','process':'Raster-only resizing, preserved aspect ratio. WebP intermediates; no vector tracing or new symbol.','exports':[]}
for p in sorted(O.glob('*.png')):
 im=Image.open(p);manifest['exports'].append({'path':p.name,'dimensions':list(im.size),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()})
(O/'PROVENANCE.json').write_text(json.dumps(manifest,indent=2))
print('Pablicus PNG exports generated')
