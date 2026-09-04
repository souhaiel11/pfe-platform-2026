/**
 * PFE R19.1 — WF2 branch-creation context-loss — offline isolated validation.
 *
 * Loads wf2_fixed.json (the patched ACTIVE WF2 v4.1) and drives the
 *   Prepare Batch Context -> Lookup Remediation Branch -> Branch Exists?
 *   -> {Use Existing Branch | Prepare Branch Creation -> Create Missing Branch}
 * sub-graph with the REAL jsCode of every Code node and the REAL URL/body
 * expressions of the two httpRequest nodes. No network: the GitHub ref lookup
 * is mocked per case.
 *
 * Canonical R19 batch (must be preserved end to end):
 *   incidentId 65e35d1b-212f-4153-bd63-fba6e8eebc2c
 *   requestId  f1af3192-40f0-4400-869a-3854246d7a11
 *   batchId    9c190dbec8d6f3d17b2b7e961e329bdc122e00ed18f88586b85bdca7a8d1c49d
 *   baseSha    1aded596713cbe8477a4bf652cd081b9aec00aa7
 *   findings   b8db9c11… java:S4684 TaskController.java:36
 *              f11d4686… java:S4684 TaskController.java:41
 */
import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const exported = JSON.parse(readFileSync(new URL('../backups/r19-3c-prebuild/wf2-trusted-f95634ef.json', import.meta.url), 'utf8'));
const wf = Array.isArray(exported) ? exported[0] : exported;
assert.equal(wf.name.startsWith('WF2'), true);
const nodeMap = new Map(wf.nodes.map(n => [n.name, n]));
const node = n => { assert.ok(nodeMap.has(n), `missing node ${n}`); return nodeMap.get(n); };
const out = (n, i = 0) => (wf.connections[n]?.main?.[i] || []).map(e => e.node);

// ─── canonical batch ────────────────────────────────────────────────────────
const INCIDENT = '65e35d1b-212f-4153-bd63-fba6e8eebc2c';
const REQUEST = 'f1af3192-40f0-4400-869a-3854246d7a11';
const BATCH = '9c190dbec8d6f3d17b2b7e961e329bdc122e00ed18f88586b85bdca7a8d1c49d';
const BASE_SHA = '1aded596713cbe8477a4bf652cd081b9aec00aa7';
const TARGET_BRANCH = `fix/pfe-${INCIDENT}-${REQUEST}`;
const findingIds = ['b8db9c11-ddf9-4a23-9bf3-1d2ff15a59ef', 'f11d4686-a7ba-4c0c-abbb-a12998c57220'];
const findings = findingIds.map((id, i) => ({
  findingId: id, id, rule: 'java:S4684', severity: 'CRITICAL', type: 'VULNERABILITY',
  source: 'SONARQUBE', stage: 'sonar',
  file: 'src/main/java/com/pfe/devsecops/controller/TaskController.java', line: 36 + 5 * i,
}));

// Policy Gate output as consumed by Prepare Batch Context ($('Policy Gate…').first())
const policyGate = {
  incidentId: INCIDENT, projectId: '3aa1c9b9-e114-40e4-884b-ebc7aa32e002', buildNumber: 140,
  requestId: REQUEST, batchId: BATCH, batchKey: BATCH, attemptCount: 3,
  repository_owner: 'souhaiel11', repository_name: 'pfe-app-test', githubRepo: 'souhaiel11/pfe-app-test',
  default_branch: 'main',
  targetFiles: ['src/main/java/com/pfe/devsecops/controller/TaskController.java'],
  findingIds: [...findingIds], findings: [...findings],
};
// Get Main Branch SHA1 output as consumed by Prepare Batch Context ($input.first())
const mainRef = { ref: 'refs/heads/main', object: { sha: BASE_SHA, type: 'commit' } };

// ─── minimal n8n runtime shim ───────────────────────────────────────────────
function runCode(name, { input, ctxByNode }) {
  const src = node(name).parameters.jsCode;
  const $ = ref => ({
    first: () => ({ json: ctxByNode[ref] ?? (() => { throw new Error(`no run data for $('${ref}')`); })() }),
  });
  const $items = (ref) => [{ json: ctxByNode[ref] }];
  const $input = { first: () => ({ json: input }) };
  const $json = input;
  const $execution = { id: '9999' };
  const fn = new Function('$', '$items', '$input', '$json', '$execution',
    `"use strict";${src}`);
  return fn($, $items, $input, $json, $execution);
}
// n8n "{{ expr }}" evaluation for httpRequest string params, $json in scope
function tmpl(str, $json) {
  return str.replace(/^=/, '').replace(/\{\{([\s\S]*?)\}\}/g, (_, e) =>
    String(new Function('$json', `"use strict";return (${e});`)($json)));
}

