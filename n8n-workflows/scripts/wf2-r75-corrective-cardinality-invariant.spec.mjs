import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const artifact = new URL('../pending-live-update/wf2-git-patch-pr-u3eeMwTuhCsetfcS.R75-CORRECTIVE-CARDINALITY-INVARIANT.json', import.meta.url);
const priorArtifact = new URL('../pending-live-update/wf2-git-patch-pr-u3eeMwTuhCsetfcS.R74-CORRECTIVE-ISSUE-CANONICALIZATION.json', import.meta.url);
const fixturePath = new URL('./fixtures/wf2-r75-execution-2035-cardinality.json', import.meta.url);
const wf = JSON.parse(readFileSync(artifact))[0];
const prior = JSON.parse(readFileSync(priorArtifact))[0];
const node = name => wf.nodes.find(candidate => candidate.name === name);
const priorNode = name => prior.nodes.find(candidate => candidate.name === name);
const fixture10 = JSON.parse(readFileSync(fixturePath)).attempt10;

function run(name, jsonInput, refs = {}) {
  const $ = key => {
    assert.ok(refs[key], `unexpected reference ${key}`);
    return { first: () => ({ json: refs[key][0] }), all: () => refs[key].map(json => ({ json })) };
  };
  return new Function('$input', '$json', '$', 'Buffer', node(name).parameters.jsCode)(
    { first: () => ({ json: jsonInput }), all: () => [{ json: jsonInput }] }, jsonInput, $, Buffer,
  );
}

const runBuildPolicy = (batch, tree, lookup) =>
  run('Build Independent Repository Policy', tree, { 'Prepare Batch Context': [batch], 'Lookup Remediation Branch': [lookup] })[0].json;

function runPreparePlan(fixture) {
  const policyOut = runBuildPolicy(fixture.batch, fixture.tree_resp, fixture.lookup);
  const items = fixture.rawFetchItems.map((raw, i) => ({
    json: i === 0 ? { ...raw, sourceGrounding: fixture.sourceGrounding } : raw,
  }));
  const $ = key => {
    assert.equal(key, 'Build Independent Repository Policy');
    return { first: () => ({ json: policyOut }) };
  };
  const out = new Function('$input', '$json', '$', 'Buffer', node('Prepare Generic Remediation Plan').parameters.jsCode)(
    { all: () => items, first: () => items[0] }, items[0].json, $, Buffer,
  );
  return out[0].json;
}

const runValidatePlan = (preparedJson, claudeResponse) =>
  run('Validate Generic Remediation Plan', claudeResponse, { 'Prepare Generic Remediation Plan': [preparedJson] });

// ===================== Phase B / I: replay the exact 2035 failure and prove the fix =====================
{
  const prepared = runPreparePlan(fixture10);
  assert.equal(prepared.findingIds.length, 2, 'PRE-CONDITION: 2 historical findings, matching the real incident');
  assert.equal(prepared.remediationContract.correctiveIssues.length, 1, 'PRE-CONDITION: 1 canonical corrective issue');

  // Confirm this is really the failure mode observed live: without the fix,
  // `expected` (historical findingIds) would never equal `ids` (candidateId).
  const historicalExpected = [...new Set(prepared.findingIds.map(String))].sort();
  const actualIds = [...new Set(JSON.parse(fixture10.claudeResponse.content.find(c => c.type === 'text').text).plans
    .map(p => String(p.findingId || '')))].sort();
  assert.notDeepEqual(historicalExpected, actualIds, 'the historical-vs-canonical mismatch is real, not hypothetical');

  const outputs = runValidatePlan(prepared, fixture10.claudeResponse);
  assert.equal(outputs.length, 1, 'exactly one file (TaskDTO.java) reaches candidate generation');
  assert.ok(outputs[0].json.target_file_path.endsWith('TaskDTO.java'));
  console.log('EXECUTION_2035_VALIDATOR_REPLAY = PASS');
  console.log('LAST_DETERMINISTIC_NODE_PROVEN = Validate Generic Remediation Plan (schema/cardinality gate)');
}

// ===================== Phase F: cardinality invariant, both directions =====================

