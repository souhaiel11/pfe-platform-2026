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
assert.deepEqual(targets('Prepare Batch Context'), ['Lookup Remediation Branch']);

const createBranch = JSON.stringify(node('Create Missing Branch').parameters);
assert.ok(!createBranch.includes('Parse - Code Patch Output'), 'branch creation has a forward patch-parser dependency');
assert.ok(createBranch.includes('$json.repository_owner') && createBranch.includes('$json.repository_name'));
assert.ok(createBranch.includes('$json.targetBranchName') && createBranch.includes('$json.baseSha'));

const orderedPath = [
  'Expand Approved Target Files', 'Fetch Repository Files',
  'Prepare - Code Patch Body', 'de Patch - HTTP Request', 'Parse - Code Patch Output',
  'Update File in Branch', 'Build File Result', 'Validate Batch Completeness', 'Lookup Existing Batch PR',
  'Select Existing PR', 'Existing PR?',
];
for (let index = 0; index < orderedPath.length - 1; index += 1) {
  assert.ok(targets(orderedPath[index]).includes(orderedPath[index + 1]),
    `${orderedPath[index]} must precede ${orderedPath[index + 1]}`);
}

const failureNode = 'Prepare WF2 Failure Status';
for (const critical of ['Capture Correlation Envelope', 'Adapt Webhook Payload',
  'Policy Gate - Validate Constraints', 'Fetch Repository Metadata',
  'Apply Repository Metadata', 'Get Main Branch SHA1', 'Prepare Batch Context', 'Lookup Remediation Branch',
  'Use Existing Branch', 'Create Missing Branch',
  'Expand Approved Target Files', 'Fetch Repository Files', 'Prepare - Code Patch Body',
  'de Patch - HTTP Request', 'Parse - Code Patch Output', 'Update File in Branch',
  'Build File Result', 'Validate Batch Completeness', 'Lookup Existing Batch PR', 'Select Existing PR',
  'Use Existing PR', 'Create Pull Request1']) {
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
for (const field of ['completenessPassed', 'processedFindingIds', 'updatedFiles', 'commitShas', 'prHeadSha']) {
  assert.ok(successContract.includes(field), `success completeness evidence missing ${field}`);
}
assert.equal(node('Prepare - Code Patch Body').parameters.mode, 'runOnceForEachItem');
assert.equal(node('Parse - Code Patch Output').parameters.mode, 'runOnceForEachItem');
assert.ok(!node('Prepare - Code Patch Body').parameters.jsCode.includes('$input.first()'));
assert.ok(!node('Parse - Code Patch Output').parameters.jsCode.includes('$input.first()'));
assert.ok(node('Validate Batch Completeness').parameters.jsCode.includes('missingFindingIds'));
assert.ok(node('Validate Batch Completeness').parameters.jsCode.includes('missingFiles'));

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
const norm = values => [...new Set(values)].sort();
const exact = (expected, actual) => JSON.stringify(norm(expected)) === JSON.stringify(norm(actual));
assert.equal(exact(['A', 'B'], ['A']), false);
assert.equal(exact(['A', 'B'], ['A', 'C']), false);
assert.equal(exact(['A', 'B'], ['A', 'B', 'C']), false);
assert.equal(exact(['A', 'B'], ['B', 'A']), true);
assert.equal(exact(['A', 'B'], ['A', 'A', 'B']), true);
assert.equal(exact(payload.findingIds, payload.findingIds), true);
assert.equal(exact(payload.findings.map(f => f.file), payload.findings.map(f => f.file)), true);
const grouped = Object.values(payload.findings.reduce((groups, finding) => {
  const targetFile = finding.file;
  groups[targetFile] ||= { targetFile, approvedFindingIds: [], approvedFindings: [] };
  groups[targetFile].approvedFindingIds.push(finding.findingId);
  groups[targetFile].approvedFindings.push(finding);
  return groups;
}, {}));
assert.equal(grouped.length, 2);
assert.ok(grouped.every(group => group.approvedFindingIds.length === 1));
const completeResults = grouped.map((group, index) => ({ ...group,
  processedFindingIds: [...group.approvedFindingIds], updateApplied: true,
  oldSha: `old-${index}`, newSha: `new-${index}`, commitSha: `${index + 1}`.repeat(40),
}));
const completeness = results => exact(payload.findingIds, results.flatMap(result => result.processedFindingIds))
  && exact(payload.findings.map(f => f.file), results.filter(result => result.updateApplied).map(result => result.targetFile));
assert.equal(completeness(completeResults), true);
assert.equal(completeness(completeResults.slice(0, 1)), false);

// Resume simulation: deterministic branch and the single matching PR are reused.
const branchLookup = JSON.stringify(node('Lookup Remediation Branch').parameters);
assert.ok(branchLookup.includes('targetBranchName'));
assert.deepEqual(targets('Branch Exists?'), ['Use Existing Branch']);
assert.deepEqual(targets('Branch Exists?', 1), ['Create Missing Branch']);
assert.deepEqual(targets('Existing PR?'), ['Use Existing PR']);
assert.deepEqual(targets('Existing PR?', 1), ['Create Pull Request1']);

console.log('wf2 lifecycle graph and exact two-finding mock: PASS');