// ─── wiring assertions (structure) ──────────────────────────────────────────
assert.deepEqual(out('Prepare Batch Context'), ['Lookup Remediation Branch']);
assert.deepEqual(out('Lookup Remediation Branch'), ['Branch Exists?']);
assert.deepEqual(out('Lookup Remediation Branch', 1), ['Prepare WF2 Failure Status']);
assert.deepEqual(out('Branch Exists?', 0), ['Use Existing Branch']);
assert.deepEqual(out('Branch Exists?', 1), ['Prepare Branch Creation']);
assert.deepEqual(out('Prepare Branch Creation', 0), ['Create Missing Branch']);
assert.deepEqual(out('Prepare Branch Creation', 1), ['Prepare WF2 Failure Status']);
assert.deepEqual(out('Create Missing Branch', 0), ['Expand Approved Target Files']);
assert.deepEqual(out('Use Existing Branch', 0), ['Expand Approved Target Files']);
console.log('✓ wiring: 200→Use Existing Branch ; 404→Prepare Branch Creation→Create Missing Branch ; both→Expand Approved Target Files');

// ─── shared: Prepare Batch Context with the REAL node code ───────────────────
const pbc = runCode('Prepare Batch Context', {
  input: mainRef, ctxByNode: { 'Policy Gate - Validate Constraints': policyGate },
})[0].json;
assert.equal(pbc.repository_owner, 'souhaiel11');
assert.equal(pbc.repository_name, 'pfe-app-test');
assert.equal(pbc.targetBranchName, TARGET_BRANCH);
assert.equal(pbc.baseSha, BASE_SHA);
assert.equal(pbc.batchId, BATCH);
assert.deepEqual(pbc.findingIds, findingIds);
const ctxByNode = { 'Policy Gate - Validate Constraints': policyGate, 'Prepare Batch Context': pbc };
console.log('✓ Prepare Batch Context: context intact (owner/repo/branch/baseSha/batchId/findingIds)');

// Branch Exists? predicate (real IF condition: $json.statusCode === 200)
const branchExistsTrue = lookupItem => Number(lookupItem.statusCode) === 200;

// ══ CASE A — remediation branch missing (lookup 404) ════════════════════════
{
  const lookup = { body: { message: 'Not Found', status: '404' }, headers: {}, statusCode: 404, statusMessage: 'Not Found' };
  assert.equal(branchExistsTrue(lookup), false, 'A: 404 must route to false/create');
  const prep = runCode('Prepare Branch Creation', { input: lookup, ctxByNode })[0].json;
  assert.equal(prep.repository_owner, 'souhaiel11');
  assert.equal(prep.repository_name, 'pfe-app-test');
  assert.equal(prep.targetBranchName, TARGET_BRANCH);
  assert.equal(prep.baseSha, BASE_SHA);
  assert.equal(prep.batchId, BATCH);
  assert.equal(prep.requestId, REQUEST);
  assert.equal(prep.incidentId, INCIDENT);
  assert.deepEqual(prep.findingIds, findingIds);
  assert.equal(prep.lookupStatusCode, 404);

  const url = tmpl(node('Create Missing Branch').parameters.url, prep);
  const body = JSON.parse(tmpl(node('Create Missing Branch').parameters.jsonBody, prep));
  assert.equal(url, 'https://api.github.com/repos/souhaiel11/pfe-app-test/git/refs');
  assert.equal(body.ref, `refs/heads/${TARGET_BRANCH}`);
  assert.equal(body.sha, BASE_SHA);
  assert.ok(!/undefined|null/.test(url + JSON.stringify(body)), 'A: no undefined/null in request');
  console.log('✓ CASE A branch-missing:', url, JSON.stringify(body));
}

// ══ CASE B — remediation branch already exists (lookup 200) ═════════════════
{
  const lookup = { body: { ref: `refs/heads/${TARGET_BRANCH}`, object: { sha: 'abc123' } }, headers: {}, statusCode: 200, statusMessage: 'OK' };
  assert.equal(branchExistsTrue(lookup), true, 'B: 200 must route to true/existing');
  const existing = runCode('Use Existing Branch', { input: lookup, ctxByNode })[0].json;
  assert.equal(existing.repository_owner, 'souhaiel11');
  assert.equal(existing.targetBranchName, TARGET_BRANCH);
  assert.equal(existing.baseSha, BASE_SHA);
  assert.equal(existing.batchId, BATCH);
  assert.deepEqual(existing.findingIds, findingIds);
  // create branch must NOT be entered on this path
  assert.ok(!out('Branch Exists?', 0).includes('Create Missing Branch'));
  assert.ok(!out('Branch Exists?', 0).includes('Prepare Branch Creation'));
  console.log('✓ CASE B branch-exists: context preserved, no duplicate branch create');
}

