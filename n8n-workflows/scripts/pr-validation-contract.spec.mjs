import assert from 'node:assert/strict';
import fs from 'node:fs';

const load = file => JSON.parse(fs.readFileSync(file))[0];
const wf1 = load('n8n-workflows/active/wf1-incident-intake-analysis-v5-1-vNOQiEgnXg9Zqn2q.json');
const wf3 = load('n8n-workflows/active/wf3-post-pr-validation-v4-4JiOKpyHhx1znTYw.json');
const byName = (wf, name) => wf.nodes.find(node => node.name === name);
const sha = '10e90dd5a0d21941dea1a544c3026d0955a029b1';
const required = ['validationRequestId','projectId','incidentId','fixRequestId','batchId','batchKey','attemptCount',
  'repository','prNumber','prHeadBranch','expectedPrHeadSha','checkoutSha','jenkinsJob','prValidationJob',
  'jenkinsBuildNumber','jenkinsBuildUrl','jenkinsStatus','ceTaskId','analysisId','requiredStages','sonarAnalysisMode'];
const communityRequired = ['baseSonarProjectKey','validationSonarProjectKey'];
const validModes = ['COMMUNITY_EXACT_SHA','DEVELOPER_NATIVE_PR'];

const assertContract = payload => {
  const missing = required.filter(key => payload[key] === undefined || payload[key] === null || payload[key] === '');
  assert.deepEqual(missing, []);
  assert.ok(validModes.includes(payload.sonarAnalysisMode));
  if (payload.sonarAnalysisMode === 'COMMUNITY_EXACT_SHA') {
    const communityMissing = communityRequired.filter(key => payload[key] === undefined || payload[key] === null || payload[key] === '');
    assert.deepEqual(communityMissing, []);
  }
  assert.match(payload.expectedPrHeadSha, /^[a-f0-9]{40}$/);
  assert.equal(payload.checkoutSha, payload.expectedPrHeadSha);
  assert.ok(payload.requiredStages.find(stage => stage.stage === 'tests' && stage.required && stage.status === 'PASSED'));
};
const payload = Object.fromEntries(required.map(key => [key, key]));
Object.assign(payload, { attemptCount:7, prNumber:24, expectedPrHeadSha:sha, checkoutSha:sha,
  sonarAnalysisMode:'COMMUNITY_EXACT_SHA', baseSonarProjectKey:'pfe-app-test', validationSonarProjectKey:'pfe-app-test-pr-24',
  requiredStages:['build','tests','sonar'].map(stage => ({stage,required:true,status:'PASSED'})) });
assertContract(payload);
assert.throws(() => assertContract({...payload, checkoutSha:'b'.repeat(40)}));
assert.throws(() => assertContract({...payload, analysisId:null}));
assert.throws(() => assertContract({...payload, requiredStages:payload.requiredStages.map(stage => stage.stage === 'tests' ? {...stage,status:'SKIPPED'} : stage)}));

// R45 -- sonarAnalysisMode is mandatory and never inferred: absent/unknown values reject.
assert.throws(() => assertContract({...payload, sonarAnalysisMode:undefined}));
assert.throws(() => assertContract({...payload, sonarAnalysisMode:'NATIVE_PR_ANALYSIS'}));
// R45 -- COMMUNITY_EXACT_SHA requires the dedicated per-PR project keys; a missing one fails closed.
assert.throws(() => assertContract({...payload, validationSonarProjectKey:undefined}));
assert.throws(() => assertContract({...payload, baseSonarProjectKey:''}));
// R45 -- DEVELOPER_NATIVE_PR does not require the Community-only project-key fields.
assertContract({...payload, sonarAnalysisMode:'DEVELOPER_NATIVE_PR', baseSonarProjectKey:undefined, validationSonarProjectKey:undefined});
// R45 -- the exact-SHA/ceTaskId/analysisId requirements are unconditional in both modes.
assert.throws(() => assertContract({...payload, sonarAnalysisMode:'DEVELOPER_NATIVE_PR', baseSonarProjectKey:undefined, validationSonarProjectKey:undefined, analysisId:null}));

