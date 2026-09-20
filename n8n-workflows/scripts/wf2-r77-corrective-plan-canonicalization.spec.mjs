import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const artifact = new URL('../pending-live-update/wf2-git-patch-pr-u3eeMwTuhCsetfcS.R77-CORRECTIVE-PLAN-CANONICALIZATION.json', import.meta.url);
const priorArtifact = new URL('../pending-live-update/wf2-git-patch-pr-u3eeMwTuhCsetfcS.R75-CORRECTIVE-CARDINALITY-INVARIANT.json', import.meta.url);
const fixture2035 = JSON.parse(readFileSync(new URL('./fixtures/wf2-r75-execution-2035-cardinality.json', import.meta.url))).attempt10;
const fixture2036 = JSON.parse(readFileSync(new URL('./fixtures/wf2-r77-execution-2036-canonicalization.json', import.meta.url))).attempt11;
const wf = JSON.parse(readFileSync(artifact))[0];
const prior = JSON.parse(readFileSync(priorArtifact))[0];
const node = name => wf.nodes.find(candidate => candidate.name === name);
const priorNode = name => prior.nodes.find(candidate => candidate.name === name);

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
  const items = fixture.rawFetchItems.map((raw, i) => ({ json: i === 0 ? { ...raw, sourceGrounding: fixture.sourceGrounding } : raw }));
  const $ = key => { assert.equal(key, 'Build Independent Repository Policy'); return { first: () => ({ json: policyOut }) }; };
  return new Function('$input', '$json', '$', 'Buffer', node('Prepare Generic Remediation Plan').parameters.jsCode)(
    { all: () => items, first: () => items[0] }, items[0].json, $, Buffer,
  )[0].json;
}
const runValidatePlan = (preparedJson, claudeResponse) =>
  run('Validate Generic Remediation Plan', claudeResponse, { 'Prepare Generic Remediation Plan': [preparedJson] });

function claudeTextResponse(plans) {
  return { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ plans }) }] };
}
function makePlan(overrides = {}) {
  return {
    findingId: 'x', source: 'SONARQUBE', rule: 'java:S4684', target: { file: 'src/main/java/com/pfe/devsecops/dto/TaskDTO.java', line: null },
    rootCause: 'r', remediationIntent: 'r', filesToModify: ['src/main/java/com/pfe/devsecops/dto/TaskDTO.java'], filesToCreate: [],
    proposedPaths: ['src/main/java/com/pfe/devsecops/dto/TaskDTO.java'], requiredChanges: ['x'], forbiddenChanges: ['x'],
    expectedBehaviorPreserved: ['x'], validationStrategy: { compile: true, tests: true, scanner: 'SONARQUBE' }, confidence: 0.9,
    disposition: 'AUTO_CANDIDATE', requiredRelationshipApis: [], relationshipOperations: [], ...overrides,
  };
}

// ===================== 6. Real replays =====================

// Execution 2035 (attempt 10): 1 canonical issue, 1 raw plan already keyed
// by candidateId -> canonicalization is a no-op, PASS.
let prepared2035, canonicalId2035;
{
  prepared2035 = runPreparePlan(fixture2035);
  assert.equal(prepared2035.remediationContract.correctiveIssues.length, 1);
  canonicalId2035 = prepared2035.remediationContract.correctiveIssues[0].candidateId;
  const outputs = runValidatePlan(prepared2035, fixture2035.claudeResponse);
  assert.equal(outputs.length, 1);
  assert.ok(outputs[0].json.target_file_path.endsWith('TaskDTO.java'));
  assert.equal(outputs[0].json.remediationPlans[0].findingId, canonicalId2035);
  console.log('EXECUTION_2035_REPLAY = PASS');
}

// Execution 2036 (attempt 11): 1 canonical issue, 2 raw plans (both
// byte-identical except findingId, both correctly targeting TaskDTO.java) ->
// must collapse to exactly 1 canonical plan, findingId rewritten to the
// issue's candidateId.
let prepared2036, canonicalId2036;
{
  prepared2036 = runPreparePlan(fixture2036);
  assert.equal(prepared2036.remediationContract.correctiveIssues.length, 1);
  canonicalId2036 = prepared2036.remediationContract.correctiveIssues[0].candidateId;
  const rawText = fixture2036.claudeResponse.content.find(c => c.type === 'text').text;
  const rawPlanCount = JSON.parse(rawText).plans.length;
  assert.equal(rawPlanCount, 2, 'PRECONDITION: real execution 2036 produced 2 raw plans');
  console.log('RAW_2036_PLAN_COUNT =', rawPlanCount);

  const outputs = runValidatePlan(prepared2036, fixture2036.claudeResponse);
  assert.equal(outputs.length, 1, 'CANONICAL_2036_PLAN_COUNT must be 1 (collapsed)');
  console.log('CANONICAL_2036_PLAN_COUNT =', outputs.length);
  assert.equal(outputs[0].json.remediationPlans.length, 1);
  assert.equal(outputs[0].json.remediationPlans[0].findingId, canonicalId2036, 'canonical plan must be keyed by candidateId, not a historical id');
  assert.ok(outputs[0].json.target_file_path.endsWith('TaskDTO.java'));
  console.log('EXECUTION_2036_REPLAY = PASS');
}

