import assert from 'node:assert/strict';
import fs from 'node:fs';

const load = file => JSON.parse(fs.readFileSync(file))[0];
const wf1 = load('n8n-workflows/active/wf1-incident-intake-analysis-v5-1-vNOQiEgnXg9Zqn2q.json');
const wf3 = load('n8n-workflows/active/wf3-post-pr-validation-v4-4JiOKpyHhx1znTYw.json');
const byName = (wf, name) => wf.nodes.find(node => node.name === name);
const sha = '10e90dd5a0d21941dea1a544c3026d0955a029b1';
const required = ['validationRequestId','projectId','incidentId','fixRequestId','batchId','batchKey','attemptCount',
  'repository','prNumber','prHeadBranch','expectedPrHeadSha','checkoutSha','jenkinsJob','prValidationJob',
  'jenkinsBuildNumber','jenkinsBuildUrl','jenkinsStatus','ceTaskId','analysisId','requiredStages'];

const assertContract = payload => {
  const missing = required.filter(key => payload[key] === undefined || payload[key] === null || payload[key] === '');
  assert.deepEqual(missing, []);
  assert.match(payload.expectedPrHeadSha, /^[a-f0-9]{40}$/);
  assert.equal(payload.checkoutSha, payload.expectedPrHeadSha);
  assert.ok(payload.requiredStages.find(stage => stage.stage === 'tests' && stage.required && stage.status === 'PASSED'));
};
const payload = Object.fromEntries(required.map(key => [key, key]));
Object.assign(payload, { attemptCount:7, prNumber:24, expectedPrHeadSha:sha, checkoutSha:sha,
  requiredStages:['build','tests','sonar'].map(stage => ({stage,required:true,status:'PASSED'})) });
assertContract(payload);
assert.throws(() => assertContract({...payload, checkoutSha:'b'.repeat(40)}));
assert.throws(() => assertContract({...payload, analysisId:null}));
assert.throws(() => assertContract({...payload, requiredStages:payload.requiredStages.map(stage => stage.stage === 'tests' ? {...stage,status:'SKIPPED'} : stage)}));

assert.equal(wf1.connections['Is PR Validation'].main[0][0].node, 'Validate PR Validation Contract');
for (const field of required) assert.ok(byName(wf1, 'Validate PR Validation Contract').parameters.jsCode.includes(field));
for (const field of required) assert.ok(byName(wf3, 'Extract Validation Context').parameters.jsCode.includes(field));
assert.ok(byName(wf3, 'Get Incident From DB').parameters.query.includes("prValidationRequest'->>'validationRequestId"));
assert.ok(byName(wf3, 'Consolidate Validation Result').parameters.jsCode.includes("requiredNames=['build','tests','sonar']"));
assert.ok(byName(wf3, 'Get SonarQube PR Quality Gate').parameters.url.includes('analysisId='));
console.log('PR validation WF1/WF3 contract: PASS');
