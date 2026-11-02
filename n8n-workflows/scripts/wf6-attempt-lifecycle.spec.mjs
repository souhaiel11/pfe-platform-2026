// Vérifie les transitions du cycle de correction dans WF6.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import { buildHarnessTarget } from './build-wf6-retry-e2e-harness.mjs';
import { buildAttemptTarget, targetUrl } from './build-wf6-attempt-lifecycle.mjs';
const {baseline, target:expected, changed}=buildAttemptTarget();
const [target]=JSON.parse(readFileSync(process.env.WF6_ATTEMPT_TEST_TARGET || targetUrl));
const isHarnessTarget=!!process.env.WF6_ATTEMPT_TEST_TARGET;
const nodes=new Map(target.nodes.map(n=>[n.name,n]));
const req={projectId:'3aa1c9b9-e114-40e4-884b-ebc7aa32e002',batchId:'sec-batch-new',findingTaskIds:['task-a','task-b'],attempts:[
 {findingTaskId:'task-a',attemptId:'uuid-a',attemptNumber:2},{findingTaskId:'task-b',attemptId:'uuid-b',attemptNumber:1}],
 v1_8ValidatedFindings:[{findingTaskId:'task-a',cve:'CVE-A'},{findingTaskId:'task-b',cve:'CVE-B'}]};
