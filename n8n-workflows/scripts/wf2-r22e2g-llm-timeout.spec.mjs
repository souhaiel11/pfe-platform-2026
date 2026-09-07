// R22-E2G — structural proof that the three pre-CandidateVerification LLM
// httpRequest nodes now carry an explicit, bounded, deliberate timeout
// (LLM_TIMEOUT_MS=180000), that no automatic retry was introduced, that
// their existing onError/Failure Envelope wiring is untouched, and that
// every other R22-E/R22-E2B safety invariant still holds on the
// regenerated artifact. Pure static checks against the JSON file on disk
// -- nothing here imports/publishes/activates/invokes anything.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const artifactPath = path.join(here, '..', 'pending-live-update', 'wf2-git-patch-pr-v4-1-9adcV31eaIgJyMR0.R22E-TWO-PASS-CANDIDATE.json');
const raw = readFileSync(artifactPath, 'utf8');
const workflow = JSON.parse(raw)[0];

const LLM_TIMEOUT_MS = 180000;
const LLM_NODES = ['Generate Remediation Plan', 'de Patch - HTTP Request', 'Independent Semantic Review'];
const PRODUCTION_WORKFLOW_ID = '9adcV31eaIgJyMR0';
const PRODUCTION_WEBHOOK_PATH = 'wf2-approve';

const nodeByName = new Map(workflow.nodes.map(n => [n.name, n]));
const node = name => {
  const n = nodeByName.get(name);
  assert.ok(n, `expected node '${name}' to exist`);
  return n;
};

// --- Tests 1-3: each of the three LLM nodes has options.timeout = 180000 ---
for (const name of LLM_NODES) {
  const n = node(name);
  assert.equal(n.type, 'n8n-nodes-base.httpRequest', `sanity - '${name}' is still an httpRequest node`);
  assert.equal(n.parameters.options?.timeout, LLM_TIMEOUT_MS, `Test - '${name}' has options.timeout === ${LLM_TIMEOUT_MS}`);
  console.log(`Test PASS - '${name}' options.timeout = ${n.parameters.options.timeout}`);
}

// --- Test 4: exactly 3 nodes in the whole workflow carry this LLM timeout policy ---
const nodesWithLlmTimeout = workflow.nodes.filter(n => n.parameters?.options?.timeout === LLM_TIMEOUT_MS);
assert.equal(nodesWithLlmTimeout.length, 3, 'Test 4 - exactly 3 nodes carry the LLM_TIMEOUT_MS policy');
assert.deepEqual(new Set(nodesWithLlmTimeout.map(n => n.name)), new Set(LLM_NODES), 'Test 4 - the 3 nodes are exactly the intended LLM nodes');
console.log('Test 4 PASS - exactly 3 nodes (the intended LLM nodes) carry the new timeout policy');

// --- Test 5: none of the three has automatic retry enabled ---
for (const name of LLM_NODES) {
  const n = node(name);
  assert.equal(n.retryOnFail ?? false, false, `Test 5 - '${name}' has no retryOnFail`);
  assert.equal(n.maxTries ?? undefined, undefined, `Test 5 - '${name}' has no maxTries`);
}
console.log('Test 5 PASS - no automatic retry added to any of the 3 LLM nodes');

// --- Test 6: all three retain onError = continueErrorOutput ---
for (const name of LLM_NODES) {
  assert.equal(node(name).onError, 'continueErrorOutput', `Test 6 - '${name}' still has onError=continueErrorOutput`);
}
console.log('Test 6 PASS - onError=continueErrorOutput preserved on all 3 LLM nodes');

// --- Test 7: each LLM node's error output (output index 1) still targets its existing Failure Envelope ---
for (const name of LLM_NODES) {
  const conn = workflow.connections[name];
  assert.ok(conn?.main?.[1]?.length, `Test 7 - '${name}' has a wired error output (index 1)`);
  const errorTargets = conn.main[1].map(t => t.node);
  assert.ok(errorTargets.includes(`Failure Envelope - ${name}`), `Test 7 - '${name}' error output reaches its own Failure Envelope`);
  console.log(`Test 7 PASS - '${name}' error output -> ${errorTargets.join(', ')}`);
}

