"""Run mock-backend tests only in a disposable copy, never the release dist.

A green test must not package its mock SDK as the application SDK. Verify the
release against ASSET_MANIFEST before AND after testing; preserve evidence.
"""
from pathlib import Path
import hashlib, json, shutil, subprocess, sys, tempfile

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / 'dist'
EVIDENCE = ROOT / 'evidence'

def verify_dist():
    expected = json.loads((DIST / 'ASSET_MANIFEST.json').read_text())
    actual = {p.relative_to(DIST).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
              for p in DIST.rglob('*') if p.is_file() and p.name != 'ASSET_MANIFEST.json'}
    if actual != expected:
        raise RuntimeError('Release artifact does not match its asset manifest')
    vendor = (DIST / 'vendor' / 'supabase.js').read_text()
    if len(vendor) < 100000 or '__mock' in vendor or 'window.__QA' in vendor:
        raise RuntimeError('Release vendor is not the genuine Supabase client')
    return actual

before = verify_dist()
EVIDENCE.mkdir(exist_ok=True)
with tempfile.TemporaryDirectory(prefix='pablicus-mock-tests-') as directory:
    shadow = Path(directory) / 'pablicus'
    (shadow / 'tests').mkdir(parents=True)
    shutil.copytree(DIST, shadow / 'dist')
    shutil.copy2(ROOT / 'tests' / 'integration.py', shadow / 'tests' / 'integration.py')
    result = subprocess.run([sys.executable, str(shadow / 'tests' / 'integration.py')])
    if (shadow / 'evidence').exists():
        shutil.copytree(shadow / 'evidence', EVIDENCE, dirs_exist_ok=True)
    after = verify_dist()
    if before != after:
        raise RuntimeError('Testing mutated the release files')
    (EVIDENCE / 'artifact-integrity.json').write_text(json.dumps({
        'test_backend': 'EXPLICIT_MOCK_IN_TEMPORARY_COPY',
        'release_unchanged': True,
        'asset_count': len(after),
        'manifest_verified_before_and_after': True,
        'genuine_supabase_sdk_bytes': (DIST / 'vendor' / 'supabase.js').stat().st_size,
        'mock_test_exit_code': result.returncode
    }, indent=2))
    raise SystemExit(result.returncode)
