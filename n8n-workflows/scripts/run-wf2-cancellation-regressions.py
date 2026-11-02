"""Lance les tests du cycle d’annulation WF2 et collecte leurs résultats."""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import json
import os
import subprocess

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'docs/qa/wf2-cancellation'
OUT.mkdir(parents=True, exist_ok=True)
GUARD = ROOT / 'n8n-workflows/scripts/wf2-offline-test-guard.cjs'
SOURCE = ROOT / 'n8n-workflows/backups/pre-promotion-r90-dto-source-discovery-20261004T133500Z/WF2-R90-LIVE-ACTIVE-POST-RESTART.json'
TARGET = ROOT / 'n8n-workflows/pending-live-update/WF2-R91-TRUE-CANCELLATION.OFFLINE.json'

def execute(label, spec, command, env):
    """Lance le scénario et collecte son code de sortie."""
    result = subprocess.run(command, cwd=ROOT, env=env, text=True, capture_output=True, timeout=60)
    log = OUT / (label + '-' + spec.name + '.log')
    log.write_text(result.stdout + result.stderr)
    return {'name': spec.name, 'exitCode': result.returncode, 'log': str(log.relative_to(ROOT))}

def backend(spec):
    """Lance le scénario de régression backend demandé."""
    env = os.environ.copy()
    env['TS_NODE_PROJECT'] = str(ROOT / 'backend/tsconfig.json')
    return execute('backend', spec, ['node', '-r', str(GUARD), '-r',
        str(ROOT / 'backend/node_modules/ts-node/register/transpile-only'), str(spec)], env)

def wf2(task):
    """Lance le scénario de régression du workflow WF2."""
    label, artifact, spec = task
    env = os.environ.copy()
    if artifact is None:
        env.pop('WF2_TEST_ARTIFACT', None)
    else:
        env['WF2_TEST_ARTIFACT'] = str(artifact)
    command = ['node', '-r', str(GUARD), str(spec)]
    # These specs test a historical hardening transformation, requiring their
    # actual PRE-promotion fixture (not today's already-hardened workflow).
    historical = {
        'wf2-r86-sticky-zone-consolidation.spec.mjs': ('r86', '*LIVE-BEFORE-R86.json'),
        'wf2-r87-llm-retry.spec.mjs': ('r87', '*LIVE-BEFORE-R87.json'),
        'wf2-r88-opus-retry-backoff.spec.mjs': ('r88', '*LIVE-BEFORE-R88.json'),
        'wf2-r89-mapping-required-filename-fix.spec.mjs': ('r89', '*LIVE-BEFORE-R89.json'),
    }
    if spec.name in historical:
        revision, pattern = historical[spec.name]
        matches = list((ROOT / 'n8n-workflows/backups').glob(f'pre-promotion-{revision}*/{pattern}'))
        assert len(matches) == 1, (spec.name, matches)
        command.append(str(matches[0]))
    return execute(label, spec, command, env)

if __name__ == '__main__':
    specs = sorted((ROOT / 'backend/src/incidents').glob('*.spec.ts'))
    with ThreadPoolExecutor(max_workers=2) as pool:
        backend_results = list(pool.map(backend, specs))
    print(f'backend: {sum(r["exitCode"] == 0 for r in backend_results)}/{len(backend_results)}', flush=True)
    wf_specs = sorted((ROOT / 'n8n-workflows/scripts').glob('wf2-*.spec.mjs'))
    tasks = [(label, artifact, spec) for label, artifact in [('historical', None), ('r90', SOURCE), ('r91', TARGET)] for spec in wf_specs]
    with ThreadPoolExecutor(max_workers=4) as pool:
        workflow_results = list(pool.map(wf2, tasks))
    baseline = {r['name']: r for r in workflow_results if '/r90-' in r['log']}
    target = {r['name']: r for r in workflow_results if '/r91-' in r['log']}
    regressions = [name for name in baseline if baseline[name]['exitCode'] == 0 and target[name]['exitCode'] != 0]
    failures = [name for name in baseline if baseline[name]['exitCode'] != 0]
    report = {'network': 'BLOCKED_BY_TEST_PRELOAD', 'fixtureOverrides': 'legacy shared WF2 primary fixture only; all assertions unchanged',
        'backend': backend_results, 'workflows': workflow_results, 'baselineFailures': failures, 'candidateRegressions': regressions}
    (OUT / 'regression-results.json').write_text(json.dumps(report, indent=2) + '\n')
    for label in ['historical', 'r90', 'r91']:
        results = [r for r in workflow_results if f'/{label}-' in r['log']]
        print(f'{label}: {sum(r["exitCode"] == 0 for r in results)}/{len(results)}', flush=True)
    print('baseline failures:', failures, flush=True)
    print('candidate regressions:', regressions, flush=True)
    print('backend failures:', [r['name'] for r in backend_results if r['exitCode'] != 0], flush=True)