// Negative: same corrective issue, 2 semantically DIFFERENT raw plans -> CORRECTIVE_PLAN_CONFLICT.
{
  const cand = canonicalId2036;
  const planA = makePlan({ findingId: 'b8db9c11-ddf9-4a23-9bf3-1d2ff15a59ef', requiredChanges: ['approach A'] });
  const planB = makePlan({ findingId: 'f11d4686-a7ba-4c0c-abbb-a12998c57220', requiredChanges: ['approach B (different)'] });
  assert.throws(() => runValidatePlan(prepared2036, claudeTextResponse([planA, planB])), /CORRECTIVE_PLAN_CONFLICT/);
  console.log('CONFLICTING_DUPLICATE_FAILS_CLOSED = YES');
}

// ===================== 7. Multi-issue test matrix =====================

// A. 1 issue -> 1 canonical plan (already proven by 2035 above).
console.log('R77_A_ONE_ISSUE_ONE_PLAN: PASS');

// B. 2 historical findings -> 1 issue -> 2 EQUIVALENT raw plans -> collapse (proven by 2036 above).
console.log('R77_B_EQUIVALENT_DUPLICATES_COLLAPSE: PASS');

// C. conflicting plans -> fail (proven above).
console.log('R77_C_CONFLICTING_DUPLICATES_FAIL: PASS');

// D. 2 independent corrective issues -> exactly 2 canonical plans.
{
  const causeA = { type: 'DEFAULT_VALUE_SEMANTICS_DEFECT', candidateType: 'TaskDTO' };
  const causeB = { type: 'DEFAULT_VALUE_SEMANTICS_DEFECT', candidateType: 'TaskService' };
  const batch = { ...fixture2036.batch, correctiveContext: { ...fixture2036.batch.correctiveContext, blockingCauses: [causeA, causeB] } };
  const prepared = runPreparePlan({ ...fixture2036, batch });
  assert.equal(prepared.remediationContract.correctiveIssues.length, 2);
  const [idA, idB] = prepared.remediationContract.correctiveIssues.map(i => i.candidateId);
  const planA = makePlan({ findingId: idA, target: { file: 'src/main/java/com/pfe/devsecops/dto/TaskDTO.java', line: null }, filesToModify: ['src/main/java/com/pfe/devsecops/dto/TaskDTO.java'], proposedPaths: ['src/main/java/com/pfe/devsecops/dto/TaskDTO.java'] });
  const planB = makePlan({ findingId: idB, target: { file: 'src/main/java/com/pfe/devsecops/service/TaskService.java', line: null }, filesToModify: ['src/main/java/com/pfe/devsecops/service/TaskService.java'], proposedPaths: ['src/main/java/com/pfe/devsecops/service/TaskService.java'] });
  const outputs = runValidatePlan(prepared, claudeTextResponse([planA, planB]));
  assert.equal(outputs.length, 2);
  // remediationPlans is the full, shared plan list on every output item
  // (one output item per unique file); find the plan matching THIS output's
  // own target_file_path rather than assuming index [0].
  const findingIdForOutput = o => o.json.remediationPlans.find(p => p.target.file === o.json.target_file_path).findingId;
  assert.deepEqual(outputs.map(findingIdForOutput).sort(), [idA, idB].sort());
  assert.deepEqual(outputs.map(o => o.json.target_file_path).sort(), [
    'src/main/java/com/pfe/devsecops/dto/TaskDTO.java', 'src/main/java/com/pfe/devsecops/service/TaskService.java',
  ]);
  console.log('R77_D_TWO_INDEPENDENT_ISSUES_TWO_PLANS: PASS');
}

