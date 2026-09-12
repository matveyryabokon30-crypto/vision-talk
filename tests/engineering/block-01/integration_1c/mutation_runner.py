"""Isolated 1C negative controls after an intact positive baseline.

Outer PASS means the unchanged behavioral assertion detected its exact mutation.
The inner case retains FAIL and its nonzero exit code. No candidate file is edited.
"""
from __future__ import annotations

import argparse
import difflib
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import traceback
from datetime import datetime, timezone
from qualified_runner import process_log_failure

HARNESS = Path('tests/engineering/block-01/integration_1c')
CASES = ['routes', 'quiet', 'lifecycle', 'durability', 'canvas', 'outbox',
         'isolation', 'pending-send', 'storage-errors']
A = '11111111-1111-4111-8111-111111111111'
B = '22222222-2222-4222-8222-222222222222'
C1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
CB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'
BOT = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1'
CORRUPT_RESOURCE = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1'
MUTATIONS = [
    {'id': 'MUTATION_A_RESOURCE_LEAK', 'case': 'lifecycle', 'path': 'pablicus/chat.js',
     'assertion': '1C-NO-RESOURCE-ACCUMULATION', 'prior': ['1C-50-TRANSITIONS'],
     'before': "vp.removeEventListener('touchstart',this.onTouch);", 'after': '',
     'purpose': 'Omit only the real list touch-listener cleanup; all other list disposal stays intact.'},
    {'id': 'MUTATION_B_LATE_ACCOUNT', 'case': 'isolation', 'path': 'pablicus/app.js',
     'assertion': '1C-LATE-ACCOUNT-ISOLATION', 'prior': ['1C-ACCOUNT-A-RESTORED'],
     'before': "if(!isCurrent()||ep!==epoch||user?.id!==uid){if(isCurrent()&&current?.id===d.id&&user?.id===uid){$('app').style.visibility='';$('app').inert=false;}return;}rows=remote;",
     'after': 'rows=remote;',
     'purpose': 'Remove only the post-HTTP-read stale gate before real Chat.open; preserve the subsequent gate and controller guards.'},
    {'id': 'MUTATION_C_BYTE_OR_ORDER', 'case': 'durability', 'path': 'pablicus/vault.js',
     'assertion': '1C-DRAFT-BYTES', 'prior': ['1C-ORIGINAL-FILES', '1C-DRAFT-STRUCTURE'],
     'before': 'file:new File([row.blob],meta.name,{type:meta.type,lastModified:meta.lastModified})',
     'after': 'file:new File(meta.id===doc.files[0].id && row.blob.size ? [new Uint8Array([0]),row.blob.slice(1)] : [row.blob],meta.name,{type:meta.type,lastModified:meta.lastModified})',
     'purpose': 'Replace the first restored attachment byte after native IDB read; preserve original store bytes, size, metadata, IDs and order.'},
    {'id': 'MUTATION_D_ROUTE_RESOURCE', 'case': 'routes', 'path': 'pablicus/app-controller.js',
     'assertion': '1C-SCENARIO-SURVIVES-POLL',
     'prior': ['1C-ROUTE-BOTS', '1C-BOT-DETAIL-SURVIVES-POLL'],
     'before': 'if(activeTransition===transition)activeTransition=null;return true}\n  catch(error)',
     'after': "if(activeTransition===transition)activeTransition=null;if(target.screen==='scenario')state.resourceId='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1';return true}\n  catch(error)",
     'purpose': 'Corrupt only scenario resourceId after the real handler mounted and passed its final currentness gate; preserve the valid BOT request, visible scenario, successful navigation result and cleanup.'},
]


def utc_now():
    return datetime.now(timezone.utc).isoformat()


def sha(data):
    return hashlib.sha256(data).hexdigest()


def digest(path):
    return sha(Path(path).read_bytes())


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')
    temporary.replace(path)


def require(condition, reason):
    if not condition:
        raise ValueError(reason)


class ControlMismatch(ValueError):
    """Execution completed but did not demonstrate the intended negative control."""


def control_require(condition, reason):
    if not condition:
        raise ControlMismatch(reason)


