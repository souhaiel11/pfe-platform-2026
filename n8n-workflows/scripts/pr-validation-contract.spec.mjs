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
// Sonar auth with a real 401 (proven live on build #4); rewired to the new
// Header Auth credential 'n8n-sonarqube-api'. No old credential id/name may
// remain referenced anywhere in either workflow's Sonar-facing nodes.
const OLD_SONAR_CREDENTIAL_ID = 'AxQb6AG51EcWcXik';
for (const nodeName of ['Get SonarQube PR Quality Gate', 'Get SonarQube Approved Findings']) {
  const sonarNode = byName(wf3, nodeName);
  assert.equal(sonarNode.parameters.authentication, 'predefinedCredentialType');
  assert.equal(sonarNode.parameters.nodeCredentialType, 'httpHeaderAuth');
  assert.equal(sonarNode.credentials?.httpHeaderAuth?.id, 'DUFtkRTI3V05MJ3X', `${nodeName} must reference the new n8n-sonarqube-api credential`);
  assert.ok(!JSON.stringify(sonarNode.credentials).includes(OLD_SONAR_CREDENTIAL_ID), `${nodeName} must not still reference the old Sonar credential`);
}
const wf1SonarNode = byName(wf1, 'Fetch SonarQube Issues');
assert.equal(wf1SonarNode.parameters.genericAuthType, 'httpHeaderAuth');
assert.equal(wf1SonarNode.credentials?.httpHeaderAuth?.id, 'DUFtkRTI3V05MJ3X', 'WF1 Fetch SonarQube Issues must reference the new n8n-sonarqube-api credential');
assert.ok(!JSON.stringify(wf1SonarNode.credentials).includes(OLD_SONAR_CREDENTIAL_ID), 'WF1 Fetch SonarQube Issues must not still reference the old Sonar credential');

console.log('PR validation WF1/WF3 contract: PASS');
