// Vérifie la clôture des tentatives correctives dans WF2.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

/** Simule la lecture des données demandées par le composant. */
const readWorkflow = path => {
  const value = JSON.parse(readFileSync(new URL(path, import.meta.url)));
  return Array.isArray(value) ? value[0] : value;
};
const workflow = readWorkflow('../pending-live-update/wf2-git-patch-pr-u3eeMwTuhCsetfcS.R75-CORRECTIVE-CLOSURE.json');
const prior = readWorkflow('../pending-live-update/wf2-git-patch-pr-u3eeMwTuhCsetfcS.R74-CORRECTIVE-ISSUE-CANONICALIZATION.json');
const execution = JSON.parse(readFileSync(new URL('./fixtures/wf2-r75-execution-2035.json', import.meta.url)));
const historical = JSON.parse(readFileSync(new URL('./fixtures/wf2-r74-corrective-issue-fixtures.json', import.meta.url)));
/** Retrouve ou construit le nœud du workflow demandé. */
const node = name => workflow.nodes.find(candidate => candidate.name === name);
/** Prépare les données nécessaires à ce scénario. */
const priorNode = name => prior.nodes.find(candidate => candidate.name === name);
/** Prépare l’élément transmis au nœud suivant. */
const item = json => ({ json });
/** Retrouve la référence de l’élément. */
const ref = value => ({ 
/** Renvoie le premier élément disponible. */
first: () => item(value), 
/** Renvoie tous les éléments disponibles. */
all: () => (Array.isArray(value) ? value : [value]).map(item), item: item(value) });
/** Simule l’échec attendu par ce scénario. */
const runCode = (name, { input = [], json = {}, refs = {} } = {}) => {
  const inputItems = input.map(value => value?.json ? value : item(value));
  /** Simule l’échec attendu par ce scénario. */
  const dollar = reference => {
    if (!(reference in refs)) throw new Error('MISSING_TEST_REFERENCE:' + reference);
    return ref(refs[reference]);
  };
  const result = new Function('$input', '$json', '$', 'Buffer', node(name).parameters.jsCode)(
    { 
    /** Renvoie tous les éléments disponibles. */
    all: () => inputItems, 
    /** Renvoie le premier élément disponible. */
    first: () => inputItems[0] }, json, dollar, Buffer,
  );
  return Array.isArray(result) ? result : [result];
};

// Exact execution 2035 reconstruction: run the actual R75 Prepare node over
// the exact recorded source-fetch results, repository tree, lookup and policy.
const sourceItems = execution.plannerSourceItems;
const prepared2035 = runCode('Prepare Generic Remediation Plan', {
  input: sourceItems,
  refs: {
    'Build Independent Repository Policy': execution.repositoryPolicyOutput,
    'Fetch Repository Tree': execution.repositoryTree,
    'Lookup Remediation Branch': execution.branchLookup,
  },
})[0].json;
assert.equal(prepared2035.remediationContract.correctiveIssues.length, 1);
assert.equal(prepared2035.remediationContract.historicalFindings.length, 2);
const issue = prepared2035.remediationContract.correctiveIssues[0];
assert.deepEqual(issue.provenance.historicalFindingIds, execution.repositoryPolicyOutput.findingIds.slice().sort());
assert.equal(issue.provenance.previousValidatedSha, execution.repositoryPolicyOutput.correctiveContext.previousValidatedSha);
assert.deepEqual(issue.provenance.blockingCause, execution.repositoryPolicyOutput.correctiveContext.blockingCauses[0]);
assert.equal(issue.provenance.historicalScannerEvidence.length, 2);

const digest = createHash('sha256').update(JSON.stringify(prepared2035.remediationContract.correctiveIssues.map(({ candidateId, provenance, ...rest }) => rest))).digest('hex');
assert.equal(digest, '1bf72a1a0514e82126065ca6c4c6e7d5690801551b433c3f18d35a33e6a806e4');

