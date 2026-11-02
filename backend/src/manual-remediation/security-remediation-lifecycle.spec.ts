// Teste le composant « security-remediation-lifecycle » et ses cas d’erreur.
import { targetReservationTestQuery } from './target-reservation-test-query';
import { AsyncLocalStorage } from 'node:async_hooks';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { ValidationPipe } from '@nestjs/common';
import { ManualRemediationService } from './manual-remediation.service';
import { ManualRemediationTask } from './manual-remediation.entity';
import { Project } from '../projects/project.entity';
import { RetrySecurityRemediationDto } from './retry-security-remediation.dto';
import { isProjectFixVerified, classifySecurityRemediationFailure, normalizeSecurityRemediation, MAX_AUTOMATIC_ATTEMPTS } from './security-remediation-lifecycle';

const projectId='3aa1c9b9-e114-40e4-884b-ebc7aa32e002';
const taskId='83555b3a-efa1-45e1-90a8-008debddba92';
const user={id:'dev',role:'developer'};
/** Prépare les données initiales prévues par ce service. */
const seed=(extra:any={})=>({id:taskId,projectId,source:'TRIVY',ruleOrCve:'CVE-2022-38749',findingFingerprint:'fp',
 findingSnapshot:{component:'a:b',currentVersion:'1.0',fixedVersion:'1.1'},remediationType:'DEVELOPER_ACTION_REQUIRED',
 status:'TODO',scannerStatus:'DETECTED',securityFindingRemediation:null, ...extra});
/** Vérifie les résultats attendus dans ce scénario. */
function harness(extra:any={}, dispatch?: (payload:any,h:any)=>Promise<void>) {
 const inTransaction=new AsyncLocalStorage<boolean>();
 let rows=[seed(extra)];let tail=Promise.resolve();let locked=false;let dispatches:any[]=[];
 /** Recherche les éléments correspondants. */
 const find=(where:any)=>rows.find(t=>Object.entries(where).every(([k,v])=>t[k]===v));
 const repo:any={
 /** Recherche l’élément correspondant à l’identifiant. */
 findOne:async({where}:any)=>structuredClone(find(where)||null),manager:{}};
 /** Exécute les opérations dans le cadre transactionnel prévu. */
 repo.manager.transaction=async(fn:any)=>{
  const prev=tail;let release:any;tail=new Promise<void>(r=>release=r);await prev;
  const before=structuredClone(rows);locked=true;
  const taskRepo={
  /** Recherche l’élément correspondant à l’identifiant. */
  findOne:async({where,lock}:any)=>{if(lock)assert.equal(lock.mode,'pessimistic_write');return structuredClone(find(where)||null);},
    /** Enregistre les données fournies. */
    save:async(value:any)=>{for(const t of Array.isArray(value)?value:[value])rows[rows.findIndex(r=>r.id===t.id)]=structuredClone(t);return value;}};
  try{return await inTransaction.run(true,()=>fn({query: targetReservationTestQuery(), 
  /** Simule la lecture des données demandées par le composant. */
  getRepository:(entity:any)=>entity===Project?{
  /** Recherche l’élément correspondant à l’identifiant. */
  findOne:async()=>({id:projectId,githubRepo:'trusted/repo'})}:taskRepo}));}
  catch(e){rows=before;throw e;}finally{locked=false;release();}
 };
 const h:any={
 /** Prépare les données nécessaires à ce scénario. */
 row:()=>structuredClone(rows[0]),dispatches,
 /** Prépare les données nécessaires à ce scénario. */
 replace:(t:any)=>rows=[structuredClone(t)]};
 const dispatcher={
 /** Transmet la demande au service chargé de l’exécuter. */
 dispatch:async(p:any)=>{assert.equal(inTransaction.getStore(),undefined,'this request transaction must commit before HTTP');dispatches.push(structuredClone(p));if(dispatch)await dispatch(p,h);}};
 h.service=new ManualRemediationService(repo,{
 /** Recherche l’élément correspondant à l’identifiant. */
 findOne:async()=>null} as any,dispatcher);
 return h;
}
/** Lance l’opération du scénario. */
const launch=(h:any)=>h.service.launchBatchRemediation(projectId,[taskId],user);
/** Traite le retour de l’opération du scénario. */
const callback=(p:any,status='TECHNICAL_FAILURE',reason='RUNTIME_OPERATION_TIMEOUT',extra:any={})=>({projectId,batchId:p.batchId,status,reason,
 findings:[{findingTaskId:taskId,cveId:'CVE-2022-38749',attemptId:p.attempts[0].attemptId,attemptNumber:p.attempts[0].attemptNumber,status,reason}],...extra});
