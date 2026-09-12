"""Read-only binding of public static shell to the inspected checkout."""
from pathlib import Path
import ast, concurrent.futures, hashlib, json, re, subprocess, datetime

ROOT = Path(__file__).resolve().parents[4]
OUT = Path('/tmp/pablicus-audit-20260913/published')
BASE = 'https://matveyryabokon30-crypto.github.io/vision-talk/pablicus/'

def git(*args):
    return subprocess.check_output(['git', '-C', str(ROOT), *args], text=True).strip()

def fetch(rel):
    filename = 'index.html' if rel == './' else rel
    path = OUT / 'pablicus' / filename
    path.parent.mkdir(parents=True, exist_ok=True)
    # Each URL gets a separate temporary response, including ./ and index.html.
    temp = OUT / ('response-' + hashlib.sha256(rel.encode()).hexdigest())
    result = subprocess.run(['curl', '--fail', '--silent', '--show-error', '--location', '--max-time', '35', BASE + ('' if rel == './' else rel), '--output', str(temp)], capture_output=True, text=True)
    if result.returncode:
        return {'path': rel, 'error': result.stderr, 'exit_code': result.returncode}
    raw = temp.read_bytes()
    expected = (ROOT / 'pablicus' / filename).read_bytes()
    path.write_bytes(raw)
    temp.unlink()
    return {'path': rel, 'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest(), 'matches_checkout': raw == expected}

OUT.mkdir(parents=True, exist_ok=True)
worker = (ROOT / 'pablicus/sw.js').read_text()
files = ast.literal_eval(re.search(r'const FILES=(\[.*?\]);', worker).group(1)) + ['sw.js']
with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
    assets = list(pool.map(fetch, files))
build = json.loads(subprocess.check_output(['gh','api','repos/matveyryabokon30-crypto/vision-talk/pages/builds/latest']))
published = build['commit']
runtime = git('diff', '--name-only', published, 'HEAD', '--', 'pablicus').splitlines()
record = {'recorded_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'work_start_head': git('rev-parse','HEAD'), 'pages_build': {k:build.get(k) for k in ['commit','status','created_at','updated_at']}, 'url': BASE, 'assets':assets,'runtime_diff_from_published_commit':runtime,'status':'PASS' if all(x.get('matches_checkout') for x in assets) and not runtime else 'FAIL'}
(Path(__file__).parent/'PUBLISHED_BINDING.json').write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'status':record['status'],'assets':len(assets),'matched':sum(x.get('matches_checkout',False) for x in assets),'published_commit':published,'runtime_diff':runtime}))
