import test from 'node:test';
import assert from 'node:assert/strict';
import {loadFrontend} from './security-lifecycle-test-loader.mjs';
const {getSecurityRemediationPresentation: present, remediationCategory, summarizeSecurityRemediation: summary}=loadFrontend('../src/app/shared/security-remediation-presentation.ts');
for(const source of ['TRIVY','OWASP']) test(`${source}: operator terminal remains audit-only and read-only`,()=>{
 const task={id:'operator',source,status:'TODO',scannerStatus:'DETECTED',securityFindingRemediation:{status:'OPERATOR_TEST_STOPPED',reasonCode:'OPERATOR_TEST_STOPPED',retryable:false,attemptNumber:2}};
 const eligibility={selectable:true};const state=present(task,eligibility);
 assert.equal(state.state,'OPERATOR_TEST_STOPPED');assert.equal(state.label,'Test opérateur terminé');
 assert.equal(state.retryAllowed,false);assert.equal(state.selectable,false);assert.equal(remediationCategory(state.state),'OPERATOR_TEST');
 const counts=summary([{}],()=>task,()=>eligibility);
 assert.equal(counts.total,1);assert.equal(counts.operatorTests,1);
 for(const key of ['autoFixAvailable','dispatching','candidateReady','failedRetryable','verifiedFixed','manualRequired'])assert.equal(counts[key],0,key);
 assert.equal(task.scannerStatus,'DETECTED');
});
test('unknown terminal still fails closed into manual',()=>{
 const task={id:'unknown',status:'TODO',scannerStatus:'DETECTED',securityFindingRemediation:{status:'UNKNOWN',retryable:true}};
 assert.equal(present(task,{selectable:true}).state,'NON_RETRYABLE_FAILURE');
 assert.equal(present(task,{selectable:true}).retryAllowed,false);
});
