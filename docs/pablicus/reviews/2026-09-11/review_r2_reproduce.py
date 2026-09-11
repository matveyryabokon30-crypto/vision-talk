"""Bounded, source-pinned review of 1B's pending leave -> return contract.
Run on the tested source snapshot, not as the future candidate's acceptance suite.
Python 3.10+ and Node are required; no network, server or browser data is used.
"""
from pathlib import Path
import argparse, hashlib, json, os, platform, signal, subprocess, time

parser = argparse.ArgumentParser()
parser.add_argument('--source-root', type=Path, required=True)
parser.add_argument('--output', type=Path, default=Path('review-r2-results.json'))
a = parser.parse_args()
here = Path(__file__).resolve().parent
root = a.source_root.resolve()
expected = {
    'pablicus/app-controller.js': '598a9e03e6c2784d750c46d701713cbb894e3cef',
    'pablicus/app.js': 'b2b37e8eb439b7076ed0e771c9e51c472265cace',
    'tests/engineering/block-01/controller_1b_scenarios.cjs': '25acf4bf867fc1bd3645811586be9a5d748fd9d1',
}
for name, want in expected.items():
    b = (root / name).read_bytes()
    got = hashlib.sha1(b'blob ' + str(len(b)).encode() + b'\0' + b).hexdigest()
    if got != want:
        raise SystemExit(f'Pinned source mismatch: {name}: {got} != {want}')
leave = here / 'chat-leave.source.txt'
if hashlib.sha256(leave.read_bytes()).hexdigest() != 'a02a6e1e7a08b6b7ceebc4226a627fb0a6383528e23457228cd6ea48e0d2d15e':
    raise SystemExit('Pinned chat.js:520 extract mismatch')
logs = a.output.parent / (a.output.stem + '-logs')
logs.mkdir(parents=True, exist_ok=True)
result = {
    'review': 'PABLICUS-1B-HANDOFF-R2',
    'tested_sha': 'a4e19bc696f2516c2f56790b2114c69bc0f05530',
    'handoff_head': '95102dba14276439f44db8cb12c787a7644c88ed',
    'source_blobs': expected,
    'leave_file_git_blob': '4ff59d33af9fd587035d80e7134c225c5c00ffb2',
    'leave_extract_sha256': hashlib.sha256(leave.read_bytes()).hexdigest(),
    'scope': 'Exact production controller/app callers and chat.leave method; reused inspected fixture; synthetic flush, list, DOM and SDK boundaries; not full app, persisted data or device QA',
    'python': platform.python_version(),
    'node': subprocess.check_output(['node', '--version'], text=True, timeout=5).strip(),
    'cases': [],
}
def save():
    a.output.parent.mkdir(parents=True, exist_ok=True)
    tmp = a.output.with_suffix(a.output.suffix + '.tmp')
    tmp.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    tmp.replace(a.output)

save()
for i, mode in enumerate(['DENY_CONTROL', 'COMPLETE_EXIT_CONTROL'] + ['RESUME_WHILE_LEAVING'] * 5, 1):
    logfile = logs / f'{i:02d}-{mode}.log'
    record = {'case': mode, 'iteration': i, 'status': 'RUNNING', 'deadline_seconds': 8}
    result['cases'].append(record)
    save()
    start = time.monotonic()
    with logfile.open('w', encoding='utf-8') as fh:
        process = subprocess.Popen(['node', str(here/'review_real_leave.cjs'), mode, str(root), str(leave)],
                                   stdout=fh, stderr=subprocess.STDOUT, start_new_session=True)
        try:
            code = process.wait(timeout=8)
            record.update(exit_code=code)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait(timeout=2)
            record.update(status='TIMEOUT', exit_code=process.returncode)
    record.update(elapsed_seconds=round(time.monotonic()-start, 4),
                  log=logfile.relative_to(a.output.parent).as_posix(),
                  log_sha256=hashlib.sha256(logfile.read_bytes()).hexdigest())
    if record['status'] != 'TIMEOUT':
        try:
            payload = json.loads(logfile.read_text(encoding='utf-8'))
            record.update(status=payload['status'], result=payload['result'])
            spans = payload['source_spans']
            if 'source_spans' in result and result['source_spans'] != spans:
                raise ValueError('Source extraction differs between repeated cases')
            result['source_spans'] = spans
            if (record['status']=='PASS' and code!=0) or (record['status']=='FAIL' and code!=1):
                record.update(status='ERROR', reason='Unexpected process status')
        except (ValueError, KeyError) as error:
            record.update(status='ERROR', reason=str(error))
    save()
print(json.dumps({x: sum(c['status']==x for c in result['cases']) for x in ['PASS','FAIL','ERROR','TIMEOUT']}, ensure_ascii=False))
raise SystemExit(1 if any(c['status']!='PASS' for c in result['cases']) else 0)
