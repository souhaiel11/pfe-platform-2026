// Vérifie les relances après échec dans WF2.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyLlmRetry, LLM_HTTP_NODES } from './harden-wf2-r87-llm-retry.mjs';

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
if (!artifactPath) throw new Error('usage: node wf2-r87-llm-retry.spec.mjs <LIVE-BEFORE-R87.json>');

const root = JSON.parse(readFileSync(artifactPath, 'utf8'));
const before = structuredClone(Array.isArray(root) ? root[0] : root);
const workflow = structuredClone(before);

// --- precondition: the 4 LLM nodes already have retry, just with a 1000ms wait ---
assert.equal(before.nodes.filter((n) => n.type !== 'n8n-nodes-base.stickyNote').length, 182);
assert.equal(before.nodes.filter((n) => n.type === 'n8n-nodes-base.stickyNote').length, 6);
for (const name of LLM_HTTP_NODES) {
  const n = before.nodes.find((x) => x.name === name);
  assert.equal(n.retryOnFail, true, `${name} must already have retryOnFail=true`);
  assert.equal(n.maxTries, 3, `${name} must already have maxTries=3`);
  assert.equal(n.waitBetweenTries, 1000, `${name} must already have waitBetweenTries=1000`);
}
ALL_74_FAILURE_ENVELOPES_CONVERGE(before);
NO_PARASITIC_EDGE(before);

applyLlmRetry(workflow);

// --- exactly the 4 target nodes changed, and only retry fields ---
const beforeByName = new Map(before.nodes.map((n) => [n.name, n]));
let changedNodes = 0;
for (const n of workflow.nodes) {
  const b = beforeByName.get(n.name);
  if (JSON.stringify(n) !== JSON.stringify(b)) {
    changedNodes++;
    assert.ok(LLM_HTTP_NODES.includes(n.name), `unexpected node changed: ${n.name}`);
    const bb = { ...b };
    const nn = { ...n };
    for (const k of ['retryOnFail', 'maxTries', 'waitBetweenTries']) {
      delete bb[k];
      delete nn[k];
    }
    assert.deepEqual(nn, bb, `${n.name}: only retry fields may change (position/parameters/credentials must stay identical)`);
    assert.equal(n.waitBetweenTries, 5000);
    assert.equal(n.maxTries, 3);
    assert.equal(n.retryOnFail, true);
  }
}
assert.equal(changedNodes, 4, 'exactly the 4 LLM nodes must change');

// --- node/sticky counts unchanged ---
assert.equal(workflow.nodes.filter((n) => n.type !== 'n8n-nodes-base.stickyNote').length, 182);
assert.equal(workflow.nodes.filter((n) => n.type === 'n8n-nodes-base.stickyNote').length, 6);
assert.equal(workflow.nodes.length, 188);

// --- connections byte-identical ---
assert.deepEqual(workflow.connections, before.connections, 'connections must be byte-identical');

// --- R84 invariant still holds ---
ALL_74_FAILURE_ENVELOPES_CONVERGE(workflow);
NO_PARASITIC_EDGE(workflow);

console.log(
  'WF2 R87 — waitBetweenTries 1000ms -> 5000ms on the 4 LLM call nodes, nothing else touched, ' +
    '182 functional nodes + 6 stickies intact, connections byte-identical, 74/74 convergence intact: PASS',
);