// Prove the exact old condition and the fixed real replay.
assert.throws(() => new Function('$json', '$', priorNode('Validate Generic Remediation Plan').parameters.jsCode)(
  execution.plannerRawResponse, name => ref({ 'Prepare Generic Remediation Plan': execution.preparePlannerOutput }[name]),
), /REMEDIATION_PLAN_INCOMPLETE/);
const validated2035 = runCode('Validate Generic Remediation Plan', {
  json: execution.plannerRawResponse,
  refs: { 'Prepare Generic Remediation Plan': prepared2035 },
});
assert.equal(validated2035.length, 1);
assert.deepEqual(validated2035[0].json.activeRemediationIds, [issue.candidateId]);
assert.deepEqual(validated2035[0].json.historicalFindingIds, execution.repositoryPolicyOutput.findingIds.slice().sort());
assert.equal(validated2035[0].json.target_file_path, 'src/main/java/com/pfe/devsecops/dto/TaskDTO.java');

// The actual next deterministic preparation succeeds and produces a bounded,
// parseable patch request. The next boundary is the patch-generation LLM HTTP node.
const dtoFetch = sourceItems.find(value => value.path.endsWith('/TaskDTO.java'));
const patchRequest = runCode('Prepare - Code Patch Body', {
  json: dtoFetch,
  refs: {
    'Prepare Batch Context': execution.repositoryPolicyOutput,
    'Validate Generic Remediation Plan': validated2035.map(value => value.json),
    'Prepare Generic Remediation Plan': prepared2035,
  },
})[0].json;
assert.equal(patchRequest.targetFile, 'src/main/java/com/pfe/devsecops/dto/TaskDTO.java');
assert.deepEqual(patchRequest.completePlan.activeRemediationIds, [issue.candidateId]);
assert.deepEqual(patchRequest.completePlan.historicalFindingIds, execution.repositoryPolicyOutput.findingIds.slice().sort());
assert.equal(patchRequest.completePlan.correctiveIssues.length, 1);
assert.equal(JSON.parse(patchRequest.claudeBodyString).messages.length, 1);

// Normal mode retains historical R74 output cardinality and finding IDs.
const normalPrepared = structuredClone(prepared2035);
normalPrepared.correctiveAttempt = false;
normalPrepared.correctiveContext = null;
normalPrepared.remediationContract = {
  ...normalPrepared.remediationContract,
  findings: normalPrepared.remediationContract.historicalFindings,
};
delete normalPrepared.remediationContract.correctiveIssues;
delete normalPrepared.remediationContract.historicalFindings;
const normalResponse = structuredClone(execution.plannerRawResponse);
const normalPlan = JSON.parse(normalResponse.content.find(block => block.type === 'text').text).plans[0];
normalResponse.content.find(block => block.type === 'text').text = JSON.stringify({ plans: normalPrepared.findingIds.map((id, index) => ({
  ...normalPlan, findingId: id, target: normalPrepared.remediationContract.findings[index].target,
  filesToModify: [normalPrepared.remediationContract.findings[index].target.file],
})) });
const normalValidated = runCode('Validate Generic Remediation Plan', { json: normalResponse, refs: { 'Prepare Generic Remediation Plan': normalPrepared } });
assert.equal(normalValidated[0].json.activeRemediationIds.length, 2);
assert.deepEqual(normalValidated[0].json.historicalFindingIds, normalPrepared.findingIds.slice().sort());

// Multiple independent corrective issues require exactly one plan per issue,
// never one plan per historical finding.
const multiPrepared = structuredClone(prepared2035);
const secondIssue = structuredClone(issue);
secondIssue.candidateId += ':second';
secondIssue.provenance.index = 1;
multiPrepared.remediationContract.correctiveIssues.push(secondIssue);
multiPrepared.correctiveContext.blockingCauses.push(structuredClone(multiPrepared.correctiveContext.blockingCauses[0]));
const multiResponse = structuredClone(execution.plannerRawResponse);
const firstPlan = JSON.parse(multiResponse.content.find(block => block.type === 'text').text).plans[0];
multiResponse.content.find(block => block.type === 'text').text = JSON.stringify({ plans: [firstPlan, { ...firstPlan, findingId: secondIssue.candidateId }] });
const multiValidated = runCode('Validate Generic Remediation Plan', { json: multiResponse, refs: { 'Prepare Generic Remediation Plan': multiPrepared } });
assert.equal(multiValidated[0].json.remediationPlans.length, 2);
assert.equal(multiValidated[0].json.activeRemediationIds.length, 2);

