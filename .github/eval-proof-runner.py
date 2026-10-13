#!/usr/bin/env python3
"""PR3287 expectation-only fallibility proofs (Python >=3.9, stdlib only).

Dry run renders/reviews all 11 copies OUTSIDE the checkout; it starts nothing.
Execute only on the separately prepared scratch CI checkout and already-running,
built-from-source managed stack. The existing fixtures still attest mock routing.
This runner does not build, start, stop, repair, or reconfigure that stack.

All original assertions remain. One additional assertion per copy compares real
observed state with one wrong expected value. In particular, CDC polling is never
poisoned and no judge input, shared constant, request, or filter is changed.

Runtime command (cwd REPO/e2e):
  NODE22 node_modules/@playwright/test/cli.js test RELATIVE_SPEC
    --workers=1 --reporter=json --output=OUT/RUN/artifacts
The extra --output ONLY isolates Playwright's traces/screenshots/attachments.
PLAYWRIGHT_JSON_OUTPUT_FILE redirects the JSON reporter away from noisy stdout.

No catalog generation while temporary same-ID copies exist. No concurrent suite
or catalog invocation should run in this scratch checkout. Only one temporary
spec exists at a time. SIGINT/SIGTERM and normal exceptions trigger cleanup;
SIGKILL, machine loss, or a filesystem failure cannot be cleaned up by Python.
"""
import argparse
import base64
import difflib
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import time
import uuid

MAX_TOTAL_SECONDS = 45 * 60
PROCESS_HEADROOM_SECONDS = 90
STOP_HEADROOM_SECONDS = 5
STOP_REQUESTED = False
FLOW_INFO = {
    'OBS-E2E-037': {
        'path': 'flows/observe/eval-count-tiles.spec.ts',
        'sha256': '871c44ad76fb8e2a410d303113db30ff244f47068adab7317f61e0a2a37e5963',
        'checks': [
            'the project and config have the exact actor scope; both source spans and the curated trace retain their identities across replay',
            'two distinct completed task/logger rows retain the same config and child span, with Pass then a newer Fail and exact mapped explanations and mock usage',
            'ClickHouse tracer_eval_logger FINAL equals both exact Postgres rows, including task/logger/trace/span IDs and verdicts',
            'the actual trace and span list responses and API replays expose the minted span-target config and exactly {pass:0,fail:1}',
            'trace-root and recursively located child detail rollups contain only the latest Fail and explanation; eval-cell click opens Evals and the expanded breakdown displays them',
        ],
    },
    'AGENT-E2E-001': {
        'path': 'flows/agents/call-log-eval-columns.spec.ts',
        'sha256': 'cff1e38ae909703eb99b9945b347a05d7534cd0cde2b239147082675f25b9684',
        'checks': [
            'the simulator-source project/config belong to the actor scope and both OTLP spans plus the curated trace retain exact identities through replay',
            'two distinct completed task/logger rows for the same config/child persist as Pass then newer Fail, with exact mapped explanations and mock usage',
            'ClickHouse tracer_eval_logger FINAL equals both exact Postgres logger/task/trace/span identities and verdicts',
            'the actual voice list and its API replay expose the named span-target config, counts {pass:0,fail:1} and the backward-compatible scalar output 0',
            'voice detail preserves scalar Fail and adds the exact latest per-span rollup; eval-cell click selects Evals and shows its explanation',
            'native Failed and Passed filters send the config-bound predicate; browser and API return exactly the call ID or the empty set, respectively',
        ],
    },
}

SCOPE = """    expect(await probe.pg(`SELECT c.id,c.project_id,c.eval_template_id,c.mapping,p.organization_id,p.workspace_id
      FROM tracer_custom_eval_config c JOIN tracer_project p ON p.id=c.project_id WHERE c.id=$1`, [config]))
      .toEqual([{ id: config, project_id: projectId, eval_template_id: template, mapping,
        organization_id: actor.organizationId, workspace_id: actor.workspaceId }]);"""