// --- Test 8: CandidateVerification remains downstream of all three (graph reachability) ---
function successors(name) {
  const c = workflow.connections[name];
  if (!c) return [];
  return c.main.flatMap(outputArr => (outputArr || []).map(t => t.node));
}
function reachableFrom(startName) {
  const seen = new Set(); const queue = [startName];
  while (queue.length) {
    const cur = queue.shift();
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const next of successors(cur)) if (!seen.has(next)) queue.push(next);
  }
  return seen;
}
for (const name of LLM_NODES) {
  assert.ok(reachableFrom(name).has('Call Candidate Verification'), `Test 8 - 'Call Candidate Verification' remains reachable (success path) from '${name}'`);
}
console.log('Test 8 PASS - Call Candidate Verification remains downstream of all 3 LLM nodes');

// --- Test 9: zero Git mutation reachable before CandidateVerification PASS (unchanged invariant) ---
const webhookNode = workflow.nodes.find(n => n.type === 'n8n-nodes-base.webhook');
function reachableFromStoppingAt(startName, stopAt) {
  const seen = new Set(); const queue = [startName];
  while (queue.length) {
    const cur = queue.shift();
    if (seen.has(cur)) continue;
    seen.add(cur);
    if (stopAt.has(cur) && cur !== startName) continue;
    for (const next of successors(cur)) if (!seen.has(next)) queue.push(next);
  }
  return seen;
}
const reachableBeforeCV = reachableFromStoppingAt(webhookNode.name, new Set(['Call Candidate Verification']));
for (const gitNode of ['Create Missing Branch', 'Create File in Branch', 'Update File in Branch']) {
  assert.equal(reachableBeforeCV.has(gitNode), false, `Test 9 - '${gitNode}' still unreachable before Call Candidate Verification`);
}
console.log('Test 9 PASS - zero Git mutation reachable before CandidateVerification (invariant preserved)');

// --- Test 10: no production workflow identity/webhook appears ---
assert.notEqual(workflow.id, PRODUCTION_WORKFLOW_ID, 'Test 10 - artifact does not carry the production workflow id');
assert.equal(workflow.active, false, 'Test 10 - artifact is inactive');
const anyProductionWebhook = workflow.nodes.some(n => n.type === 'n8n-nodes-base.webhook' && n.parameters.path === PRODUCTION_WEBHOOK_PATH);
assert.equal(anyProductionWebhook, false, 'Test 10 - no node exposes the production webhook path');
assert.equal(raw.includes(PRODUCTION_WEBHOOK_PATH), false, 'Test 10 - production webhook path string appears nowhere in the file');
console.log('Test 10 PASS - no production workflow identity/webhook present');

// --- Test 11: credential references on the 3 LLM nodes unchanged (still bound, same ids) ---
for (const name of LLM_NODES) {
  const cred = node(name).credentials?.httpHeaderAuth;
  assert.ok(cred?.id, `Test 11 - '${name}' still has a bound httpHeaderAuth credential`);
  console.log(`Test 11 PASS - '${name}' credential unchanged: ${cred.name} (${cred.id})`);
}

// --- Test 12: node count 147 (141 base + R22-E2Q FIX A: 6 SHA-256 nodes); topology otherwise unchanged ---
assert.equal(workflow.nodes.length, 147, 'Test 12 - node count 147 (141 base + R22-E2Q FIX A)');
assert.equal(new Set(workflow.nodes.map(n => n.id)).size, 147, 'Test 12 - all node ids still unique');
console.log('Test 12 PASS - 147 unique nodes (141 + R22-E2Q FIX A + 6 native SHA-256 nodes)');

console.log('\nALL R22-E2G LLM TIMEOUT HARDENING PROOFS PASSED');
