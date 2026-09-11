"""Bounded executable 1B contracts. Each scenario owns a killable process group.

Only the DOM, SDK events and I/O/resource boundaries are synthetic. Production
callbacks, authentication, view functions and controller registrations are read
from --app-path, not copied into the fixture. This is not 1C/full-device acceptance.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import signal
import subprocess
import sys
import time
import traceback

CASES = [
    '1B-T01', '1B-T02', '1B-T03', '1B-T04', '1B-T05', '1B-T06',
    '1B-CANVAS-YES', '1B-CANVAS-CLEAN', '1B-CANVAS-CALLERS',
    '1B-CANVAS-ROUNDTRIP', '1B-CANVAS-HOME', '1B-CANVAS-PENDING',
    '1B-AUTH-LOGOUT', '1B-AUTH-SWITCH', '1B-AUTH-LATE-ERROR',
    '1B-AUTH-ORDER', '1B-AUTH-PASSKEY', '1B-AUTH-BOOT',
    '1B-AUTH-BOOT-ERROR', '1B-AUTH-LOGOUT-RELOGIN',
    '1B-LATE-REJECT', '1B-SESSION-LATE', '1B-SESSION-ERROR',
    '1B-SESSION-ORDER', '1B-TIMEOUT-SELFTEST',
    '1B-LEAVE-DENY', '1B-LEAVE-COMPLETE', '1B-LEAVE-RESUME',
    '1B-LEAVE-FLUSH-REJECT', '1B-LEAVE-CANVAS-RESUME', '1B-LEAVE-REPEAT-BACK',
]
INTERNAL = 'HARNESS_NEVER_FINISHES'

def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()

def save(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + '.tmp')
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    temporary.replace(path)

def execute(command: list[str], limit: float, logfile: Path) -> dict:
    """Always retain logs and an exit status, including startup and timeout errors."""
    started = time.monotonic()
    proc = None
    result = {'command': command, 'timeout_seconds': limit}
    try:
        proc = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                text=True, start_new_session=True)
        try:
            output, _ = proc.communicate(timeout=limit)
            result.update(exit_code=proc.returncode, timed_out=False)
        except subprocess.TimeoutExpired:
            os.killpg(proc.pid, signal.SIGTERM)
            try:
                output, _ = proc.communicate(timeout=1)
            except subprocess.TimeoutExpired:
                os.killpg(proc.pid, signal.SIGKILL)
                output, _ = proc.communicate(timeout=2)
            result.update(exit_code=proc.returncode, timed_out=True,
                          reason=f'PROCESS_TIMEOUT after {limit}s; process group terminated')
    except Exception as exc:
        output = traceback.format_exc()
        result.update(exit_code=None, timed_out=False, launch_error=str(exc))
    finally:
        if proc is not None:
            # Kill residual children even if the parent exited before its descendants.
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            if proc.poll() is None:
                proc.wait(timeout=2)
    logfile.parent.mkdir(parents=True, exist_ok=True)
    logfile.write_text(output, encoding='utf-8')
    result.update(elapsed_seconds=round(time.monotonic()-started, 4),
                  log=str(logfile), log_sha256=digest(logfile))
    return result

def running(pid: int) -> bool:
    try:
        stat = Path(f'/proc/{pid}/stat')
        if stat.exists() and stat.read_text().split()[2] == 'Z':
            return False  # Exited; not an executing orphan process.
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--source-root', type=Path, default=Path.cwd())
    ap.add_argument('--controller-path', type=Path)
    ap.add_argument('--app-path', type=Path)
    ap.add_argument('--chat-path', type=Path, help='Production chat.js or an explicitly recorded exact leave-method excerpt')
    ap.add_argument('--browser', help='Legacy CLI compatibility; these contracts use Node VM, not a browser.')
    ap.add_argument('--output', type=Path, default=Path('block01-results/controller-1b.json'))
    ap.add_argument('--only', default='')
    ap.add_argument('--case-timeout', type=float, default=8.0)
    args = ap.parse_args()
    if not 0.2 <= args.case_timeout <= 60:
        ap.error('--case-timeout must be between 0.2 and 60 seconds')
    root = args.source_root.resolve()
    ctl = (args.controller_path or root/'pablicus/app-controller.js').resolve()
    app = (args.app_path or root/'pablicus/app.js').resolve()
    script = Path(__file__).with_name('controller_1b_scenarios.cjs').resolve()
    leave_script = Path(__file__).with_name('controller_1b_leave.cjs').resolve()
    chat = (args.chat_path or root/'pablicus/chat.js').resolve()
    selected = args.only.split(',') if args.only else CASES
    if any(t not in CASES+[INTERNAL] for t in selected) or len(selected) != len(set(selected)):
        ap.error('Unknown or duplicate scenario name in --only')
    args.output = args.output.resolve()
    logs = args.output.parent/(args.output.stem+'-logs')
    results = {name: {'status':'NOT_RUN', 'reason':'Scenario has not executed'} for name in selected}
    save(args.output, results)
    environment = {'python':sys.version, 'platform':platform.platform(), 'source_root':str(root),
                   'scope':'Exact application/controller functions; synthetic DOM/SDK/I/O; no real server or device',
                   'case_timeout_seconds':args.case_timeout,
                   'sources':{str(p): digest(p) if p.exists() else None for p in [ctl, app, script, leave_script, chat, Path(__file__).resolve()]}}
    save(args.output.with_suffix('.environment.json'), environment)
    try:
        for name in selected:
            results[name] = {'status':'RUNNING', 'reason':'Scenario started; not yet a pass'}
            save(args.output, results)
            logfile = logs/(name+'.log')
            if name == '1B-T06':
                checks=[]
                for path in [ctl,app,root/'pablicus/bots-nav.js',root/'pablicus/bot-scenario-bridge.js',script]:
                    checks.append(execute(['node','--check',str(path)], min(5,args.case_timeout), logs/(name+'-'+path.name+'.log')))
                status='TIMEOUT' if any(c.get('timed_out') for c in checks) else 'PASS' if all(c['exit_code']==0 for c in checks) else 'ERROR'
                record={'status':status, 'checks':checks}
            elif name == '1B-TIMEOUT-SELFTEST':
                probe = args.output.parent/'timeout-probe/results.json'
                cmd=[sys.executable,str(Path(__file__).resolve()),'--source-root',str(root),
                     '--controller-path',str(ctl),'--app-path',str(app),'--only',INTERNAL,
                     '--case-timeout','0.5','--output',str(probe)]
                execution=execute(cmd,6,logfile)
                child_results=json.loads(probe.read_text()) if probe.exists() else {}
                child_result=child_results.get(INTERNAL,{})
                probe_log=Path(child_result.get('execution',{}).get('log','/nonexistent'))
                ids=[]
                if probe_log.is_file():
                    for line in probe_log.read_text().splitlines():
                        try:
                            entry=json.loads(line)
                            if entry.get('probe')=='intentional-hang':ids=[entry['pid'],entry['child_pid']]
                        except (ValueError,KeyError): pass
                active=[pid for pid in ids if running(pid)]
                ok=(execution['exit_code'] not in [None,0] and not execution.get('timed_out')
                    and child_result.get('status')=='TIMEOUT' and len(ids)==2 and not active
                    and probe_log.is_file() and child_result['execution']['log_sha256']==digest(probe_log))
                record={'status':'PASS' if ok else 'FAIL','reason':'Timeout is recorded as TIMEOUT/nonzero, logs retained, parent and child stopped',
                        'execution':execution,'probe':str(probe),'probe_sha256':digest(probe) if probe.exists() else None,
                        'probe_result':child_result,'process_ids':ids,'still_running':active}
            else:
                command=['node',str(leave_script if name.startswith('1B-LEAVE-') else script),name,str(root),str(ctl),str(app)]
                if name.startswith('1B-LEAVE-'):
                    command.append(str(chat))
                execution=execute(command,args.case_timeout,logfile)
                if execution.get('timed_out'):
                    record={'status':'TIMEOUT','reason':execution['reason']}
                elif execution.get('launch_error'):
                    record={'status':'ERROR','reason':execution['launch_error']}
                else:
                    entries=[]
                    for line in logfile.read_text().splitlines():
                        try:
                            parsed=json.loads(line)
                            if parsed.get('test')==name: entries.append(parsed)
                        except (ValueError,AttributeError): pass
                    record=entries[-1] if entries else {'status':'ERROR','reason':'No structured result from scenario; inspect log'}
                    if record.get('status')=='PASS' and execution['exit_code']!=0:
                        record={'status':'ERROR','reason':'PASS payload conflicts with nonzero exit code','payload':record}
                record['execution']=execution
            results[name]=record
            save(args.output, results)
            print(name,record['status'],record.get('reason',''),flush=True)
    except BaseException as exc:
        for name,record in results.items():
            if record['status']=='RUNNING':
                results[name]={'status':'ERROR','reason':str(exc),'traceback':traceback.format_exc()}
        save(args.output,results)
        print(traceback.format_exc(),file=sys.stderr)
        return 1
    return 0 if results and all(r['status']=='PASS' for r in results.values()) else 1

if __name__=='__main__':
    raise SystemExit(main())