def source_manifest(root):
    result = {}
    for folder in [root/'pablicus', root/HARNESS]:
        require(folder.is_dir() and not folder.is_symlink(), 'Missing or linked source directory: '+str(folder))
        for path in sorted(folder.rglob('*')):
            if '__pycache__' in path.parts:
                continue
            require(not path.is_symlink(), 'Unexpected source symlink: '+str(path))
            if path.is_file():
                result[path.relative_to(root).as_posix()] = digest(path)
    return result


def verified_reference(record, key, base):
    path = Path(record[key])
    if not path.is_absolute():
        path = base/path
    require(path.is_file(), 'Missing baseline '+key+': '+str(path))
    require(digest(path) == record[key+'_sha256'], 'Changed baseline '+key+': '+str(path))
    return path


def validate_baseline(path, code_sha, sources):
    baseline = json.loads(path.read_text())
    require(baseline.get('status') == 'PASS', 'Positive baseline is not PASS')
    require(baseline.get('tested_sha') == code_sha, 'Positive baseline SHA differs from current HEAD')
    require(all(baseline.get('cases', {}).get(name, {}).get('status') == 'PASS' for name in CASES),
            'All nine positive scenarios must PASS before mutations')
    verified = {'results_json': str(path), 'results_sha256': digest(path), 'gates': {}, 'cases': {}}
    for name in ['boundary', 'network-browser', 'selftests', 'ab', 'preflight']:
        record = baseline.get('gates', {}).get(name, {})
        require(record.get('status') == 'PASS' and record.get('exit_code') == 0, 'Prerequisite gate did not PASS: '+name)
        result_path = verified_reference(record, 'result', path.parent)
        log_path = verified_reference(record, 'log', path.parent)
        payload = json.loads(result_path.read_text())
        require(payload.get('status') == 'PASS', 'Referenced gate payload is not PASS: '+name)
        if name in ['ab', 'preflight']:
            require(payload.get('tested_sha') == code_sha, 'Diagnostic SHA changed: '+name)
            require(payload.get('source_sha256') == sources, 'Source bytes differ from positive '+name+' gate')
        verified['gates'][name] = {'result': str(result_path), 'result_sha256': digest(result_path),
                                   'log': str(log_path), 'log_sha256': digest(log_path)}
    for name in CASES:
        mutation = next((item for item in MUTATIONS if item['case'] == name), None)
        record = baseline['cases'][name]
        require(record.get('exit_code') == 0 and not record.get('timed_out'), 'Invalid positive case process: '+name)
        result_path = verified_reference(record, 'result', path.parent)
        log_path = verified_reference(record, 'log', path.parent)
        payload = json.loads(result_path.read_text())
        require(payload.get('status') == 'PASS' and payload.get('tested_sha') == code_sha,
                'Positive case payload is not the passing candidate: '+name)
        require(payload.get('mandatory_evidence_complete') is True, 'Positive case evidence incomplete: '+name)
        require(payload.get('source_sha256') == sources, 'Source bytes differ from positive case: '+name)
        require(payload.get('browser_version') and payload.get('checks')
                and all(check.get('status') == 'PASS' for check in payload['checks']), 'Positive behavioral evidence invalid: '+name)
        if mutation:
            require(any(check.get('name') == mutation['assertion'] and check.get('status') == 'PASS'
                        for check in payload['checks']), 'Positive counterpart assertion missing: '+name)
        verified['cases'][name] = {'result': str(result_path), 'result_sha256': digest(result_path),
                                   'log': str(log_path), 'log_sha256': digest(log_path),
                                   'browser_version': payload.get('browser_version'),
                                   'assertion': mutation['assertion'] if mutation else None, 'payload': payload}
    return verified


def active_group_members(pgid):
    # Zombie entries have exited; retain only executing members of our process group.
    output = subprocess.check_output(['ps', '-eo', 'pid=,pgid=,stat='], text=True, timeout=2)
    members = []
    for line in output.splitlines():
        columns = line.split()
        if len(columns) >= 3 and int(columns[1]) == pgid and not columns[2].startswith('Z'):
            members.append({'pid': int(columns[0]), 'pgid': pgid, 'state': columns[2]})
    return members