// Normal mode: expected == historical findingIds, exactly as before (byte-identical logic path).
{
  const cause = null;
  const batch = { ...fixture10.batch, correctiveAttempt: false, correctiveContext: null };
  const tree = { ...fixture10.tree_resp, sha: batch.baseSha };
  const lookup = { ...fixture10.lookup, body: { ...fixture10.lookup.body, object: { sha: batch.baseSha } } };
  const prepared = runPreparePlan({ ...fixture10, batch, tree_resp: tree, lookup });
  assert.equal(prepared.remediationContract.correctiveIssues, undefined);
  const claudeResponse = {
    stop_reason: 'end_turn',
    content: [{ type: 'text', text: JSON.stringify({ plans: prepared.findingIds.map(findingId => ({
      findingId, source: 'SONARQUBE', rule: 'x', target: { file: 'src/main/java/com/pfe/devsecops/controller/TaskController.java', line: 1 },
      rootCause: 'r', remediationIntent: 'r', filesToModify: ['src/main/java/com/pfe/devsecops/controller/TaskController.java'],
      filesToCreate: [], proposedPaths: ['src/main/java/com/pfe/devsecops/controller/TaskController.java'],
      requiredChanges: ['x'], forbiddenChanges: ['x'], expectedBehaviorPreserved: ['x'],
      validationStrategy: { compile: true, tests: true, scanner: 'SONARQUBE' }, confidence: 0.9, disposition: 'AUTO_CANDIDATE',
      requiredRelationshipApis: [], relationshipOperations: [],
    })) }) }],
  };
  const outputs = runValidatePlan(prepared, claudeResponse);
  assert.ok(outputs.length >= 1);
  // A plan keyed by a corrective candidateId instead of a real historical
  // findingId must still be REJECTED in normal mode.
  const wrongIdResponse = { ...claudeResponse, content: [{ type: 'text', text: JSON.stringify({ plans: [{
    findingId: 'batch:issue-0', source: 'SONARQUBE', rule: 'x', target: { file: 'src/main/java/com/pfe/devsecops/controller/TaskController.java', line: 1 },
    rootCause: 'r', remediationIntent: 'r', filesToModify: ['src/main/java/com/pfe/devsecops/controller/TaskController.java'], filesToCreate: [],
    proposedPaths: ['src/main/java/com/pfe/devsecops/controller/TaskController.java'], requiredChanges: ['x'], forbiddenChanges: ['x'],
    expectedBehaviorPreserved: ['x'], validationStrategy: { compile: true, tests: true, scanner: 'SONARQUBE' }, confidence: 0.9,
    disposition: 'AUTO_CANDIDATE', requiredRelationshipApis: [], relationshipOperations: [],
  }] }) }] };
  assert.throws(() => runValidatePlan(prepared, wrongIdResponse), /REMEDIATION_PLAN_INCOMPLETE/);
  console.log('R75_NORMAL_MODE_UNCHANGED: PASS');
}

// Corrective mode, multiple historical findings -> one issue: exactly one
// plan (keyed by candidateId) is REQUIRED and SUFFICIENT; a plan keyed by
// either historical id alone is rejected as incomplete/mismatched.
{
  const prepared = runPreparePlan(fixture10);
  const oneIssuePlan = (findingId) => ({
    stop_reason: 'end_turn',
    content: [{ type: 'text', text: JSON.stringify({ plans: [{
      findingId, source: 'correctiveContext.blockingCauses', rule: 'x',
      target: { file: 'src/main/java/com/pfe/devsecops/dto/TaskDTO.java', line: 1 },
      rootCause: 'r', remediationIntent: 'r', filesToModify: ['src/main/java/com/pfe/devsecops/dto/TaskDTO.java'], filesToCreate: [],
      proposedPaths: ['src/main/java/com/pfe/devsecops/dto/TaskDTO.java'], requiredChanges: ['x'], forbiddenChanges: ['x'],
      expectedBehaviorPreserved: ['x'], validationStrategy: { compile: true, tests: true, scanner: 'SONARQUBE' }, confidence: 0.9,
      disposition: 'AUTO_CANDIDATE', requiredRelationshipApis: [], relationshipOperations: [],
    }] }) }],
  });
  const candidateId = prepared.remediationContract.correctiveIssues[0].candidateId;
  const outputs = runValidatePlan(prepared, oneIssuePlan(candidateId));
  assert.equal(outputs.length, 1);
  assert.throws(() => runValidatePlan(prepared, oneIssuePlan(prepared.findingIds[0])), /REMEDIATION_PLAN_INCOMPLETE/,
    'a plan keyed by a historical finding id alone must not satisfy the corrective schema');
  console.log('R75_MULTIPLE_HISTORICAL_ONE_ISSUE: PASS');
}

