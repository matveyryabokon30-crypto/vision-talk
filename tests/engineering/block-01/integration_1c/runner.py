"""Finite per-process 1C browser runner. Retains original failures, partial JSON,
logs and evidence hashes; always cleans the process group. Runs all independent
cases even when earlier cases fail. A green 1B result never fills a missing 1C.
"""
from __future__ import annotations
import argparse,hashlib,json,os,signal,subprocess,sys,time,traceback
from pathlib import Path
CASES=['routes','quiet','lifecycle','durability','canvas','outbox','isolation','pending-send','storage-errors']
ap=argparse.ArgumentParser();ap.add_argument('--source-root',type=Path,default=Path.cwd());ap.add_argument('--output-dir',type=Path,default=Path('integration-1c-results/browser'));ap.add_argument('--only',default='');ap.add_argument('--timeout',type=float,default=120);a=ap.parse_args()
root=a.source_root.resolve();out=a.output_dir.resolve();out.mkdir(parents=True,exist_ok=True);selected=a.only.split(',') if a.only else CASES
if not 1<=a.timeout<=300 or any(x not in CASES for x in selected):ap.error('Invalid finite timeout or case')
result={'source_root':str(root),'cases':{c:{'status':'NOT_RUN'} for c in selected},'deadline_seconds':a.timeout,'status':'RUNNING'}
def save():
 p=out/'results.json';t=p.with_suffix('.tmp');t.write_text(json.dumps(result,ensure_ascii=False,indent=2));t.replace(p)
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
save()
for name in selected:
 folder=out/name;folder.mkdir(exist_ok=True);log=folder/'process.log';started=time.monotonic();proc=None
 result['cases'][name]={'status':'RUNNING'};save()
 try:
  with log.open('w') as f:
   cmd=[sys.executable,str(Path(__file__).with_name('case.py')),'--case',name,'--source-root',str(root),'--output',str(folder)]
   proc=subprocess.Popen(cmd,stdout=f,stderr=subprocess.STDOUT,start_new_session=True)
   try:code=proc.wait(timeout=a.timeout);timed_out=False
   except subprocess.TimeoutExpired:
    os.killpg(proc.pid,signal.SIGTERM)
    try:proc.wait(timeout=2)
    except subprocess.TimeoutExpired:os.killpg(proc.pid,signal.SIGKILL);proc.wait(timeout=3)
    code=proc.returncode;timed_out=True
  p=folder/'result.json';payload=json.loads(p.read_text()) if p.exists() else {}
  if timed_out:status='TIMEOUT';reason='PROCESS_TIMEOUT: complete process group terminated'
  elif not payload:status='ERROR';reason='Missing structured result; see process log'
  else:status=payload['status'];reason=payload.get('reason')
  if status=='PASS' and code!=0:status='ERROR';reason='PASS payload with nonzero exit'
  result['cases'][name]={'status':status,'reason':reason,'exit_code':code,'timed_out':timed_out,'elapsed_seconds':round(time.monotonic()-started,4),'command':cmd,'result':str(p.relative_to(out)),'result_sha256':digest(p) if p.exists() else None,'log':str(log.relative_to(out)),'log_sha256':digest(log),'checks':payload.get('checks',[])}
 except Exception as exc:result['cases'][name]={'status':'ERROR','reason':str(exc),'traceback':traceback.format_exc()}
 finally:
  if proc:
   try:os.killpg(proc.pid,signal.SIGKILL)
   except ProcessLookupError:pass
   if proc.poll() is None:proc.wait(timeout=3)
  save();print(name,result['cases'][name]['status'],result['cases'][name].get('reason'),flush=True)
result['counts']={s:sum(r['status']==s for r in result['cases'].values()) for s in ['PASS','FAIL','ERROR','TIMEOUT','NOT_RUN']}
result['status']='PASS' if result['counts']['PASS']==len(selected) else 'NOT_PASSED'
result['evidence_sha256']={str(p.relative_to(out)):digest(p) for p in out.rglob('*') if p.is_file() and p.name!='results.json'}
save();sys.exit(0 if result['status']=='PASS' else 1)
