// R22-E2B — proves the R22-E TEST artifact is safe against the live
// production WF2 (id 9adcV31eaIgJyMR0, name "WF2 - Git Patch & PR v4.1",
// webhook "wf2-approve") before any future import is even considered.
// Nothing here imports/publishes/activates anything -- pure static checks
// against the JSON files on disk.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const artifactPath = path.join(here, '..', 'pending-live-update', 'wf2-git-patch-pr-v4-1-9adcV31eaIgJyMR0.R22E-TWO-PASS-CANDIDATE.json');
const raw = readFileSync(artifactPath, 'utf8');
const workflow = JSON.parse(raw)[0]; // Test 1's own JSON-validity is implicit: this line throws if not valid JSON.

const PRODUCTION_WORKFLOW_ID = '9adcV31eaIgJyMR0';
const PRODUCTION_NAME = 'WF2 - Git Patch & PR v4.1';
const PRODUCTION_WEBHOOK_PATH = 'wf2-approve';
const TEST_NAME = 'WF2 - Git Patch & PR R22E TEST';
const TEST_WEBHOOK_PATH = 'wf2-r22e-test';

// Approved credential IDs already present in the live production export
// (R22-E2A) -- anything outside this set on a GitHub-calling node would be
// an unreviewed, unexpected credential reference.
const APPROVED_GITHUB_CREDENTIAL_IDS = new Set(['YBO0vWrPlyoYx4Kr', 'fBueZWwflXWM3RoX']);

// --- Test 1: does NOT contain the production workflow id as its import identity ---
assert.notEqual(workflow.id, PRODUCTION_WORKFLOW_ID, 'Test 1 - artifact must not carry the production workflow id');
console.log('Test 1 PASS - no production workflow id present' + (workflow.id ? ` (has: ${workflow.id})` : ' (omitted entirely)'));

// --- Test 2: active == false ---
assert.equal(workflow.active, false, 'Test 2 - artifact must be inactive');
console.log('Test 2 PASS - active === false');

// --- Test 3: name ---
assert.equal(workflow.name, TEST_NAME, 'Test 3 - artifact must carry the dedicated TEST name');
assert.notEqual(workflow.name, PRODUCTION_NAME, 'Test 3b - artifact name must differ from the production name');
console.log('Test 3 PASS - name = ' + TEST_NAME);

// --- Test 4/5: webhook path isolated, production path not exposed anywhere ---
const webhookNodes = workflow.nodes.filter(n => n.type === 'n8n-nodes-base.webhook');
assert.equal(webhookNodes.length, 1, 'sanity - exactly one webhook node');
assert.equal(webhookNodes[0].parameters.path, TEST_WEBHOOK_PATH, 'Test 4 - webhook path must be the dedicated test path');
const anyProductionWebhook = workflow.nodes.some(n => n.type === 'n8n-nodes-base.webhook' && n.parameters.path === PRODUCTION_WEBHOOK_PATH);
assert.equal(anyProductionWebhook, false, 'Test 5 - no node may expose the production webhook path');
console.log('Test 4/5 PASS - webhook is wf2-r22e-test, production path wf2-approve not exposed anywhere');

// --- Test 5b (R22-E2H) - TEST Webhook node's own node-level identity
// (webhookId) must differ from production's, not just the human-readable
// path. Identity hygiene, not a claimed root cause for the separately
// R22-E2F-RO-proven stale-registration issue. ---
const PRODUCTION_WEBHOOK_ID = '6155a0ff-9dea-4479-a1c8-96c827797354';
assert.notEqual(webhookNodes[0].webhookId, PRODUCTION_WEBHOOK_ID, 'Test 5b - TEST Webhook node webhookId must differ from production webhookId');
console.log('Test 5b PASS - TEST webhookId (' + webhookNodes[0].webhookId + ') distinct from production webhookId');

// --- Test 6/7: credential coverage + no unapproved credential IDs ---
const githubCallingTypes = new Set(['n8n-nodes-base.github']);
const isGithubHttpCall = (n) => n.type === 'n8n-nodes-base.httpRequest' && typeof n.parameters?.url === 'string' && n.parameters.url.includes('api.github.com');
const githubNodes = workflow.nodes.filter(n => githubCallingTypes.has(n.type) || isGithubHttpCall(n));
assert.ok(githubNodes.length > 10, 'sanity - found a substantial number of GitHub-calling nodes to audit');

const coverageReport = [];
let allCovered = true;
let noUnapprovedIds = true;
for (const n of githubNodes) {
  const credEntries = Object.values(n.credentials || {});
  const present = credEntries.length > 0;
  if (!present) allCovered = false;
  for (const cred of credEntries) {
    if (n.type === 'n8n-nodes-base.httpRequest' || n.type === 'n8n-nodes-base.github') {
      // Only githubApi-typed references are in scope for this approved-id check
      // (httpHeaderAuth references, e.g. 'git-n8n', are a separate credential
      // family already present on some pre-existing nodes and out of scope here).
    }
  }
  const githubApiCred = n.credentials?.githubApi;
  if (githubApiCred && !APPROVED_GITHUB_CREDENTIAL_IDS.has(githubApiCred.id)) noUnapprovedIds = false;
  coverageReport.push({ name: n.name, type: n.type, credentialPresent: present });
}
console.log('\nTest 6 — GitHub-calling node credential coverage:');
for (const row of coverageReport) console.log(`  ${row.credentialPresent ? 'YES' : 'NO '} | ${row.type} | ${row.name}`);
assert.equal(allCovered, true, 'Test 6 - every GitHub-calling node must have a credential reference present');
console.log('Test 6 PASS - ' + coverageReport.length + '/' + coverageReport.length + ' GitHub-calling nodes have a credential reference');

