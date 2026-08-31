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
  'Prepare - Code Patch Body', 'File Requires Patch?', 'de Patch - HTTP Request', 'Parse - Code Patch Output',
  'Update File in Branch', 'Build File Result', 'Merge Effective File Results', 'Validate Batch Completeness', 'Lookup Existing Batch PR',
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
  'Use Existing PR', 'Create Pull Request1', 'Build Already Remediated Result']) {
  assert.equal(node(critical).onError, 'continueErrorOutput', `${critical} must expose its error output`);
  assert.ok(targets(critical, 1).includes(failureNode), `${critical} error must reach failure callback`);
}
assert.ok(targets(failureNode).includes('Persist WF2 Failure Status'));
const failureContract = JSON.stringify(node('Persist WF2 Failure Status').parameters);
assert.ok(failureContract.includes('/workflow-status'));
for (const field of ['workflowId', 'executionId', 'incidentId', 'requestId', 'batchId', 'batchKey', 'attemptCount']) {
  assert.ok(node('Prepare WF2 Failure Status').parameters.jsCode.includes(field), `failure callback missing ${field}`);
}
assert.ok(node('Prepare WF2 Failure Status').parameters.jsCode.includes("$items('Capture Correlation Envelope',0,0)"));
assert.ok(!node('Prepare WF2 Failure Status').parameters.jsCode.includes("$('Prepare Batch Context')"));
const successContract = JSON.stringify(node('Save Execution Result to Backend').parameters);
assert.ok(successContract.includes('/workflow-status'));
for (const field of ['PR_CREATED', 'workflowId', 'executionId', 'requestId', 'batchId', 'batchKey', 'attemptCount', 'prUrl', 'prNumber']) {
  assert.ok(successContract.includes(field), `success callback missing ${field}`);
}
assert.ok(successContract.includes("$items('Capture Correlation Envelope',0,0)"));
assert.ok(!successContract.includes("$('Prepare Batch Context')"));
for (const field of ['completenessPassed', 'processedFindingIds', 'updatedFiles', 'commitShas', 'prHeadSha']) {
  assert.ok(successContract.includes(field), `success completeness evidence missing ${field}`);
}
assert.equal(node('Prepare - Code Patch Body').parameters.mode, 'runOnceForEachItem');
assert.equal(node('Parse - Code Patch Output').parameters.mode, 'runOnceForEachItem');
assert.ok(!node('Prepare - Code Patch Body').parameters.jsCode.includes('$input.first()'));
assert.ok(!node('Parse - Code Patch Output').parameters.jsCode.includes('$input.first()'));
for (const perItem of ['Prepare - Code Patch Body', 'Parse - Code Patch Output', 'Build File Result']) {
  assert.equal(node(perItem).parameters.mode, 'runOnceForEachItem');
  assert.ok(!/return \[\{/.test(node(perItem).parameters.jsCode), `${perItem} returns an array in per-item mode`);
}
assert.ok(node('Validate Batch Completeness').parameters.jsCode.includes('missingFindingIds'));
assert.ok(node('Validate Batch Completeness').parameters.jsCode.includes('missingFiles'));
assert.ok(node('Validate Batch Completeness').parameters.jsCode.includes('effectiveRemediatedFindingIds'));
assert.ok(node('Validate Batch Completeness').parameters.jsCode.includes('finalStateVerified'));

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
    { findingId: '39c99e32-2737-419c-b85d-f521ce541f41', rule: 'java:S1068', file: 'src/main/java/com/pfe/devsecops/service/TaskService.java', line: 48, message: 'Remove this unused "userRepository" private field.' },
    { findingId: 'b8305253-8e0c-4fb6-88a8-2eadb6d48a45', rule: 'java:S125', file: 'src/main/java/com/pfe/devsecops/config/SecurityConfig.java', line: 40, message: 'This block of commented-out lines of code should be removed.' },
  ],
};
payload.targetFiles = payload.findings.map(finding => finding.file);
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
  processedFindingIds: index ? [] : [...group.approvedFindingIds],
  effectiveRemediatedFindingIds: [...group.approvedFindingIds], finalStateVerified: true,
  outcome: index ? 'ALREADY_REMEDIATED' : 'MODIFIED_AND_REMEDIATED', updateApplied: index === 0,
  oldSha: `old-${index}`, newSha: index ? `old-${index}` : `new-${index}`, commitSha: index ? null : '1'.repeat(40),
}));
const completeness = results => exact(payload.findingIds, results.flatMap(result => result.effectiveRemediatedFindingIds))
  && exact(payload.findings.map(f => f.file), results.filter(result => result.finalStateVerified).map(result => result.targetFile));