const findings=[{cveId:'CVE-A',status:'CLOSED',reason:'TARGET_CVE_CLOSED'},{cveId:'CVE-B',status:'CLOSED',reason:'TARGET_CVE_CLOSED'}];
const trusted={findings,candidateIdentity:'c'.repeat(64),decision:{evaluatedSha:'a'.repeat(40)},branchName:'security/fix/test'};
const ev={...trusted,status:'TECHNICAL_FAILURE',reason:'RUNTIME_OPERATION_TIMEOUT:TRIVY_SCAN'};
/** Évalue les données et retourne la décision correspondante. */
function evaluate(node,body=req,early=false){
 /** Simule l’accès à un nœud n8n pour le scénario. */
 const $=name=>{
  if(name==='Webhook - Security Remediation Request')return {
  /** Renvoie le premier élément disponible. */
  first:()=>({json:{body}})};
  if(early)throw Error(`Forbidden early reference: ${name}`);
  return {
  /** Renvoie le premier élément disponible. */
  first:()=>({json:name==='Trusted Candidate'?trusted:name==='Evaluate Security Remediation'?{body:ev}:
    {pullRequestUrl:'https://github.com/x/y/pull/1',pullRequestNumber:1}})};
 };
 return vm.runInNewContext(`(${node.parameters.jsonBody.slice(3,-2)})`,{$,$json:{body:ev},$execution:{id:'offline-execution'}});
}
const callbacks=target.nodes.filter(n=>n.name.startsWith('Record Batch Result'));
test('W1 intake correlation uses authoritative webhook envelope on all branches',()=>{assert.equal(target.id,baseline.id);for(const n of callbacks)assert.match(n.parameters.jsonBody,/Webhook - Security Remediation Request/);});
test('W2 attemptNumber retained individually for mixed-history batches',()=>{for(const n of callbacks){const p=evaluate(n);assert.deepEqual(Array.from(p.findings,f=>f.attemptNumber),[2,1]);}});
test('W3 fresh backend batchId propagated exactly',()=>{for(const n of callbacks)assert.equal(evaluate(n).batchId,req.batchId);for(const n of target.nodes.filter(n=>n.name==='Evaluate Security Remediation'||n.name.startsWith('Revalidate Before Write')))assert.equal(evaluate(n).batchId,req.batchId);});
test('W4 success callback carries both finding attempt identities and execution id',()=>{const p=evaluate(nodes.get('Record Batch Result (Success)'));assert.deepEqual(Array.from(p.findings,f=>f.attemptId),['uuid-a','uuid-b']);assert.equal(p.executionId,'offline-execution');assert.equal(p.status,'CANDIDATE_READY');assert.equal(p.findings[0].status,'CLOSED');});
test('W5 all technical failure callbacks carry exact identities',()=>{for(const n of callbacks){const p=evaluate(n);assert.equal(p.findings.length,2);for(const f of p.findings){const a=req.attempts.find(a=>a.findingTaskId===f.findingTaskId);assert.equal(f.attemptId,a.attemptId);assert.equal(f.attemptNumber,a.attemptNumber);}}});
test('W6 EVALUATION_FAILED carries identity without Trusted Candidate',()=>{ev.failureClass='VERIFIER_TIMEOUT';try{const p=evaluate(nodes.get('Record Batch Result (EVALUATION_FAILED)'),req,true);assert.equal(p.findings[0].attemptId,'uuid-a');assert.equal(p.findings[0].status,'TECHNICAL_FAILURE');assert.equal(p.reason,ev.reason);assert.equal(p.findings[0].reasonCode,'VERIFIER_TIMEOUT');}finally{delete ev.failureClass;}});
test('W7 correlation cannot be fabricated when intake identity is missing',()=>{const noIdentity={...req,attempts:[]};for(const n of callbacks)assert.throws(()=>evaluate(n,noIdentity),/ATTEMPT_CORRELATION_MISSING/);});
test('W8 R95 fix preserves webhook/$json-only early failure and genuine underlying reason',()=>{const n=nodes.get('Record Batch Result (EVALUATION_FAILED)');assert.doesNotMatch(n.parameters.jsonBody,/Trusted Candidate/);const refs=[...n.parameters.jsonBody.matchAll(/\$\("([^"]+)"\)/g)].map(m=>m[1]);assert.ok(refs.every(x=>x==='Webhook - Security Remediation Request'));assert.equal(evaluate(n,req,true).findings[1].reason,ev.reason);});
test('W9 Trusted Candidate validation and all candidate code nodes unchanged',()=>{for(const old of baseline.nodes.filter(n=>n.type==='n8n-nodes-base.code'))assert.deepEqual(nodes.get(old.name),old);});
test('W10 strict diff proves Git/security policy, graph, settings and credentials unchanged',()=>{if (isHarnessTarget) { assert.deepEqual(target,buildHarnessTarget().target); const original=structuredClone(target); original.nodes=original.nodes.filter(n=>n.name!=='Operator Test Barrier?'); delete original.connections['Operator Test Barrier?']; original.connections['Evaluation HTTP OK?']=expected.connections['Evaluation HTTP OK?']; assert.deepEqual(original,expected); } else assert.deepEqual(target,expected); if (!isHarnessTarget) assert.deepEqual(target.connections,baseline.connections);assert.deepEqual(target.settings,baseline.settings);for(const old of baseline.nodes){const n=nodes.get(old.name);assert.deepEqual(n.credentials,old.credentials);if(!changed.some(c=>c.name===n.name))assert.deepEqual(n,old);else {const a=structuredClone(n);a.parameters.jsonBody=old.parameters.jsonBody;assert.deepEqual(a,old);}}assert.equal(changed.length,32);});
test('evaluation/revalidation forwards correlations without changing original body fields',()=>{for(const n of target.nodes.filter(n=>n.name==='Evaluate Security Remediation'||n.name.startsWith('Revalidate Before Write'))){const p=evaluate(n);assert.equal(JSON.stringify(p.attempts),JSON.stringify(req.attempts));assert.equal(p.projectId,req.projectId);assert.equal(JSON.stringify(p.findingTaskIds),JSON.stringify(req.findingTaskIds));}});

test('empty early evaluation findings still complete each reserved task using intake identity',()=>{const previous=ev.findings;try{ev.findings=[];const p=evaluate(nodes.get('Record Batch Result (Not Ready)'));assert.equal(p.findings.length,2);assert.equal(p.findings[1].attemptId,'uuid-b');}finally{ev.findings=previous;}});
