import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = name => JSON.parse(readFileSync(new URL('../pending-live-update/' + name, import.meta.url), 'utf8'))[0];
const base = read('wf2-git-patch-pr-v4-1-9adcV31eaIgJyMR0.CANONICAL-FINAL.json');
const target = read('wf2-git-patch-pr-u3eeMwTuhCsetfcS.PROMOTION-TARGET.json');
const id = 'u3eeMwTuhCsetfcS';
const node = name => target.nodes.find(n => n.name === name);
assert.equal(target.id, id);
assert.equal(target.active, false, 'artifact is not an activation request');
assert.equal(node('Webhook').parameters.path, 'wf2-r22e-test');
assert.equal(node('Webhook').parameters.httpMethod, 'POST');
assert.equal(target.nodes.length, 147);
assert.equal(new Set(target.nodes.map(n => n.id)).size, 147);
assert.equal(new Set(target.nodes.map(n => n.name)).size, 147);
assert.deepEqual(target.connections, base.connections, 'all corrective and failure routing preserved');
// R74 -- bounded transient-network retry (wf2-resilience.spec.mjs) legitimately
// adds retryOnFail/maxTries/waitBetweenTries to exactly these two non-mutating
// nodes, after the identity promotion. Excluded from the strict byte-parity
// check below on that basis alone -- every other property must still match
// the base exactly, same as any other node.
const RETRY_HARDENED = ['Get Main Branch SHA1', 'Independent Semantic Review'];
for (const n of target.nodes) {
  const previous = base.nodes.find(b => b.name === n.name);
  assert.deepEqual(n.credentials, previous.credentials, 'credential references unchanged');
  if (!['Webhook', 'Capture Correlation Envelope', ...RETRY_HARDENED].includes(n.name)) assert.deepEqual(n, previous);
  else if (RETRY_HARDENED.includes(n.name)) {
    const { retryOnFail, maxTries, waitBetweenTries, ...rest } = n;
    assert.deepEqual(rest, previous, `${n.name}: only retry properties may differ from base`);
  }
  assert.doesNotMatch(JSON.stringify(n.parameters), /httpRequestWithAuthentication|requestWithAuthenticationPaginated|(?:this\.)?helpers\./);
  assert.doesNotMatch(JSON.stringify(n.parameters), /9adcV31eaIgJyMR0/);
}
for (const outputs of Object.values(target.connections)) {
  for (const ports of Object.values(outputs)) for (const edges of ports) for (const edge of edges) assert.ok(node(edge.node));
}
const body = { incidentId: 'i', projectId: 'p', buildNumber: 1, requestId: 'r', batchId: 'b', batchKey: 'b',
  attemptCount: 2, findingIds: ['a'], workflowId: 'spoofed-input' };
const capture = workflow => new Function('$input', '$workflow', node('Capture Correlation Envelope').parameters.jsCode)(
  { first: () => ({ json: { body } }) }, workflow)[0].json.correlationEnvelope;
const envelope = capture({ id });
assert.equal(envelope.workflowId, id);
assert.equal(capture({ id: 'different-runtime-id' }).workflowId, 'different-runtime-id', 'real context, not target constant');
for (const missing of [{}, { id: '' }, { id: null }, { id: 42 }, { id: ' invalid ' }]) {
  assert.throws(() => capture(missing), /WORKFLOW_IDENTITY_UNAVAILABLE/);
}
const failure = new Function('$input', '$execution', node('Prepare WF2 Failure Status').parameters.jsCode)(
  { first: () => ({ json: { correlationEnvelope: envelope, failureCode: 'TEST_FAILURE' } }) }, { id: 123 })[0].json;
assert.equal(failure.workflowId, id);
const expression = node('Save Execution Result to Backend').parameters.jsonBody;
const success = JSON.parse(new Function('$items', '$execution', '$', '$json', 'return (' + expression.slice(3, -2) + ')')(
  () => [{ json: { correlationEnvelope: envelope } }], { id: 123 },
  () => ({ first: () => ({ json: {} }) }), { head: { sha: 'a'.repeat(40) }, number: 1, html_url: 'https://github.com/o/r/pull/1' }));
assert.equal(success.workflowId, id);
assert.equal(success.prHeadSha, 'a'.repeat(40));
assert.equal(failure.workflowId, success.workflowId);
console.log('WF2 promotion identity I/J, graph, credentials, unchanged corrective/Git safety and runner API checks: PASS');