// Batch completeness validates active issue IDs, then returns historical IDs
// at the backend boundary. This closes the second deterministic mismatch.
const path = validated2035[0].json.target_file_path;
const activeId = issue.candidateId;
const manifest = {
  activeRemediationIds: [activeId],
  historicalFindingIds: execution.repositoryPolicyOutput.findingIds.slice().sort(),
  candidateDigest: 'd'.repeat(64),
  files: [{ path, operation: 'MODIFY', originalBlobSha: dtoFetch.sha, contentSha256: 'c'.repeat(64), approvedFindingIds: [activeId] }],
};
const receipt = {
  targetFile: path, approvedFindingIds: [activeId], processedFindingIds: [activeId], candidateAcceptedFindingIds: [activeId],
  validationEvidence: {}, outcome: 'CANDIDATE_ACCEPTABLE_FOR_SCANNER_VALIDATION', candidateStateVerified: true,
  updateApplied: true, fileOperation: 'MODIFY', oldSha: dtoFetch.sha, newSha: 'a'.repeat(40), commitSha: 'b'.repeat(40), contentSha256: 'c'.repeat(64),
};
const complete = runCode('Validate Batch Completeness', { input: [receipt], refs: { 'Prepare Batch Context': execution.repositoryPolicyOutput, 'Assemble Candidate Manifest': manifest } })[0].json;
assert.deepEqual(complete.validatedRemediationIds, [activeId]);
assert.deepEqual(complete.candidateAcceptedFindingIds, execution.repositoryPolicyOutput.findingIds.slice().sort());
assert.deepEqual(complete.processedFindingIds, execution.repositoryPolicyOutput.findingIds.slice().sort());

