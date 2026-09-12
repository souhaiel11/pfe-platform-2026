// Offline contract tests for WF1's "Merge All Fetched Data" node: proves it
// consumes the CONSOLIDATED Sonar baseline snapshot (the sole authoritative
// owner of fetch completeness), never the raw single-page HTTP fetch.
//
// Root cause (execution 1969, real Jenkins build #141, incident
// c24ac224-cc55-4d74-9139-33d55ed71e55): sonarRaw was bound to
// $('Fetch SonarQube Issues') -- a stale pre-refactor reference. That raw
// shape has no complete/snapshotError/collectedCount fields at all, so
// sonarRaw.complete === true was permanently false regardless of the real
// (correct) consolidation result, producing a false snapshotError=INCOMPLETE
// on a genuinely complete 16-issue baseline.
//
// No n8n execution, network or business action.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const wf = JSON.parse(readFileSync(new URL('../active/wf1-incident-intake-analysis-v5-1-vNOQiEgnXg9Zqn2q.json', import.meta.url)))[0];
const mergeNode = wf.nodes.find(n => n.name === 'Merge All Fetched Data');
const consolidateNode = wf.nodes.find(n => n.name === 'Consolidate Baseline Sonar Snapshot');
const fetchNode = wf.nodes.find(n => n.name === 'Fetch SonarQube Issues');
const conns = wf.connections;

// ── 1. Static contract: the fix is actually in place ───────────────────────
const code = mergeNode.parameters.jsCode;
assert.match(code, /sonarRaw = \$\('Consolidate Baseline Sonar Snapshot'\)\.first\(\)\?\.json/,
  'sonarRaw must be sourced from the consolidation node');
assert.doesNotMatch(code, /sonarRaw = \$\('Fetch SonarQube Issues'\)/,
  'sonarRaw must never be sourced from the raw single-page fetch node');
assert.doesNotMatch(code, /sonarSnapshotCollectedCount[^;]*:\s*sonarIssues\.length/,
  'collectedCount must never silently fall back to issues.length -- missing metadata must fail closed');
assert.doesNotMatch(code, /httpRequestWithAuthentication|requestWithAuthenticationPaginated|(?:this\.)?helpers\./,
  'no unsupported n8n API/helper introduced');

// ── 2. Graph contract: unchanged topology, only the Merge node's code moved ─
assert.equal(fetchNode.type, 'n8n-nodes-base.httpRequest');
assert.deepEqual((conns['Fetch SonarQube Issues']?.main?.[0] || []).map(e => e.node), ['Consolidate Baseline Sonar Snapshot']);
assert.ok((conns['Parse OWASP JSON']?.main?.[0] || []).some(e => e.node === 'Merge All Fetched Data'));

// ── Harness: execute the real node code with a mocked $(nodeName) ──────────
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
function dollar(overrides) {
  return (nodeName) => ({
    first: () => {
      if (!(nodeName in overrides)) throw new Error(`unmocked node reference: ${nodeName}`);
      return { json: overrides[nodeName] };
    },
  });
}
const baseFixture = () => ({
  'Extract Project Config': { projectConfig: { sonarqubeKey: 'test-project' }, jenkins: {}, reports: {}, build_number: 141 },
  'Incident Webhook': { body: {} },
  'Prepare Fetch URLs': { incidentUUID: 'incident-test-uuid' },
  'Resolve Exact Sonar Correlation': { qualityGate: 'OK', ceTaskId: 'ce-task-test', analysisId: 'analysis-test', correlationVerified: true },
});
async function runMerge(overrides) {
  const fn = new AsyncFunction('$', mergeNode.parameters.jsCode);
  return (await fn(dollar({ ...baseFixture(), ...overrides })))[0].json.enrichedData.sonar;
}

const issue = i => ({ key: `k${i}`, rule: 'java:S125', severity: 'MAJOR', type: 'CODE_SMELL', component: `proj:F${i}.java`, message: 'm', line: 1 });
const consolidated = (n, extra = {}) => ({
  issues: Array.from({ length: n }, (_, i) => issue(i)),
  total: n, collectedCount: n, pageSize: 500, complete: true, snapshotError: null,
  ...extra,
});

// ── 3. Real execution-1969 shape regression: RAW vs CONSOLIDATED ───────────
// This is the exact bug shape: a well-formed raw single-page fetch response
// (no completeness fields) alongside a well-formed consolidated snapshot.
// The fixed code must consume the consolidated one.
{
  const rawFetch = { total: 16, p: 1, ps: 500, paging: { total: 16, pageIndex: 1, pageSize: 500 }, issues: Array.from({ length: 16 }, (_, i) => issue(i)) };
  const consolidatedOut = consolidated(16);
  const sonar = await runMerge({ 'Fetch SonarQube Issues': rawFetch, 'Consolidate Baseline Sonar Snapshot': consolidatedOut });
  assert.equal(sonar.total, 16);
  assert.equal(sonar.collectedCount, 16);
  assert.equal(sonar.issues.length, 16);
  assert.equal(sonar.complete, true);
  assert.equal(sonar.snapshotError, null);
}

