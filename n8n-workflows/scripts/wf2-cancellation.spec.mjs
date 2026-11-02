// Vérifie l’annulation et ses identifiants de tentative dans WF2.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildCandidate, targetUrl, reachable, writes, boundary } from './build-wf2-cancellation.mjs';

import { executableContent, executableNode, isSticky } from './wf2-drift-content.mjs';

const { source, candidate: expected, report } = buildCandidate();
// Runtime tests compare every executable node field, connection and setting.
// Presentation equality belongs to the separate presentation suite.
const artifact = process.env.WF2_CANCELLATION_ARTIFACT || targetUrl;
const parsed = JSON.parse(readFileSync(artifact));
const w = Array.isArray(parsed) ? parsed[0] : parsed;
assert.equal(w.id, expected.id);
assert.deepEqual(executableContent(w), executableContent(expected), 'executable content must match approved R91');
for (const name of ['Register WF2 Execution', 'Execution May Continue?', 'Restore Registered Intake',
  'Pre-Git Cancellation Gate', 'Git Write Allowed?', 'Restore Pre-Git Context', 'WF2 Cancellation Terminal']) {
  assert.equal(w.nodes.filter(n => n.name === name).length, 1, `required unique cancellation node: ${name}`);
}
/** Retrouve ou construit le nœud du workflow demandé. */
const node = name => w.nodes.find(n => n.name === name);
/** Construit la condition utilisée par le nœud. */
const condition = (name, value) => {
  const expression = node(name).parameters.conditions.conditions[0].leftValue.slice(3, -2);
  return new Function('$json', `return (${expression});`)(value);
};
/** Traite le résultat reçu et actualise les données locales. */
const next = (name, port = 0) => w.connections[name].main[port].map(e => e.node);

// W1: evaluate the actual installed 2.14.2 implementation offline with
// dependency stubs; no workflow or n8n API execution.
const exports = {};
new Function('exports', 'require', readFileSync(new URL('../../docs/qa/wf2-cancellation/n8n-2.14.2-get-additional-keys.js', import.meta.url), 'utf8'))(
  exports, name => name.includes('get-secrets-proxy') ? { 
  /** Simule la lecture des données demandées par le composant. */
  getSecretsProxy: () => ({}) } : {});
const keys = exports.getAdditionalKeys({ executionId: '456', variables: {} }, 'webhook');
assert.equal(new Function('$execution', 'return $execution.id;')(keys.$execution), '456');
assert.match(node('Register WF2 Execution').parameters.jsonBody, /executionId:\$execution\.id/);
console.log('W1 PASS: $execution.id verified against installed n8n 2.14.2 implementation');

assert.equal(node('Register WF2 Execution').type, 'n8n-nodes-base.httpRequest');
assert.deepEqual(next('Adapt Webhook Payload'), ['Register WF2 Execution']);
assert.deepEqual(next('Capture Correlation Envelope'), source.connections['Capture Correlation Envelope'].main[0].map(e => e.node));
assert.equal(condition('Execution May Continue?', { success: true, cancelRequested: true, cancelled: true }), false);
const cancelledStart = next('Execution May Continue?', 1)[0];
assert.equal(cancelledStart, 'WF2 Cancellation Terminal');
assert.equal(reachable(w, cancelledStart).size, 1);
assert.ok(![...reachable(w, cancelledStart)].some(name => /Planner|Plan|LLM/.test(name)));
console.log('W2-W3 PASS');

for (const [i, name] of writes.entries()) {
  assert.ok(reachable(w, 'Webhook').has(name));
  assert.ok(!reachable(w, 'Webhook', new Set(['Pre-Git Cancellation Gate'])).has(name));
  console.log(`W${i + 4} PASS: Pre-Git Cancellation Gate dominates ${name}`);
}
assert.equal(condition('Git Write Allowed?', { allowed: true, cancelRequested: false }), true);
assert.equal(condition('Git Write Allowed?', { allowed: false, cancelRequested: true }), false);
assert.equal(condition('Git Write Allowed?', { allowed: 'true', cancelRequested: false }), false);
assert.equal(condition('Git Write Allowed?', {}), false);
assert.equal(condition('Execution May Continue?', { success: true, cancelRequested: false, cancelled: false }), true);
assert.equal(condition('Execution May Continue?', {}), false);
assert.equal(condition('Execution May Continue?', { success: true, cancelRequested: false, cancelled: false, stale: true }), false);
assert.deepEqual(next('Restore Pre-Git Context'), [boundary]);
assert.deepEqual(next('Restore Registered Intake'), source.connections['Adapt Webhook Payload'].main[0].map(e => e.node));
assert.deepEqual([...reachable(w, boundary)].sort(), [...reachable(source, boundary)].sort());
console.log('W8 PASS: original write path preserved');

const cancelledGate = next('Git Write Allowed?', 1)[0];
for (const start of [cancelledStart, cancelledGate]) {
  const seen = reachable(w, start);
  for (const forbidden of [...writes, 'Persist WF2 Failure Status', 'Save Execution Result to Backend']) assert.ok(!seen.has(forbidden));
}
assert.equal(w.connections['WF2 Cancellation Terminal'], undefined);
console.log('W9-W11 PASS: cancellation reaches no write, success or failure callback');

// W12: strict equality of ALL original executable node definitions (including code,
// credentials, guards, retries, failure branches) is stronger than sampling
// a few guard strings. Only the two successful intake/boundary edges change.
for (const old of source.nodes.filter(n => !isSticky(n))) assert.deepEqual(executableNode(node(old.name)), executableNode(old));
for (const [name, connections] of Object.entries(source.connections)) {
  if (['Adapt Webhook Payload', 'Remote Head Drift Passed?'].includes(name)) {
    assert.deepEqual(w.connections[name].main.slice(1), connections.main.slice(1));
  } else assert.deepEqual(w.connections[name], connections);
}
for (const name of ['Register WF2 Execution', 'Pre-Git Cancellation Gate']) {
  assert.equal(node(name).continueOnFail, undefined);
  assert.equal(node(name).onError, undefined);
  assert.deepEqual(Object.keys(w.connections[name]), ['main']);
  assert.equal(w.connections[name].main.length, 1);
  assert.ok(node(name).parameters.options.timeout > 0);
  assert.match(JSON.stringify(node(name)), /N8N_INTERNAL_SECRET/);
  assert.doesNotMatch(JSON.stringify(node(name)), /N8N_API_KEY/);
}
assert.equal(report.UNRELATED_NODE_CHANGED_COUNT, 0);
console.log('W12 PASS: all original executable R90 node/security definitions and error edges unchanged');
console.log('WF2 cancellation offline W1-W12: ALL PASS');
