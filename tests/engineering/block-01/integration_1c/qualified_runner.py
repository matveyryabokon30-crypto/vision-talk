"""Finite 1C gates and scenarios; incomplete prerequisites never become PASS."""
from __future__ import annotations
import argparse, hashlib, json, os, re, signal, subprocess, sys, time, traceback
from collections import Counter
from pathlib import Path

HERE=Path(__file__).resolve().parent
CASES=['routes','quiet','lifecycle','durability','canvas','outbox','isolation','pending-send','storage-errors']
STATUSES=['PASS','FAIL','ERROR','TIMEOUT','NOT_RUN','BLOCKED']

def digest(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def process_log_failure(path):
    content=Path(path).read_text(errors='replace')
    found=re.search(r"RuntimeWarning: coroutine[^\n]*was never awaited|Error occurred in event listener|Task exception was never retrieved",content)
    return found.group(0) if found else None
def save(path,value):
    path.parent.mkdir(parents=True,exist_ok=True)
    temporary=path.with_suffix('.tmp')
    temporary.write_text(json.dumps(value,ensure_ascii=False,indent=2),encoding='utf-8')
    temporary.replace(path)

def fingerprint(payload):
    first=payload.get('first_error') or {}
    location=first.get('location') or {}
    origin=payload.get('origin') or payload.get('environment',{}).get('origin','')
    source=location.get('url','')
    if origin: source=source.replace(origin,'<origin>')
    message=first.get('message') or payload.get('reason','')
    if origin: message=message.replace(origin,'<origin>')
    fields={'class':first.get('name') or payload.get('status'), 'message':message,
            'source':source,'line':location.get('line'),'column':location.get('column')}
    return {'fields':fields,'sha256':hashlib.sha256(json.dumps(fields,sort_keys=True).encode()).hexdigest()}

def validate_pass(payload):
    """Check positive result invariants; expected B0/collector failures stay explicit."""
    def checks(value):
        rows=value.get('checks')
        if not isinstance(rows,list) or not rows or any(row.get('status')!='PASS' for row in rows):
            raise ValueError('PASS requires nonempty successful checks')
    def evidence(value):
        if value.get('mandatory_evidence_complete') is not True or value.get('collector_errors'):
            raise ValueError('PASS requires complete independent evidence')
    if 'case' in payload:
        checks(payload);evidence(payload)
        if payload.get('page_errors') or payload.get('network',{}).get('unknown') or payload.get('network',{}).get('blocked'):
            raise ValueError('PASS contains unexpected browser/network errors')
        if payload.get('browser_cleanup')!={'context':'CLOSED','browser':'CLOSED'} or payload.get('closed')!={'server':True,'thread_alive':False}:
            raise ValueError('PASS requires completed browser/server cleanup')
    elif payload.get('mode') in ['ab','preflight']:
        variants=payload['results'];expected=['A','B0','B1'] if payload['mode']=='ab' else ['B1']
        if set(variants)!=set(expected):raise ValueError('Missing diagnostic variants')
        for name,value in variants.items():
            evidence(value)
            if value.get('context_closed') is not True:raise ValueError('Diagnostic context did not close')
            if name!='B0':
                if value.get('status')!='PASS':raise ValueError('Positive diagnostic variant did not PASS')
                checks(value)
        if payload.get('browser_closed') is not True or payload.get('cleanup')!={'server_closed':True,'thread_alive':False}:
            raise ValueError('Diagnostic cleanup incomplete')
    elif 'tests' in payload:
        tests=payload['tests']
        if set(tests)!={'INSTRUMENT-NATIVE-RECEIVER-01','COLLECTOR-EARLY-ERROR-01'}:raise ValueError('Required self-tests missing')
        for value in tests.values():
            if value.get('status')!='PASS':raise ValueError('Self-test did not PASS')
            checks(value)
        receiver=tests['INSTRUMENT-NATIVE-RECEIVER-01'];collector=tests['COLLECTOR-EARLY-ERROR-01']
        if receiver.get('browser_closed') is not True:raise ValueError('Receiver browser not closed')
        for value in receiver['variants'].values():evidence(value)
        if collector.get('inner_exit_code')!=1 or collector.get('inner_process_group_cleaned') is not True:
            raise ValueError('Collector expected inner failure/cleanup missing')
    elif payload.get('test_id')=='NETWORK-BOUNDARY-CONTRACT-01':checks(payload)
    elif payload.get('test_id')=='NETWORK-BROWSER-BOUNDARY-01':
        checks(payload);evidence(payload)
        if payload.get('python_warnings') or payload.get('loop_errors'):raise ValueError('Browser boundary qualification contains callback errors')
        if payload.get('cleanup')!={'context':'CLOSED','browser':'CLOSED'}:raise ValueError('Browser boundary cleanup incomplete')
        network=payload.get('network',{})
        if network.get('pending_websocket_jobs')!=0 or network.get('active_external_channels')!=[] or network.get('websocket_qualification_errors'):
            raise ValueError('Browser boundary jobs, channels or callback errors remain')
    else:raise ValueError('Unknown PASS result shape')

def execute(command,folder,payload_name,timeout,environment):
    folder.mkdir(parents=True,exist_ok=True)
    log=folder/'process.log';proc=None;started=time.monotonic();timed_out=False;result={}
    try:
        with log.open('w') as stream:
            proc=subprocess.Popen(command,stdout=stream,stderr=subprocess.STDOUT,env=environment,start_new_session=True)
            try: code=proc.wait(timeout=timeout)
            except subprocess.TimeoutExpired:
                timed_out=True;os.killpg(proc.pid,signal.SIGTERM)
                try: proc.wait(timeout=2)
                except subprocess.TimeoutExpired: os.killpg(proc.pid,signal.SIGKILL);proc.wait(timeout=5)
                code=proc.returncode
        path=folder/payload_name
        payload=json.loads(path.read_text()) if path.is_file() else {}
        status=payload.get('status','ERROR');reason=payload.get('reason')
        if timed_out: status='TIMEOUT';reason='PROCESS_TIMEOUT: complete process group terminated'
        elif not payload: status='ERROR';reason='Missing structured result'
        elif status not in STATUSES: status='ERROR';reason='Invalid result status '+str(status)
        elif status=='PASS' and code!=0: status='ERROR';reason='PASS payload with nonzero exit'
        elif process_log_failure(log):status='ERROR';reason='HARNESS_CALLBACK_ERROR: '+process_log_failure(log)
        elif status=='PASS':validate_pass(payload)
        failure_payload=payload
        if payload.get('mode') in ['ab','preflight']:
            variants=payload.get('results',{})
            failure_payload=next((variants[k] for k in ['A','B1','B0'] if k in variants and variants[k]['status']!='PASS'),payload)
        result={'status':status,'reason':reason,'exit_code':code,'timed_out':timed_out,
                'elapsed_seconds':round(time.monotonic()-started,4),'command':command,
                'result':str(path),'result_sha256':digest(path) if path.is_file() else None,
                'log':str(log),'log_sha256':digest(log),'checks':payload.get('checks',[]),
                'fingerprint':fingerprint({**failure_payload,'status':status,'reason':reason or failure_payload.get('reason')}) if status!='PASS' else None,
                'behavioral_checks_reached':len(payload.get('checks',[]))}
    except Exception as exc:
        result={'status':'ERROR','reason':str(exc),'traceback':traceback.format_exc(),
                'log':str(log),'log_sha256':digest(log) if log.is_file() else None,
                'behavioral_checks_reached':0,'fingerprint':fingerprint({'status':'ERROR','reason':str(exc)})}
    finally:
        if proc:
            try:
                try:os.killpg(proc.pid,signal.SIGKILL)
                except ProcessLookupError:pass
                if proc.poll() is None:proc.wait(timeout=5)
                members=[]
                for _ in range(3):
                    rows=subprocess.check_output(['ps','-eo','pid=,pgid=,stat='],text=True,timeout=2).splitlines()
                    members=[{'pid':int(parts[0]),'pgid':int(parts[1]),'state':parts[2]} for row in rows if len(parts:=row.split())>=3 and int(parts[1])==proc.pid and not parts[2].startswith('Z')]
                    if not members:break
                    time.sleep(.1)
                result.update(process_group=proc.pid,remaining_active_group_members=members,process_group_cleaned=not members)
                if members:result.update(status='ERROR',reason='Active child process remained after cleanup')
            except Exception as exc:
                result.update(status='ERROR',reason='Process cleanup failed: '+str(exc),process_group_cleaned=False)
    return result

def main(argv=None):
    parser=argparse.ArgumentParser()
    parser.add_argument('--source-root',type=Path,default=Path.cwd())
    parser.add_argument('--output-dir',type=Path,default=Path('integration-1c-results/browser'))
    parser.add_argument('--only',default='')
    parser.add_argument('--timeout',type=float,default=180)
    args=parser.parse_args(argv)
    selected=args.only.split(',') if args.only else CASES
    if not 1<=args.timeout<=300 or any(name not in CASES for name in selected): parser.error('Invalid finite timeout or case')
    root=args.source_root.resolve();out=args.output_dir.resolve()
    if out.exists() and any(out.iterdir()):parser.error('Output directory must be empty: stale evidence cannot qualify a new run')
    out.mkdir(parents=True,exist_ok=True)
    sha=subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True,timeout=5).strip()
    environment={**os.environ,'PABLICUS_TESTED_SHA':sha,'PYTHONDONTWRITEBYTECODE':'1'}
    result={'status':'RUNNING','tested_sha':sha,'source_root':str(root),'gates':{},
            'cases':{name:{'status':'NOT_RUN'} for name in selected},'deadline_seconds':args.timeout,
            'executed':0,'deduplicated_not_run':0,'independent_continued':0}
    save(out/'results.json',result)
    gates=[('boundary','boundary_selftests.py',['--output'],'results.json',20),
           ('network-browser','network_browser_selftest.py',['--output'],'results.json',120),
           ('selftests','selftests.py',['--output'], 'results.json',180),
           ('ab','diagnostics.py',['--mode','ab','--output'],'summary.json',360),
           ('preflight','diagnostics.py',['--mode','preflight','--output'],'summary.json',150)]
    root_blocker=None
    for name,script,options,payload,deadline in gates:
        folder=out/'gates'/name
        command=[sys.executable,str(HERE/script),'--source-root',str(root),*options,str(folder)]
        gate=execute(command,folder,payload,deadline,environment)
        result['gates'][name]=gate;save(out/'results.json',result)
        print('gate',name,gate['status'],gate.get('reason'),flush=True)
        if gate['status']!='PASS':
            root_blocker={'test_id':name,'fingerprint':gate.get('fingerprint'),'reason':gate.get('reason') or 'Prerequisite did not PASS'}
            break
    if root_blocker:
        for name in selected: result['cases'][name]={'status':'NOT_RUN','blocked_by':root_blocker}
    else:
        early=Counter();first_by_fingerprint={}
        stopped_by=None
        for name in selected:
            if stopped_by:
                result['cases'][name]={'status':'NOT_RUN','blocked_by':stopped_by}
                result['deduplicated_not_run']+=1;continue
            folder=out/name
            command=[sys.executable,str(HERE/'case.py'),'--case',name,'--source-root',str(root),'--output',str(folder)]
            case=execute(command,folder,'result.json',args.timeout,environment)
            result['cases'][name]=case;result['executed']+=1
            if case['status'] in ['ERROR','TIMEOUT'] and case['behavioral_checks_reached']==0:
                key=case['fingerprint']['sha256'];early[key]+=1;first_by_fingerprint.setdefault(key,name)
                if early[key]>=3: stopped_by={'test_id':first_by_fingerprint[key],'fingerprint':case['fingerprint'],'reason':'Three identical failures before first behavioral assertion'}
            save(out/'results.json',result);print(name,case['status'],case.get('reason'),flush=True)
    result['counts']={status:sum(case['status']==status for case in result['cases'].values()) for status in STATUSES}
    result['status']='PASS' if result['counts']['PASS']==len(selected) else 'BLOCKED' if root_blocker else 'FAIL'
    result['evidence_sha256']={str(path.relative_to(out)):digest(path) for path in out.rglob('*') if path.is_file() and path!=out/'results.json'}
    save(out/'results.json',result)
    return 0 if result['status']=='PASS' else 1

if __name__=='__main__': raise SystemExit(main())