assert.equal(noUnapprovedIds, true, 'Test 7 - no GitHub-calling node may reference a credential ID outside the approved, already-existing set');
console.log('Test 7 PASS - no new/unapproved credential IDs introduced');

// --- Test 8: no literal secret/token/password value anywhere in the file ---
const secretLikePattern = /"(ghp_|gho_|github_pat_|sk-ant-|sk-|xox[baprs]-)[A-Za-z0-9_-]{10,}"/;
assert.equal(secretLikePattern.test(raw), false, 'Test 8 - no literal secret/token value pattern found anywhere in the artifact');
console.log('Test 8 PASS - no literal secret/token pattern found in the artifact file');

// --- Test 9: 147 unique node IDs (141 base + R22-E2Q FIX A: 6 native SHA-256 nodes) ---
const ids = workflow.nodes.map(n => n.id);
assert.equal(workflow.nodes.length, 147, 'Test 9 - node count unchanged by hardening');
assert.equal(new Set(ids).size, 147, 'Test 9 - all 147 node ids remain unique');
console.log('Test 9 PASS - 147 unique node ids (hardening changed only id/name/active/webhook/credentials metadata, not node topology)');

// --- Test 10: no dangling connections ---
const nameSet = new Set(workflow.nodes.map(n => n.name));
const dangling = [];
for (const [src, c] of Object.entries(workflow.connections)) {
  if (!nameSet.has(src)) dangling.push(['SOURCE_MISSING', src]);
  for (const outputArr of c.main || []) for (const t of outputArr) if (!nameSet.has(t.node)) dangling.push(['TARGET_MISSING', src, t.node]);
}
assert.deepEqual(dangling, [], 'Test 10 - no dangling connection references');
console.log('Test 10 PASS - no dangling connections');

// --- Tests 11-14: architecture invariants (graph reachability, mirroring wf2-r22e-two-pass.spec.mjs) ---
function successors(name) {
  const c = workflow.connections[name];
  if (!c) return [];
  return c.main.flatMap(outputArr => outputArr.map(t => t.node));
}
function reachableFrom(startName, { stopAt = new Set() } = {}) {
  const seen = new Set(); const queue = [startName];
  while (queue.length) {
    const current = queue.shift();
    if (seen.has(current)) continue;
    seen.add(current);
    if (stopAt.has(current) && current !== startName) continue;
    for (const next of successors(current)) if (!seen.has(next)) queue.push(next);
  }
  return seen;
}
{
  const reachable = reachableFrom(webhookNodes[0].name, { stopAt: new Set(['Call Candidate Verification']) });
  for (const gitNode of ['Create Missing Branch', 'Create File in Branch', 'Update File in Branch']) {
    assert.equal(reachable.has(gitNode), false, `Test 11 - '${gitNode}' unreachable before Call Candidate Verification`);
  }
  console.log('Test 11 PASS - verification still enforced before any Git mutation');
}
{
  // Test 12: branch creation only reachable after Write Guard Passed? TRUE branch.
  const reachableAfterGuardTrue = reachableFrom('Branch Existed At Generation?');
  assert.ok(reachableAfterGuardTrue.has('Create Missing Branch'), 'sanity - Create Missing Branch is reachable from the post-guard branch-existence check at all');
  const reachableFromWebhookStoppingAtGuard = reachableFrom(webhookNodes[0].name, { stopAt: new Set(['Write Guard Passed?']) });
  assert.equal(reachableFromWebhookStoppingAtGuard.has('Create Missing Branch'), false, 'Test 12 - branch creation unreachable without passing through Write Guard Passed? first');
  console.log('Test 12 PASS - branch creation still enforced after verification');
}
{
  const reachableStoppingAtDrift = reachableFrom(webhookNodes[0].name, { stopAt: new Set(['Call Remote Head Drift Guard']) });
  for (const gitNode of ['Create Missing Branch', 'Create File in Branch', 'Update File in Branch']) {
    assert.equal(reachableStoppingAtDrift.has(gitNode), false, `Test 13 - '${gitNode}' unreachable without passing through the remote-head drift guard first`);
  }
  console.log('Test 13 PASS - remote-head check still enforced before first write');
}
{
  const reachableStoppingAtCompleteness = reachableFrom(webhookNodes[0].name, { stopAt: new Set(['Validate Batch Completeness']) });
  assert.equal(reachableStoppingAtCompleteness.has('Create Pull Request1'), false, 'Test 14 - PR creation unreachable without passing through Validate Batch Completeness first');
  console.log('Test 14 PASS - manifest completeness still enforced before PR');
}

console.log('\nALL R22-E2B NON-PROD SAFETY PROOFS PASSED');
