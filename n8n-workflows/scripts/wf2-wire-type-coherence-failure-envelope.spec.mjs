// Vérifie la classification et le retour des échecs dans WF2.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { wireTypeCoherenceFailureEnvelope } from './harden-wf2-wire-type-coherence-failure-envelope.mjs';

const ALL_74_FAILURE_ENVELOPES = [
  'Failure Envelope - Accumulate Candidate File', 'Failure Envelope - Adapt Webhook Payload',
  'Failure Envelope - Apply Repository Metadata', 'Failure Envelope - Assemble Candidate Manifest',
  'Failure Envelope - Build File Result', 'Failure Envelope - Build File Result (Pass 2)',
  'Failure Envelope - Build Independent Repository Policy', 'Failure Envelope - Build Reconciled File Result',
  'Failure Envelope - Call Candidate Verification', 'Failure Envelope - Call Cross-File COMPILE_MAIN',
  'Failure Envelope - Call Cross-File COMPILE_TESTS', 'Failure Envelope - Call Cross-File FULL_TEST',
  'Failure Envelope - Call Remote Head Drift Guard', 'Failure Envelope - Call Write Guard',
  'Failure Envelope - Capture Correlation Envelope', 'Failure Envelope - Create File in Branch',
  'Failure Envelope - Create Missing Branch', 'Failure Envelope - Create Pull Request1',
  'Failure Envelope - Enforce Cross-File COMPILE_MAIN', 'Failure Envelope - Enforce Cross-File COMPILE_TESTS',
  'Failure Envelope - Enforce Cross-File FULL_TEST', 'Failure Envelope - Enforce Cross-File Review',
  'Failure Envelope - Enforce Independent Review', 'Failure Envelope - Evaluate GitHub Write Reconciliation',
  'Failure Envelope - Expand Finding Source Files', 'Failure Envelope - Expand Manifest Files',
  'Failure Envelope - Expand Referenced API Sources', 'Failure Envelope - Fetch Finding Source Context',
  'Failure Envelope - Fetch Referenced API Sources', 'Failure Envelope - Fetch Repository Files',
  'Failure Envelope - Fetch Repository Metadata', 'Failure Envelope - Fetch Repository Tree',
  'Failure Envelope - Generate Remediation Plan', 'Failure Envelope - Generic Candidate Preflight',
  'Failure Envelope - Get Main Branch SHA1', 'Failure Envelope - Hash Cross-File Candidate Manifest',
  'Failure Envelope - Independent Cross-File Semantic Review', 'Failure Envelope - Independent Semantic Review',
  'Failure Envelope - Lookup Existing Batch PR', 'Failure Envelope - Lookup Head After Reconciled Write',
  'Failure Envelope - Lookup Head After Reconciled Write (Pass 2)', 'Failure Envelope - Lookup Remediation Branch',
  'Failure Envelope - Parse - Code Patch Output', 'Failure Envelope - Policy Gate - Validate Constraints',
  'Failure Envelope - Prepare - Code Patch Body', 'Failure Envelope - Prepare Batch Context',
  'Failure Envelope - Prepare Branch Creation', 'Failure Envelope - Prepare Cross-File COMPILE_MAIN',
  'Failure Envelope - Prepare Cross-File COMPILE_TESTS', 'Failure Envelope - Prepare Cross-File FULL_TEST',
  'Failure Envelope - Prepare Cross-File Review', 'Failure Envelope - Prepare Generic Remediation Plan',
  'Failure Envelope - Re-check Existing Branch Head', 'Failure Envelope - Re-lookup Baseline Ref Before Creation',
  'Failure Envelope - Re-lookup Remediation Branch Before Create', 'Failure Envelope - Read Back File After Write Error',
  'Failure Envelope - Read Back File After Write Error (Pass 2)', 'Failure Envelope - Record New Branch Baseline',
  'Failure Envelope - Remote Candidate Present?', 'Failure Envelope - Remote Candidate Present? (Pass 2)',
  'Failure Envelope - Return Policy Rejected', 'Failure Envelope - Save Execution Result to Backend',
  'Failure Envelope - Seed New Planned File', 'Failure Envelope - Select Existing PR',
  'Failure Envelope - Transport Requires Read Back?', 'Failure Envelope - Transport Requires Read Back? (Pass 2)',
  'Failure Envelope - Use Existing Branch', 'Failure Envelope - Use Existing PR',
  'Failure Envelope - Validate Batch Completeness', 'Failure Envelope - Validate Cross-File Candidate Manifest',
  'Failure Envelope - Validate Cross-File Type Coherence', 'Failure Envelope - Validate Generic Remediation Plan',
  'Failure Envelope - Verify Content Hash Before Send', 'Failure Envelope - de Patch - HTTP Request',
];
assert.equal(ALL_74_FAILURE_ENVELOPES.length, 74, 'this list itself must enumerate exactly 74 names');

