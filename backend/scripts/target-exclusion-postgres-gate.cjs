// Teste avec PostgreSQL qu'une cible ne peut pas être réservée simultanément par deux corrections incompatibles.
require('reflect-metadata');
require('ts-node').register({transpileOnly:true,project:require('path').resolve(__dirname,'../tsconfig.json')});
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {fork}=require('node:child_process');
const {randomUUID}=require('node:crypto');
const {DataSource,EntitySchema}=require('typeorm');
const {ManualRemediationService}=require('../src/manual-remediation/manual-remediation.service');
const {ManualRemediationTask}=require('../src/manual-remediation/manual-remediation.entity');
const {Project}=require('../src/projects/project.entity');
const {RetryE2EHarnessService}=require('../src/security-remediation/retry-e2e-harness.service');
const {RetryE2ETestPlanEntity}=require('../src/security-remediation/retry-e2e-test-plan.entity');
const {canonicalTarget,productionTarget,reserveTarget}=require('../src/manual-remediation/remediation-target-reservation');
const database='phase4g_target_exclusion';
if(process.env.TARGET_EXCLUSION_DISPOSABLE_DATABASE!==database)throw Error('Disposable marker required');
// Minimal real PostgreSQL task schema for actual production service calls.
const taskSchema=new EntitySchema({name:'ManualRemediationTask',target:ManualRemediationTask,tableName:'manual_remediation_tasks',columns:{id:{type:'uuid',primary:true},projectId:{type:'uuid'},source:{type:'varchar'},ruleOrCve:{type:'varchar'},findingSnapshot:{type:'jsonb'},remediationType:{type:'varchar'},status:{type:'varchar'},scannerStatus:{type:'varchar'},securityRemediationBatchId:{type:'varchar',nullable:true},securityFindingRemediation:{type:'jsonb',nullable:true}}});
const projectSchema=new EntitySchema({name:'Project',target:Project,tableName:'projects',columns:{id:{type:'uuid',primary:true}}});
/** Prépare la source de données utilisée par le scénario. */
function source(){return new DataSource({type:'postgres',host:'127.0.0.1',port:5432,username:'postgres',database,synchronize:false,entities:[taskSchema,projectSchema,RetryE2ETestPlanEntity],extra:{max:2},logging:false});}
/** Prépare le service utilisé dans le scénario. */
function service(db,dispatches=[]){return new ManualRemediationService(db.getRepository(ManualRemediationTask),{}, {
/** Transmet la demande au service chargé de l’exécuter. */
dispatch:async p=>dispatches.push(p)});}
/** Exécute le traitement dans un processus séparé. */
async function worker(){const db=await source().initialize();process.send({ready:true,pid:process.pid,pgPid:(await db.query('select pg_backend_pid() as pid'))[0].pid});process.once('message',async m=>{const dispatched=[];try{const result=m.file?await db.transaction(tx=>reserveTarget(tx,canonicalTarget(m.projectId,m.file,m.component),[m.taskId])):m.abandon?await service(db,dispatched).abandonTarget(m.taskId,m.attemptId,{role:'admin',id:'operator'}):m.retry?await service(db,dispatched).retrySecurityRemediation(m.taskId,{}, {role:'developer'}):await service(db,dispatched).launchBatchRemediation(m.projectId,[m.taskId],{role:'developer'});process.send({ok:true,result,dispatches:dispatched.length});}catch(e){process.send({ok:false,error:e.getResponse?.()||e.message,dispatches:dispatched.length});}finally{await db.destroy();process.exit(0);}});}
/** Prépare deux opérations pour tester leur concurrence. */
async function pair(messages){const children=messages.map(()=>fork(__filename,['worker'],{stdio:['ignore','ignore','pipe','ipc']}));const ready=await Promise.all(children.map(c=>new Promise((r,j)=>{c.once('message',r);c.once('error',j);c.once('exit',code=>{if(code)j(Error('worker startup failure'));});c.stderr.on('data',d=>process.stderr.write(d));})));assert.notEqual(ready[0].pid,ready[1].pid);assert.notEqual(ready[0].pgPid,ready[1].pgPid);const results=await Promise.all(children.map((c,i)=>new Promise((r,j)=>{c.once('message',r);c.once('error',j);c.send(messages[i]);})));await Promise.all(children.map(c=>c.exitCode===null?new Promise(r=>c.once('exit',r)):Promise.resolve()));return {ready,results};}
/** Exécute les étapes principales de ce programme. */
async function main(){const db=await source().initialize();const report={database,network:'none',productionAccess:false,checks:{}};let dispatches=[];
const tasks=db.getRepository(ManualRemediationTask),projects=db.getRepository(Project);const svc=service(db,dispatches);
/** Exécute la requête SQL du contrôle. */
const sql=n=>fs.readFileSync(path.resolve(__dirname,'../migrations/'+n),'utf8');
try{
assert.equal((await db.query("select tablename from pg_tables where schemaname='public'")).length,0);
await db.query('CREATE TABLE projects (id uuid PRIMARY KEY)');
await db.query('CREATE TABLE manual_remediation_tasks (id uuid PRIMARY KEY,"projectId" uuid NOT NULL,source varchar NOT NULL,"ruleOrCve" varchar NOT NULL,"findingSnapshot" jsonb NOT NULL,"remediationType" varchar NOT NULL,status varchar NOT NULL,"scannerStatus" varchar NOT NULL,"securityRemediationBatchId" varchar,"securityFindingRemediation" jsonb)');
await db.query(sql('20261006_add_remediation_target_reservations.sql'));report.checks.migrationUp=true;
await db.query(sql('20261005_add_retry_e2e_test_plans.sql'));
/** Prépare les données initiales prévues par ce service. */
const seed=async(component='com.h2database:h2',extra={})=>{const projectId=extra.projectId||randomUUID();await projects.save({id:projectId});const row={id:randomUUID(),projectId,source:'TRIVY',ruleOrCve:'CVE-2022-45868',findingSnapshot:{component,currentVersion:'2.1.214',fixedVersion:'2.2.220'},remediationType:'DEVELOPER_ACTION_REQUIRED',status:'TODO',scannerStatus:'DETECTED',securityFindingRemediation:null,...extra};await tasks.save(row);return row;};
/** Lance l’opération du scénario. */
const launch=t=>svc.launchBatchRemediation(t.projectId,[t.id],{role:'developer'});
/** Traite le retour de l’opération du scénario. */
const callback=(t,p,status='TECHNICAL_FAILURE',reasonCode='VERIFIER_TIMEOUT',extra={})=>svc.recordWf6BatchResult({projectId:t.projectId,batchId:p.batchId,status,reason:reasonCode,reasonCode,...extra,findings:[{findingTaskId:t.id,cveId:t.ruleOrCve,...p.attempts[0],status,reason:reasonCode,reasonCode}]});
/** Construit une décision bloquée avec sa raison. */
const blocked=async t=>{const before=await tasks.findOneByOrFail({id:t.id});const d=dispatches.length;await assert.rejects(()=>launch(t),e=>e.getResponse().code==='REMEDIATION_TARGET_ALREADY_IN_PROGRESS'&&e.getResponse().status==='TARGET_BUSY');assert.deepEqual(await tasks.findOneByOrFail({id:t.id}),before);assert.equal(dispatches.length,d);assert.equal(before.securityFindingRemediation,null);assert.equal(before.securityRemediationBatchId,null);};
// T1/T2/T3 two independent production service processes, one writer admission.
const t1=await seed(),t2=await seed(undefined,{projectId:t1.projectId,source:'OWASP'});
const race=await pair([t1,t2].map(t=>({projectId:t.projectId,taskId:t.id})));assert.equal(race.results.filter(r=>r.ok).length,1);const loserIndex=race.results.findIndex(r=>!r.ok),loser=[t1,t2][loserIndex];assert.equal(race.results[loserIndex].dispatches,0);assert.equal(race.results[loserIndex].error.code,'REMEDIATION_TARGET_ALREADY_IN_PROGRESS');assert.equal((await tasks.findOneByOrFail({id:loser.id})).securityFindingRemediation,null);assert.equal((await tasks.findOneByOrFail({id:loser.id})).securityRemediationBatchId,null);assert.equal((await db.query("SELECT count(*)::int AS n FROM remediation_target_reservations WHERE state='ACTIVE'"))[0].n,1);report.race=race;report.checks.T1_singleWinner=report.checks.T2_noLoserAttempt=report.checks.T3_unchangedCount=true;
// T4/T5 + exact H2 harness qualification with deterministic A ownership.
const a=await seed(),b=await seed(undefined,{projectId:a.projectId,source:'OWASP'});
process.env.SECURITY_REMEDIATION_E2E_TEST_HARNESS_ENABLED='true';
const harness=new RetryE2EHarnessService(db);const planId=randomUUID();
await db.getRepository(RetryE2ETestPlanEntity).save({id:planId,projectId:a.projectId,taskId:a.id,state:'ACTIVE',plan:{enabled:true,projectId:a.projectId,taskId:a.id,expiresAt:new Date(Date.now()+600000).toISOString(),attempt1Mode:'FORCE_VERIFIER_TIMEOUT_ONCE',attempt2Mode:'STOP_BEFORE_GIT_WRITE_ONCE',consumedAttempt1:false,consumedAttempt2:false,events:[]}});
const p1=await launch(a);await svc.verifyWf6TargetOwnership(a.projectId,[a.id],true);await assert.rejects(()=>svc.verifyWf6TargetOwnership(b.projectId,[b.id],true));await assert.rejects(()=>svc.verifyWf6TargetOwnership(a.projectId,[a.id],false));report.checks.legacyBypassBlocked=true;await blocked(b);let reservation=(await db.query('SELECT * FROM remediation_target_reservations WHERE "projectId"=$1 AND state=\'ACTIVE\'',[a.projectId]))[0];const reservationId=reservation.id;
/** Prépare le contexte du scénario. */
const ctx=p=>({projectId:a.projectId,taskId:a.id,batchId:p.batchId,attemptId:p.attempts[0].attemptId,attemptNumber:p.attempts[0].attemptNumber});
assert.equal(await harness.hook(ctx(p1),'INITIAL'),'TIMEOUT');await callback(a,p1);await blocked(b);const first=structuredClone((await tasks.findOneByOrFail({id:a.id})).securityFindingRemediation.attempts[0]);
const p2=await svc.retrySecurityRemediation(a.id,{expectedAttemptId:p1.attempts[0].attemptId},{role:'developer'});assert.notEqual(p1.batchId,p2.batchId);assert.notEqual(p1.attempts[0].attemptId,p2.attempts[0].attemptId);await blocked(b);reservation=(await db.query('SELECT * FROM remediation_target_reservations WHERE id=$1',[reservationId]))[0];assert.equal(reservation.state,'ACTIVE');assert.equal(reservation.claims[a.id].attemptId,p2.attempts[0].attemptId);assert.equal(await harness.hook(ctx(p2),'INITIAL'),'NORMAL');await blocked(b);assert.equal(await harness.hook(ctx(p2),'CANDIDATE_READY'),'BARRIER');const stopped=await tasks.findOneByOrFail({id:a.id});assert.equal(stopped.securityFindingRemediation.status,'OPERATOR_TEST_STOPPED');assert.deepEqual(stopped.securityFindingRemediation.attempts[0],first);assert.equal((await db.query('SELECT state FROM remediation_target_reservations WHERE id=$1',[reservationId]))[0].state,'RELEASED');await launch(b);assert.equal(await harness.hook(ctx(p2),'CANDIDATE_READY'),'BARRIER_REPLAY');report.checks.T4_retryOwner=report.checks.T5_siblingRetryWindow=report.checks.T7_operatorStopRelease=report.checks.H2_singleWriter=true;
// Already-supported batches retain co-claims, but may never fork into two retry writers.
const ba=await seed('g:a'),bb=await seed('g:b',{projectId:ba.projectId});
const pb=await svc.launchBatchRemediation(ba.projectId,[ba.id,bb.id],{role:'developer'});
await svc.recordWf6BatchResult({projectId:ba.projectId,batchId:pb.batchId,status:'TECHNICAL_FAILURE',reason:'VERIFIER_TIMEOUT',reasonCode:'VERIFIER_TIMEOUT',findings:pb.attempts.map((a,i)=>({...a,cveId:[ba,bb][i].ruleOrCve,status:'TECHNICAL_FAILURE',reason:'VERIFIER_TIMEOUT',reasonCode:'VERIFIER_TIMEOUT'}))});
const batchRace=await pair([ba,bb].map(t=>({taskId:t.id,projectId:t.projectId,retry:true})));
assert.equal(batchRace.results.filter(r=>r.ok).length,1);
const batchLoser=[ba,bb][batchRace.results.findIndex(r=>!r.ok)];
assert.equal((await tasks.findOneByOrFail({id:batchLoser.id})).securityFindingRemediation.attemptCount,1);
report.batchRetryRace=batchRace;
report.checks.batchRetrySingleWriter=true;
// T6 terminal without side effects releases; effects/uncertain results retain.
const final=await seed(),sibling=await seed(undefined,{projectId:final.projectId});const pf=await launch(final);await callback(final,pf,'TECHNICAL_FAILURE','APPLICATION_TESTS_FAILED');await launch(sibling);report.checks.T6_nonretryableRelease=true;
const effect=await seed(),es=await seed(undefined,{projectId:effect.projectId});const pe=await launch(effect);await callback(effect,pe,'TECHNICAL_FAILURE','WRITE_CONFLICT',{unresolvedGitSideEffect:true});await blocked(es);await assert.rejects(()=>svc.abandonTarget(effect.id,pe.attempts[0].attemptId,{role:'admin',id:'operator'}));report.checks.uncertainGitRetains=true;
const candidate=await seed(),cs=await seed(undefined,{projectId:candidate.projectId});const pc=await launch(candidate);await callback(candidate,pc,'PR_CREATED','PR_CREATED',{branchName:'synthetic-only',prUrl:'https://example.invalid/pr/1'});await blocked(cs);await assert.rejects(()=>svc.abandonTarget(candidate.id,pc.attempts[0].attemptId,{role:'admin'}));report.checks.candidateRetains=true;
let verified=await tasks.findOneByOrFail({id:candidate.id});verified.status='VERIFIED';verified.scannerStatus='NOT_DETECTED';await tasks.save(verified);
const finalized=await svc.abandonTarget(candidate.id,pc.attempts[0].attemptId,{role:'admin',id:'operator'});assert.equal(finalized.status,'TARGET_FINALIZED');assert.equal((await tasks.findOneByOrFail({id:candidate.id})).securityFindingRemediation.status,'CANDIDATE_READY');await launch(cs);report.checks.projectVerifiedFinalization=true;
const unknown=await seed(),us=await seed(undefined,{projectId:unknown.projectId});const pu=await launch(unknown);await callback(unknown,pu,'TECHNICAL_FAILURE','UNKNOWN_FAILURE');await blocked(us);await assert.rejects(()=>svc.abandonTarget(unknown.id,pu.attempts[0].attemptId,{role:'admin'}));report.checks.unknownOutcomeRetains=true;
// Explicit supported abandonment closes Retry and releases exclusively under task lock.
const abandoned=await seed(),abs=await seed(undefined,{projectId:abandoned.projectId});const pa=await launch(abandoned);await callback(abandoned,pa);await assert.rejects(()=>svc.abandonTarget(abandoned.id,pa.attempts[0].attemptId,{role:'developer'}));await svc.abandonTarget(abandoned.id,pa.attempts[0].attemptId,{role:'admin',id:'operator'});await assert.rejects(()=>svc.retrySecurityRemediation(abandoned.id,{}, {role:'developer'}));await launch(abs);report.checks.manualAbandon=true;
const ar=await seed();const par=await launch(ar);await callback(ar,par);
const abandonRace=await pair([{taskId:ar.id,projectId:ar.projectId,retry:true},{taskId:ar.id,projectId:ar.projectId,abandon:true,attemptId:par.attempts[0].attemptId}]);assert.equal(abandonRace.results.filter(r=>r.ok).length,1);report.abandonRetryRace=abandonRace;report.checks.abandonRetryAtomic=true;
// T8 safe FILE units can reserve concurrently in same project. Production dispatcher currently roots all at pom.xml.
const projectId=randomUUID();const safe=await pair([{projectId,taskId:randomUUID(),file:'module-a/pom.xml',component:'g:a'},{projectId,taskId:randomUUID(),file:'module-b/pom.xml',component:'g:b'}]);assert.ok(safe.results.every(r=>r.ok));report.differentFiles=safe;report.checks.T8_differentSafeTargets=true;
// T10 different dependency coordinates on SAME file conflict, even conflicting candidates.
const d1=await seed('g:a'),d2=await seed('g:b',{projectId:d1.projectId,findingSnapshot:{component:'g:b',currentVersion:'1',fixedVersion:'999'}});await launch(d1);await blocked(d2);assert.equal(productionTarget(d1).targetKey,productionTarget(d2).targetKey);report.checks.T10_fileGranularity=true;
// T9 crash/lost callback: stale detection and existing reconciliation quarantine, never expiration release.
const stale=await seed(),ss=await seed(undefined,{projectId:stale.projectId});const ps=await launch(stale);await db.query(`UPDATE remediation_target_reservations SET "updatedAt"=now()-interval '2 hours' WHERE "projectId"=$1`,[stale.projectId]);let st=await tasks.findOneByOrFail({id:stale.id});st.securityFindingRemediation.attempts[0].startedAt=new Date(Date.now()-7200000).toISOString();await tasks.save(st);assert.ok((await svc.staleTargets({role:'admin'})).some(r=>r.projectId===stale.projectId));await blocked(ss);await svc.reconcileStaleWf6Dispatch(stale.id,{batchId:ps.batchId,attemptCount:1},{role:'admin'});await blocked(ss);await assert.rejects(()=>svc.retrySecurityRemediation(stale.id,{}, {role:'developer'}));report.checks.T9_staleQuarantined=true;
// Partial index permits historic released rows but refuses duplicate ACTIVE keys directly.
const key=productionTarget(stale);await assert.rejects(()=>db.query(`INSERT INTO remediation_target_reservations(id,"projectId","targetKey","targetFile","ownerTaskId",claims,state) VALUES($1,$2,$3,'pom.xml',$4,$5,'ACTIVE')`,[randomUUID(),stale.projectId,key.targetKey,ss.id,JSON.stringify({[ss.id]:{}})]),e=>e.code==='23505');report.checks.postgresPartialUnique=true;
// Down is guarded: cannot silently remove ACTIVE locks.
await assert.rejects(()=>db.query(sql('20261006_add_remediation_target_reservations.down.sql')),/prevents rollback/);await db.query('ROLLBACK');
// Disposable cleanup only, unrelated to supported production lifecycle API.
await db.query('TRUNCATE remediation_target_reservations');await db.query(sql('20261006_add_remediation_target_reservations.down.sql'));assert.equal((await db.query("SELECT tablename FROM pg_tables WHERE tablename='remediation_target_reservations'")).length,0);report.checks.migrationDown=true;
// Cutover regression: populated independent lifecycles abort migration atomically.
await db.query('TRUNCATE manual_remediation_tasks');
const ca=await seed(undefined,{securityFindingRemediation:{status:'DISPATCHING',batchId:'legacy-a'}});
const cb=await seed(undefined,{projectId:ca.projectId,securityFindingRemediation:{status:'DISPATCHING',batchId:'legacy-b'}});
await assert.rejects(()=>db.query(sql('20261006_add_remediation_target_reservations.sql')),/independent co-target/);await db.query('ROLLBACK');
assert.equal((await db.query("SELECT tablename FROM pg_tables WHERE tablename='remediation_target_reservations'")).length,0);
await tasks.delete({id:cb.id});const unknownCutover=await seed(undefined,{securityFindingRemediation:{status:'TECHNICAL_FAILURE',reasonCode:'UNKNOWN_FAILURE',batchId:'legacy-unknown'}});await db.query(sql('20261006_add_remediation_target_reservations.sql'));
assert.ok((await db.query('SELECT claims FROM remediation_target_reservations WHERE "projectId"=$1',[ca.projectId]))[0].claims[ca.id]);assert.ok((await db.query('SELECT claims FROM remediation_target_reservations WHERE "projectId"=$1',[unknownCutover.projectId]))[0].claims[unknownCutover.id]);report.checks.unknownCutoverRetained=true;
const cutoverSibling=await seed(undefined,{projectId:ca.projectId});await blocked(cutoverSibling);report.checks.cutoverBackfill=true;report.checks.cutoverRejectsExistingRace=true;
await db.query('TRUNCATE remediation_target_reservations');await db.query(sql('20261006_add_remediation_target_reservations.down.sql'));
console.log(JSON.stringify(report,null,2));
}finally{await db.destroy();}}
(process.argv[2]==='worker'?worker():main()).catch(e=>{console.error(e);process.exit(1);});
