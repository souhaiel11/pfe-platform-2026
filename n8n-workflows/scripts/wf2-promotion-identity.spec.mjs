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
assert.equal(target.nodes.length, 184);
assert.equal(new Set(target.nodes.map(n => n.id)).size, 184);
assert.equal(new Set(target.nodes.map(n => n.name)).size, 184);
const apiNodes = ['Expand Referenced API Sources','Fetch Referenced API Sources'];
const gateNodes = ['Validate Source Context Completeness'];
const dependencyNodes=['Expand Required Dependency Sources','Fetch Required Dependency Sources','Validate Required Dependency Sources'];
const crossAdded=target.nodes.filter(n=>n.name==='Classify Candidate Coordination Scope'||n.name.includes('Cross-File')).map(n=>n.name);
const added = [...apiNodes, ...apiNodes.map(n => 'Failure Envelope - ' + n), ...gateNodes, ...dependencyNodes, ...crossAdded];
const originalConnections = structuredClone(target.connections);
for (const name of added) delete originalConnections[name];
originalConnections['Fetch Finding Source Context'].main[0][0].node = 'Prepare Generic Remediation Plan';
// Atomic review moves exactly three success edges and reuses the manifest failure envelope.
assert.equal(target.connections['Generic Candidate Preflight'].main[0][0].node, 'Hash Candidate File Content');
assert.equal(target.connections['Prepare Candidate Manifest'].main[0][0].node, 'Classify Candidate Coordination Scope');
assert.equal(target.connections['Classify Candidate Coordination Scope'].main[1][0].node, 'Independent Semantic Review');
assert.equal(target.connections['Enforce Independent Review'].main[0][0].node, 'Hash Candidate Manifest');
assert.deepEqual(target.connections['Prepare Candidate Manifest'].main[1], [{node:'Failure Envelope - Assemble Candidate Manifest',type:'main',index:0}]);
originalConnections['Generic Candidate Preflight'].main[0][0].node = 'Independent Semantic Review';
originalConnections['Prepare Candidate Manifest'].main = [[{node:'Hash Candidate Manifest',type:'main',index:0}]];
originalConnections['Enforce Independent Review'].main[0][0].node = 'Hash Candidate File Content';
assert.deepEqual(originalConnections, base.connections, 'only source completeness and atomic candidate review topology changes');

// "Expand Referenced API Sources" keeps the original single-node envelope
// pattern (own error output -> its own dedicated failure envelope).
assert.equal(node('Expand Referenced API Sources').onError,'continueErrorOutput');
assert.equal(target.connections['Expand Referenced API Sources'].main[1][0].node,'Failure Envelope - Expand Referenced API Sources');
assert.equal(target.connections['Failure Envelope - Expand Referenced API Sources'].main[0][0].node,'Prepare WF2 Failure Status');

// R23 -- "Fetch Referenced API Sources": BOTH outputs (success items and
// per-item error items) now fan into one completeness gate first, so a
// partial/0-of-N fetch can never reach the planner and can never race a
// second, independent failure callback past the gate. Exactly one failure
// envelope (the existing one, reused) and one continuation edge exist past
// this node.
assert.equal(node('Fetch Referenced API Sources').onError,'continueErrorOutput');
assert.equal(target.connections['Fetch Referenced API Sources'].main[0][0].node,'Validate Source Context Completeness');
assert.equal(target.connections['Fetch Referenced API Sources'].main[1][0].node,'Validate Source Context Completeness');
assert.equal(node('Validate Source Context Completeness').onError,'continueErrorOutput');
assert.equal(target.connections['Validate Source Context Completeness'].main[0][0].node,'Expand Required Dependency Sources');
assert.deepEqual(target.connections['Expand Required Dependency Sources'].main,[[{node:'Fetch Required Dependency Sources',type:'main',index:0}],[{node:'Failure Envelope - Fetch Referenced API Sources',type:'main',index:0}]]);
assert.deepEqual(target.connections['Fetch Required Dependency Sources'].main,[[{node:'Validate Required Dependency Sources',type:'main',index:0}],[{node:'Validate Required Dependency Sources',type:'main',index:0}]]);
assert.deepEqual(target.connections['Validate Required Dependency Sources'].main,[[{node:'Prepare Generic Remediation Plan',type:'main',index:0}],[{node:'Failure Envelope - Fetch Referenced API Sources',type:'main',index:0}]]);
assert.deepEqual(node('Fetch Required Dependency Sources').parameters,node('Fetch Referenced API Sources').parameters);
assert.deepEqual(node('Fetch Required Dependency Sources').credentials,node('Fetch Referenced API Sources').credentials);
assert.equal(node('Fetch Required Dependency Sources').maxTries,3);
assert.equal(target.connections['Validate Source Context Completeness'].main[1][0].node,'Failure Envelope - Fetch Referenced API Sources');
assert.equal(target.connections['Failure Envelope - Fetch Referenced API Sources'].main[0][0].node,'Prepare WF2 Failure Status');

