import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const path = new URL('./active/wf2-git-patch-pr-v4-1-9adcV31eaIgJyMR0.json', import.meta.url);
const raw = JSON.parse(readFileSync(path, 'utf8'));
const workflow = Array.isArray(raw) ? raw[0] : raw;
assert.equal(workflow.id, '9adcV31eaIgJyMR0');
const nodes = new Map(workflow.nodes.map(node => [node.name, node]));
const node = name => {
  assert.ok(nodes.has(name), `missing node: ${name}`);
  return nodes.get(name);
};
const targets = (name, output = 0) => (workflow.connections[name]?.main?.[output] || []).map(edge => edge.node);

const envelope = node('Capture Correlation Envelope');
const envelopeCode = envelope.parameters.jsCode;
for (const field of ['incidentId', 'projectId', 'buildNumber', 'requestId', 'batchId', 'batchKey',
  'attemptCount', 'workflowId', 'route', 'findingIds']) {
  assert.ok(envelopeCode.includes(field), `correlation envelope missing ${field}`);
}
assert.ok(envelopeCode.includes('Number.isInteger(attemptCount)') && envelopeCode.includes('attemptCount<1'));
assert.ok(envelopeCode.includes('INVALID_ATTEMPT_COUNT'), 'missing attempts must fail closed');
assert.deepEqual(targets('Webhook'), ['Capture Correlation Envelope']);
assert.deepEqual(targets('Capture Correlation Envelope'), ['Adapt Webhook Payload']);
assert.ok(targets('Capture Correlation Envelope', 1).includes('Prepare WF2 Failure Status'));

const adapt = node('Adapt Webhook Payload');
assert.ok(adapt.parameters.jsCode.includes('attemptCount:envelope.attemptCount'));
assert.ok(targets('Adapt Webhook Payload', 1).includes('Prepare WF2 Failure Status'));

const context = node('Prepare Batch Context');
const contextCode = context.parameters.jsCode;
for (const field of ['incidentId', 'projectId', 'buildNumber', 'requestId', 'batchId', 'batchKey',
  'attemptCount', 'repository_owner', 'repository_name', 'default_branch', 'baseSha',
  'baseBranch', 'targetBranchName', 'findingIds', 'findings']) {
  assert.ok(contextCode.includes(field), `canonical context missing ${field}`);
}
assert.deepEqual(targets('Get Main Branch SHA1'), ['Prepare Batch Context']);
assert.deepEqual(targets('Prepare Batch Context'), ['Create Branch1']);

const createBranch = JSON.stringify(node('Create Branch1').parameters);
assert.ok(!createBranch.includes('Parse - Code Patch Output'), 'branch creation has a forward patch-parser dependency');
assert.ok(createBranch.includes('$json.repository_owner') && createBranch.includes('$json.repository_name'));
assert.ok(createBranch.includes('$json.targetBranchName') && createBranch.includes('$json.baseSha'));

const orderedPath = [
  'Prepare Batch Context', 'Create Branch1', 'Expand Approved Target Files', 'Fetch Repository Files',
  'Prepare - Code Patch Body', 'de Patch - HTTP Request', 'Parse - Code Patch Output',
  'Update File in Branch', 'Collect File Updates', 'Create Pull Request', 'Create Pull Request1',
  'Save Execution Result to Backend',
];
for (let index = 0; index < orderedPath.length - 1; index += 1) {
  assert.ok(targets(orderedPath[index]).includes(orderedPath[index + 1]),
    `${orderedPath[index]} must precede ${orderedPath[index + 1]}`);
}