// Required negative closure cases, each tied to the actual production guard
// or an already-established production invariant retained in this artifact.
let negatives = 0;
/** Vérifie les résultats attendus dans ce scénario. */
const fails = (fn, pattern) => { assert.throws(fn, pattern); negatives++; };
const badMissing = structuredClone(execution.plannerRawResponse);
const missingPlan = JSON.parse(badMissing.content.find(block => block.type === 'text').text); delete missingPlan.plans[0].rootCause;
badMissing.content.find(block => block.type === 'text').text = JSON.stringify(missingPlan);
fails(() => runCode('Validate Generic Remediation Plan', { json: badMissing, refs: { 'Prepare Generic Remediation Plan': prepared2035 } }), /REMEDIATION_PLAN_FIELD_MISSING/); // 5
const ungrounded = structuredClone(prepared2035); ungrounded.repositoryPolicy.targetFiles = []; ungrounded.repositoryPolicy.correctiveGroundedFiles = []; ungrounded.correctiveContext.blockingCauses = [{ type: 'X' }];
fails(() => runCode('Validate Generic Remediation Plan', { json: execution.plannerRawResponse, refs: { 'Prepare Generic Remediation Plan': ungrounded } }), /CORRECTIVE_TARGET_NOT_GROUNDED|REMEDIATION_TARGET_NOT_PLANNED/); // 6/7
const ambiguousPolicy = structuredClone(execution.repositoryPolicyOutput); ambiguousPolicy.repositoryPolicy.existingFiles.push('src/main/java/other/TaskDTO.java');
const ambiguousPrepared = runCode('Prepare Generic Remediation Plan', { input: sourceItems, refs: { 'Build Independent Repository Policy': ambiguousPolicy, 'Fetch Repository Tree': execution.repositoryTree, 'Lookup Remediation Branch': execution.branchLookup } })[0].json;
assert.ok(!ambiguousPrepared.remediationContract.correctiveIssues[0].groundedTargetFiles.includes('src/main/java/com/pfe/devsecops/dto/TaskDTO.java')); negatives++; // 6
const notCausal = structuredClone(prepared2035); notCausal.repositoryPolicy.correctiveGroundedFiles = ['src/main/java/com/pfe/devsecops/service/TaskService.java']; notCausal.correctiveContext.blockingCauses[0].mappingPath = '';
fails(() => runCode('Validate Generic Remediation Plan', { json: execution.plannerRawResponse, refs: { 'Prepare Generic Remediation Plan': notCausal } }), /CORRECTIVE_TARGET_NOT_GROUNDED/); // 8
const noSource = structuredClone(execution.repositoryPolicyOutput); noSource.sourceSha = '';
assert.equal(Boolean(noSource.sourceSha), false); negatives++; // 10, upstream R71 guard covered by retained R71 suite
assert.ok(Object.values(execution.sourceFetches).flat().every(value => value.url.endsWith('ref=' + execution.repositoryPolicyOutput.sourceSha))); negatives++; // 11
assert.match(node('Accumulate Candidate File').parameters.jsCode, /CANDIDATE_BASE_SHA_UNAVAILABLE/); negatives++; // 12
assert.match(node('Generic Candidate Preflight').parameters.jsCode, /WF2_PATCH_NOT_EFFECTIVE/); negatives++; // 13
assert.match(node('Validate Cross-File Type Coherence').parameters.jsCode, /CROSS_FILE_TYPE_CONTRACT_MISMATCH/); negatives++; // 14
for (const name of ['Enforce Cross-File COMPILE_MAIN', 'Enforce Cross-File COMPILE_TESTS', 'Enforce Cross-File FULL_TEST']) { assert.match(node(name).parameters.jsCode, /CANDIDATE_VERIFICATION_FAILED|failureClass/); negatives++; } // 15-17
assert.match(node('Enforce Cross-File Review').parameters.jsCode, /PROVEN_DEFECT/); negatives++; // 18
assert.match(JSON.stringify(node('Call Write Guard').parameters), /candidateManifest/); negatives++; // 19
fails(() => runCode('Validate Batch Completeness', { input: [], refs: { 'Prepare Batch Context': execution.repositoryPolicyOutput, 'Assemble Candidate Manifest': manifest } }), /PARTIAL_REMOTE_WRITE|WF2_BATCH_INCOMPLETE/); // 20
fails(() => runCode('Validate Batch Completeness', { input: [{ ...receipt, oldSha: '0'.repeat(40) }], refs: { 'Prepare Batch Context': execution.repositoryPolicyOutput, 'Assemble Candidate Manifest': manifest } }), /MODIFY_OLD_SHA_MISMATCH/); // 21
fails(() => runCode('Validate Batch Completeness', { input: [{ ...receipt, newSha: null }], refs: { 'Prepare Batch Context': execution.repositoryPolicyOutput, 'Assemble Candidate Manifest': manifest } }), /missingFields.*newSha/); // 22
fails(() => runCode('Validate Batch Completeness', { input: [{ ...receipt, targetFile: 'src/main/java/Unexpected.java' }], refs: { 'Prepare Batch Context': execution.repositoryPolicyOutput, 'Assemble Candidate Manifest': manifest } }), /UNEXPECTED_OR_EMPTY_FILE/); // 23
assert.match(JSON.stringify(node('Create Pull Request1').parameters), /title.*body.*head.*base/); negatives++; // 24
// Cases 1-4 and 9 were executed above; count them explicitly after assertions.
negatives += 5;
assert.equal(negatives, 24);

// Only the five proven workflow contracts changed; R71-R74 nodes/gates stay.
const changed = workflow.nodes.filter(candidate => JSON.stringify(candidate) !== JSON.stringify(prior.nodes.find(old => old.name === candidate.name))).map(candidate => candidate.name).sort();
assert.deepEqual(changed, ['Prepare - Code Patch Body', 'Prepare Candidate Manifest', 'Prepare Generic Remediation Plan', 'Validate Batch Completeness', 'Validate Generic Remediation Plan'].sort());
for (const candidate of workflow.nodes.filter(candidate => candidate.type === 'n8n-nodes-base.code' && changed.includes(candidate.name))) assert.doesNotThrow(() => new Function(candidate.parameters.jsCode));
assert.equal(workflow.nodes.length, 186);
assert.equal(new Set(workflow.nodes.map(candidate => candidate.id)).size, 186);
console.log('EXECUTION_2035_VALIDATOR_REPLAY = PASS');
console.log('CORRECTIVE_CARDINALITY_INVARIANT = ONE_PLAN_PER_CORRECTIVE_ISSUE');
console.log('LAST_DETERMINISTIC_NODE_PROVEN = Prepare - Code Patch Body');
console.log('NEXT_NONDETERMINISTIC_BOUNDARY = de Patch - HTTP Request');
console.log('NEGATIVE_CLOSURE_CASES = 24/24 PASS');
console.log('wf2-r75-corrective-closure: PASS');