const {id: fetchId,name: fetchName,position: fetchPosition,retryOnFail: _fetchRetry,maxTries: _fetchMaxTries,waitBetweenTries: _fetchWait,...fetchRest}=node('Fetch Referenced API Sources');
const {id: oldId,name: oldName,position: oldPosition,...oldFetchRest}=node('Fetch Finding Source Context');
assert.deepEqual(fetchRest,oldFetchRest,'same native read-only GitHub node, credentials and exact-SHA reference');
// R74/R76 -- bounded transient-network retry (wf2-resilience.spec.mjs)
// legitimately adds retryOnFail/maxTries/waitBetweenTries to these
// non-mutating nodes, after the identity promotion. Excluded from the
// strict byte-parity check below on that basis alone -- every other
// property must still match the base exactly, same as any other node.
// R23 -- "Generate Remediation Plan" (the planner's pure outbound Claude
// call) receives the same bounded retry, following the proven EAI_AGAIN
// failure in execution 1997.
const RETRY_HARDENED = ['Get Main Branch SHA1', 'Independent Semantic Review', 'de Patch - HTTP Request', 'Generate Remediation Plan'];
// R75/R76 -- proven, narrowly-scoped jsCode-only rewrites: R75's guard-aware
// raw-cast detection (replacing the old bare structural regex) and R76's
// bounded verificationEvidence summary (Persist Verification Failure, built
// from Call Candidate Verification's real, already-available output).
// Excluded from the strict byte-parity check below on that basis alone --
// every other property, and every other node, must still match the base
// exactly.
// Patch-output hardening changes only request construction and parsing; dedicated tests
// verify truncation, complete JSON, schema, target identity and bounded output budget.
const JSCODE_HARDENED = ['Generic Candidate Preflight', 'Persist Verification Failure', 'Prepare - Code Patch Body', 'Parse - Code Patch Output', 'Prepare Generic Remediation Plan', 'Validate Generic Remediation Plan', 'Prepare WF2 Failure Status', 'Accumulate Candidate File', 'Prepare Candidate Manifest', 'Enforce Independent Review', 'Failure Envelope - Assemble Candidate Manifest', 'Validate Batch Completeness', 'Expand Manifest Files', 'Build File Result (Pass 2)', 'Build Reconciled File Result'];
const SOURCE_BASELINE_PINNED = ['Fetch Finding Source Context'];
for (const n of target.nodes) {
  if (added.includes(n.name)) {
    assert.doesNotMatch(JSON.stringify(n.parameters), /httpRequestWithAuthentication|requestWithAuthenticationPaginated|(?:this\.)?helpers\./);
    continue;
  }
  const previous = base.nodes.find(b => b.name === n.name);
  assert.deepEqual(n.credentials, previous.credentials, 'credential references unchanged');
  if (!['Webhook', 'Capture Correlation Envelope', ...RETRY_HARDENED, ...JSCODE_HARDENED, ...SOURCE_BASELINE_PINNED].includes(n.name)) assert.deepEqual(n, previous);
  else if (RETRY_HARDENED.includes(n.name)) {
    const { retryOnFail, maxTries, waitBetweenTries, ...rest } = n;
    assert.deepEqual(rest, previous, `${n.name}: only retry properties may differ from base`);
  } else if (JSCODE_HARDENED.includes(n.name)) {
    const { parameters, ...restNode } = n;
    const { jsCode, ...restParams } = parameters;
    const { parameters: prevParameters, ...prevRestNode } = previous;
    const { jsCode: prevJsCode, ...prevRestParams } = prevParameters;
    if (n.name === 'Prepare Candidate Manifest') {
      assert.equal(restNode.onError, 'continueErrorOutput');
      delete restNode.onError;
    }
    assert.deepEqual(restNode, prevRestNode, `${n.name}: only parameters.jsCode may differ from base`);
    assert.deepEqual(restParams, prevRestParams, `${n.name}: only jsCode may differ from base`);
    assert.notEqual(jsCode, prevJsCode, `${n.name}: jsCode was expected to change (R75/R76 fix)`);
  } else if (SOURCE_BASELINE_PINNED.includes(n.name)) {
    const current = structuredClone(n); const prior = structuredClone(previous);
    assert.equal(current.parameters.additionalParameters.reference, "={{ $('Prepare Batch Context').first().json.baseSha }}");
    current.parameters.additionalParameters.reference = prior.parameters.additionalParameters.reference;
    assert.deepEqual(current, prior, `${n.name}: only the frozen baseline reference may differ from base`);
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