assert.equal(wf1.connections['Is PR Validation'].main[0][0].node, 'Validate PR Validation Contract');
for (const field of required) assert.ok(byName(wf1, 'Validate PR Validation Contract').parameters.jsCode.includes(field));
for (const field of required) assert.ok(byName(wf3, 'Extract Validation Context').parameters.jsCode.includes(field));
for (const wfNode of [byName(wf1, 'Validate PR Validation Contract'), byName(wf3, 'Extract Validation Context')]) {
  assert.ok(wfNode.parameters.jsCode.includes('COMMUNITY_EXACT_SHA'));
  assert.ok(wfNode.parameters.jsCode.includes('DEVELOPER_NATIVE_PR'));
  assert.ok(wfNode.parameters.jsCode.includes('INVALID_SONAR_ANALYSIS_MODE'));
  for (const field of communityRequired) assert.ok(wfNode.parameters.jsCode.includes(field));
}
assert.ok(byName(wf3, 'Get Incident From DB').parameters.query.includes("prValidationRequest'->>'validationRequestId"));
assert.ok(byName(wf3, 'Consolidate Validation Result').parameters.jsCode.includes("requiredNames=['build','tests','sonar']"));
assert.ok(byName(wf3, 'Get SonarQube PR Quality Gate').parameters.url.includes('analysisId='));

// R45 -- WF3 evidence must never claim native Sonar PR analysis when Community
// exact-SHA mode actually ran; it must name the mode transparently instead.
const consolidateCode = byName(wf3, 'Consolidate Validation Result').parameters.jsCode;
assert.ok(consolidateCode.includes('Sonar Community exact-SHA validation'));
assert.ok(consolidateCode.includes("analysisMode==='COMMUNITY_EXACT_SHA'"));
assert.ok(consolidateCode.includes('sonarAnalysisMode:analysisMode'));

// R45 -- the approved-finding search must use the isolated per-PR project key in
// Community mode and must never send a Developer-only &pullRequest= parameter there.
const prepareCode = byName(wf3, 'Prepare Approved Finding Validation').parameters.jsCode;
assert.ok(prepareCode.includes("mode==='COMMUNITY_EXACT_SHA'"));
assert.ok(prepareCode.includes('ctx.validationSonarProjectKey'));
assert.ok(prepareCode.includes('SONAR_VALIDATION_PROJECT_KEY_UNAVAILABLE'));
const communityBranch = prepareCode.slice(prepareCode.indexOf("mode==='COMMUNITY_EXACT_SHA'"), prepareCode.indexOf('}else{'));
assert.ok(!communityBranch.includes('&pullRequest='));

// R49 -- both Sonar HTTP nodes must have a real credential reference wired up.
// Proven live: real PR-24 build #3's WF3 execution errored "Credentials not
// found" on both nodes because neither had ever had one attached.
// R52 -- the original httpBasicAuth credential subsequently started failing
// Sonar auth with a real 401 (proven live on build #4); rewired to Header
// Auth credential 'n8n-sonarqube-api', which also failed (valid=false).
// R57 -- rewired again to 'sonar' (id bMpqrUPOkyVVn6G2), confirmed by the
// user as the correct credential after 'sanar' (typo) did not exist -- this
// also failed (valid=false) despite the token itself being independently
// proven valid via direct curl. R60 -- rewired to 'sonar-direct-token' (id
// r60SonarDirectCred1), created directly from the user-provided token and
// proven live (valid=true, Quality Gate OK, real issue data). No old
// credential id/name may remain referenced anywhere in either workflow's
// Sonar-facing nodes.
const OLD_SONAR_CREDENTIAL_IDS = ['AxQb6AG51EcWcXik', 'DUFtkRTI3V05MJ3X', 'bMpqrUPOkyVVn6G2'];
for (const nodeName of ['Get SonarQube PR Quality Gate', 'Get SonarQube Approved Findings']) {
  const sonarNode = byName(wf3, nodeName);
  assert.equal(sonarNode.parameters.authentication, 'predefinedCredentialType');
  assert.equal(sonarNode.parameters.nodeCredentialType, 'httpHeaderAuth');
  assert.equal(sonarNode.credentials?.httpHeaderAuth?.id, 'r60SonarDirectCred1', `${nodeName} must reference the 'sonar-direct-token' credential`);
  for (const oldId of OLD_SONAR_CREDENTIAL_IDS) {
    assert.ok(!JSON.stringify(sonarNode.credentials).includes(oldId), `${nodeName} must not still reference an old Sonar credential`);
  }
}
const wf1SonarNode = byName(wf1, 'Fetch SonarQube Issues');
assert.equal(wf1SonarNode.parameters.genericAuthType, 'httpHeaderAuth');
assert.equal(wf1SonarNode.credentials?.httpHeaderAuth?.id, 'r60SonarDirectCred1', "WF1 Fetch SonarQube Issues must reference the 'sonar-direct-token' credential");
for (const oldId of OLD_SONAR_CREDENTIAL_IDS) {
  assert.ok(!JSON.stringify(wf1SonarNode.credentials).includes(oldId), 'WF1 Fetch SonarQube Issues must not still reference an old Sonar credential');
}