def execute_case(command, cwd, output, timeout, environment):
    output.mkdir(parents=True, exist_ok=True)
    log = output/'process.log'
    process = None
    started = time.monotonic()
    observed = {'command': command, 'deadline_seconds': timeout, 'timed_out': False,
                'start_time_utc': utc_now(), 'process_group_cleaned': False}
    try:
        with log.open('w') as stream:
            process = subprocess.Popen(command, cwd=cwd, env=environment, stdout=stream,
                                       stderr=subprocess.STDOUT, start_new_session=True)
            observed['process_group'] = process.pid
            try:
                observed['exit_code'] = process.wait(timeout=timeout)
            except subprocess.TimeoutExpired:
                observed['timed_out'] = True
                os.killpg(process.pid, signal.SIGTERM)
                try:
                    process.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
                    process.wait(timeout=5)
                observed['exit_code'] = process.returncode
    except Exception as exc:
        observed.update(error=str(exc), traceback=traceback.format_exc())
    finally:
        if process is not None:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            try:
                if process.poll() is None:
                    process.wait(timeout=5)
                for _ in range(3):
                    members = active_group_members(process.pid)
                    if not members:
                        break
                    time.sleep(.1)
                observed['remaining_active_group_members'] = members
                observed['process_group_cleaned'] = not members
            except Exception as exc:
                observed['cleanup_error'] = str(exc)
        observed.update(end_time_utc=utc_now(), duration_ms=round((time.monotonic()-started)*1000),
                        log=str(log), log_sha256=digest(log) if log.is_file() else None)
        observed['harness_log_error']=process_log_failure(log) if log.is_file() else 'MISSING_PROCESS_LOG'
        result_path = output/'result.json'
        observed.update(result=str(result_path), result_sha256=digest(result_path) if result_path.is_file() else None)
    return observed


def concrete_failure(mutation, actual):
    if mutation['id'] == 'MUTATION_A_RESOURCE_LEAK':
        before, after = actual['before'], actual['after']
        growth = {key: count-before['listener_sources'].get(key, 0)
                  for key, count in after['listener_sources'].items()
                  if '/pablicus/chat.js:' in key and key.endswith(' | touchstart')
                  and count > before['listener_sources'].get(key, 0)}
        control_require(growth and after['listeners'] > before['listeners']
                and after['list']['active_lists'] == before['list']['active_lists'] == 0,
                'Expected retained list touch-listener growth was not observed')
        return {'failure_class': 'RESOURCE_ACCUMULATION', 'touch_listener_growth': growth}
    if mutation['id'] == 'MUTATION_B_LATE_ACCOUNT':
        before, after = actual['before'], actual['after']
        control_require(before['uid'] == B and before['scope'] == {'user': B, 'chat': CB}
                and after['scope'] == {'user': A, 'chat': C1}
                and after['store']['account'] == A and after['live'] != before['live'],
                'Expected late A scope/draft over the established B screen was not observed')
        return {'failure_class': 'LATE_ACCOUNT_CONTAMINATION', 'before_scope': before['scope'],
                'after_scope': after['scope'], 'after_store': after['store']}
    if mutation['id'] == 'MUTATION_D_ROUTE_RESOURCE':
        route = actual['route']
        control_require(route['screen'] == 'scenario' and route['section'] == 'bots'
                and route['resourceId'] == CORRUPT_RESOURCE and route['conversationId'] is None
                and actual['uid'] == A and actual['homeVisible'] and not actual['appVisible']
                and actual['selected'] == ['tasks'] and actual['current'] is None and not actual['list']
                and actual['scenario_visible'] is True
                and actual['scenario_text'] == ['Fixture greeting', 'Done'],
                'Expected resourceId corruption over the correctly mounted visible scenario was not observed')
        return {'failure_class': 'ROUTE_RESOURCE_MISMATCH', 'expected_resource_id': BOT,
                'observed_resource_id': route['resourceId'], 'observed_route': route,
                'scenario_visible': actual['scenario_visible'], 'scenario_text': actual['scenario_text']}
    live, stored = actual['live'], actual['stored']
    control_require({key: value for key, value in live.items() if key != 'files'} ==
            {key: value for key, value in stored.items() if key != 'files'}, 'Mutation changed non-file content')
    original_files, restored_files = live['files'], stored['files']
    control_require(len(original_files) == len(restored_files) and len(original_files) > 0, 'Mutation changed file count')
    changed = []
    for index, (original, restored) in enumerate(zip(original_files, restored_files)):
        control_require({key: value for key, value in original.items() if key != 'sha256'} ==
                {key: value for key, value in restored.items() if key != 'sha256'}, 'Mutation changed metadata or order')
        if original['sha256'] != restored['sha256']:
            changed.append(index)
    corpus = 'Original alpha\nСтрока один\n'.encode()
    control_require(changed == [0] and original_files[0]['sha256'] == sha(corpus)
            and restored_files[0]['sha256'] == sha(b'\0'+corpus[1:]), 'Expected exactly one restored first-byte corruption was not observed')
    return {'failure_class': 'BYTE_HASH_MISMATCH', 'changed_file_indices': changed,
            'original_sha256': original_files[0]['sha256'], 'restored_sha256': restored_files[0]['sha256']}


