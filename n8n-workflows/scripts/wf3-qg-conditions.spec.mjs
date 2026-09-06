// R22-A — proves the "Consolidate Validation Result" node in the
// repo-tracked WF3 export (n8n-workflows/active/wf3-post-pr-validation-v4-
// 4JiOKpyHhx1znTYw.json) forwards the Sonar Quality Gate's per-condition
// breakdown (sonarQualityGateConditions/sonarQualityGatePeriod) instead of
// discarding it after only extracting `.status` -- proven-missing live on
// PR-25 build #3 (R21-AZ): the persisted backend payload had `sonarStatus:
// "ERROR"` but no per-condition detail anywhere, forcing a manual SQLite/
// n8n-execution-data read to find the exact failing condition. This is a
// REPO-ONLY change: nothing here imports/publishes to the live n8n instance.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const wfPath = path.join(here, '..', 'active', 'wf3-post-pr-validation-v4-4JiOKpyHhx1znTYw.json');
const workflow = JSON.parse(readFileSync(wfPath, 'utf8'))[0];
const node = workflow.nodes.find(n => n.name === 'Consolidate Validation Result');
assert.ok(node, 'Consolidate Validation Result node must exist in the repo-tracked WF3 export');
const code = node.parameters.jsCode;

function run(mockData) {
  const mock = name => ({ first: () => ({ json: mockData[name] }) });
  const capturingCode = code
    .replace('return [{json:{', 'const __out = {')
    .replace(/\}\}\];\s*$/, '};\nreturn __out;');
  const capture = new Function('$', capturingCode);
  return capture(mock);
}

const baseCtx = {
  sonarAnalysisMode: 'COMMUNITY_EXACT_SHA', ceTaskId: 'ce-1', analysisId: 'analysis-1',
  jenkinsStatus: 'SUCCESS', checkoutSha: 'sha1', expectedPrHeadSha: 'sha1',
  incidentId: 'incident-1', requiredStages: [
    { stage: 'build', required: true, status: 'PASSED' },
    { stage: 'tests', required: true, status: 'PASSED' },
    { stage: 'sonar', required: true, status: 'PASSED' },
  ], unresolvedBlockingCount: 0,
};

// --- Case 1: normal Sonar Quality Gate response with 3 conditions ---
const out1 = run({
  'Extract Validation Context': baseCtx,
  'Get Incident From DB': { id: 'incident-1' },
  'Get SonarQube PR Quality Gate': {
    projectStatus: {
      status: 'ERROR',
      conditions: [
        { metricKey: 'new_coverage', status: 'OK', comparator: 'LT', errorThreshold: '80', actualValue: '0.0' },
        { metricKey: 'new_violations', status: 'ERROR', comparator: 'GT', errorThreshold: '0', actualValue: '1' },
      ],
      period: { mode: 'PREVIOUS_VERSION', date: '2026-09-05T23:55:37+0000' },
    },
  },
  'Get SonarQube Approved Findings': { issues: [] },
  'Prepare Approved Finding Validation': { findings: [], findingIds: [] },
});
assert.equal(out1.sonarQualityGateConditions.length, 2, 'Case 1: both conditions forwarded');
assert.deepEqual(out1.sonarQualityGateConditions[1],
  { metric: 'new_violations', status: 'ERROR', actualValue: '1', threshold: '0', comparator: 'GT' },
  'Case 1: condition fields renamed to the documented contract (metric/status/actualValue/threshold/comparator)');
assert.equal(out1.sonarQualityGatePeriod.mode, 'PREVIOUS_VERSION', 'Case 1: period forwarded');

// --- Case 2: correlation not verified (no ceTaskId) -> never fabricate conditions from an unverified response ---
const out2 = run({
  'Extract Validation Context': { ...baseCtx, ceTaskId: null, analysisId: null },
  'Get Incident From DB': { id: 'incident-1' },
  'Get SonarQube PR Quality Gate': { projectStatus: { status: 'OK', conditions: [{ metricKey: 'x', status: 'OK' }] } },
  'Get SonarQube Approved Findings': { issues: [] },
  'Prepare Approved Finding Validation': { findings: [], findingIds: [] },
});
assert.deepEqual(out2.sonarQualityGateConditions, [], 'Case 2: no conditions forwarded when correlation is unverified');
assert.equal(out2.sonarQualityGatePeriod, null, 'Case 2: no period forwarded when correlation is unverified');

// --- Case 3: Quality Gate available but conditions array absent (older Sonar / partial response) ---
const out3 = run({
  'Extract Validation Context': baseCtx,
  'Get Incident From DB': { id: 'incident-1' },
  'Get SonarQube PR Quality Gate': { projectStatus: { status: 'OK' } },
  'Get SonarQube Approved Findings': { issues: [] },
  'Prepare Approved Finding Validation': { findings: [], findingIds: [] },
});
assert.deepEqual(out3.sonarQualityGateConditions, [], 'Case 3: missing conditions array degrades to empty, never throws/fabricates');

console.log('WF3 Quality Gate conditions forwarding: PASS');
