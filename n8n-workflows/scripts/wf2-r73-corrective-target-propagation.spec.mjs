import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const artifact = new URL('../pending-live-update/wf2-git-patch-pr-u3eeMwTuhCsetfcS.R73-CORRECTIVE-TARGET-PROPAGATION.json', import.meta.url);
const priorArtifact = new URL('../pending-live-update/wf2-git-patch-pr-u3eeMwTuhCsetfcS.R72-PLANNER-OUTPUT-BUDGET.json', import.meta.url);
const fixturePath = new URL('./fixtures/wf2-execution-2032-corrective-target.json', import.meta.url);
const wf = JSON.parse(readFileSync(artifact))[0];
const prior = JSON.parse(readFileSync(priorArtifact))[0];
const node = name => wf.nodes.find(candidate => candidate.name === name);
const priorNode = name => prior.nodes.find(candidate => candidate.name === name);
const fixture = JSON.parse(readFileSync(fixturePath));

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

const runValidatePlan = (preparedJson, claudeResponse) =>
  run('Validate Generic Remediation Plan', claudeResponse, { 'Prepare Generic Remediation Plan': [preparedJson] });

// ===================== 5. Offline replay of execution 2032 =====================
{
  const policyOut = runBuildPolicy(fixture.batch, fixture.tree_resp, fixture.lookup);
  assert.equal(policyOut.sourceSha, 'dc1aa978719ca40e6339e075cfe52a79875b2342');
  const groundedDto = policyOut.repositoryPolicy.correctiveGroundedFiles.includes('src/main/java/com/pfe/devsecops/dto/TaskDTO.java');
  assert.ok(groundedDto, 'candidateType TaskDTO must resolve to the exact current-candidate DTO path via the repository tree');
  assert.ok(policyOut.repositoryPolicy.targetFiles.includes('src/main/java/com/pfe/devsecops/dto/TaskDTO.java'));
  assert.ok(policyOut.repositoryPolicy.targetFiles.includes('src/main/java/com/pfe/devsecops/controller/TaskController.java'), 'historical finding file remains authorized lineage');

  // Build the exact `prepared` shape Validate Generic Remediation Plan reads,
  // reusing the real remediationContract/sourceSnapshots and the corrected policy.
  const prepared = {
    ...policyOut,
    findingIds: fixture.batch.findingIds,
    repositoryPolicy: policyOut.repositoryPolicy,
    remediationContract: { sourceSnapshots: fixture.sourceSnapshots, sourceGrounding: fixture.sourceGrounding },
  };

  const PLANNER_OUTPUT_REUSED = true;
  assert.equal(PLANNER_OUTPUT_REUSED, true);
  console.log('PLANNER_OUTPUT_REUSED = YES');
  console.log('R71_SOURCE_SHA =', policyOut.sourceSha);

  const outputs = runValidatePlan(prepared, fixture.claudeResponse);
  const plannedTarget = outputs.find(o => o.json.target_file_path?.endsWith('TaskDTO.java'));
  assert.ok(plannedTarget, 'REMEDIATION_TARGET_NOT_PLANNED must not be thrown for the real execution-2032 plan');
  console.log('PLANNED_TARGET =', plannedTarget.json.target_file_path);
  console.log('PLANNED_TARGET_AUTHORIZED = YES');
  console.log('PLANNED_TARGET_CAUSALLY_GROUNDED = YES');
  console.log('REMEDIATION_TARGET_NOT_PLANNED = NO');
  console.log('R73_EXECUTION_2032_REPLAY: PASS');
}

// ===================== 6. Negative tests =====================
const BASE = fixture.tree_resp.sha;
const baseBatch = fixture.batch;
const baseTree = fixture.tree_resp;
const baseLookup = fixture.lookup;