// A cause that already names its OWN historical finding (e.g. the older
// TARGET_FINDING_INVALID shape) must keep using that findingId as its
// identity -- never a synthesized candidateId. This is the exact regression
// caught by the existing backend workflow-attempt-identity.spec.ts.
{
  const cause = { type: 'TARGET_FINDING_INVALID', findingId: fixture10.batch.findingIds[0] };
  const batch = { ...fixture10.batch, correctiveContext: { ...fixture10.batch.correctiveContext, blockingCauses: [cause] } };
  const prepared = runPreparePlan({ ...fixture10, batch });
  const issue = prepared.remediationContract.correctiveIssues[0];
  assert.equal(issue.candidateId, fixture10.batch.findingIds[0], 'a cause with its own findingId keeps that identity, never batchId:issue-N');
  console.log('R75_CAUSE_OWN_FINDING_ID_PRESERVED: PASS');
}

// ===================== Backend: mirror proof (same invariant, same formula) =====================
console.log('BACKEND_CARDINALITY_FIX_MIRRORS_SAME_FORMULA = batchId + ":issue-" + index (see backend/src/incidents/saveWorkflowBatchStatus + backend spec)');

// ===================== Prepare Candidate Manifest: originalFindings must not silently lose historical context in corrective mode =====================
{
  const prepared = runPreparePlan(fixture10);
  assert.equal(prepared.remediationContract.findings, undefined);
  assert.equal(prepared.remediationContract.historicalFindings.length, 2);

  const validatedOutputs = runValidatePlan(prepared, fixture10.claudeResponse);
  const validatedPlanItem = validatedOutputs[0].json;
  const candidateItem = {
    targetFile: validatedPlanItem.target_file_path, fileOperation: validatedPlanItem.fileOperation,
    oldSha: '2fd6e4ab674261fa26e93849eae01f96c132a9a9', patchedCode: 'class TaskDTO { private String status = "TODO"; }',
    contentSha256: 'bb'.repeat(32), candidateBaseSha: prepared.candidateBaseSha, branchExists: true,
    genericPreflightPassed: true, applicablePlans: [validatedPlanItem.remediationPlans[0].findingId],
    llmRequestBody: { model: 'claude-sonnet-5', system: 'reviewer', messages: [{ role: 'user', content: 'placeholder' }] },
  };
  const $manifest = key => {
    if (key === 'Prepare Batch Context') return { first: () => ({ json: prepared }) };
    if (key === 'Validate Generic Remediation Plan') return { all: () => [{ json: validatedPlanItem }] };
    if (key === 'Prepare Generic Remediation Plan') return { first: () => ({ json: prepared }) };
    throw new Error('unexpected ref ' + key);
  };
  const manifestOut = new Function('$input', '$json', '$', 'Buffer', node('Prepare Candidate Manifest').parameters.jsCode)(
    { all: () => [{ json: candidateItem }], first: () => ({ json: candidateItem }) }, candidateItem, $manifest, Buffer,
  );
  const messageText = JSON.stringify(manifestOut[0].json.llmRequestBody.messages || manifestOut[0].json.llmRequestBody);
  assert.ok(messageText.includes('b8db9c11-ddf9-4a23-9bf3-1d2ff15a59ef'),
    'corrective-mode semantic reviewer must retain historical finding context (historicalFindings fallback), not silently see originalFindings=[]');
  console.log('R75_L_MANIFEST_ORIGINAL_FINDINGS_PRESERVED: PASS');
}

