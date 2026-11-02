// Vérifie les relances après échec dans WF2.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyOpusRetryBackoff, OPUS_HTTP_NODE } from './harden-wf2-r88-opus-retry-backoff.mjs';

/** Vérifie les résultats attendus dans ce scénario. */
const ALL_74_FAILURE_ENVELOPES_CONVERGE = (workflow) => {
  const fe = workflow.nodes.filter((n) => n.name.startsWith('Failure Envelope'));
  assert.equal(fe.length, 74);
  for (const n of fe) {
    const edge = workflow.connections[n.name]?.main?.[0]?.[0];
    assert.equal(edge?.node, 'Prepare WF2 Failure Status', `${n.name} must still converge`);
  }
};

/** Vérifie les résultats attendus dans ce scénario. */
const NO_PARASITIC_EDGE = (workflow) => {
  const targets =
    workflow.connections['Record New Branch Baseline']?.main?.[0]?.map((e) => e.node) ?? [];
  assert.ok(!targets.includes('Remote Candidate Present?'), 'parasitic edge must remain absent');
};

const artifactPath = process.argv[2];
if (!artifactPath) throw new Error('usage: node wf2-r88-opus-retry-backoff.spec.mjs <LIVE-BEFORE-R88.json>');

const root = JSON.parse(readFileSync(artifactPath, 'utf8'));
const before = structuredClone(Array.isArray(root) ? root[0] : root);
const workflow = structuredClone(before);

// --- precondition ---
assert.equal(before.nodes.filter((n) => n.type !== 'n8n-nodes-base.stickyNote').length, 182);
assert.equal(before.nodes.filter((n) => n.type === 'n8n-nodes-base.stickyNote').length, 6);
const opusBefore = before.nodes.find((n) => n.name === OPUS_HTTP_NODE);
assert.equal(opusBefore.retryOnFail, true);
assert.equal(opusBefore.maxTries, 3);
assert.equal(opusBefore.waitBetweenTries, 1000, 'R87 was never deployed -- live value is still 1000ms');
// confirm the other 3 LLM nodes are NOT touched by this patch
const others = ['Generate Remediation Plan', 'Independent Semantic Review', 'Independent Cross-File Semantic Review'];
ALL_74_FAILURE_ENVELOPES_CONVERGE(before);
NO_PARASITIC_EDGE(before);

applyOpusRetryBackoff(workflow);

// --- exactly 1 node changed, only retry fields ---
const beforeByName = new Map(before.nodes.map((n) => [n.name, n]));
let changedNodes = 0;
for (const n of workflow.nodes) {
  const b = beforeByName.get(n.name);
  if (JSON.stringify(n) !== JSON.stringify(b)) {
    changedNodes++;
    assert.equal(n.name, OPUS_HTTP_NODE, `unexpected node changed: ${n.name}`);
    const bb = { ...b };
    const nn = { ...n };
    for (const k of ['retryOnFail', 'maxTries', 'waitBetweenTries']) {
      delete bb[k];
      delete nn[k];
    }
    assert.deepEqual(nn, bb, 'only retry fields may change');
    assert.equal(n.waitBetweenTries, 20000);
    assert.equal(n.maxTries, 3);
    assert.equal(n.retryOnFail, true);
  }
}
assert.equal(changedNodes, 1, 'exactly 1 node (the Opus call) must change');

for (const name of others) {
  const n = workflow.nodes.find((x) => x.name === name);
  assert.equal(n.waitBetweenTries, 1000, `${name} must be untouched by this patch`);
}

// --- counts unchanged ---
assert.equal(workflow.nodes.filter((n) => n.type !== 'n8n-nodes-base.stickyNote').length, 182);
assert.equal(workflow.nodes.filter((n) => n.type === 'n8n-nodes-base.stickyNote').length, 6);
assert.equal(workflow.nodes.length, 188);

// --- connections byte-identical ---
assert.deepEqual(workflow.connections, before.connections, 'connections must be byte-identical');

ALL_74_FAILURE_ENVELOPES_CONVERGE(workflow);
NO_PARASITIC_EDGE(workflow);

console.log(
  'WF2 R88 — waitBetweenTries 1000ms -> 20000ms on the single Opus 5 call node only, ' +
    'the other 3 LLM nodes untouched, 182 functional + 6 stickies intact, connections byte-identical, ' +
    '74/74 convergence intact: PASS',
);