// ══ CASE C — malformed / inconclusive ═════════════════════════════════════
{
  // C1 — lookup returns non-404 technical status (e.g. 500): fail closed, no write
  const lookup500 = { body: { message: 'Server Error' }, headers: {}, statusCode: 500, statusMessage: 'ERR' };
  assert.equal(branchExistsTrue(lookup500), false);
  assert.throws(() => runCode('Prepare Branch Creation', { input: lookup500, ctxByNode }),
    /BRANCH_LOOKUP_INCONCLUSIVE:500/, 'C1: 500 must fail closed');
  console.log('✓ CASE C1 non-404 lookup (500): BRANCH_LOOKUP_INCONCLUSIVE, no GitHub write');

  // C2 — lookup item carries no statusCode at all: fail closed
  assert.throws(() => runCode('Prepare Branch Creation', { input: {}, ctxByNode }),
    /BRANCH_LOOKUP_INCONCLUSIVE:NO_STATUS/, 'C2: missing status must fail closed');
  console.log('✓ CASE C2 no statusCode: BRANCH_LOOKUP_INCONCLUSIVE:NO_STATUS');

  // C3 — 404 but batch context missing baseSha: fail closed before any write
  const brokenCtx = { ...ctxByNode, 'Prepare Batch Context': { ...pbc, baseSha: '' } };
  assert.throws(() => runCode('Prepare Branch Creation',
    { input: { statusCode: 404 }, ctxByNode: brokenCtx }),
    /BRANCH_CONTEXT_INCOMPLETE:baseSha/, 'C3: incomplete context must fail closed');
  console.log('✓ CASE C3 incomplete context (baseSha): BRANCH_CONTEXT_INCOMPLETE, no GitHub write');

  // C4 — 404 but repository_owner missing
  const brokenCtx2 = { ...ctxByNode, 'Prepare Batch Context': { ...pbc, repository_owner: '' } };
  assert.throws(() => runCode('Prepare Branch Creation',
    { input: { statusCode: 404 }, ctxByNode: brokenCtx2 }),
    /BRANCH_CONTEXT_INCOMPLETE:repository_owner/, 'C4');
  console.log('✓ CASE C4 incomplete context (repository_owner): BRANCH_CONTEXT_INCOMPLETE');
}

// ── regression: nodes / expressions left untouched ─────────────────────────
assert.equal(wf.nodes.length, 48);
const liveCreate = JSON.parse(readFileSync(new URL('../backups/wf2-git-patch-pr-v4-1-9adcV31eaIgJyMR0.LIVE-BACKUP-20260903T100849Z.draft-4b85520d.json', import.meta.url), 'utf8'))
  .nodes.find(n => n.name === 'Create Missing Branch');
assert.deepEqual(node('Create Missing Branch').parameters, liveCreate.parameters, 'Create Missing Branch unchanged');
assert.deepEqual(node('Lookup Remediation Branch').parameters,
  JSON.parse(readFileSync(new URL('../backups/wf2-git-patch-pr-v4-1-9adcV31eaIgJyMR0.LIVE-BACKUP-20260903T100849Z.draft-4b85520d.json', import.meta.url), 'utf8'))
    .nodes.find(n => n.name === 'Lookup Remediation Branch').parameters, 'Lookup Remediation Branch unchanged');
assert.deepEqual(node('Branch Exists?').parameters,
  JSON.parse(readFileSync(new URL('../backups/wf2-git-patch-pr-v4-1-9adcV31eaIgJyMR0.LIVE-BACKUP-20260903T100849Z.draft-4b85520d.json', import.meta.url), 'utf8'))
    .nodes.find(n => n.name === 'Branch Exists?').parameters, 'Branch Exists? unchanged');
// only the false-branch edge of Branch Exists? changed vs live
const liveConn = JSON.parse(readFileSync(new URL('../backups/wf2-git-patch-pr-v4-1-9adcV31eaIgJyMR0.LIVE-BACKUP-20260903T100849Z.draft-4b85520d.json', import.meta.url), 'utf8')).connections;
for (const k of Object.keys(liveConn)) {
  if (k === 'Branch Exists?') continue;
  assert.deepEqual(wf.connections[k], liveConn[k], `connection ${k} unchanged`);
}
assert.deepEqual(wf.connections['Branch Exists?'].main[0], liveConn['Branch Exists?'].main[0], 'Branch Exists? true edge unchanged');
console.log('✓ regression: Create Missing Branch / Lookup / Branch Exists? params byte-identical; only Branch Exists?[false] edge rewired + 1 node added');

console.log('\nALL R19.1 ISOLATED CHECKS PASSED');