/** Prépare les données nécessaires à ce scénario. */
async function failed(extra:any={}){const h=harness(extra);const p=await launch(h);await h.service.recordWf6BatchResult(callback(p));return {h,p};}

test('A1 initial launch reserves exactly attempt #1 with unique identity',async()=>{const h=harness();const p=await launch(h);assert.equal(h.row().securityFindingRemediation.attemptNumber,1);assert.match(p.attempts[0].attemptId,/^[0-9a-f-]{36}$/);assert.equal(p.attempts[0].attemptNumber,1);});
test('A2 callback completes attempt #1 without increment/append',async()=>{const {h}=await failed();const r=h.row().securityFindingRemediation;assert.equal(r.attemptCount,1);assert.equal(r.attempts.length,1);assert.ok(r.attempts[0].finishedAt);});
test('A3 retry reserves exactly attempt #2',async()=>{const {h}=await failed();await h.service.retrySecurityRemediation(taskId,{},user);assert.equal(h.row().securityFindingRemediation.attemptNumber,2);});
test('A4 retry attemptId differs',async()=>{const {h,p}=await failed();const q=await h.service.retrySecurityRemediation(taskId,{},user);assert.notEqual(q.attempts[0].attemptId,p.attempts[0].attemptId);});
test('A5 retry batchId differs',async()=>{const {h,p}=await failed();const q=await h.service.retrySecurityRemediation(taskId,{},user);assert.notEqual(q.batchId,p.batchId);});
test('A6 previous finished attempt preserved byte-for-byte',async()=>{const {h}=await failed();const old=h.row().securityFindingRemediation.attempts[0];await h.service.retrySecurityRemediation(taskId,{},user);assert.deepEqual(h.row().securityFindingRemediation.attempts[0],old);});
test('A7 duplicate callback idempotent',async()=>{const {h,p}=await failed();const old=h.row();await h.service.recordWf6BatchResult(callback(p));assert.deepEqual(h.row(),old);});
test('A8 old callback cannot mutate newer attempt',async()=>{const {h,p}=await failed();await h.service.retrySecurityRemediation(taskId,{},user);const old=h.row();await assert.rejects(h.service.recordWf6BatchResult(callback(p)));assert.deepEqual(h.row(),old);});
test('A9 wrong batchId rejected',async()=>{const h=harness();const p=await launch(h);const old=h.row();await assert.rejects(h.service.recordWf6BatchResult(callback({...p,batchId:'wrong'})));assert.deepEqual(h.row(),old);});
test('A10 concurrent retry requests reserve exactly one attempt',async()=>{const {h}=await failed();const results=await Promise.allSettled([h.service.retrySecurityRemediation(taskId,{},user),h.service.retrySecurityRemediation(taskId,{},user)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(h.row().securityFindingRemediation.attemptNumber,2);assert.equal(h.dispatches.length,2);});
test('A11 HTTP failure completes same reservation and blocks uncertain remote effects',async()=>{const h=harness({},async()=>{throw Error('timeout secret must not leak');});await assert.rejects(launch(h));const r=h.row().securityFindingRemediation;assert.equal(r.status,'DISPATCH_FAILED');assert.equal(r.attemptNumber,1);assert.equal(r.attempts.length,1);assert.ok(r.attempts[0].finishedAt);assert.equal(r.retryable,false);await assert.rejects(h.service.retrySecurityRemediation(taskId,{},user));});
test('A12 legacy row can reserve modern retry without losing raw historical fields',async()=>{const legacy={status:'TECHNICAL_FAILURE',reason:'WARMUP_NETWORK_FAILURE',attemptCount:1,attempts:[{attempt:1,at:'2026-01-01',status:'TECHNICAL_FAILURE',reason:'WARMUP_NETWORK_FAILURE',customEvidence:'kept'}]};const h=harness({securityFindingRemediation:legacy});const p=await h.service.retrySecurityRemediation(taskId,{},user);const r=h.row().securityFindingRemediation;assert.equal(p.attempts[0].attemptNumber,2);assert.equal(r.attempts[0].legacyAttempt,true);assert.equal(r.attempts[0].customEvidence,'kept');assert.equal(legacy.attempts[0].hasOwnProperty('legacyAttempt'),false);});

for(const [id,code,allowed] of [['R1','RUNTIME_OPERATION_TIMEOUT',true],['R2','WARMUP_NETWORK_FAILURE',true],['R1b','VERIFIER_UNAVAILABLE',true],['R1c','VERIFIER_PROTOCOL_ERROR',true],['R3','APPLICATION_TESTS_FAILED',false],['R4','MAVEN_RESOLUTION_MISMATCH',false],['R5','CANDIDATE_DRIFTED',false],['R6','unknown timeout text',false]] as const){test(`${id} policy ${code}`,async()=>{assert.equal(classifySecurityRemediationFailure({reason:code}).retryable,allowed);const h=harness();const p=await launch(h);await h.service.recordWf6BatchResult(callback(p,'TECHNICAL_FAILURE',code));if(allowed)await h.service.retrySecurityRemediation(taskId,{},user);else await assert.rejects(h.service.retrySecurityRemediation(taskId,{},user));});}
test('R7 VERIFIED + NOT_DETECTED refuses retry',async()=>{const {h}=await failed();h.replace({...h.row(),status:'VERIFIED',scannerStatus:'NOT_DETECTED'});await assert.rejects(h.service.retrySecurityRemediation(taskId,{},user));});
test('R8 DISPATCHING refuses retry',async()=>{const h=harness();await launch(h);await assert.rejects(h.service.retrySecurityRemediation(taskId,{},user));});
test('R9 CANDIDATE_READY refuses retry',async()=>{const h=harness();const p=await launch(h);await h.service.recordWf6BatchResult(callback(p,'CANDIDATE_READY','PR_CREATED'));await assert.rejects(h.service.retrySecurityRemediation(taskId,{},user));});
test('R10 maximum includes initial; fourth attempt refused',async()=>{const {h}=await failed();for(let i=2;i<=3;i++){const p=await h.service.retrySecurityRemediation(taskId,{},user);await h.service.recordWf6BatchResult(callback(p));}assert.equal(MAX_AUTOMATIC_ATTEMPTS,3);await assert.rejects(h.service.retrySecurityRemediation(taskId,{},user));assert.equal(h.dispatches.length,3);});
test('R11 unresolved PR/Git side effects refuse retry',async()=>{for(const effect of [{prUrl:'https://github.com/x/y/pull/1'},{branchName:'security/fix/x'},{unresolvedGitSideEffect:true}]){const {h}=await failed();const t=h.row();t.securityFindingRemediation={...t.securityFindingRemediation,...effect};h.replace(t);await assert.rejects(h.service.retrySecurityRemediation(taskId,{},user));}});
test('R12 concurrent duplicate request dispatches once',async()=>{const {h}=await failed();const expectedAttemptId=h.row().securityFindingRemediation.attemptId;await Promise.allSettled([h.service.retrySecurityRemediation(taskId,{expectedAttemptId},user),h.service.retrySecurityRemediation(taskId,{expectedAttemptId},user)]);assert.equal(h.dispatches.length,2);});

for(const [id,task,yes] of [
 ['V1',{securityFindingRemediation:{status:'CLOSED'}},false],
 ['V2',{status:'TODO',scannerStatus:'DETECTED',securityFindingRemediation:{status:'CLOSED'}},false],
 ['V3',{status:'VERIFIED',scannerStatus:'NOT_DETECTED'},true],
 ['V4',{status:'VERIFIED',scannerStatus:'STILL_DETECTED'},false],
 ['V5',{status:'VERIFIED',scannerStatus:'DETECTED'},false],
] as const)test(`${id} project correction predicate`,()=>assert.equal(isProjectFixVerified(task),yes));
test('V6 candidate CLOSED preserved independently from project correction and reappearance',async()=>{const h=harness();const p=await launch(h);const dto=callback(p,'CANDIDATE_READY','PR_CREATED');dto.findings[0].status='CLOSED';dto.findings[0].reason='TARGET_CVE_CLOSED';await h.service.recordWf6BatchResult(dto);const r=h.row();assert.equal(r.securityFindingRemediation.status,'CANDIDATE_READY');assert.equal(r.securityFindingRemediation.attempts[0].candidateStatus,'CLOSED');assert.equal(isProjectFixVerified(r),false);const before=structuredClone(r.securityFindingRemediation.attempts);for(const scannerStatus of ['NOT_DETECTED','STILL_DETECTED','DETECTED']){r.status='VERIFIED';r.scannerStatus=scannerStatus;assert.equal(isProjectFixVerified(r),scannerStatus==='NOT_DETECTED');assert.deepEqual(r.securityFindingRemediation.attempts,before);}});

test('stale reconciliation retry policy never guesses from TECHNICAL_FAILURE',()=>{assert.equal(classifySecurityRemediationFailure({reasonCode:'WF6_STALE_DISPATCH_RECONCILED'}).retryable,false);assert.equal(classifySecurityRemediationFailure({reasonCode:'WF6_STALE_DISPATCH_RECONCILED',underlyingReasonCode:'VERIFIER_TIMEOUT'}).retryable,true);assert.equal(classifySecurityRemediationFailure({reasonCode:'WF6_STALE_DISPATCH_RECONCILED',underlyingReasonCode:'something'}).retryable,false);});
test('retry DTO forbids server-owned properties',async()=>{const pipe=new ValidationPipe({whitelist:true,forbidNonWhitelisted:true,transform:true});for(const key of ['status','retryable','attemptId','attemptNumber','batchId','reasonCode'])await assert.rejects(pipe.transform({[key]:'injected'},{type:'body',metatype:RetrySecurityRemediationDto}));});
test('missing correlation and differing duplicate callback never mutate task',async()=>{const {h,p}=await failed();const old=h.row();const wrong=callback(p);delete wrong.findings[0].attemptId;await assert.rejects(h.service.recordWf6BatchResult(wrong));await assert.rejects(h.service.recordWf6BatchResult(callback(p,'TECHNICAL_FAILURE','WARMUP_TIMEOUT')));assert.deepEqual(h.row(),old);});
test('optimistic attempt identity cannot refer to another attempt',async()=>{const {h}=await failed();await assert.rejects(h.service.retrySecurityRemediation(taskId,{expectedAttemptId:'wrong'},user));assert.equal(h.dispatches.length,1);});
test('legacy read normalization preserves unknown fields and marks historical entries',()=>{const raw={status:'TECHNICAL_FAILURE',reason:'VERIFIER_TIMEOUT',attempts:[{attempt:1,at:'2026-01-01',status:'TECHNICAL_FAILURE',reason:'VERIFIER_TIMEOUT',extra:'original'}]};const n=normalizeSecurityRemediation(raw);assert.equal(n.attempts[0].legacyAttempt,true);assert.equal(n.attempts[0].extra,'original');assert.equal(raw.attempts[0].hasOwnProperty('legacyAttempt'),false);});

test('modern stale reconciliation completes same attempt; underlying timeout retained',async()=>{
 const h=harness();const p=await launch(h);const t=h.row();const r=t.securityFindingRemediation;
 r.startedAt='2020-01-01T00:00:00Z';r.attempts[0].startedAt=r.startedAt;r.attempts[0].underlyingReasonCode='VERIFIER_TIMEOUT';h.replace(t);
 await h.service.reconcileStaleWf6Dispatch(taskId,{batchId:p.batchId,attemptCount:1},{role:'admin'});
 const done=h.row().securityFindingRemediation;assert.equal(done.attemptCount,1);assert.equal(done.attempts.length,1);
 assert.equal(done.reasonCode,'WF6_STALE_DISPATCH_RECONCILED');assert.equal(done.retryable,true);assert.equal(done.underlyingReasonCode,'VERIFIER_TIMEOUT');
 await assert.rejects(h.service.retrySecurityRemediation(taskId,{},user),'unresolved remote side effects must block retry even when the underlying code is temporary');
});
test('legacy uncorrelated callback cannot overwrite a legacy row',async()=>{
 const h=harness({securityFindingRemediation:{status:'TECHNICAL_FAILURE',reason:'VERIFIER_TIMEOUT',attemptCount:1,attempts:[{attempt:1,status:'TECHNICAL_FAILURE',reason:'VERIFIER_TIMEOUT'}]}});
 const before=h.row();await assert.rejects(h.service.recordWf6BatchResult({projectId,batchId:'old',status:'CANDIDATE_READY',findings:[{findingTaskId:taskId,cveId:'CVE-2022-38749',status:'CLOSED'}]}));assert.deepEqual(h.row(),before);
});
test('initial launch endpoint cannot bypass retry eligibility for an existing failed task',async()=>{const {h}=await failed();await assert.rejects(launch(h));assert.equal(h.dispatches.length,1);});
test('wrong attemptNumber, project and finding identity each reject safely',async()=>{const h=harness();const p=await launch(h);const before=h.row();for(const mutate of [(d:any)=>d.findings[0].attemptNumber++, (d:any)=>d.projectId='wrong', (d:any)=>d.findings[0].cveId='CVE-wrong']){const d=callback(p);mutate(d);await assert.rejects(h.service.recordWf6BatchResult(d));assert.deepEqual(h.row(),before);}});
test('correlated evaluation context refuses stale or completed attempts',async()=>{const h=harness();const p=await launch(h);await h.service.verifyWf6AttemptContext(projectId,[taskId],p.batchId,p.attempts);await h.service.recordWf6BatchResult(callback(p));await assert.rejects(h.service.verifyWf6AttemptContext(projectId,[taskId],p.batchId,p.attempts));});
test('historical success with persisted PR is never erased by a refused retry',async()=>{const historical={status:'TECHNICAL_FAILURE',reason:'VERIFIER_TIMEOUT',attemptCount:1,attempts:[{attempt:1,status:'CLOSED',prUrl:'https://github.com/x/y/pull/1',reason:'TARGET_CVE_CLOSED'}]};const h=harness({securityFindingRemediation:historical});const before=h.row();await assert.rejects(h.service.retrySecurityRemediation(taskId,{},user));assert.deepEqual(h.row(),before);});
test('real syncIncident reopens project-verified finding without deleting successful candidate history',async()=>{
 const history={status:'CANDIDATE_READY',attempts:[{attempt:1,status:'CLOSED',reason:'TARGET_CVE_CLOSED'}]};
 const finding={id:'CVE-2022-38749',pkg:'a:b',installedVersion:'1.0',fixedVersion:'1.1',severity:'HIGH'};
 const {findingFingerprint}=await import('./finding-fingerprint');
 const row:any=seed({status:'VERIFIED',scannerStatus:'NOT_DETECTED',events:[],findingFingerprint:findingFingerprint('TRIVY',finding),securityFindingRemediation:history});
 const repo:any={
 /** Recherche les éléments correspondants. */
 find:async({where}:any)=>where.source==='TRIVY'?[row]:[],
 /** Enregistre les données fournies. */
 save:async(t:any)=>t,
 /** Applique les modifications autorisées à l’élément. */
 update:async()=>{}};
 const service=new ManualRemediationService(repo,{} as any,{
 /** Transmet la demande au service chargé de l’exécuter. */
 dispatch:async()=>{throw Error('no dispatch')}});
 await service.syncIncident({id:'incident',projectId,buildNumber:2,metadata:{enrichedData:{trivy:{status:'COMPLETED',completed:true,resultAvailable:true,cves:[finding]},owasp:{status:'NOT_RUN'},zap:{status:'NOT_RUN'}}}} as any);
 assert.equal(row.status,'REOPENED');assert.equal(row.scannerStatus,'DETECTED');assert.equal(isProjectFixVerified(row),false);assert.deepEqual(row.securityFindingRemediation,history);
});

test('late dispatch HTTP failure cannot replace a completed or newer attempt',async()=>{
 const h=harness({},async(p,h)=>{await h.service.recordWf6BatchResult(callback(p));throw Error('late transport failure');});
 await assert.rejects(launch(h));const r=h.row().securityFindingRemediation;assert.equal(r.status,'TECHNICAL_FAILURE');assert.equal(r.attempts.length,1);assert.equal(r.reasonCode,'RUNTIME_OPERATION_TIMEOUT');
});
test('configured attempt limit can tighten the hard cap, never raise it',async()=>{
 const previous=process.env.SECURITY_REMEDIATION_MAX_ATTEMPTS;
 try{const {h}=await failed();process.env.SECURITY_REMEDIATION_MAX_ATTEMPTS='1';await assert.rejects(h.service.retrySecurityRemediation(taskId,{},user));process.env.SECURITY_REMEDIATION_MAX_ATTEMPTS='4';await assert.rejects(launch(harness()));}
 finally{if(previous===undefined)delete process.env.SECURITY_REMEDIATION_MAX_ATTEMPTS;else process.env.SECURITY_REMEDIATION_MAX_ATTEMPTS=previous;}
});