def qualify(mutation, execution, payload, output, positive):
    require(not execution['timed_out'] and execution.get('exit_code') in [0, 1],
            'Mutation must finish normally, never a process timeout/crash')
    require(execution['process_group_cleaned'], 'Mutation process group cleanup was not verified')
    require(not execution.get('harness_log_error'), 'Mutation has a Python callback/log error')
    require(payload.get('mandatory_evidence_complete') is True and not payload.get('page_errors')
            and not payload.get('first_error') and not payload.get('collector_errors'), 'Mutation has incomplete evidence or browser errors')
    require(payload.get('status') in ['PASS', 'FAIL'], 'Mutation execution did not reach a valid behavioral verdict')
    control_require(payload.get('status') == 'FAIL' and payload.get('reason') == mutation['assertion'],
            'Mutation did not FAIL at its exact behavioral assertion')
    require(execution['exit_code'] == 1, 'Behavioral FAIL must retain a nonzero process exit')
    checks = payload.get('checks', [])
    failed = [check for check in checks if check.get('status') == 'FAIL']
    control_require(len(failed) == 1 and failed[0].get('name') == mutation['assertion'], 'Unexpected failed assertion')
    control_require(all(any(check.get('name') == name and check.get('status') == 'PASS' for check in checks)
                for name in mutation['prior']), 'Mutation did not reach the required prior behavioral checks')
    require(payload.get('browser_version') == positive['browser_version'], 'Mutation browser differs from positive counterpart')
    require(payload.get('browser_cleanup') == {'context': 'CLOSED', 'browser': 'CLOSED'}
            and payload.get('closed') == {'server': True, 'thread_alive': False}, 'Browser/server cleanup incomplete')
    require(not payload.get('network', {}).get('unknown') and not payload.get('network', {}).get('blocked'),
            'Mutation reached an unknown or blocked network boundary')
    require(payload.get('screenshots') and payload.get('html_reference'), 'Mutation screenshot/HTML absent')
    for reference in [*payload['screenshots'], payload['html_reference']]:
        path = (output/reference['path']).resolve()
        require(path.is_relative_to(output) and path.is_file() and digest(path) == reference['sha256'],
                'Mutation screenshot/HTML hash mismatch')
    events = (output/payload['browser_events_reference']).resolve()
    require(events.is_relative_to(output) and events.is_file(), 'Mutation event journal absent')
    concrete = concrete_failure(mutation, failed[0]['actual'])
    if mutation['id'] == 'MUTATION_D_ROUTE_RESOURCE':
        calls = [entry for entry in payload['instrument']['navigations']
                 if entry.get('target', {}).get('screen') == 'scenario']
        control_require(len(calls) == 1 and calls[0]['target'].get('resourceId') == BOT
                and calls[0].get('status') == 'fulfilled' and calls[0].get('result') is True,
                'Scenario did not complete its original valid BOT navigation before route corruption')
        concrete['completed_scenario_navigation'] = calls[0]
    return {**concrete, 'assertion': mutation['assertion'],
            'behavioral_checks_reached': len(checks), 'inner_status': payload['status'],
            'inner_exit_code': execution['exit_code'], 'event_log_sha256': digest(events)}