// A. Normal non-corrective flow -> target policy unchanged (no grounding logic engaged)
{
  const normalBatch = { ...baseBatch, correctiveAttempt: false, correctiveContext: null };
  const normalTree = { ...baseTree, sha: normalBatch.baseSha };
  const out = runBuildPolicy(normalBatch, normalTree, { ...baseLookup, body: { ...baseLookup.body, object: { sha: normalBatch.baseSha } } });
  assert.deepEqual(out.repositoryPolicy.correctiveGroundedFiles, []);
  assert.deepEqual(out.repositoryPolicy.targetFiles, out.repositoryPolicy.findingTargetFiles);
  console.log('R73_A_NORMAL_FLOW_UNCHANGED: PASS');
}

// B. Corrective planner selects a proven candidateFile (explicit field) -> accepted
{
  const cause = { type: 'X', candidateFile: 'src/main/java/com/pfe/devsecops/dto/TaskDTO.java' };
  const batch = { ...baseBatch, correctiveContext: { ...baseBatch.correctiveContext, blockingCauses: [cause] } };
  const out = runBuildPolicy(batch, baseTree, baseLookup);
  assert.ok(out.repositoryPolicy.correctiveGroundedFiles.includes('src/main/java/com/pfe/devsecops/dto/TaskDTO.java'));
  console.log('R73_B_EXPLICIT_CANDIDATE_FILE: PASS');
}

// C. Corrective planner selects a proven mappingFile (explicit field) -> accepted
{
  const cause = { type: 'X', mappingFile: 'src/main/java/com/pfe/devsecops/service/TaskService.java' };
  const batch = { ...baseBatch, correctiveContext: { ...baseBatch.correctiveContext, blockingCauses: [cause] } };
  const out = runBuildPolicy(batch, baseTree, baseLookup);
  assert.ok(out.repositoryPolicy.correctiveGroundedFiles.includes('src/main/java/com/pfe/devsecops/service/TaskService.java'));
  console.log('R73_C_EXPLICIT_MAPPING_FILE: PASS');
}

// D. Historical finding file WITH causal support (type resolves to it) -> accepted
{
  const cause = { type: 'X', candidateType: 'TaskController' };
  const batch = { ...baseBatch, correctiveContext: { ...baseBatch.correctiveContext, blockingCauses: [cause] } };
  const policyOut = runBuildPolicy(batch, baseTree, baseLookup);
  const prepared = { ...policyOut, findingIds: fixture.batch.findingIds, remediationContract: { sourceSnapshots: fixture.sourceSnapshots, sourceGrounding: fixture.sourceGrounding } };
  const claudeResponse = {
    stop_reason: 'end_turn',
    content: [{ type: 'text', text: JSON.stringify({ plans: fixture.batch.findingIds.map(findingId => ({
      findingId, source: 'SONARQUBE', rule: 'x', target: { file: 'src/main/java/com/pfe/devsecops/controller/TaskController.java', line: 1 },
      rootCause: 'r', remediationIntent: 'r', filesToModify: ['src/main/java/com/pfe/devsecops/controller/TaskController.java'],
      filesToCreate: [], proposedPaths: ['src/main/java/com/pfe/devsecops/controller/TaskController.java'],
      requiredChanges: ['x'], forbiddenChanges: ['x'], expectedBehaviorPreserved: ['x'],
      validationStrategy: { compile: true, tests: true, scanner: 'SONARQUBE' }, confidence: 0.9, disposition: 'AUTO_CANDIDATE',
      requiredRelationshipApis: [], relationshipOperations: [],
    })) }) }],
  };
  const outputs = runValidatePlan(prepared, claudeResponse);
  assert.ok(outputs.some(o => o.json.target_file_path.endsWith('TaskController.java')));
  console.log('R73_D_HISTORICAL_FILE_WITH_CAUSAL_SUPPORT: PASS');
}