// R67 -- a matching rule/file/line Sonar issue alone must never prove a
// finding still exists: on a long-lived, reused validation project, Sonar
// keeps CLOSED/FIXED issues in its history (proven live on PR-24 build #6 --
// issue 19a6499c... status=CLOSED resolution=FIXED was wrongly read as
// "remains open"). These tests execute the REAL generated jsCode (not a
// reimplementation) against constructed Sonar fixtures, so they exercise
// exactly what n8n runs.
assert.ok(byName(wf3, 'Prepare Approved Finding Validation').parameters.jsCode.includes('&resolved=false&'), 'Sonar query must request resolved=false as defense-in-depth (never relied on alone)');

const runNodeCode = (jsCode, dollarMap, inputJson) => {
  const $ = name => ({ first: () => ({ json: dollarMap[name] }) });
  const $input = { first: () => ({ json: inputJson }) };
  // eslint-disable-next-line no-new-func
  return new Function('$', '$input', jsCode)($, $input)[0].json;
};

const s1068Finding = { findingId: '39c99e32-2737-419c-b85d-f521ce541f41', rule: 'java:S1068', file: 'src/main/java/com/pfe/devsecops/service/TaskService.java', line: 48 };
const s125Finding = { findingId: 'b8305253-8e0c-4fb6-88a8-2eadb6d48a45', rule: 'java:S125', file: 'src/main/java/com/pfe/devsecops/config/SecurityConfig.java', line: 40 };
const taskControllerOpenS125 = { key: '8e25e723-97cc-4da0-b3c3-f799fafff264', rule: 'java:S125', component: 'pfe-app-test-pr-24:src/main/java/com/pfe/devsecops/controller/TaskController.java', line: 29, status: 'OPEN', resolution: null, issueStatus: 'OPEN' };
const securityConfigClosedFixed = { key: '19a6499c-3e31-49ed-84be-d8b741ca7f6a', rule: 'java:S125', component: 'pfe-app-test-pr-24:src/main/java/com/pfe/devsecops/config/SecurityConfig.java', status: 'CLOSED', resolution: 'FIXED', issueStatus: 'FIXED' }; // no `line` field, matching real R66/R67 evidence exactly

const ctxBase = {
  sonarAnalysisMode: 'COMMUNITY_EXACT_SHA', ceTaskId: 'ce-1', analysisId: 'analysis-1',
  requiredStages: ['build', 'tests', 'sonar'].map(stage => ({ stage, required: true, status: 'PASSED' })),
  jenkinsStatus: 'SUCCESS', expectedPrHeadSha: sha, checkoutSha: sha, incidentId: 'incident-1',
};
const consolidateCodeUnderTest = byName(wf3, 'Consolidate Validation Result').parameters.jsCode;
const runConsolidate = (findings, findingIds, issues, overrides = {}) => runNodeCode(consolidateCodeUnderTest, {
  'Extract Validation Context': { ...ctxBase, ...overrides },
  'Get Incident From DB': { id: 'incident-1' },
  'Get SonarQube PR Quality Gate': { projectStatus: { status: 'OK' } },
  'Get SonarQube Approved Findings': issues === undefined ? { error: { message: 'unavailable' } } : { issues },
  'Prepare Approved Finding Validation': { findings, findingIds: findings.map(f => f.findingId) },
}, null);
const resultFor = (findingId, findings, findingIds, issues, overrides) => runConsolidate(findings, findingIds, issues, overrides).findingResults.find(r => r.findingId === findingId);

// A. matching issue OPEN => INVALID
assert.equal(resultFor('b8305253-8e0c-4fb6-88a8-2eadb6d48a45', [s125Finding], null, [{ ...securityConfigClosedFixed, status: 'OPEN', resolution: null, issueStatus: 'OPEN', line: 40 }]).result, 'INVALID', 'A: an OPEN matching issue must still invalidate the finding');

// B. matching issue CLOSED+FIXED => VALID
assert.equal(resultFor('b8305253-8e0c-4fb6-88a8-2eadb6d48a45', [s125Finding], null, [securityConfigClosedFixed]).result, 'VALID', 'B: a CLOSED/FIXED historical issue must not invalidate the finding');

// C. historical CLOSED/FIXED plus unrelated active same-rule issue in another file => approved finding VALID
assert.equal(resultFor('b8305253-8e0c-4fb6-88a8-2eadb6d48a45', [s125Finding], null, [securityConfigClosedFixed, taskControllerOpenS125]).result, 'VALID', 'C: an unrelated active same-rule issue in a different file must not invalidate the approved finding');