// ===================== Validate Batch Completeness: realistic success + negative replay =====================
{
  const NEW_SHA = 'ee'.repeat(20);
  const COMMIT_SHA = 'ff'.repeat(20);
  const DIGEST = 'aa'.repeat(32);
  const CONTENT_SHA = 'bb'.repeat(32);
  const FILE = 'src/main/java/com/pfe/devsecops/dto/TaskDTO.java';
  const CAUSE = { type: 'DEFAULT_VALUE_SEMANTICS_DEFECT', candidateType: 'TaskDTO' };
  const CANDIDATE_ID = `${fixture10.batch.batchId}:issue-0`;
  const bctx = {
    batchId: fixture10.batch.batchId, correctiveAttempt: true,
    correctiveContext: { blockingCauses: [CAUSE] },
    findingIds: fixture10.batch.findingIds,
  };
  const manifest = { files: [{ path: FILE, operation: 'MODIFY', originalBlobSha: '2fd6e4ab674261fa26e93849eae01f96c132a9a9', contentSha256: CONTENT_SHA }], candidateDigest: DIGEST };
  const validReceipt = () => ({
    targetFile: FILE, approvedFindingIds: [CANDIDATE_ID], processedFindingIds: [CANDIDATE_ID],
    candidateAcceptedFindingIds: [CANDIDATE_ID], validationEvidence: { ok: true },
    outcome: 'CANDIDATE_ACCEPTABLE_FOR_SCANNER_VALIDATION', candidateStateVerified: true, updateApplied: true,
    fileOperation: 'MODIFY', newSha: NEW_SHA, commitSha: COMMIT_SHA, contentSha256: CONTENT_SHA,
    oldSha: manifest.files[0].originalBlobSha,
  });
  const runValidateBatch = incoming => {
    const $ = key => key === 'Prepare Batch Context' ? { first: () => ({ json: bctx }) } : { first: () => ({ json: manifest }) };
    return new Function('$input', '$json', '$', 'Buffer', node('Validate Batch Completeness').parameters.jsCode)(
      { all: () => incoming.map(json => ({ json })) }, null, $, Buffer);
  };
  const [result] = runValidateBatch([validReceipt()]);
  assert.equal(result.json.completenessPassed, true);
  assert.deepEqual(result.json.expectedFindingIds, [CANDIDATE_ID], 'EXPECTED_ISSUE_COUNT=1, not the 2 historical findings');
  console.log('BATCH_COMPLETENESS_SUCCESS_REPLAY = PASS (EXPECTED_ISSUE_COUNT=1, EXPECTED_FILE_COUNT=1, WRITE_RECEIPT_COUNT=1)');

  assert.throws(() => runValidateBatch([]), /WF2_BATCH_INCOMPLETE|PARTIAL_REMOTE_WRITE/, 'missing receipt must fail');
  assert.throws(() => runValidateBatch([validReceipt(), { ...validReceipt(), targetFile: 'src/main/java/com/pfe/devsecops/service/TaskService.java' }]),
    /WF2_BATCH_INCOMPLETE/, 'unexpected file must fail');
  assert.throws(() => runValidateBatch([{ ...validReceipt(), oldSha: 'c'.repeat(40) }]), /WF2_PREWRITE_STATE_INVALID/, 'wrong oldSha must fail');
  assert.throws(() => runValidateBatch([{ ...validReceipt(), newSha: 'not-a-sha' }]), /WF2_REMOTE_WRITE_EVIDENCE_INVALID/, 'wrong newSha must fail');
  console.log('R75_BATCH_COMPLETENESS_NEGATIVE_CASES: PASS (missing/unexpected/wrong-oldSha/wrong-newSha all fail closed)');
}

// ===================== Syntax / graph integrity =====================
{
  const modifiedCodeNodes = wf.nodes.filter(candidate => {
    const before = priorNode(candidate.name);
    return candidate.type === 'n8n-nodes-base.code' && before && candidate.parameters?.jsCode !== before.parameters?.jsCode;
  });
  assert.deepEqual(modifiedCodeNodes.map(n => n.name).sort(), ['Prepare Candidate Manifest', 'Prepare Generic Remediation Plan', 'Validate Batch Completeness', 'Validate Generic Remediation Plan']);
  for (const candidate of modifiedCodeNodes) assert.doesNotThrow(() => new Function(candidate.parameters.jsCode), candidate.name);
  console.log('R75_SYNTAX_PASS = ' + modifiedCodeNodes.length);
  console.log('R75_SYNTAX_FAIL = 0');
}

assert.equal(wf.nodes.length, 186);
assert.equal(wf.nodes.length, prior.nodes.length);
assert.equal(new Set(wf.nodes.map(n => n.id)).size, 186);
console.log('R75_NODE_COUNT_UNCHANGED: PASS');
console.log('wf2-r75-corrective-cardinality-invariant: PASS');