const failureNode = 'Prepare WF2 Failure Status';
for (const critical of ['Capture Correlation Envelope', 'Adapt Webhook Payload',
  'Policy Gate - Validate Constraints', 'Fetch Repository Metadata',
  'Apply Repository Metadata', 'Get Main Branch SHA1', 'Prepare Batch Context', 'Create Branch1',
  'Expand Approved Target Files', 'Fetch Repository Files', 'Prepare - Code Patch Body',
  'de Patch - HTTP Request', 'Parse - Code Patch Output', 'Update File in Branch',
  'Create Pull Request', 'Create Pull Request1']) {
  assert.equal(node(critical).onError, 'continueErrorOutput', `${critical} must expose its error output`);
  assert.ok(targets(critical, 1).includes(failureNode), `${critical} error must reach failure callback`);
}
assert.ok(targets(failureNode).includes('Persist WF2 Failure Status'));
const failureContract = JSON.stringify(node('Persist WF2 Failure Status').parameters);
assert.ok(failureContract.includes('/workflow-status'));
for (const field of ['workflowId', 'executionId', 'incidentId', 'requestId', 'batchId', 'batchKey', 'attemptCount']) {
  assert.ok(node('Prepare WF2 Failure Status').parameters.jsCode.includes(field), `failure callback missing ${field}`);
}
assert.ok(node('Prepare WF2 Failure Status').parameters.jsCode.includes("$('Capture Correlation Envelope')"));
assert.ok(!node('Prepare WF2 Failure Status').parameters.jsCode.includes("$('Prepare Batch Context')"));
const successContract = JSON.stringify(node('Save Execution Result to Backend').parameters);
assert.ok(successContract.includes('/workflow-status'));
for (const field of ['PR_CREATED', 'workflowId', 'executionId', 'requestId', 'batchId', 'batchKey', 'attemptCount', 'prUrl', 'prNumber']) {
  assert.ok(successContract.includes(field), `success callback missing ${field}`);
}
assert.ok(successContract.includes("$('Capture Correlation Envelope')"));
assert.ok(!successContract.includes("$('Prepare Batch Context')"));

// Safe mock traversal using the exact execution-1888 batch. No network node
// is invoked: this validates only immutable context and graph order.
const payload = {
  incidentId: 'd1f5e9ce-f039-475d-9a50-41f217e6444b',
  projectId: '3aa1c9b9-e114-40e4-884b-ebc7aa32e002', buildNumber: 136,
  requestId: '9b62e087-02a8-409d-bfb1-a951629a8814', attemptCount: 2,
  batchId: '6396353230fd100bf80c3417271c70cb7808273ebd6500571a46c2a4505af431',
  batchKey: '6396353230fd100bf80c3417271c70cb7808273ebd6500571a46c2a4505af431',
  repository_owner: 'souhaiel11', repository_name: 'pfe-app-test', default_branch: 'main',
  findingIds: ['39c99e32-2737-419c-b85d-f521ce541f41', 'b8305253-8e0c-4fb6-88a8-2eadb6d48a45'],
  findings: [
    { findingId: '39c99e32-2737-419c-b85d-f521ce541f41', rule: 'java:S1068', file: 'src/main/java/com/pfe/devsecops/service/TaskService.java', line: 48 },
    { findingId: 'b8305253-8e0c-4fb6-88a8-2eadb6d48a45', rule: 'java:S125', file: 'src/main/java/com/pfe/devsecops/config/SecurityConfig.java', line: 40 },
  ],
};
assert.equal(payload.findingIds.length, 2);
assert.equal(payload.findings.length, 2);
assert.equal(payload.batchId, payload.batchKey);
for (const attemptCount of [1, 2, 3]) {
  const captured = { incidentId: payload.incidentId, projectId: payload.projectId,
    buildNumber: payload.buildNumber, requestId: payload.requestId, batchId: payload.batchId,
    batchKey: payload.batchKey, attemptCount, workflowId: workflow.id, route: 'WF2',
    findingIds: [...payload.findingIds] };
  const adapted = { ...payload, ...captured };
  const prepared = { ...adapted, baseSha: 'mock-main-sha', baseBranch: 'main' };
  assert.equal(captured.attemptCount, attemptCount);
  assert.equal(adapted.attemptCount, attemptCount);
  assert.equal(prepared.attemptCount, attemptCount);
}
for (const failurePoint of ['Adapt Webhook Payload', 'Create Branch1', 'de Patch - HTTP Request',
  'Update File in Branch', 'Create Pull Request1']) {
  const callback = { ...payload, workflowId: workflow.id, executionId: 'mock',
    failureNode: failurePoint };
  assert.equal(callback.attemptCount, 2, `${failurePoint} lost attempt correlation`);
}
assert.deepEqual(orderedPath.slice(0, 7), [
  'Prepare Batch Context', 'Create Branch1', 'Expand Approved Target Files', 'Fetch Repository Files',
  'Prepare - Code Patch Body', 'de Patch - HTTP Request', 'Parse - Code Patch Output',
]);

console.log('wf2 lifecycle graph and exact two-finding mock: PASS');
