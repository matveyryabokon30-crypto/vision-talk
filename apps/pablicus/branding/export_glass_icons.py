"""Re-export the owner-selected glass artwork, without redrawing it.

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
    (assets / 'PROVENANCE.json').write_text(json.dumps(provenance, indent=2) + '\n')

if __name__ == '__main__':
    export()