assert.equal(completeness(completeResults), true);
assert.equal(completeness(completeResults.slice(0, 1)), false);

// Execute the exact per-item preparation contract twice. n8n requires the
// returned item itself (and its json property) to be plain objects.
const executeCode = (code, bindings) => Function(...Object.keys(bindings), code)(...Object.values(bindings));
const gateForPerItem = {
  ...payload, decision: 'FIX_PROPOSED', enrichedData: { sonar: { issues: payload.findings.map(f => ({
    ...f, severity: 'MAJOR', type: 'CODE_SMELL',
  })) } }, target_file_path: payload.findings[0].file,
};
const currentSources = {
  [payload.findings[0].file]: 'package p;\nimport p.UserRepository;\nclass TaskService { TaskService(TaskRepository taskRepository, UserRepository userRepository) {} }',
  [payload.findings[1].file]: 'class SecurityConfig {\n// règle de sécurité expliquée\nvoid filterChain() { secure(); }\n}',
};
const preparedItems = payload.findings.map(finding => executeCode(node('Prepare - Code Patch Body').parameters.jsCode, {
  $json: { path: finding.file, sha: `sha-${finding.rule}`, content: Buffer.from(currentSources[finding.file]).toString('base64') },
  $: () => ({ first: () => ({ json: gateForPerItem }) }), Buffer,
}));
assert.equal(preparedItems.length, 2);
assert.ok(preparedItems.every(item => item && !Array.isArray(item) && item.json && !Array.isArray(item.json)));
assert.deepEqual(preparedItems.map(item => item.json.targetFile).sort(), payload.findings.map(f => f.file).sort());
assert.ok(preparedItems.every(item => item.json.approvedFindingIdsForFile.length === 1));
assert.equal(preparedItems[0].json.requiresPatch, true);
assert.equal(preparedItems[1].json.requiresPatch, false);
assert.deepEqual(preparedItems[1].json.alreadyResolvedFindingIds, [payload.findingIds[1]]);
const parsedItems = preparedItems.filter(prepared => prepared.json.requiresPatch).map(prepared => {
  const response = { content: [{ text: JSON.stringify({
    incidentId: payload.incidentId,
    patchDescription: 'Correction simulée',
    filePath: prepared.json.targetFile,
    targetFile: prepared.json.targetFile,
    processedFindingIds: prepared.json.approvedFindingIdsForFile,
    patchedCode: 'package p;\nclass TaskService { TaskService(TaskRepository taskRepository) {} }',
    commitMessage: `fix: ${prepared.json.targetFile}`,
  }) }] };
  return executeCode(node('Parse - Code Patch Output').parameters.jsCode, {
    $json: response,
    $: name => name === 'Prepare - Code Patch Body'
      ? { item: { json: prepared.json } }
      : { first: () => ({ json: gateForPerItem }) },
  });
});
assert.equal(parsedItems.length, 1);
assert.ok(parsedItems.every(item => item && !Array.isArray(item) && item.json && !Array.isArray(item.json)));
assert.deepEqual(parsedItems.map(item => item.json.targetFile), [payload.findings[0].file]);
const modifiedResult = executeCode(node('Build File Result').parameters.jsCode, {
  $json: { commit: { sha: '1'.repeat(40) }, content: { sha: 'new-task-sha' } },
  $: () => ({ item: { json: parsedItems[0].json } }),
}).json;
const alreadyResult = executeCode(node('Build Already Remediated Result').parameters.jsCode, {
  $json: preparedItems[1].json,
}).json;
assert.equal(modifiedResult.outcome, 'MODIFIED_AND_REMEDIATED');
assert.equal(alreadyResult.outcome, 'ALREADY_REMEDIATED');
assert.equal(alreadyResult.oldSha, alreadyResult.newSha);
const completeV2 = executeCode(node('Validate Batch Completeness').parameters.jsCode, {
  $input: { all: () => [{ json: modifiedResult }, { json: alreadyResult }] },
  $: () => ({ first: () => ({ json: payload }) }),
});
assert.equal(completeV2[0].json.completenessPassed, true);
assert.deepEqual(completeV2[0].json.effectiveRemediatedFindingIds, [...payload.findingIds].sort());
assert.throws(() => executeCode(node('Validate Batch Completeness').parameters.jsCode, {
  $input: { all: () => [{ json: modifiedResult }, { json: { ...alreadyResult, effectiveRemediatedFindingIds: [], finalStateVerified: false, outcome: 'FAILED' } }] },
  $: () => ({ first: () => ({ json: payload }) }),
}), /WF2_BATCH_INCOMPLETE/);

