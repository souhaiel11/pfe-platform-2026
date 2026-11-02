// Teste le composant « retry-e2e-harness » et ses cas d’erreur.
import { targetReservationTestQuery } from '../manual-remediation/target-reservation-test-query';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { reserveAttempt, completeAttempt, assertRetryAllowed } from '../manual-remediation/security-remediation-lifecycle';
import { advanceHarness, harnessEnabled, HarnessContext } from './retry-e2e-harness.logic';
import { RetryE2ETestPlan } from './retry-e2e-test-plan.entity';
import { RetryE2EHarnessService } from './retry-e2e-harness.service';
import { RetryE2EOperatorGuard } from './retry-e2e-harness.controller';
import { SecurityRemediationController } from './security-remediation.controller';
const projectId='3aa1c9b9-e114-40e4-884b-ebc7aa32e002', taskId='ff316278-ee17-4615-81fc-f93afeba2818';
const at='2026-10-05T10:00:00.000Z';
/** Prépare les données nécessaires à ce scénario. */
function fixture() {
 const task:any={id:taskId,projectId,status:'TODO',scannerStatus:'DETECTED',securityFindingRemediation:null};
 const a=reserveAttempt(task,'batch-1',at);
 const identity:HarnessContext={projectId,taskId,attemptId:a.attemptId!,attemptNumber:1,batchId:'batch-1'};
 const plan:RetryE2ETestPlan={enabled:true,projectId,taskId,expiresAt:'2026-10-05T10:20:00.000Z',
  attempt1Mode:'FORCE_VERIFIER_TIMEOUT_ONCE',attempt2Mode:'STOP_BEFORE_GIT_WRITE_ONCE',
  consumedAttempt1:false,consumedAttempt2:false,events:[]};
 return {task,plan,identity};
}
test('F1 exact modern identity produces timeout once; no candidate fields',()=>{
 const f=fixture();assert.equal(advanceHarness(f.plan,f.task,f.identity,'INITIAL',at),'TIMEOUT');assert.equal(f.plan.events.length,1);
 assert.equal(f.task.securityFindingRemediation.status,'DISPATCHING');
});
test('F2 different task/project remain normal',()=>{const f=fixture();for(const c of [{...f.identity,taskId:'other'},{...f.identity,projectId:'other'}])assert.equal(advanceHarness(f.plan,f.task,c,'INITIAL',at),'NORMAL');assert.equal(f.plan.events.length,0);});
test('F3 different bound attempt/batch do not consume hook',()=>{const f=fixture();advanceHarness(f.plan,f.task,f.identity,'INITIAL',at);for(const c of [{...f.identity,attemptId:'other'},{...f.identity,batchId:'other'}])assert.equal(advanceHarness(f.plan,f.task,c,'INITIAL',at),'NORMAL');assert.equal(f.plan.events.length,1);});
test('F4 duplicate evaluation replays timeout without firing twice or falling through',()=>{const f=fixture();for(let i=0;i<4;i++)assert.equal(advanceHarness(f.plan,f.task,f.identity,'INITIAL',at),i===0?'TIMEOUT':'TIMEOUT_REPLAY');assert.equal(f.plan.events.length,1);});
test('F5 expired plan refuses evaluation without injecting or releasing candidate',()=>{const f=fixture();assert.throws(()=>advanceHarness(f.plan,f.task,f.identity,'INITIAL','2026-10-06T10:00:00Z'),/expired/);assert.equal(f.plan.events.length,0);});
test('F6 disabled service is inert: no DB access',async()=>{const old=process.env.SECURITY_REMEDIATION_E2E_TEST_HARNESS_ENABLED;delete process.env.SECURITY_REMEDIATION_E2E_TEST_HARNESS_ENABLED;try{assert.equal(harnessEnabled(),false);const s=new RetryE2EHarnessService({
/** Exécute les opérations dans le cadre transactionnel prévu. */
transaction:()=>{throw Error('DB access');}} as any);assert.equal(await s.hook(fixture().identity,'INITIAL'),'NORMAL');await assert.rejects(()=>s.create(projectId,taskId,at));}finally{if(old===undefined)delete process.env.SECURITY_REMEDIATION_E2E_TEST_HARNESS_ENABLED;else process.env.SECURITY_REMEDIATION_E2E_TEST_HARNESS_ENABLED=old;}});
/** Traite le résultat reçu et actualise les données locales. */
function next() {
 const f=fixture();advanceHarness(f.plan,f.task,f.identity,'INITIAL',at);
 completeAttempt(f.task,f.identity,{status:'TECHNICAL_FAILURE',reasonCode:'VERIFIER_TIMEOUT'},at);
 const previous=structuredClone(f.task.securityFindingRemediation.attempts[0]);assertRetryAllowed(f.task,f.identity.attemptId);
 const a=reserveAttempt(f.task,'batch-2',at);const second={...f.identity,attemptId:a.attemptId!,attemptNumber:2,batchId:'batch-2'};
 return {...f,second,previous};
}
test('G1/offline retry: attempt 2 evaluates normally then stops; first history immutable; stale callback rejected',()=>{
 const f=next();assert.notEqual(f.identity.attemptId,f.second.attemptId);assert.notEqual(f.identity.batchId,f.second.batchId);
 assert.equal(advanceHarness(f.plan,f.task,f.second,'INITIAL',at),'NORMAL');
 assert.equal(advanceHarness(f.plan,f.task,f.second,'CANDIDATE_READY',at),'BARRIER');
 assert.equal(f.task.securityFindingRemediation.status,'OPERATOR_TEST_STOPPED');assert.equal(f.task.securityFindingRemediation.retryable,false);
 assert.equal(f.task.securityFindingRemediation.attemptCount,2);assert.deepEqual(f.task.securityFindingRemediation.attempts[0],f.previous);
 const before=structuredClone(f.task);assert.throws(()=>completeAttempt(f.task,f.identity,{status:'TECHNICAL_FAILURE',reasonCode:'VERIFIER_TIMEOUT'}),/obsolète/);assert.deepEqual(f.task,before);
 assert.equal(advanceHarness(f.plan,f.task,f.second,'CANDIDATE_READY',at),'BARRIER_REPLAY');assert.equal(f.plan.events.length,2);
});
test('G6 different task has no barrier',()=>{const f=next();assert.equal(advanceHarness(f.plan,f.task,{...f.second,taskId:'other'},'CANDIDATE_READY',at),'NORMAL');});
test('G7 attempt 1 never hits attempt 2 barrier',()=>{const f=fixture();assert.equal(advanceHarness(f.plan,f.task,f.identity,'CANDIDATE_READY',at),'NORMAL');});
test('enrolled attempt 2 remains fenced after expiry',()=>{const f=next();advanceHarness(f.plan,f.task,f.second,'INITIAL',at);assert.equal(advanceHarness(f.plan,f.task,f.second,'CANDIDATE_READY','2026-10-06T10:00:00Z'),'BARRIER');});
test('barrier cannot fire without prior normal-evaluation enrollment',()=>{const f=next();assert.throws(()=>advanceHarness(f.plan,f.task,f.second,'CANDIDATE_READY',at),/not enrolled/);});
test('operator guard disabled/unconfigured/wrong secret fail closed',()=>{const env=process.env.SECURITY_REMEDIATION_E2E_TEST_HARNESS_ENABLED,secret=process.env.SECURITY_REMEDIATION_E2E_OPERATOR_SECRET;
/** Prépare les données nécessaires à ce scénario. */
const context=(value:string)=>({
/** Prépare les données nécessaires à ce scénario. */
switchToHttp:()=>({
/** Simule la lecture des données demandées par le composant. */
getRequest:()=>({headers:{'x-e2e-operator-secret':value}})})}) as any;try{delete process.env.SECURITY_REMEDIATION_E2E_TEST_HARNESS_ENABLED;assert.throws(()=>new RetryE2EOperatorGuard().canActivate(context('x')));process.env.SECURITY_REMEDIATION_E2E_TEST_HARNESS_ENABLED='true';process.env.SECURITY_REMEDIATION_E2E_OPERATOR_SECRET='s'.repeat(32);assert.equal(new RetryE2EOperatorGuard().canActivate(context('x'.repeat(32))),false);assert.equal(new RetryE2EOperatorGuard().canActivate(context('s'.repeat(32))),true);}finally{for(const [k,v] of [['SECURITY_REMEDIATION_E2E_TEST_HARNESS_ENABLED',env],['SECURITY_REMEDIATION_E2E_OPERATOR_SECRET',secret]])if(v===undefined)delete process.env[k];else process.env[k]=v;}});
/** Prépare les données nécessaires à ce scénario. */
function controllerFixture(action: 'TIMEOUT'|'TIMEOUT_REPLAY'|'NORMAL'='NORMAL', barrier: boolean|'BARRIER_REPLAY'=false) {
 const calls:string[]=[];
 const resolver:any={
 /** Retrouve les données fiables correspondant à la demande. */
 resolve:async()=>{calls.push('resolve');return {ok:true,repository:'safe/repo',candidateBaseSha:'a'.repeat(40),cveId:'CVE-TEST',finding:{source:'TRIVY'},title:'test'};}};
 const manual:any={
 /** Vérifie WF6 cible Ownership dans ce scénario de test. */
 verifyWf6TargetOwnership:async()=>{},
 /** Vérifie WF6 tentative contexte dans ce scénario de test. */
 verifyWf6AttemptContext:async()=>calls.push('identity')};
 const worker:any={
 /** Prépare les données nécessaires à ce scénario. */
 evaluateSecurityRemediationBatch:async()=>{calls.push('worker');return {status:'CANDIDATE_READY',candidateIdentity:'b'.repeat(64),decisions:[]};}};
 const harness:any={
 /** Vérifie Initial périmètre dans ce scénario de test. */
 assertInitialScope:async()=>{},
 /** Prépare les données nécessaires à ce scénario. */
 hook:async(_c:any,phase:string)=>{calls.push(phase);return phase==='INITIAL'?action:barrier?(barrier==='BARRIER_REPLAY'?'BARRIER_REPLAY':'BARRIER'):'NORMAL';}};
 const body={projectId,findingTaskIds:[taskId],batchId:'batch-1',attempts:[{findingTaskId:taskId,attemptId:'a',attemptNumber:1}]};
 return {controller:new SecurityRemediationController(resolver,worker,manual,harness),body,calls};
}
test('controller timeout occurs after resolution/correlation and before worker',async()=>{const f=controllerFixture('TIMEOUT');const r=await f.controller.evaluateBatch(f.body);assert.equal(r.status,'TECHNICAL_FAILURE');assert.equal((r as any).failureClass,'VERIFIER_TIMEOUT');assert.ok(!f.calls.includes('worker'));assert.ok(f.calls.indexOf('resolve')<f.calls.indexOf('INITIAL'));assert.equal((r as any).branchName,null);});
test('controller barrier requires successful worker result, strips writable candidate',async()=>{const f=controllerFixture('NORMAL',true);const r=await f.controller.evaluateBatch(f.body);assert.equal(r.status,'OPERATOR_TEST_STOPPED');assert.equal((r as any).operatorTestBarrier,true);assert.equal((r as any).candidateIdentity,undefined);assert.ok(f.calls.indexOf('worker')<f.calls.indexOf('CANDIDATE_READY'));});
test('F7 revalidation never invokes fault or barrier hooks',async()=>{const f=controllerFixture('TIMEOUT',true);await f.controller.revalidateBatch({...f.body,expectedCandidateIdentity:'b'.repeat(64)} as any);assert.ok(f.calls.includes('worker'));assert.ok(!f.calls.includes('INITIAL'));assert.ok(!f.calls.includes('CANDIDATE_READY'));});
/** Vérifie les résultats attendus dans ce scénario. */
function storageFixture() {
 const f=fixture();const entry:any={id:'plan-id',projectId,taskId,state:'ACTIVE',plan:f.plan};let row:any=f.task,record:any=entry,tail=Promise.resolve();
 const db:any={
 /** Exécute les opérations dans le cadre transactionnel prévu. */
 transaction:async(fn:any)=>{const prev=tail;let release:any;tail=new Promise<void>(r=>release=r);await prev;
  const before={row:structuredClone(row),record:structuredClone(record)};
  const planRepo={
  /** Recherche l’élément correspondant à l’identifiant. */
  findOne:async({where,lock}:any)=>{assert.equal(lock.mode,'pessimistic_write');return record.projectId===where.projectId && record.taskId===where.taskId?structuredClone(record):null;},
  /** Enregistre les données fournies. */
  save:async(e:any)=>record=structuredClone(e)};
  const taskRepo={
  /** Recherche l’élément correspondant à l’identifiant. */
  findOne:async({lock}:any)=>{assert.equal(lock.mode,'pessimistic_write');return structuredClone(row);},
  /** Enregistre les données fournies. */
  save:async(t:any)=>row=structuredClone(t)};
  try{return await fn({query: targetReservationTestQuery(), 
  /** Simule la lecture des données demandées par le composant. */
  getRepository:(entity:any)=>entity.name==='RetryE2ETestPlanEntity'?planRepo:taskRepo});}catch(e){row=before.row;record=before.record;throw e;}finally{release();}}};
 return {db,service:new RetryE2EHarnessService(db),identity:f.identity,
 /** Récupère les données demandées. */
 get:()=>({row,record}),
 /** Simule la modification demandée par le composant. */
 setTask:(t:any)=>row=t};
}
test('shared transactional consumption: concurrent duplicates fire once and all replay safe timeout',async()=>{const old=process.env.SECURITY_REMEDIATION_E2E_TEST_HARNESS_ENABLED;process.env.SECURITY_REMEDIATION_E2E_TEST_HARNESS_ENABLED='true';try{const f=storageFixture();f.get().record.plan.expiresAt=new Date(Date.now()+60_000).toISOString();const results=await Promise.all(Array.from({length:8},()=>f.service.hook(f.identity,'INITIAL')));assert.equal(results.filter(r=>r==='TIMEOUT').length,1);assert.equal(results.filter(r=>r==='TIMEOUT_REPLAY').length,7);assert.equal(f.get().record.plan.events.length,1);}finally{if(old===undefined)delete process.env.SECURITY_REMEDIATION_E2E_TEST_HARNESS_ENABLED;else process.env.SECURITY_REMEDIATION_E2E_TEST_HARNESS_ENABLED=old;}});
test('invalid identity transaction cannot consume or alter plan/task',async()=>{const old=process.env.SECURITY_REMEDIATION_E2E_TEST_HARNESS_ENABLED;process.env.SECURITY_REMEDIATION_E2E_TEST_HARNESS_ENABLED='true';try{const f=storageFixture();const before=structuredClone(f.get());await assert.rejects(()=>f.service.hook({...f.identity,attemptId:'wrong'},'INITIAL'));assert.deepEqual(f.get(),before);}finally{if(old===undefined)delete process.env.SECURITY_REMEDIATION_E2E_TEST_HARNESS_ENABLED;else process.env.SECURITY_REMEDIATION_E2E_TEST_HARNESS_ENABLED=old;}});
test('different service-level task does not fire or save a hook',async()=>{const old=process.env.SECURITY_REMEDIATION_E2E_TEST_HARNESS_ENABLED;process.env.SECURITY_REMEDIATION_E2E_TEST_HARNESS_ENABLED='true';try{const f=storageFixture();const before=structuredClone(f.get());assert.equal(await f.service.hook({...f.identity,taskId:'other'},'INITIAL'),'NORMAL');assert.deepEqual(f.get(),before);}finally{if(old===undefined)delete process.env.SECURITY_REMEDIATION_E2E_TEST_HARNESS_ENABLED;else process.env.SECURITY_REMEDIATION_E2E_TEST_HARNESS_ENABLED=old;}});
test('disabled controller/service output equals original path',async()=>{const f=controllerFixture();const without=new SecurityRemediationController((f.controller as any).resolver,(f.controller as any).candidateVerification,(f.controller as any).manualRemediation);assert.deepEqual(await f.controller.evaluateBatch(f.body),await without.evaluateBatch(f.body));});
test('concurrent successful attempt-2 evaluations ALL stop, even after plan completed',async()=>{const old=process.env.SECURITY_REMEDIATION_E2E_TEST_HARNESS_ENABLED;process.env.SECURITY_REMEDIATION_E2E_TEST_HARNESS_ENABLED='true';try{const f=storageFixture(), second=next();f.get().record.plan=second.plan;f.get().record.plan.expiresAt=new Date(Date.now()+60_000).toISOString();f.setTask(second.task);assert.equal(await f.service.hook(second.second,'INITIAL'),'NORMAL');const outcomes=await Promise.all(Array.from({length:8},()=>f.service.hook(second.second,'CANDIDATE_READY')));assert.equal(outcomes.filter(x=>x==='BARRIER').length,1);assert.equal(outcomes.filter(x=>x==='BARRIER_REPLAY').length,7);assert.equal(f.get().record.plan.events.length,2);assert.equal(f.get().row.securityFindingRemediation.attemptCount,2);}finally{if(old===undefined)delete process.env.SECURITY_REMEDIATION_E2E_TEST_HARNESS_ENABLED;else process.env.SECURITY_REMEDIATION_E2E_TEST_HARNESS_ENABLED=old;}});
test('revoked completed plan still replays the terminal barrier for a delayed successful response',async()=>{const old=process.env.SECURITY_REMEDIATION_E2E_TEST_HARNESS_ENABLED;process.env.SECURITY_REMEDIATION_E2E_TEST_HARNESS_ENABLED='true';try{const f=storageFixture(), second=next();f.get().record.plan=second.plan;f.get().record.plan.expiresAt=new Date(Date.now()+60_000).toISOString();f.setTask(second.task);await f.service.hook(second.second,'INITIAL');await f.service.hook(second.second,'CANDIDATE_READY');f.get().record.state='REVOKED';assert.equal(await f.service.hook(second.second,'CANDIDATE_READY'),'BARRIER_REPLAY');assert.equal(f.get().record.state,'REVOKED');}finally{if(old===undefined)delete process.env.SECURITY_REMEDIATION_E2E_TEST_HARNESS_ENABLED;else process.env.SECURITY_REMEDIATION_E2E_TEST_HARNESS_ENABLED=old;}});
test('attempt 3 cannot escape an active test fence',()=>{const f=next();completeAttempt(f.task,f.second,{status:'TECHNICAL_FAILURE',reasonCode:'VERIFIER_TIMEOUT'},at);const a=reserveAttempt(f.task,'batch-3',at);assert.throws(()=>advanceHarness(f.plan,f.task,{...f.identity,attemptId:a.attemptId!,attemptNumber:3,batchId:'batch-3'},'INITIAL',at),/two attempts/);});
test('operator activation rejects non-qualified finding and excessive TTL',async()=>{const env=process.env.SECURITY_REMEDIATION_E2E_TEST_HARNESS_ENABLED,project=process.env.SECURITY_REMEDIATION_E2E_TEST_PROJECT_ID;process.env.SECURITY_REMEDIATION_E2E_TEST_HARNESS_ENABLED='true';process.env.SECURITY_REMEDIATION_E2E_TEST_PROJECT_ID=projectId;try{const db:any={
/** Exécute les opérations dans le cadre transactionnel prévu. */
transaction:async(fn:any)=>fn({
/** Renvoie les termes de recherche courants. */
query:async()=>[],
/** Simule la lecture des données demandées par le composant. */
getRepository:(e:any)=>e.name==='RetryE2ETestPlanEntity'?{
/** Recherche l’élément correspondant à l’identifiant. */
findOne:async()=>null}:{
/** Recherche l’élément correspondant à l’identifiant. */
findOne:async()=>({id:taskId,projectId,status:'TODO',scannerStatus:'DETECTED',remediationType:'DEVELOPER_ACTION_REQUIRED'})}})};const s=new RetryE2EHarnessService(db);await assert.rejects(()=>s.create(projectId,taskId,new Date(Date.now()+60000).toISOString()),/not qualified/);await assert.rejects(()=>s.create(projectId,taskId,new Date(Date.now()+31*60000).toISOString()),/30 minutes/);}finally{for(const [k,v] of [['SECURITY_REMEDIATION_E2E_TEST_HARNESS_ENABLED',env],['SECURITY_REMEDIATION_E2E_TEST_PROJECT_ID',project]])if(v===undefined)delete process.env[k];else process.env[k]=v;}});
test('attempt 2 normal evaluation failure closes as an explicit test abort, never a fake success or another retry',()=>{const f=next();advanceHarness(f.plan,f.task,f.second,'INITIAL',at);assert.equal(advanceHarness(f.plan,f.task,f.second,'EVALUATION_ABORTED',at),'BARRIER');assert.equal(f.task.securityFindingRemediation.status,'OPERATOR_TEST_STOPPED');assert.equal(f.task.securityFindingRemediation.operatorTest.candidateEvaluationPassed,false);assert.equal(f.task.securityFindingRemediation.retryable,false);assert.equal(f.plan.events[1].hook,'CONTROLLED_TEST_ABORT');});
import { ManualRemediationService } from '../manual-remediation/manual-remediation.service';
test('mixed operator-test batch rejected at common dispatch entry BEFORE attempt reservation',async()=>{let reserved=false;const repo:any={manager:{
/** Exécute les opérations dans le cadre transactionnel prévu. */
transaction:()=>{reserved=true;throw Error('must not reserve');}}};const guard:any={
/** Vérifie Initial périmètre dans ce scénario de test. */
assertInitialScope:async()=>{throw Error('one modern finding only');}};const service=new ManualRemediationService(repo,{} as any,undefined,undefined,undefined,guard);await assert.rejects(()=>service.launchBatchRemediation(projectId,[taskId,'other-task'],{role:'developer'}),/one modern finding only/);assert.equal(reserved,false);});
test('stale callback fixture traverses REAL callback service and rejects before any save',async()=>{const f=next();advanceHarness(f.plan,f.task,f.second,'INITIAL',at);advanceHarness(f.plan,f.task,f.second,'CANDIDATE_READY',at);f.task.ruleOrCve='CVE-TEST';const before=structuredClone(f.task);let saves=0;const tx:any={
/** Vérifie les résultats attendus dans ce scénario. */
getRepository:()=>({
/** Recherche l’élément correspondant à l’identifiant. */
findOne:async({lock}:any)=>{assert.equal(lock.mode,'pessimistic_write');return structuredClone(f.task);},
/** Enregistre les données fournies. */
save:async()=>{saves++;}})};const service=new ManualRemediationService({} as any,{} as any);await assert.rejects(()=>service.recordWf6BatchResult({projectId,batchId:f.identity.batchId,status:'TECHNICAL_FAILURE',reason:'VERIFIER_TIMEOUT',reasonCode:'VERIFIER_TIMEOUT',findings:[{findingTaskId:taskId,cveId:'CVE-TEST',attemptId:f.identity.attemptId,attemptNumber:1,status:'TECHNICAL_FAILURE',reason:'VERIFIER_TIMEOUT',reasonCode:'VERIFIER_TIMEOUT'}]},tx),/obsolète/);assert.equal(saves,0);assert.deepEqual(f.task,before);});
import { V1_8CompatibilityDecisionService } from '../dependency-compatibility/v1_8-compatibility-decision.service';
/** Prépare les données nécessaires à ce scénario. */
function activationFixture(shared=false) {
 let saved:any=null;const sql:string[]=[];
 const task:any={id:taskId,projectId,incidentId:'incident',source:'TRIVY',ruleOrCve:'CVE-TEST',status:'TODO',scannerStatus:'DETECTED',remediationType:'DEVELOPER_ACTION_REQUIRED',securityFindingRemediation:null,securityRemediationBatchId:null,findingSnapshot:{component:'g:a',currentVersion:'1.0.0',fixedVersion:'1.0.1'}};
 const plans:any={
 /** Recherche l’élément correspondant à l’identifiant. */
 findOne:async()=>null,
 /** Crée et enregistre un nouvel élément. */
 create:(x:any)=>x,
 /** Enregistre les données fournies. */
 save:async(x:any)=>saved=structuredClone(x)};
 const db:any={
 /** Exécute les opérations dans le cadre transactionnel prévu. */
 transaction:async(fn:any)=>fn({
 /** Renvoie les termes de recherche courants. */
 query:async(q:string)=>{sql.push(q);return q.includes('SELECT id')&&shared?[{id:'other'}]:[];},
 /** Simule la lecture des données demandées par le composant. */
 getRepository:(e:any)=>e.name==='RetryE2ETestPlanEntity'?plans:e.name==='ManualRemediationTask'?{
 /** Recherche l’élément correspondant à l’identifiant. */
 findOne:async()=>task}:e.name==='Project'?{
 /** Recherche l’élément correspondant à l’identifiant. */
 findOne:async()=>({id:projectId,githubRepo:'safe/repo'})}:{
 /** Recherche l’élément correspondant à l’identifiant. */
 findOne:async()=>({projectId,metadata:{sourceCommitSha:'a'.repeat(40)}})}})};
 return {service:new RetryE2EHarnessService(db),
 /** Récupère les données demandées. */
 get:()=>saved,sql};
}
/** Prépare les données nécessaires à ce scénario. */
async function withActivationEnvironment(fn:()=>Promise<void>) {const enabled=process.env.SECURITY_REMEDIATION_E2E_TEST_HARNESS_ENABLED,project=process.env.SECURITY_REMEDIATION_E2E_TEST_PROJECT_ID;process.env.SECURITY_REMEDIATION_E2E_TEST_HARNESS_ENABLED='true';process.env.SECURITY_REMEDIATION_E2E_TEST_PROJECT_ID=projectId;try{await fn();}finally{for(const [k,v] of [['SECURITY_REMEDIATION_E2E_TEST_HARNESS_ENABLED',enabled],['SECURITY_REMEDIATION_E2E_TEST_PROJECT_ID',project]])if(v===undefined)delete process.env[k];else process.env[k]=v;}}
test('activation allows validated co-target fixture; target reservation fences sibling dispatch',()=>withActivationEnvironment(async()=>{
 const original=V1_8CompatibilityDecisionService.prototype.lookup;
 /** Recherche la décision correspondant au contexte demandé. */
 V1_8CompatibilityDecisionService.prototype.lookup=()=>({repository:'safe/repo',validatedCommitSha:'a'.repeat(40),findingSource:'TRIVY',cve:'CVE-TEST',component:'g:a',installedVersion:'1.0.0',state:'VALIDATED_RECOMMENDED',sandboxValidated:true,targetCveClosed:true,newHighCriticalCount:0,recommendedVersion:'1.0.1',actualEditTarget:'g:a',editType:'DEPENDENCY_VERSION',requiresDeveloperReview:false} as any);
 try { const f=activationFixture(true); const result=await f.service.create(projectId,taskId,new Date(Date.now()+60000).toISOString()); assert.equal(result.taskId,taskId); assert.ok(!f.sql.some(q=>q.includes('SELECT id'))); }
 finally { V1_8CompatibilityDecisionService.prototype.lookup=original; }
}));
test('scanner eligibility label cannot replace server V1.8 proof',()=>withActivationEnvironment(async()=>{const f=activationFixture();await assert.rejects(()=>f.service.create(projectId,taskId,new Date(Date.now()+60000).toISOString()),/server-validated/);assert.equal(f.get(),null);}));
test('offline qualified fixture creates fixed modes only under shared admission lock',()=>withActivationEnvironment(async()=>{const original=V1_8CompatibilityDecisionService.prototype.lookup;
/** Recherche la décision correspondant au contexte demandé. */
V1_8CompatibilityDecisionService.prototype.lookup=()=>({repository:'safe/repo',validatedCommitSha:'a'.repeat(40),findingSource:'TRIVY',cve:'CVE-TEST',component:'g:a',installedVersion:'1.0.0',state:'VALIDATED_RECOMMENDED',sandboxValidated:true,targetCveClosed:true,newHighCriticalCount:0,recommendedVersion:'1.0.1',actualEditTarget:'g:a',editType:'DEPENDENCY_VERSION',requiresDeveloperReview:false} as any);try{const f=activationFixture();const result=await f.service.create(projectId,taskId,new Date(Date.now()+60000).toISOString());assert.equal(result.plan.attempt1Mode,'FORCE_VERIFIER_TIMEOUT_ONCE');assert.equal(result.plan.attempt2Mode,'STOP_BEFORE_GIT_WRITE_ONCE');assert.equal(result.plan.consumedAttempt1,false);assert.match(f.sql[0],/pg_advisory_xact_lock/);assert.equal(f.get().taskId,taskId);}finally{V1_8CompatibilityDecisionService.prototype.lookup=original;}}));

test('controller replays safe timeout/terminal envelopes without releasing a writable candidate',async()=>{const timeout=controllerFixture('TIMEOUT_REPLAY');const t=await timeout.controller.evaluateBatch(timeout.body);assert.equal(t.status,'TECHNICAL_FAILURE');assert.equal((t as any).failureClass,'VERIFIER_TIMEOUT');assert.ok(!timeout.calls.includes('worker'));const barrier=controllerFixture('NORMAL','BARRIER_REPLAY');const b=await barrier.controller.evaluateBatch(barrier.body);assert.equal(b.status,'OPERATOR_TEST_STOPPED');assert.equal((b as any).operatorTestBarrier,true);assert.ok(barrier.calls.includes('worker'));for(const k of ['prUrl','branchName','candidateIdentity','patchedPom'])assert.equal((b as any)[k],undefined);});