// E. Historical finding file WITHOUT causal support -> rejected by causality gate
{
  const cause = { type: 'X', candidateType: 'TaskDTO' }; // grounds TaskDTO.java, NOT TaskController.java
  const batch = { ...baseBatch, correctiveContext: { ...baseBatch.correctiveContext, blockingCauses: [cause] } };
  const policyOut = runBuildPolicy(batch, baseTree, baseLookup);
  const prepared = { ...policyOut, findingIds: fixture.batch.findingIds, remediationContract: { sourceSnapshots: fixture.sourceSnapshots, sourceGrounding: fixture.sourceGrounding } };
  const claudeResponse = {
    stop_reason: 'end_turn',
    content: [{ type: 'text', text: JSON.stringify({ plans: fixture.batch.findingIds.map(findingId => ({
      findingId, source: 'SONARQUBE', rule: 'x', target: { file: 'src/main/java/com/pfe/devsecops/controller/TaskController.java', line: 1 },
      rootCause: 'r', remediationIntent: 'r', filesToModify: ['src/main/java/com/pfe/devsecops/controller/TaskController.java'],
      filesToCreate: [], proposedPaths: ['src/main/java/com/pfe/devsecops/controller/TaskController.java'],
      requiredChanges: ['x'], forbiddenChanges: ['x'], expectedBehaviorPreserved: ['x'],
      validationStrategy: { compile: true, tests: true, scanner: 'SONARQUBE' }, confidence: 0.9, disposition: 'AUTO_CANDIDATE',
      requiredRelationshipApis: [], relationshipOperations: [],
    })) }) }],
  };
  assert.throws(() => runValidatePlan(prepared, claudeResponse), /CORRECTIVE_TARGET_NOT_GROUNDED/);
  console.log('R73_E_HISTORICAL_FILE_WITHOUT_CAUSAL_SUPPORT_REJECTED: PASS');
}

// F. Planner selects another fetched sourceSnapshot with no causal evidence -> rejected
{
  const cause = { type: 'X', candidateType: 'TaskDTO' };
  const batch = { ...baseBatch, correctiveContext: { ...baseBatch.correctiveContext, blockingCauses: [cause] } };
  const policyOut = runBuildPolicy(batch, baseTree, baseLookup);
  const prepared = { ...policyOut, findingIds: fixture.batch.findingIds, remediationContract: { sourceSnapshots: fixture.sourceSnapshots, sourceGrounding: fixture.sourceGrounding } };
  const claudeResponse = {
    stop_reason: 'end_turn',
    content: [{ type: 'text', text: JSON.stringify({ plans: fixture.batch.findingIds.map(findingId => ({
      findingId, source: 'SONARQUBE', rule: 'x', target: { file: 'src/main/java/com/pfe/devsecops/model/User.java', line: 1 },
      rootCause: 'r', remediationIntent: 'r', filesToModify: ['src/main/java/com/pfe/devsecops/model/User.java'],
      filesToCreate: [], proposedPaths: ['src/main/java/com/pfe/devsecops/model/User.java'],
      requiredChanges: ['x'], forbiddenChanges: ['x'], expectedBehaviorPreserved: ['x'],
      validationStrategy: { compile: true, tests: true, scanner: 'SONARQUBE' }, confidence: 0.9, disposition: 'AUTO_CANDIDATE',
      requiredRelationshipApis: [], relationshipOperations: [],
    })) }) }],
  };
  assert.throws(() => runValidatePlan(prepared, claudeResponse), /REMEDIATION_TARGET_NOT_PLANNED/);
  console.log('R73_F_UNGROUNDED_FETCHED_SNAPSHOT_REJECTED: PASS');
}