const artifact = new URL(
  '../backups/pre-promotion-r84-wire-type-coherence-envelope-20261003T000000Z/wf2-u3eeMwTuhCsetfcS.LIVE-BEFORE-R84.json',
  import.meta.url,
);
const root = JSON.parse(readFileSync(artifact, 'utf8'));
const before = structuredClone(root[0]);
const workflow = structuredClone(root[0]);

// --- precondition: this is exactly the known-defective live state ---
assert.equal(before.nodes.length, 197);
assert.equal(before.nodes.filter(n => n.type !== 'n8n-nodes-base.stickyNote').length, 186);
assert.equal(before.connections['Failure Envelope - Validate Cross-File Type Coherence'], undefined,
  'precondition: the envelope must currently have no outgoing connection');
const brokenCount = ALL_74_FAILURE_ENVELOPES.filter(fe => {
  const c = before.connections[fe];
  return c?.main?.[0]?.[0]?.node === 'Prepare WF2 Failure Status';
}).length;
assert.equal(brokenCount, 73, 'precondition: exactly 73/74 converge before the fix');

wireTypeCoherenceFailureEnvelope(workflow);

// --- node set: unchanged, byte-identical, nothing added/removed/reordered in substance ---
assert.equal(workflow.nodes.length, before.nodes.length, 'no node added or removed');
assert.equal(workflow.nodes.filter(n => n.type !== 'n8n-nodes-base.stickyNote').length, 186,
  '186 functional nodes, unchanged');
const beforeByName = new Map(before.nodes.map(n => [n.name, n]));
for (const n of workflow.nodes) {
  if (n.name === 'Failure Envelope - Validate Cross-File Type Coherence') continue; // unchanged, checked below
  if (n.name === 'Sticky - Phase 6 - Revue semantique') continue; // the one intended text edit
  assert.deepEqual(n, beforeByName.get(n.name), `node ${n.name} must be byte-identical to the live version`);
}
// the envelope node itself (code/onError/jsCode) must not have changed — only the connection moves
assert.deepEqual(
  workflow.nodes.find(n => n.name === 'Failure Envelope - Validate Cross-File Type Coherence'),
  beforeByName.get('Failure Envelope - Validate Cross-File Type Coherence'),
  'the envelope node definition itself is untouched — only its outgoing connection changes',
);

// --- connections: EXACTLY one key added, nothing else touched ---
const beforeConnKeys = new Set(Object.keys(before.connections));
const afterConnKeys = new Set(Object.keys(workflow.connections));
const addedKeys = [...afterConnKeys].filter(k => !beforeConnKeys.has(k));
const removedKeys = [...beforeConnKeys].filter(k => !afterConnKeys.has(k));
assert.deepEqual(addedKeys, ['Failure Envelope - Validate Cross-File Type Coherence']);
assert.deepEqual(removedKeys, []);
for (const key of beforeConnKeys) {
  assert.deepEqual(workflow.connections[key], before.connections[key],
    `connections['${key}'] must be byte-identical — only the envelope's own entry is new`);
}
assert.deepEqual(workflow.connections['Failure Envelope - Validate Cross-File Type Coherence'], {
  main: [[{ node: 'Prepare WF2 Failure Status', type: 'main', index: 0 }]],
}, 'new connection must match the exact shape used by every other Failure Envelope');

// --- REGRESSION GUARD: 74/74 Failure Envelopes converge on Prepare WF2 Failure Status ---
// This is the assertion this script exists to make permanent: the omission in
// commit 5f33dfc (harden-wf2-plan-authority-type-coherence.mjs) must never
// silently reappear for this or any other envelope.
for (const fe of ALL_74_FAILURE_ENVELOPES) {
  assert.ok(workflow.nodes.some(n => n.name === fe), `envelope ${fe} must exist`);
  const edge = workflow.connections[fe]?.main?.[0]?.[0];
  assert.equal(edge?.node, 'Prepare WF2 Failure Status', `envelope ${fe} must converge on Prepare WF2 Failure Status`);
  assert.equal(edge?.type, 'main');
  assert.equal(edge?.index, 0);
}

// --- sticky: the only content change in this patch, and it now states the fixed truth ---
const stickyAfter = workflow.nodes.find(n => n.name === 'Sticky - Phase 6 - Revue semantique');
const stickyBefore = beforeByName.get('Sticky - Phase 6 - Revue semantique');
assert.equal(stickyBefore.parameters.content, "## Chemins d'echec\n",
  'precondition: the sticky was left mid-edit at just its heading');
assert.match(stickyAfter.parameters.content, /\b74\b.*convergent/s);
assert.doesNotMatch(stickyAfter.parameters.content, /\b73\b/);
for (const n of workflow.nodes) {
  if (n.type !== 'n8n-nodes-base.stickyNote') continue;
  if (n.name === 'Sticky - Phase 6 - Revue semantique') continue;
  assert.deepEqual(n, beforeByName.get(n.name), `sticky ${n.name} must be untouched`);
}

console.log('WF2 R84 — type-coherence envelope wired, 74/74 convergence proven, sticky corrected, nothing else touched: PASS');
