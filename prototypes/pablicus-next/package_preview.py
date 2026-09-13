"""Build an explicit static preview payload; never include the repository tree."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PUBLIC_FILES = (
    'prototypes/pablicus-next/index.html',
    'prototypes/pablicus-next/app.js',
    'prototypes/pablicus-next/shell.css',
    'library/pablicus-ui/edge-picker.js',
    'library/pablicus-ui/notch-geometry.js',
    'library/pablicus-ui/foundation.css',
    'vendor/upstream/figma-sds/src/theme.css',
    'library/pablicus-ui/THIRD_PARTY_NOTICES.md',
    'vendor/upstream/figma-sds/LICENSE',
    'vendor/upstream/codenotch/LICENSE',
)


def package():
    files = []
    for path in PUBLIC_FILES:
        content = (ROOT / path).read_text()
        if path.endswith('/index.html'):
            # Hosts may remove a trailing slash from directory URLs. Absolute
            # HTML asset URLs also let this same document work at the site root.
            content = content.replace('href="./shell.css"', 'href="/prototypes/pablicus-next/shell.css"')
            content = content.replace('src="./app.js"', 'src="/prototypes/pablicus-next/app.js"')
            content = content.replace('href="../../library/', 'href="/library/')
            files.append({'path': 'index.html', 'content': content})
        files.append({'path': path, 'content': content})
    return {'files': files, 'labels': ['pablicus', 'prototype']}


if __name__ == '__main__':
    print(json.dumps(package(), ensure_ascii=False))