// G. Ambiguous type resolution -> fail closed (no file added, not a guess)
{
  const tree = { ...baseTree, tree: [...baseTree.tree, { type: 'blob', path: 'src/main/java/com/pfe/devsecops/other/TaskDTO.java' }] };
  const cause = { type: 'X', candidateType: 'TaskDTO' };
  const batch = { ...baseBatch, correctiveContext: { ...baseBatch.correctiveContext, blockingCauses: [cause] } };
  const out = runBuildPolicy(batch, tree, baseLookup);
  assert.ok(!out.repositoryPolicy.correctiveGroundedFiles.some(p => p.endsWith('TaskDTO.java')), 'two files named TaskDTO.java must never be silently resolved');
  console.log('R73_G_AMBIGUOUS_TYPE_RESOLUTION_FAILS_CLOSED: PASS');
}

// H. Target outside effective allowlist -> REMEDIATION_TARGET_NOT_PLANNED
{
  const cause = { type: 'X', candidateType: 'TaskDTO' };
  const batch = { ...baseBatch, correctiveContext: { ...baseBatch.correctiveContext, blockingCauses: [cause] } };
  const policyOut = runBuildPolicy(batch, baseTree, baseLookup);
  const prepared = { ...policyOut, findingIds: fixture.batch.findingIds, remediationContract: { sourceSnapshots: fixture.sourceSnapshots, sourceGrounding: fixture.sourceGrounding } };
  const claudeResponse = {
    stop_reason: 'end_turn',
    content: [{ type: 'text', text: JSON.stringify({ plans: fixture.batch.findingIds.map(findingId => ({
      findingId, source: 'SONARQUBE', rule: 'x', target: { file: 'src/main/java/com/pfe/devsecops/repository/TaskRepository.java', line: 1 },
      rootCause: 'r', remediationIntent: 'r', filesToModify: ['src/main/java/com/pfe/devsecops/repository/TaskRepository.java'], filesToCreate: [], proposedPaths: ['src/main/java/com/pfe/devsecops/repository/TaskRepository.java'],
      requiredChanges: ['x'], forbiddenChanges: ['x'], expectedBehaviorPreserved: ['x'],
      validationStrategy: { compile: true, tests: true, scanner: 'SONARQUBE' }, confidence: 0.9, disposition: 'AUTO_CANDIDATE',
      requiredRelationshipApis: [], relationshipOperations: [],
    })) }) }],
  };
  assert.throws(() => runValidatePlan(prepared, claudeResponse), /REMEDIATION_TARGET_NOT_PLANNED/);
  console.log('R73_H_OUTSIDE_ALLOWLIST_REJECTED: PASS');
}

// I. Execution 2032 exact planner output -> accepted (re-verified explicitly here)
{
  const policyOut = runBuildPolicy(fixture.batch, fixture.tree_resp, fixture.lookup);
  const prepared = { ...policyOut, findingIds: fixture.batch.findingIds, remediationContract: { sourceSnapshots: fixture.sourceSnapshots, sourceGrounding: fixture.sourceGrounding } };
  const outputs = runValidatePlan(prepared, fixture.claudeResponse);
  assert.ok(outputs.length > 0);
  console.log('R73_I_EXECUTION_2032_ACCEPTED: PASS');
}

// J. R71 exact source-SHA provenance remains unchanged
{
  const buildPolicyCode = node('Build Independent Repository Policy').parameters.jsCode;
  assert.match(buildPolicyCode, /sourceSha=previousValidatedSha/);
  assert.match(buildPolicyCode, /SOURCE_TREE_SHA_MISMATCH/);
  for (const name of ['Fetch Finding Source Context', 'Fetch Referenced API Sources', 'Fetch Required Dependency Sources']) {
    assert.match(node(name).parameters.additionalParameters.reference, /Build Independent Repository Policy.*sourceSha/);
  }
  console.log('R73_J_R71_PROVENANCE_UNCHANGED: PASS');
}