SECOND = """    expect(Date.parse(rows[1].created_at)).toBeGreaterThan(Date.parse(rows[0].created_at));"""
CDC = '    await expect.poll(readCH, POLL.CDC_VISIBLE).toEqual(rows);'
OBS_COUNTS = '        expect(body.result.table[0][config]).toEqual(counts);'
AGENT_COUNTS = '      expect(body.results[0][config]).toEqual(counts);'
OBS_DETAIL = """        expect(rollup?.evals).toEqual([expect.objectContaining({ eval_config_id: config, eval_name: evalName,
          target_type: 'span', aggregate: counts, spans: [expect.objectContaining({ span_id: seed.spanIds[1],
            value: 'fail', explanation: explanations[1], status: 'completed', error: false })] })]);"""
AGENT_DETAIL = """      expect(body.result.eval_rollup.evals).toEqual([expect.objectContaining({ eval_config_id: config,
        eval_name: evalName, target_type: 'span', aggregate: counts,
        spans: [expect.objectContaining({ span_id: seed.spanIds[1], value: 'fail', explanation: explanations[1],
          status: 'completed', error: false })] })]);"""
FILTER = """        if (index > 0) await expect(page.getByText('No calls found', { exact: true })).toBeVisible({ timeout: UI_READY });"""


class ProofError(Exception):
    pass