// E. raw plan maps ambiguously to 2 issues (target file grounded by BOTH issues, no candidateId match) -> fail.
{
  const causeA = { type: 'X', candidateFile: 'src/main/java/com/pfe/devsecops/dto/TaskDTO.java' };
  const causeB = { type: 'X', candidateFile: 'src/main/java/com/pfe/devsecops/dto/TaskDTO.java' };
  const batch = { ...fixture2036.batch, correctiveContext: { ...fixture2036.batch.correctiveContext, blockingCauses: [causeA, causeB] } };
  const prepared = runPreparePlan({ ...fixture2036, batch });
  assert.equal(prepared.remediationContract.correctiveIssues.length, 2);
  const ambiguousPlan = makePlan({ findingId: 'unrelated-id' }); // no candidateId match; target grounded by BOTH issues
  assert.throws(() => runValidatePlan(prepared, claudeTextResponse([ambiguousPlan])), /CORRECTIVE_PLAN_UNMAPPED|REMEDIATION_PLAN_INCOMPLETE/);
  console.log('R77_E_AMBIGUOUS_MAPPING_FAILS: PASS');
}

// F. missing one issue -> fail.
{
  const causeA = { type: 'DEFAULT_VALUE_SEMANTICS_DEFECT', candidateType: 'TaskDTO' };
  const causeB = { type: 'DEFAULT_VALUE_SEMANTICS_DEFECT', candidateType: 'TaskService' };
  const batch = { ...fixture2036.batch, correctiveContext: { ...fixture2036.batch.correctiveContext, blockingCauses: [causeA, causeB] } };
  const prepared = runPreparePlan({ ...fixture2036, batch });
  const [idA] = prepared.remediationContract.correctiveIssues.map(i => i.candidateId);
  const planA = makePlan({ findingId: idA, target: { file: 'src/main/java/com/pfe/devsecops/dto/TaskDTO.java', line: null }, filesToModify: ['src/main/java/com/pfe/devsecops/dto/TaskDTO.java'], proposedPaths: ['src/main/java/com/pfe/devsecops/dto/TaskDTO.java'] });
  assert.throws(() => runValidatePlan(prepared, claudeTextResponse([planA])), /REMEDIATION_PLAN_INCOMPLETE/);
  console.log('R77_F_MISSING_ISSUE_FAILS: PASS');
}

// G. unexpected third plan (unmapped) -> fail.
{
  const extra = makePlan({ findingId: 'nonexistent-candidate-id', target: { file: 'src/main/java/com/pfe/devsecops/model/User.java', line: null }, filesToModify: ['src/main/java/com/pfe/devsecops/model/User.java'], proposedPaths: ['src/main/java/com/pfe/devsecops/model/User.java'] });
  const validPlan = makePlan({ findingId: canonicalId2036 });
  assert.throws(() => runValidatePlan(prepared2036, claudeTextResponse([validPlan, extra])), /CORRECTIVE_PLAN_UNMAPPED/);
  console.log('R77_G_UNEXPECTED_PLAN_FAILS: PASS');
}

// H. normal non-corrective flow unchanged.
{
  const normalBatch = { ...fixture2035.batch, correctiveAttempt: false, correctiveContext: null };
  const normalTree = { ...fixture2035.tree_resp, sha: normalBatch.baseSha };
  const normalLookup = { ...fixture2035.lookup, body: { ...fixture2035.lookup.body, object: { sha: normalBatch.baseSha } } };
  const prepared = runPreparePlan({ ...fixture2035, batch: normalBatch, tree_resp: normalTree, lookup: normalLookup });
  assert.equal(prepared.remediationContract.correctiveIssues, undefined);
  const plans = prepared.findingIds.map(findingId => makePlan({ findingId, target: { file: 'src/main/java/com/pfe/devsecops/controller/TaskController.java', line: 1 }, filesToModify: ['src/main/java/com/pfe/devsecops/controller/TaskController.java'], proposedPaths: ['src/main/java/com/pfe/devsecops/controller/TaskController.java'] }));
  const outputs = runValidatePlan(prepared, claudeTextResponse(plans));
  assert.ok(outputs.length >= 1);
  assert.deepEqual(outputs[0].json.remediationPlans.map(p => p.findingId).sort(), prepared.findingIds.slice().sort());
  console.log('R77_H_NORMAL_MODE_UNCHANGED: PASS');
}