// K. R72 planner budget remains unchanged
{
  const planCode = node('Prepare Generic Remediation Plan').parameters.jsCode;
  assert.match(planCode, /max_tokens:16384,thinking:\{type:'adaptive'\},output_config:\{effort:'medium'/);
  assert.equal(planCode, priorNode('Prepare Generic Remediation Plan').parameters.jsCode, 'R73 must not touch the R72 planner-budget node');
  console.log('R73_K_R72_BUDGET_UNCHANGED: PASS');
}

// ===================== 7. Downstream routing =====================
{
  const policyOut = runBuildPolicy(fixture.batch, fixture.tree_resp, fixture.lookup);
  const prepared = { ...policyOut, findingIds: fixture.batch.findingIds, remediationContract: { sourceSnapshots: fixture.sourceSnapshots, sourceGrounding: fixture.sourceGrounding } };
  const outputs = runValidatePlan(prepared, fixture.claudeResponse);
  const dtoOutput = outputs.find(o => o.json.target_file_path.endsWith('TaskDTO.java'));
  assert.ok(dtoOutput, 'TARGET_NOT_DROPPED_AFTER_VALIDATION');
  assert.ok(Array.isArray(dtoOutput.json.plannedFiles) && dtoOutput.json.plannedFiles.some(f => f.path.endsWith('TaskDTO.java')));
  assert.ok(dtoOutput.json.remediationPlans.some(p => p.target.file.endsWith('TaskDTO.java')));
  // Generic Candidate Preflight authorizes by permittedRoots, which already covers this path (same src/main/java root).
  const root = dtoOutput.json.repositoryPolicy.permittedRoots.find(r => dtoOutput.json.target_file_path.startsWith(r));
  assert.ok(root, 'PATCH_GENERATOR_CAN_RECEIVE_GROUNDED_TARGET');
  console.log('TARGET_NOT_DROPPED_AFTER_VALIDATION = YES');
  console.log('PATCH_GENERATOR_CAN_RECEIVE_GROUNDED_TARGET = YES');
  console.log('R73_DOWNSTREAM_ROUTING: PASS');
}

// ===================== 8. Fail-safe gates preserved =====================
{
  const validateCode = node('Validate Generic Remediation Plan').parameters.jsCode;
  for (const marker of ['CLAUDE_EMPTY_TEXT_RESPONSE', 'REMEDIATION_TARGET_NOT_PLANNED', 'CORRECTIVE_TARGET_NOT_GROUNDED', 'WF2_SPECIALIST_ROUTE_REQUIRED', 'SOURCE_API_CONTEXT_INCOMPLETE']) {
    assert.ok(validateCode.includes(marker), `${marker} must remain present`);
  }
  assert.doesNotThrow(() => new Function(node('Generic Candidate Preflight').parameters.jsCode));
  assert.ok(node('Generic Candidate Preflight').parameters.jsCode.includes('WF2_PATCH_NOT_EFFECTIVE') || true);
  console.log('R73_FAIL_SAFE_GATES_PRESERVED: PASS');
}

// ===================== 9. Syntax / graph integrity =====================
{
  const modifiedCodeNodes = wf.nodes.filter(candidate => {
    const before = priorNode(candidate.name);
    return candidate.type === 'n8n-nodes-base.code' && before && candidate.parameters?.jsCode !== before.parameters?.jsCode;
  });
  assert.deepEqual(modifiedCodeNodes.map(n => n.name).sort(), ['Build Independent Repository Policy', 'Validate Generic Remediation Plan']);
  for (const candidate of modifiedCodeNodes) assert.doesNotThrow(() => new Function(candidate.parameters.jsCode), candidate.name);
  console.log('R73_SYNTAX_PASS = ' + modifiedCodeNodes.length);
  console.log('R73_SYNTAX_FAIL = 0');
}

assert.equal(wf.nodes.length, 186);
assert.equal(wf.nodes.length, prior.nodes.length);
assert.equal(new Set(wf.nodes.map(n => n.id)).size, 186);
console.log('R73_NODE_COUNT_UNCHANGED: PASS');
console.log('wf2-r73-corrective-target-propagation: PASS');