def require(condition, message):
    if not condition:
        raise ProofError(message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def save_json(path, obj):
    with path.open('x', encoding='utf-8') as stream:
        json.dump(obj, stream, indent=2)
        stream.write('\n')


def unique_replace(text, old, new):
    require(text.count(old) == 1, 'anchor must occur exactly once: ' + old[:100])
    return text.replace(old, new, 1)


def mutation(flow, number, marker):
    """Return unique original anchor + added assertion; never alter the anchor."""
    if number == 1:
        negative = unique_replace(SCOPE, '[config]))', "[config]), '" + marker + "')")
        negative = unique_replace(negative, 'organization_id: actor.organizationId,',
                                  'organization_id: `${actor.organizationId}-proof-wrong`,')
        return SCOPE, negative, 'config actor organization ID gains an expected-only -proof-wrong suffix', 'toEqual'
    if number == 2:
        negative = """    expect(rows[1], 'MARKER').toMatchObject({ custom_eval_config_id: config, eval_task_id: secondTask, trace_id: seed.traceId,
      observation_span_id: seed.spanIds[1], target_type: 'span', status: 'completed', error: false,
      deleted: false, output_bool: true, output_float: null, output_str: null,
      eval_explanation: explanations[1], usage: MOCK_USAGE });""".replace('MARKER', marker)
        return SECOND, negative, 'second completed Postgres attempt expects output_bool true instead of false', 'toMatchObject'
    if number == 3:
        negative = """    const proofActualCH = await readCH();
    expect(proofActualCH).toEqual(rows);
    const proofExpectedCH = rows.map((row, index) => index === 1 ? { ...row, id: rows[0].id } : { ...row });
    expect(proofActualCH, 'MARKER').toEqual(proofExpectedCH);""".replace('MARKER', marker)
        return CDC, negative, 'after unchanged CDC equality, second expected CH logger ID becomes the first logger ID', 'toEqual'
    if number == 4:
        anchor = OBS_COUNTS if flow == 'OBS-E2E-037' else AGENT_COUNTS
        actual = 'body.result.table[0][config]' if flow == 'OBS-E2E-037' else 'body.results[0][config]'
        negative = unique_replace(anchor, 'expect(' + actual + ')', "expect(" + actual + ", '" + marker + "')")
        negative = unique_replace(negative, '.toEqual(counts)', '.toEqual({ pass: 1, fail: 1 })')
        return anchor, negative, 'actual list response expects pass=1/fail=1 instead of pass=0/fail=1', 'toEqual'
    if number == 5:
        anchor = OBS_DETAIL if flow == 'OBS-E2E-037' else AGENT_DETAIL
        actual = 'rollup?.evals' if flow == 'OBS-E2E-037' else 'body.result.eval_rollup.evals'
        negative = unique_replace(anchor, 'expect(' + actual + ')', "expect(" + actual + ", '" + marker + "')")
        negative = unique_replace(negative, "value: 'fail'", "value: 'pass'")
        if flow == 'OBS-E2E-037':
            # The root and child both pass the original rollup check first.
            negative = unique_replace(negative, '        expect(', "        if (scope === 'span') expect(")
        return anchor, negative, 'latest per-span detail verdict expects pass instead of fail; explanation unchanged', 'toEqual'
    if flow == 'AGENT-E2E-001' and number == 6:
        negative = """        if (index > 0) {
          const proofFilteredCallIds = (await response.json() as CallPage).results.map(row => row.call_id);
          expect(proofFilteredCallIds).toEqual([]);
          expect(proofFilteredCallIds, 'MARKER').toEqual([callId]);
        }""".replace('MARKER', marker)
        return FILTER, negative, 'after both native filters/API replays/UI checks pass, Passed response wrongly expects [callId] instead of []', 'toEqual'
    raise ProofError('unmapped backend check')


def prepare(e2e, out, token):
    originals, cases, protected = {}, [], {}
    for flow, info in FLOW_INFO.items():
        path = e2e / info['path']
        require(path.resolve() == path and path.is_file(), 'original must be a regular in-checkout path')
        raw = path.read_bytes()
        require(sha(raw) == info['sha256'], 'original source hash drift: ' + str(path))
        text = raw.decode('utf-8')
        checks_block = re.findall(r'    backendChecks: \[\n(.*?)\n    \],', text, re.S)
        require(len(checks_block) == 1, 'backendChecks declaration not unique')
        checks = re.findall(r"^      '([^']*)',$", checks_block[0], re.M)
        require(checks == info['checks'], 'declared backendChecks changed: ' + flow)
        title_match = re.findall(r"^test\('([^']+)', \{$", text, re.M)
        budgets = re.findall(r'test\.setTimeout\(([\d_]+)\);', text)
        require(len(title_match) == len(budgets) == 1, 'expected one test and one test budget')
        budget = int(budgets[0].replace('_', '')) / 1000
        require(budget == 1080, 'existing test budget changed')
        originals[flow] = {'path': info['path'], 'title': title_match[0], 'budget_seconds': budget}
        preserved = out / 'originals' / info['path']
        preserved.parent.mkdir(parents=True, exist_ok=True)
        preserved.write_bytes(raw)
        for number, check in enumerate(checks, 1):
            case_id = flow + '-BC' + str(number)
            marker = 'PR3287_PROOF_' + case_id + '_' + token
            anchor, negative, description, matcher = mutation(flow, number, marker)
            addition = '\n' + negative
            changed = unique_replace(text, anchor, anchor + addition)
            # This insertion-only invariant proves every original byte remains in order.
            require(unique_replace(changed, anchor + addition, anchor) == text, 'mutation changed original statements')
            require(changed.count(marker) == 1, 'proof marker is not unique')
            relative = str(Path(info['path']).with_name('zz-proof-' + case_id.lower() + '-' + token + '.spec.ts'))
            rendered = out / 'specs' / relative
            rendered.parent.mkdir(parents=True, exist_ok=True)
            rendered.write_text(changed, encoding='utf-8')
            patch = out / 'patches' / (case_id + '.patch')
            patch.parent.mkdir(parents=True, exist_ok=True)
            patch.write_text(''.join(difflib.unified_diff(text.splitlines(True), changed.splitlines(True),
                                                       fromfile=info['path'], tofile=relative)), encoding='utf-8')
            # Limit accepted error locations to the marked expect's matcher expression.
            marker_offset = changed.index(marker)
            expect_start = changed.rfind('expect(', 0, marker_offset)
            expect_end = changed.index(';', marker_offset)
            cases.append({
                'id': case_id, 'flow': flow, 'backend_check_number': number,
                'backend_check': check, 'mutation': description, 'marker': marker,
                'original': info['path'], 'original_anchor_line': text[:text.index(anchor)].count('\n') + 1,
                'relative_copy': relative, 'rendered_copy': str(rendered), 'patch': str(patch),
                'assertion_lines': [changed[:expect_start].count('\n') + 1, changed[:expect_end].count('\n') + 1],
                'matcher': matcher, 'sha256': sha(changed.encode('utf-8')),
            })
    for relative in [i['path'] for i in FLOW_INFO.values()] + ['FLOWS.md', 'playwright.config.ts', 'lib/mock-model-fixtures.ts']:
        protected[relative] = sha((e2e / relative).read_bytes())
    require(len(cases) == 11, 'expected exactly eleven proof cases')
    return originals, cases, protected


def verify_unchanged(e2e, protected):
    for relative, digest in protected.items():
        path = e2e / relative
        require(path.is_file() and not path.is_symlink() and sha(path.read_bytes()) == digest,
                'protected original changed; refusing to restore/overwrite: ' + str(path))


def all_specs(suites):
    for suite in suites:
        yield from suite.get('specs', [])
        yield from all_specs(suite.get('suites', []))


def no_ansi(text):
    return re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]', '', text)