def run_mutation(mutation, root, out, code_sha, sources, positive, timeout):
    folder = out/mutation['id']
    folder.mkdir()
    result = {'test_id': mutation['id'], 'status': 'RUNNING', 'base_code_sha': code_sha,
              'case': mutation['case'], 'expected_assertion': mutation['assertion'],
              'start_time_utc': utc_now(), 'candidate_modified': False}
    temporary = None
    try:
        require(source_manifest(root) == sources, 'Candidate changed after positive baseline validation')
        temporary = Path(tempfile.mkdtemp(prefix='pablicus-1c-mutation-')).resolve()
        require(not temporary.is_relative_to(root), 'Mutation copy must be outside candidate')
        result['isolated_copy'] = str(temporary)
        for relative in sources:
            target = temporary/relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(root/relative, target)
        require(source_manifest(temporary) == sources, 'Isolated copy does not match the candidate')
        target = temporary/mutation['path']
        before = target.read_bytes()
        needle, replacement = mutation['before'].encode(), mutation['after'].encode()
        require(before.count(needle) == 1, 'Mutation insertion must match exactly once: '+mutation['path'])
        after = before.replace(needle, replacement, 1)
        require(after != before, 'Mutation made no change')
        target.write_bytes(after)
        mutated_sources = source_manifest(temporary)
        changed = [path for path in sources if mutated_sources[path] != sources[path]]
        require(changed == [mutation['path']], 'Mutation changed more than its single runtime file')
        require(all(mutated_sources[path] == sources[path] for path in sources if path.startswith(HARNESS.as_posix()+'/')),
                'Assertions or harness changed in isolated copy')
        (folder/'source.before').write_bytes(before)
        (folder/'source.after').write_bytes(after)
        patch = ''.join(difflib.unified_diff(before.decode().splitlines(True), after.decode().splitlines(True),
                                           fromfile='before/'+mutation['path'], tofile='after/'+mutation['path']))
        (folder/'mutation.diff').write_text(patch, encoding='utf-8')
        overlay_id = sha(json.dumps(mutated_sources, sort_keys=True).encode())
        result['mutated_source_id'] = overlay_id
        save(folder/'patch-manifest.json', {**mutation, 'base_code_sha': code_sha, 'replacement_count': 1,
             'source_before_sha256': sha(before), 'source_after_sha256': sha(after),
             'source_before': 'source.before', 'source_after': 'source.after',
             'patch_sha256': digest(folder/'mutation.diff'), 'harness_and_assertions_unchanged': True,
             'source_sha256_before': sources, 'source_sha256_after': mutated_sources,
             'mutated_source_id': overlay_id})
        save(folder/'qualification.json', result)
        case_output = folder/'case'
        # A mutated copy has no commit of its own. Do not label it as the clean SHA.
        environment = {**os.environ, 'PYTHONDONTWRITEBYTECODE': '1',
                       'PABLICUS_TESTED_SHA': 'MUTATION:'+mutation['id']+':'+overlay_id}
        command = [sys.executable, str(temporary/HARNESS/'case.py'), '--case', mutation['case'],
                   '--source-root', str(temporary), '--output', str(case_output)]
        execution = execute_case(command, temporary, case_output, timeout, environment)
        result['execution'] = execution
        payload_path = case_output/'result.json'
        payload = json.loads(payload_path.read_text()) if payload_path.is_file() else {}
        result['inner_status'] = 'TIMEOUT' if execution['timed_out'] else payload.get('status', 'ERROR')
        require(source_manifest(temporary) == mutated_sources, 'Mutation source changed during execution')
        result['qualification'] = qualify(mutation, execution, payload, case_output, positive)
        result['status'] = 'PASS'
    except Exception as exc:
        result.update(status='TIMEOUT' if result.get('inner_status') == 'TIMEOUT' else 'FAIL' if isinstance(exc, ControlMismatch) else 'ERROR',
                      reason=str(exc), traceback=traceback.format_exc())
    finally:
        if temporary is not None:
            try:
                shutil.rmtree(temporary)
                result['isolated_copy_removed'] = not temporary.exists()
            except Exception as exc:
                result.update(status='ERROR', cleanup_error=str(exc), isolated_copy_removed=False)
        try:
            result['candidate_unchanged'] = source_manifest(root) == sources
            if not result['candidate_unchanged']:
                result.update(status='ERROR', reason='Candidate changed during mutation; no rollback attempted')
        except Exception as exc:
            result.update(status='ERROR', reason='Candidate hash verification failed: '+str(exc))
        result['end_time_utc'] = utc_now()
        result['evidence_sha256'] = {str(path.relative_to(folder)): digest(path)
                                   for path in sorted(folder.rglob('*')) if path.is_file() and path.name != 'qualification.json'}
        save(folder/'qualification.json', result)
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-root', type=Path, required=True)
    parser.add_argument('--positive-results', type=Path, required=True)
    parser.add_argument('--output-dir', type=Path, required=True)
    parser.add_argument('--timeout', type=float, default=180)
    args = parser.parse_args(argv)
    root, out = args.source_root.resolve(), args.output_dir.resolve()
    if not 1 <= args.timeout <= 300:
        parser.error('Each process deadline must be between 1 and 300 seconds')
    if out == root or any(out.is_relative_to(root/folder) for folder in [Path('pablicus'), HARNESS]):
        parser.error('Evidence output cannot be a runtime or harness source directory')
    if out.exists() and any(out.iterdir()):
        parser.error('Use a new empty output directory; earlier evidence is preserved')
    out.mkdir(parents=True, exist_ok=True)
    summary = {'test_id': '1C-NEGATIVE-CONTROLS', 'status': 'RUNNING', 'start_time_utc': utc_now(),
               'scope': 'Same positive assertions on four separately mutated temporary copies. Outer PASS qualifies expected inner FAIL, never startup/environment failure.',
               'mutations': {mutation['id']: {'status': 'NOT_RUN'} for mutation in MUTATIONS}}
    save(out/'results.json', summary)
    try:
        code_sha = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True, timeout=5).strip()
        sources = source_manifest(root)
        summary.update(base_code_sha=code_sha, source_sha256=sources,
                       working_tree_status=subprocess.check_output(['git', 'status', '--porcelain'], cwd=root, text=True, timeout=5))
        baseline = validate_baseline(args.positive_results.resolve(), code_sha, sources)
        summary['positive_baseline'] = {**baseline, 'cases': {
            name: {key: value for key, value in record.items() if key != 'payload'} for name, record in baseline['cases'].items()}}
        save(out/'results.json', summary)
        for mutation in MUTATIONS:
            result = run_mutation(mutation, root, out, code_sha, sources, baseline['cases'][mutation['case']], args.timeout)
            summary['mutations'][mutation['id']] = result
            save(out/'results.json', summary)
            print(mutation['id'], result['status'], result.get('reason', ''), flush=True)
            if not result.get('candidate_unchanged', False):
                for remaining in MUTATIONS:
                    if summary['mutations'][remaining['id']]['status'] == 'NOT_RUN':
                        summary['mutations'][remaining['id']]['blocked_by'] = 'Candidate source changed; preserve parallel work'
                break
        summary['status'] = 'PASS' if all(result['status'] == 'PASS' for result in summary['mutations'].values()) else 'FAIL'
    except Exception as exc:
        summary.update(status='BLOCKED', reason=str(exc), traceback=traceback.format_exc())
        for result in summary['mutations'].values():
            if result['status'] == 'NOT_RUN':
                result['blocked_by'] = 'Positive baseline or source integrity prerequisite: '+str(exc)
    finally:
        summary['end_time_utc'] = utc_now()
        summary['counts'] = {status: sum(result['status'] == status for result in summary['mutations'].values())
                             for status in ['PASS', 'FAIL', 'ERROR', 'TIMEOUT', 'NOT_RUN', 'BLOCKED']}
        summary['evidence_sha256'] = {str(path.relative_to(out)): digest(path)
                                    for path in sorted(out.rglob('*')) if path.is_file() and path != out/'results.json'}
        save(out/'results.json', summary)
    return 0 if summary['status'] == 'PASS' else 1


if __name__ == '__main__':
    raise SystemExit(main())