// D. REOPENED / equivalent live state => INVALID
assert.equal(resultFor('b8305253-8e0c-4fb6-88a8-2eadb6d48a45', [s125Finding], null, [{ ...securityConfigClosedFixed, status: 'REOPENED', resolution: null, issueStatus: 'CONFIRMED', line: 40 }]).result, 'INVALID', 'D: REOPENED is a live state and must still invalidate the finding');

// E. no matching issue with complete successful Sonar response => VALID
assert.equal(resultFor('b8305253-8e0c-4fb6-88a8-2eadb6d48a45', [s125Finding], null, []).result, 'VALID', 'E: an empty-but-successful issue list means the finding is genuinely absent');

// F. Sonar API failure => INCONCLUSIVE
assert.equal(resultFor('b8305253-8e0c-4fb6-88a8-2eadb6d48a45', [s125Finding], null, undefined).result, 'INCONCLUSIVE', 'F: a failed Sonar search must never be silently treated as VALID');

// G. malformed Sonar response => INCONCLUSIVE
assert.equal(runNodeCode(consolidateCodeUnderTest, {
  'Extract Validation Context': ctxBase, 'Get Incident From DB': { id: 'incident-1' },
  'Get SonarQube PR Quality Gate': { projectStatus: { status: 'OK' } },
  'Get SonarQube Approved Findings': { issues: 'not-an-array' },
  'Prepare Approved Finding Validation': { findings: [s125Finding], findingIds: [s125Finding.findingId] },
}, null).findingResults[0].result, 'INCONCLUSIVE', 'G: a malformed (non-array issues) Sonar response must never be silently treated as VALID');

// H. rule matches but file differs => excluded
assert.equal(resultFor('b8305253-8e0c-4fb6-88a8-2eadb6d48a45', [s125Finding], null, [{ ...securityConfigClosedFixed, component: 'pfe-app-test-pr-24:src/main/java/com/pfe/devsecops/other/Elsewhere.java', status: 'OPEN', resolution: null, line: 40 }]).result, 'VALID', 'H: same rule but a different file must be excluded from matching');

// I. file matches but rule differs => excluded
assert.equal(resultFor('b8305253-8e0c-4fb6-88a8-2eadb6d48a45', [s125Finding], null, [{ ...securityConfigClosedFixed, rule: 'java:S9999', status: 'OPEN', resolution: null, line: 40 }]).result, 'VALID', 'I: same file but a different rule must be excluded from matching');

// J. historical line changed/null after closure must not resurrect a CLOSED/FIXED issue
assert.equal(resultFor('b8305253-8e0c-4fb6-88a8-2eadb6d48a45', [s125Finding], null, [{ ...securityConfigClosedFixed, line: undefined }]).result, 'VALID', 'J: a null/absent line on a CLOSED/FIXED issue must not resurrect it via the line-match bypass');

// K. S1068 existing VALID behavior unchanged (mixed batch, only S125 issues present)
{
  const batch = runConsolidate([s1068Finding, s125Finding], null, [taskControllerOpenS125, securityConfigClosedFixed]);
  assert.equal(batch.findingResults.find(r => r.findingId === s1068Finding.findingId).result, 'VALID', 'K: S1068 must remain VALID, unaffected by S125 status-filter changes');
  assert.equal(batch.findingResults.find(r => r.findingId === s125Finding.findingId).result, 'VALID', 'R66 replay: SecurityConfig S125 is now correctly VALID');
}

// R66 replay -- full acceptance case: both approved findings VALID, but the
// mandatory test gate is still failing. Overall must stay non-VALIDATED --
// the fix must never let a green remediation batch override a real test
// failure.
{
  const replay = runConsolidate([s1068Finding, s125Finding], null, [taskControllerOpenS125, securityConfigClosedFixed], {
    requiredStages: [
      { stage: 'build', required: true, status: 'FAILED' },
      { stage: 'tests', required: true, status: 'FAILED' },
      { stage: 'sonar', required: true, status: 'PASSED' },
    ],
    jenkinsStatus: 'UNSTABLE',
  });
  assert.deepEqual(replay.findingResults.map(r => r.result), ['VALID', 'VALID'], 'R66 replay: both approved findings are VALID');
  assert.equal(replay.passed, false, 'R66 replay: overall must not pass while the test gate is failing');
  assert.equal(replay.validationStatus, 'INCONCLUSIVE', 'R66 replay: no INVALID finding remains, so status is INCONCLUSIVE, never VALIDATED, while tests fail');
  assert.ok(replay.failureReasons.some(r => String(r).includes('build=FAILED')), 'R66 replay: the real test/build failure must still surface as a failure reason');
}

console.log('PR validation WF1/WF3 contract: PASS');