def excerpt(message):
    lines = no_ansi(message).splitlines()
    # Keep matcher headers and actual diff lines, rather than clipping the target field out.
    selected = set(range(min(5, len(lines))))
    for index, line in enumerate(lines):
        if re.match(r'\s*[-+]\s', line) or re.match(r'\s*(Expected|Received):', line):
            selected.add(index)
    return '\n'.join(lines[index] for index in sorted(selected))[:2400]


def validate_report(report, returncode, e2e, relative, title, case=None):
    negative = case is not None
    require(returncode == (1 if negative else 0), 'unexpected process exit: ' + str(returncode))
    require(report.get('errors') == [], 'report has global/setup/worker errors')
    config = report.get('config', {})
    require(config.get('workers') == 1, 'report did not use one worker')
    projects = config.get('projects', [])
    require(len(projects) == 1, 'expected ordinary single-project config')
    require(projects[0].get('retries') == 0 and projects[0].get('repeatEach') == 1,
            'retries/repetition in report configuration')
    require(Path(config.get('rootDir', '')).resolve() == e2e, 'report root is not requested e2e checkout')
    expected_stats = {'expected': 0 if negative else 1, 'unexpected': 1 if negative else 0, 'skipped': 0, 'flaky': 0}
    require(all(report.get('stats', {}).get(key) == value for key, value in expected_stats.items()),
            'report is not exactly one ' + ('failed' if negative else 'passed') + ' test with no skips/flakes')
    specs = list(all_specs(report.get('suites', [])))
    require(len(specs) == 1, 'report must contain exactly one spec')
    spec = specs[0]
    require(spec.get('title') == title and (e2e / spec.get('file', '')).resolve() == e2e / relative,
            'report test title/file does not match requested spec')
    require(spec.get('ok') is (not negative), 'spec outcome disagrees with expected verdict')
    tests = spec.get('tests', [])
    require(len(tests) == 1, 'report must contain exactly one test')
    test = tests[0]
    require(test.get('expectedStatus') == 'passed', 'test was marked as expected failure or skipped')
    require(test.get('status') == ('unexpected' if negative else 'expected'), 'unexpected/flaky/skipped test outcome')
    results = test.get('results', [])
    require(len(results) == 1 and results[0].get('retry') == 0, 'test was retried or not executed exactly once')
    result = results[0]
    require(result.get('status') == ('failed' if negative else 'passed'), 'timeout/interruption/non-assertion result')
    attachments = {a.get('name') for a in result.get('attachments', [])}
    require({'managed-mock-routing', 'isolated-mock-actor', 'isolated-mock-model'} <= attachments,
            'managed mock/actor/model attestation attachments missing')
    receipts = [a for a in result['attachments'] if a.get('name') == 'managed-mock-routing']
    require(len(receipts) == 1 and receipts[0].get('contentType') == 'application/json', 'managed receipt is ambiguous')
    # testInfo.attach(body=...) is emitted inline as base64 by the JSON reporter.
    receipt = json.loads(base64.b64decode(receipts[0].get('body', ''), validate=True))
    require(isinstance(receipt, dict) and all(receipt.get(k) for k in
            ('context', 'project', 'networkId', 'gatewaySha', 'mockSha', 'services')), 'managed receipt is incomplete')
    receipt_sha = sha(json.dumps(receipt, sort_keys=True, separators=(',', ':')).encode('utf-8'))
    if not negative:
        require(not result.get('error') and result.get('errors') == [], 'green run contains errors')
        return {'duration_ms': result.get('duration'), 'observed': 'passed', 'managed_receipt_sha256': receipt_sha}
    require(len(result.get('errors', [])) == 1, 'multiple errors (including teardown) cannot prove one assertion')
    error = result.get('error') or {}
    message = no_ansi(error.get('message', ''))
    # Never accept a marker found only in a nearby source code frame or stack.
    require(message.split('\n', 1)[0] == case['marker'], 'raw assertion message does not start with the proof marker')
    require('expect(received).' + case['matcher'] + '(expected)' in message, 'wrong assertion matcher')
    require('Expected' in message and 'Received' in message, 'assertion has no expected/received diff')
    require(not re.search(r'timeout|timed\s*out|interrupted|network error', message, re.I), 'timeout/runtime error is not proof')
    location = result.get('errorLocation') or error.get('location') or {}
    location_file = Path(location.get('file', ''))
    if not location_file.is_absolute():
        location_file = e2e / location_file
    require(location_file.resolve() == e2e / relative, 'failure came from another source file')
    first, last = case['assertion_lines']
    require(isinstance(location.get('line'), int) and first <= location['line'] <= last,
            'failure did not originate in the marked expectation')
    return {'duration_ms': result.get('duration'), 'observed': 'marked_assertion_failed',
            'managed_receipt_sha256': receipt_sha, 'error_location': location, 'excerpt': excerpt(message)}