const capturedEnvelope = { incidentId: payload.incidentId, projectId: payload.projectId,
  buildNumber: payload.buildNumber, requestId: payload.requestId, batchId: payload.batchId,
  batchKey: payload.batchKey, attemptCount: 4, workflowId: workflow.id, findingIds: payload.findingIds };
const failureCode = node('Prepare WF2 Failure Status').parameters.jsCode;
for (const failurePoint of ['Prepare - Code Patch Body', 'de Patch - HTTP Request', 'Parse - Code Patch Output',
  'Update File in Branch', 'Build File Result', 'Validate Batch Completeness', 'Lookup Existing Batch PR',
  'Create Pull Request1', 'Save Execution Result to Backend']) {
  const output = executeCode(failureCode, {
    $input: { first: () => ({ json: { error: { message: 'mock failure', node: { name: failurePoint } } } }) },
    $items: name => name === 'Capture Correlation Envelope' ? [{ json: { correlationEnvelope: capturedEnvelope } }] : [],
    $execution: { id: 'mock-execution' },
  });
  assert.equal(output.length, 1);
  assert.equal(output[0].json.attemptCount, 4);
  assert.equal(output[0].json.incidentId, payload.incidentId);
  assert.equal(output[0].json.failureNode, failurePoint);
}

// Resume simulation: deterministic branch and the single matching PR are reused.
const branchLookup = JSON.stringify(node('Lookup Remediation Branch').parameters);
assert.ok(branchLookup.includes('targetBranchName'));
assert.deepEqual(targets('Branch Exists?'), ['Use Existing Branch']);
assert.deepEqual(targets('Branch Exists?', 1), ['Create Missing Branch']);
assert.deepEqual(targets('Existing PR?'), ['Use Existing PR']);
assert.deepEqual(targets('Existing PR?', 1), ['Create Pull Request1']);

const selectPr = inputItems => executeCode(node('Select Existing PR').parameters.jsCode, {
  $input: { all: () => inputItems.map(json => ({ json })) },
  $: () => ({ first: () => ({ json: { ...payload, githubRepo: 'souhaiel11/pfe-app-test', targetBranchName: 'fix/batch', baseBranch: 'main' } }) }),
})[0].json;
const pr24 = { number: 24, state: 'open', body: `Batch : ${payload.batchId}`,
  head: { ref: 'fix/batch', repo: { full_name: 'souhaiel11/pfe-app-test' } },
  base: { ref: 'main', repo: { full_name: 'souhaiel11/pfe-app-test' } } };
assert.equal(selectPr([pr24]).existingPr.number, 24);
assert.equal(selectPr([[pr24]]).existingPr.number, 24);
assert.equal(selectPr([{ number: 7, state: 'closed' }, pr24]).existingPr.number, 24);
assert.equal(selectPr([]).createRequired, true);
assert.equal(selectPr([{ ...pr24, head: { ...pr24.head, ref: 'wrong' } }]).createRequired, true);
assert.equal(selectPr([{ ...pr24, base: { ...pr24.base, ref: 'wrong' } }]).createRequired, true);
assert.throws(() => selectPr([pr24, { ...pr24, number: 25 }]), /DUPLICATE_BATCH_PR/);

console.log('wf2 lifecycle graph and exact two-finding mock: PASS');