// Prove the test is meaningful: the OLD (pre-fix) code, given the exact same
// two inputs, must produce the proven-buggy result. This demonstrates the
// new test would have caught the real bug.
{
  const oldCode = code.replace(
    "sonarRaw = $('Consolidate Baseline Sonar Snapshot').first()?.json || {};",
    "sonarRaw = $('Fetch SonarQube Issues').first()?.json || {};"
  ).replace(
    /const sonarUpstreamComplete[\s\S]*?const sonarSnapshotCollectedCount = Number\.isInteger\(sonarRaw\.collectedCount\) && sonarRaw\.collectedCount >= 0 \? sonarRaw\.collectedCount : null;/,
    `const sonarSnapshotTotal = Number.isInteger(Number(sonarRaw.total)) && Number(sonarRaw.total) >= 0 ? Number(sonarRaw.total) : null;
const sonarSnapshotCollectedCount = Number.isInteger(Number(sonarRaw.collectedCount)) && Number(sonarRaw.collectedCount) >= 0 ? Number(sonarRaw.collectedCount) : sonarIssues.length;
const sonarSnapshotComplete = sonarRaw.complete === true && Array.isArray(sonarRaw.issues) && sonarSnapshotTotal !== null && sonarSnapshotCollectedCount === sonarSnapshotTotal && sonarIssues.length === sonarSnapshotCollectedCount;`
  ).replace("sonarSnapshotComplete ? null : 'UPSTREAM_SNAPSHOT_INCOMPLETE'", "sonarSnapshotComplete ? null : 'INCOMPLETE'");
  assert.notEqual(oldCode, code, 'reconstructed old code must actually differ from the fixed code');
  const rawFetch = { total: 16, p: 1, ps: 500, paging: { total: 16, pageIndex: 1, pageSize: 500 }, issues: Array.from({ length: 16 }, (_, i) => issue(i)) };
  const consolidatedOut = consolidated(16);
  const fn = new AsyncFunction('$', oldCode);
  const oldSonar = (await fn(dollar({ ...baseFixture(), 'Fetch SonarQube Issues': rawFetch, 'Consolidate Baseline Sonar Snapshot': consolidatedOut })))[0].json.enrichedData.sonar;
  assert.equal(oldSonar.complete, false, 'old code must reproduce the proven bug (complete=false despite a genuinely complete snapshot)');
  assert.equal(oldSonar.snapshotError, 'INCOMPLETE', 'old code must reproduce the exact observed literal');
}

// ── 4. Incomplete / fail-closed cases (A-H) ─────────────────────────────────
// A. upstream complete=false -> downstream complete=false
{
  const sonar = await runMerge({ 'Consolidate Baseline Sonar Snapshot': consolidated(5, { complete: false, snapshotError: 'PAGES_INCOMPLETE' }) });
  assert.equal(sonar.complete, false);
}
// B. upstream snapshotError=PAGES_INCOMPLETE -> preserved verbatim
{
  const sonar = await runMerge({ 'Consolidate Baseline Sonar Snapshot': consolidated(5, { complete: false, snapshotError: 'PAGES_INCOMPLETE' }) });
  assert.equal(sonar.snapshotError, 'PAGES_INCOMPLETE');
}
// C. complete=true but collectedCount missing -> fail closed
{
  const bad = consolidated(16); delete bad.collectedCount;
  const sonar = await runMerge({ 'Consolidate Baseline Sonar Snapshot': bad });
  assert.equal(sonar.complete, false);
  assert.equal(sonar.collectedCount, null, 'missing collectedCount must never fall back to issues.length');
  assert.equal(sonar.snapshotError, 'UPSTREAM_SNAPSHOT_INCOMPLETE');
}
// D. complete=true but collectedCount != total -> fail closed
{
  const bad = consolidated(16, { collectedCount: 15 });
  const sonar = await runMerge({ 'Consolidate Baseline Sonar Snapshot': bad });
  assert.equal(sonar.complete, false);
}
// E. complete=true but issues.length != collectedCount -> fail closed
{
  const bad = consolidated(16); bad.issues = bad.issues.slice(0, 15);
  const sonar = await runMerge({ 'Consolidate Baseline Sonar Snapshot': bad });
  assert.equal(sonar.complete, false);
}
// F. zero-finding case -> complete=true
{
  const sonar = await runMerge({ 'Consolidate Baseline Sonar Snapshot': consolidated(0) });
  assert.equal(sonar.complete, true);
  assert.equal(sonar.total, 0); assert.equal(sonar.collectedCount, 0); assert.deepEqual(sonar.issues, []);
  assert.equal(sonar.snapshotError, null);
}
// G. multi-page 600 findings -> complete=true, all 600 preserved
{
  const sonar = await runMerge({ 'Consolidate Baseline Sonar Snapshot': consolidated(600) });
  assert.equal(sonar.complete, true);
  assert.equal(sonar.total, 600); assert.equal(sonar.collectedCount, 600); assert.equal(sonar.issues.length, 600);
}
// H. raw fetch says only 500 but consolidated says 600 -> consolidated wins
{
  const rawFetch = { total: 600, p: 1, ps: 500, issues: Array.from({ length: 500 }, (_, i) => issue(i)) };
  const sonar = await runMerge({ 'Fetch SonarQube Issues': rawFetch, 'Consolidate Baseline Sonar Snapshot': consolidated(600) });
  assert.equal(sonar.total, 600); assert.equal(sonar.collectedCount, 600); assert.equal(sonar.issues.length, 600);
  assert.equal(sonar.complete, true);
}

// ── 5. Source-SHA contract untouched (scope guard) ─────────────────────────
// This node has never handled sourceCommitSha/body.commitSha; confirm that
// remains true post-fix, and confirm no other node in the file was touched.
assert.doesNotMatch(code, /sourceCommitSha|commitSha/, 'Merge All Fetched Data must not gain any commitSha handling');
const normalizeNode = wf.nodes.find(n => n.name === 'Normalize Incident Payload');
assert.match(normalizeNode.parameters.jsCode, /commitSha/, 'sourceCommitSha derivation must remain in Normalize Incident Payload, untouched');

console.log('WF1 baseline propagation (Merge All Fetched Data <- Consolidate Baseline Sonar Snapshot), cases A-H + real execution-1969 regression: PASS');