class Runner:
    def __init__(self, e2e, out, node, deadline, protected):
        self.e2e, self.out, self.node = e2e, out, node
        self.deadline, self.protected = deadline, protected
        self.owned = {}
        self.runs = []
        self.receipt_sha = None

    def cleanup(self):
        errors = []
        for path, identity in list(self.owned.items()):
            try:
                stat = path.lstat()
                require((stat.st_dev, stat.st_ino) == identity and not path.is_symlink(),
                        'temporary path replaced by another writer; will not remove: ' + str(path))
                path.unlink()
                del self.owned[path]
            except FileNotFoundError:
                del self.owned[path]
            except Exception as exc:
                errors.append(str(exc))
        require(not errors, '; '.join(errors))

    def place_copy(self, case):
        require(not self.owned, 'only one temporary copy may exist')
        path = self.e2e / case['relative_copy']
        require(path.parent.resolve() == path.parent, 'copy directory must not be a symlink')
        raw = Path(case['rendered_copy']).read_bytes()
        require(sha(raw) == case['sha256'], 'rendered proof copy changed since preparation')
        # O_EXCL prevents overwriting an existing original or another runner's copy.
        fd = os.open(str(path), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        stat = os.fstat(fd)
        self.owned[path] = (stat.st_dev, stat.st_ino)
        with os.fdopen(fd, 'wb') as stream:
            stream.write(raw)
        return path

    def process(self, argv, folder, budget, env):
        require(not STOP_REQUESTED, 'stop requested; no further subprocesses permitted')
        remaining = self.deadline - time.monotonic() - STOP_HEADROOM_SECONDS
        require(remaining > 0, '45-minute total deadline reached')
        timeout = min(budget, remaining)
        save_json(folder / 'invocation.json', {'argv': argv, 'cwd': str(self.e2e), 'timeout_seconds': timeout,
                                              'environment_changes': {'PLAYWRIGHT_JSON_OUTPUT_FILE': env.get('PLAYWRIGHT_JSON_OUTPUT_FILE')}})
        proc = None
        try:
            with (folder / 'stdout.log').open('xb') as stdout, (folder / 'stderr.log').open('xb') as stderr:
                proc = subprocess.Popen(argv, cwd=str(self.e2e), env=env, stdin=subprocess.DEVNULL,
                                        stdout=stdout, stderr=stderr, start_new_session=True)
                return proc.wait(timeout=timeout)
        except subprocess.TimeoutExpired as exc:
            raise ProofError('subprocess deadline exceeded; never counted as proof') from exc
        finally:
            if proc is not None and proc.poll() is None:
                # Kill only this runner's private child process group, not existing services.
                try:
                    os.killpg(proc.pid, signal.SIGTERM)
                    proc.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    os.killpg(proc.pid, signal.SIGKILL)
                    proc.wait(timeout=1)
                except ProcessLookupError:
                    pass

    def execute(self, name, flow, original, case=None):
        folder = self.out / 'runs' / name
        folder.mkdir(parents=True)
        relative = case['relative_copy'] if case else original['path']
        record = {'run': name, 'flow': flow, 'spec': relative, 'report': str(folder / 'report.json'),
                  'stdout': str(folder / 'stdout.log'), 'stderr': str(folder / 'stderr.log'),
                  'status': 'not_proven' if case else 'not_passed'}
        if case:
            record.update({key: case[key] for key in ('id', 'backend_check_number', 'backend_check', 'mutation', 'marker')})
        self.runs.append(record)
        try:
            verify_unchanged(self.e2e, self.protected)
            if case:
                self.place_copy(case)
            env = dict(os.environ)
            env['PLAYWRIGHT_JSON_OUTPUT_FILE'] = str(folder / 'report.json')
            # No shell, package manager, retry, grep, config, credential, or network overrides.
            argv = [str(self.node), str(self.e2e / 'node_modules/@playwright/test/cli.js'),
                    'test', relative, '--workers=1', '--reporter=json', '--output=' + str(folder / 'artifacts')]
            code = self.process(argv, folder, original['budget_seconds'] + PROCESS_HEADROOM_SECONDS, env)
            record['returncode'] = code
            require((folder / 'report.json').is_file(), 'JSON reporter did not produce a report')
            report = json.loads((folder / 'report.json').read_text(encoding='utf-8'))
            record.update(validate_report(report, code, self.e2e, relative, original['title'], case))
            if self.receipt_sha is None:
                self.receipt_sha = record['managed_receipt_sha256']
            require(record['managed_receipt_sha256'] == self.receipt_sha,
                    'managed stack/routing/source receipt changed between runs')
            record['status'] = 'proven' if case else 'passed'
            if case:
                (folder / 'failure-excerpt.txt').write_text(record['excerpt'] + '\n', encoding='utf-8')
                print(name + ': marked assertion failed as required\n' + record['excerpt'], file=sys.stderr, flush=True)
            else:
                print(name + ': original passed', file=sys.stderr, flush=True)
        except Exception as exc:
            record['error'] = str(exc)
            raise
        finally:
            try:
                self.cleanup()
            finally:
                verify_unchanged(self.e2e, self.protected)
                save_json(folder / 'verdict.json', record)


def interrupted(signum, _frame):
    global STOP_REQUESTED
    STOP_REQUESTED = True
    raise ProofError('interrupted by signal ' + str(signum))


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--repo', type=Path, required=True, help='absolute scratch checkout path when executing')
    parser.add_argument('--out', type=Path, required=True, help='NEW absolute artifact directory outside the checkout')
    parser.add_argument('--node', type=Path, help='absolute Node22 executable; required only with --execute')
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--dry-run', action='store_true', help='render copies and patches outside checkout only')
    mode.add_argument('--execute', action='store_true', help='run ONLY on separately prepared scratch CI managed stack')
    args = parser.parse_args()
    start = time.monotonic()
    summary = {'status': 'failed', 'mode': 'dry-run' if args.dry_run else 'execute',
               'errors': [], 'runs': [], 'max_total_seconds': MAX_TOTAL_SECONDS}
    runner, protected, e2e, out = None, None, None, None
    try:
        require(args.repo.is_absolute() and args.out.is_absolute(), '--repo and --out must be absolute')
        repo = args.repo.resolve(strict=True)
        e2e = repo / 'e2e'
        require(e2e.is_dir() and e2e.resolve() == e2e, 'missing real e2e directory')
        require(not args.out.exists() and not args.out.is_symlink(), '--out must not exist (no output overwrites)')
        target_out = args.out.resolve()
        require(target_out != repo and repo not in target_out.parents, '--out must be outside the checkout')
        target_out.mkdir(parents=True, mode=0o700)
        out = target_out
        token = uuid.uuid4().hex[:16]
        originals, cases, protected = prepare(e2e, out, token)
        summary.update({'out': str(out), 'repo': str(repo), 'token': token, 'protected_sha256': protected,
                        'cases': cases, 'executed_managed_tests': False})
        save_json(out / 'manifest.json', {'originals': originals, 'cases': cases, 'protected_sha256': protected})
        if args.dry_run:
            summary['status'] = 'dry_run_validated_not_runtime_proof'
        else:
            require(args.node is not None and args.node.is_absolute(), '--execute requires an absolute --node path')
            node = args.node.resolve(strict=True)
            require(node.is_file() and os.access(node, os.X_OK), '--node must be an executable file')
            require((e2e / 'node_modules/@playwright/test/cli.js').is_file(), 'Playwright CLI not installed')
            runner = Runner(e2e, out, node, start + MAX_TOTAL_SECONDS, protected)
            summary['runs'] = runner.runs
            version_dir = out / 'node-version'
            version_dir.mkdir()
            require(runner.process([str(node), '--version'], version_dir, 10, dict(os.environ)) == 0,
                    'node --version failed')
            version = (version_dir / 'stdout.log').read_text(encoding='utf-8').strip()
            require(re.fullmatch(r'v22\.\d+\.\d+', version) is not None, 'Node22 required; got ' + version)
            summary['node_version'] = version
            baseline_ok = False
            try:
                summary['executed_managed_tests'] = True
                for flow, original in originals.items():
                    runner.execute('before-' + flow, flow, original)
                baseline_ok = True
                for case in cases:
                    runner.execute(case['id'], case['flow'], originals[case['flow']], case)
            except Exception as exc:
                summary['errors'].append(str(exc))
            finally:
                # Even an invalid negative run gets postflight originals when time remains.
                runner.cleanup()
                if baseline_ok and not STOP_REQUESTED:
                    for flow, original in originals.items():
                        try:
                            runner.execute('after-' + flow, flow, original)
                        except Exception as exc:
                            summary['errors'].append(str(exc))
            negatives = [r for r in runner.runs if 'id' in r]
            greens = [r for r in runner.runs if 'id' not in r]
            if not summary['errors'] and len(negatives) == 11 and len(greens) == 4 and all(
                    r['status'] in ('proven', 'passed') for r in runner.runs):
                summary['status'] = 'proven'
    except Exception as exc:
        summary['errors'].append(str(exc))
    finally:
        if runner:
            try:
                runner.cleanup()
            except Exception as exc:
                summary['errors'].append(str(exc))
        if e2e is not None and protected is not None:
            try:
                verify_unchanged(e2e, protected)
                summary['originals_unchanged'] = True
            except Exception as exc:
                summary['errors'].append(str(exc))
                summary['originals_unchanged'] = False
        if summary['errors']:
            summary['status'] = 'failed'
        summary['duration_seconds'] = round(time.monotonic() - start, 3)
        if out is not None:
            try:
                save_json(out / 'summary.json', summary)
            except Exception as exc:
                summary['status'] = 'failed'
                summary['errors'].append('cannot preserve summary: ' + str(exc))
        # Stdout is exactly one final machine-readable JSON object; progress is stderr.
        print(json.dumps(summary, separators=(',', ':')), flush=True)
    return 0 if summary['status'] in ('proven', 'dry_run_validated_not_runtime_proof') else 1


if __name__ == '__main__':
    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, interrupted)
    sys.exit(main())
