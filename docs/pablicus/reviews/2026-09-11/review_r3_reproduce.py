"""Reproduce the scoped R3 review from original CI artifact 10273683434.
Real source functions; synthetic external boundaries. Not full app/storage QA.
Requires Python 3.10+ and Node. No network access or production data is used.
An outer exit 0 means candidate PASS and old expected controls, not that old FAILs
are relabeled as passes. Results/logs are retained for every case.
"""
from pathlib import Path
import argparse, hashlib, json, os, signal, subprocess, time

parser = argparse.ArgumentParser()
parser.add_argument('--ci-root', type=Path, required=True)
parser.add_argument('--output', type=Path, default=Path('review-r3-results.json'))
a = parser.parse_args()
ci = a.ci_root.resolve(); source = ci/'1b/source'
here = Path(__file__).resolve().parent
expected = {
 '1b/source/pablicus/app.js':'40903beeae438f62560d058fc531596e45505af8',
 '1b/source/pablicus/app-controller.js':'598a9e03e6c2784d750c46d701713cbb894e3cef',
 '1b/source/pablicus/chat.js':'4ff59d33af9fd587035d80e7134c225c5c00ffb2',
 '1b/source/tests/engineering/block-01/controller_1b_scenarios.cjs':'25acf4bf867fc1bd3645811586be9a5d748fd9d1',
 'r2-baseline/app.js':'b2b37e8eb439b7076ed0e771c9e51c472265cace',
 'r2-baseline/app-controller.js':'598a9e03e6c2784d750c46d701713cbb894e3cef',
 'r2-baseline/chat.js':'4ff59d33af9fd587035d80e7134c225c5c00ffb2',
}
for name, want in expected.items():
 b=(ci/name).read_bytes()
 got=hashlib.sha1(b'blob '+str(len(b)).encode()+b'\0'+b).hexdigest()
 if got != want: raise SystemExit('Source mismatch: '+name)
logs = a.output.parent/(a.output.stem+'-logs'); logs.mkdir(parents=True, exist_ok=True)
results=[]
def save():
 a.output.parent.mkdir(parents=True, exist_ok=True)
 temp=a.output.with_suffix(a.output.suffix+'.tmp')
 temp.write_text(json.dumps(results,ensure_ascii=False,indent=2)+'\n',encoding='utf-8');temp.replace(a.output)
save()
for version in ['old','candidate']:
 folder=ci/'r2-baseline' if version=='old' else source/'pablicus'
 for mode in ['deny','complete','resume','canvas','reject','repeat','latest']:
  log=logs/f'{version}-{mode}.log'; start=time.monotonic()
  row={'version':version,'mode':mode,'status':'RUNNING','deadline_seconds':8}
  results.append(row);save()
  with log.open('w',encoding='utf-8') as fh:
   process=subprocess.Popen(['node',str(here/'review_leave_r3.cjs'),mode,str(source),str(folder/'app.js'),str(folder/'app-controller.js'),str(folder/'chat.js')],stdout=fh,stderr=subprocess.STDOUT,start_new_session=True)
   try: code=process.wait(timeout=8)
   except subprocess.TimeoutExpired:
    os.killpg(process.pid,signal.SIGKILL);process.wait(timeout=2);code=process.returncode;row['status']='TIMEOUT'
  row.update(exit_code=code,seconds=round(time.monotonic()-start,4),log_sha256=hashlib.sha256(log.read_bytes()).hexdigest())
  if row['status']!='TIMEOUT':
   try:
    payload=json.loads(log.read_text(encoding='utf-8'));row.update(status=payload['status'],result=payload)
    expected_exit=0 if row['status']=='PASS' else 1 if row['status']=='FAIL' else 2
    if code!=expected_exit: row.update(status='ERROR',reason='Unexpected process status')
   except (ValueError,KeyError) as error: row.update(status='ERROR',reason=str(error))
  save()
ok=all(r['status']==('PASS' if r['version']=='candidate' or r['mode'] in ['deny','complete'] else 'FAIL') for r in results)
print(json.dumps({'candidate_pass':sum(r['status']=='PASS' for r in results if r['version']=='candidate'),'expected_old_controls':ok,'cases':len(results)}))
raise SystemExit(0 if ok else 1)