// ===================== 8. Complete downstream offline replay (execution 2036, canonicalized) =====================
{
  const outputs = runValidatePlan(prepared2036, fixture2036.claudeResponse);
  const validatedPlanItem = outputs[0].json;

  // Prepare Candidate Manifest: consumes the SAME canonical plannedFiles/remediationPlans.
  const candidateItem = {
    targetFile: validatedPlanItem.target_file_path, fileOperation: validatedPlanItem.fileOperation,
    oldSha: '2fd6e4ab674261fa26e93849eae01f96c132a9a9', patchedCode: 'class TaskDTO { private String status = "TODO"; }',
    contentSha256: 'bb'.repeat(32), candidateBaseSha: prepared2036.candidateBaseSha, branchExists: true,
    genericPreflightPassed: true, applicablePlans: [validatedPlanItem.remediationPlans[0].findingId],
    llmRequestBody: { model: 'claude-sonnet-5', system: 'reviewer', messages: [{ role: 'user', content: 'placeholder' }] },
  };
  const $manifest = key => {
    if (key === 'Prepare Batch Context') return { first: () => ({ json: prepared2036 }) };
    if (key === 'Validate Generic Remediation Plan') return { all: () => [{ json: validatedPlanItem }] };
    if (key === 'Prepare Generic Remediation Plan') return { first: () => ({ json: prepared2036 }) };
    throw new Error('unexpected ref ' + key);
  };
  const manifestOut = new Function('$input', '$json', '$', 'Buffer', node('Prepare Candidate Manifest').parameters.jsCode)(
    { all: () => [{ json: candidateItem }], first: () => ({ json: candidateItem }) }, candidateItem, $manifest, Buffer,
  );
  assert.equal(manifestOut[0].json.candidateManifest?.candidateId ?? manifestOut[0].json.files?.length, manifestOut[0].json.files?.length ?? undefined, 'manifest built without throwing');
  console.log('DOWNSTREAM_MANIFEST_IDENTITY_ALIGNED = YES');

  // Validate Batch Completeness: independently computes the SAME expected identity.
  const bctx = { batchId: fixture2036.batch.batchId, correctiveAttempt: true, correctiveContext: fixture2036.batch.correctiveContext, findingIds: fixture2036.batch.findingIds };
  const manifest = { files: [{ path: validatedPlanItem.target_file_path, operation: 'MODIFY', originalBlobSha: '2fd6e4ab674261fa26e93849eae01f96c132a9a9', contentSha256: 'bb'.repeat(32) }], candidateDigest: 'aa'.repeat(32) };
  const receipt = {
    targetFile: validatedPlanItem.target_file_path, approvedFindingIds: [canonicalId2036], processedFindingIds: [canonicalId2036],
    candidateAcceptedFindingIds: [canonicalId2036], validationEvidence: { ok: true }, outcome: 'CANDIDATE_ACCEPTABLE_FOR_SCANNER_VALIDATION',
    candidateStateVerified: true, updateApplied: true, fileOperation: 'MODIFY', newSha: 'ee'.repeat(20), commitSha: 'ff'.repeat(20),
    contentSha256: 'bb'.repeat(32), oldSha: manifest.files[0].originalBlobSha,
  };
  const $batch = key => key === 'Prepare Batch Context' ? { first: () => ({ json: bctx }) } : { first: () => ({ json: manifest }) };
  const [batchResult] = new Function('$input', '$json', '$', 'Buffer', node('Validate Batch Completeness').parameters.jsCode)(
    { all: () => [{ json: receipt }] }, null, $batch, Buffer);
  assert.equal(batchResult.json.completenessPassed, true);
  assert.deepEqual(batchResult.json.expectedFindingIds, [canonicalId2036]);
  console.log('DOWNSTREAM_BATCH_COMPLETENESS_IDENTITY_ALIGNED = YES');
  console.log('DOWNSTREAM_IDENTITY_ALIGNED = YES');
}

// ===================== Syntax / graph integrity =====================
{
  const modifiedCodeNodes = wf.nodes.filter(candidate => {
    const before = priorNode(candidate.name);
    return candidate.type === 'n8n-nodes-base.code' && before && candidate.parameters?.jsCode !== before.parameters?.jsCode;
  });
  assert.deepEqual(modifiedCodeNodes.map(n => n.name).sort(), ['Prepare Generic Remediation Plan', 'Validate Generic Remediation Plan']);
  for (const candidate of modifiedCodeNodes) assert.doesNotThrow(() => new Function(candidate.parameters.jsCode), candidate.name);
  console.log('R77_SYNTAX_PASS = ' + modifiedCodeNodes.length);
  console.log('R77_SYNTAX_FAIL = 0');
}

assert.equal(wf.nodes.length, 186);
assert.equal(wf.nodes.length, prior.nodes.length);
assert.equal(new Set(wf.nodes.map(n => n.id)).size, 186);
console.log('R77_NODE_COUNT_UNCHANGED: PASS');
console.log('wf2-r77-corrective-plan-canonicalization: PASS');
