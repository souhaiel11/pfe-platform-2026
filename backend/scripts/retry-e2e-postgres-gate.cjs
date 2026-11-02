// Vérifie le harnais de relance E2E et ses invariants avec PostgreSQL, notamment les comportements concurrents.
require('reflect-metadata');
require('ts-node').register({transpileOnly:true,project:require('path').resolve(__dirname,'../tsconfig.json')});
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {fork}=require('node:child_process');
const {randomUUID}=require('node:crypto');
const {DataSource,EntitySchema}=require('typeorm');
const {RetryE2EHarnessService}=require('../src/security-remediation/retry-e2e-harness.service');
const {RetryE2ETestPlanEntity}=require('../src/security-remediation/retry-e2e-test-plan.entity');
const {ManualRemediationTask}=require('../src/manual-remediation/manual-remediation.entity');
const {reserveAttempt,completeAttempt}=require('../src/manual-remediation/security-remediation-lifecycle');
const database='phase4f3_retry_e2e';
if(process.env.RETRY_E2E_DISPOSABLE_DATABASE!==database)throw Error('Explicit disposable database marker required');
const taskSchema=new EntitySchema({name:'ManualRemediationTask',target:ManualRemediationTask,tableName:'manual_remediation_tasks',columns:{id:{type:'uuid',primary:true},projectId:{type:'uuid'},securityRemediationBatchId:{type:'varchar',nullable:true},securityFindingRemediation:{type:'jsonb',nullable:true}}});
/** Prépare la source de données utilisée par le scénario. */
function source(){return new DataSource({type:'postgres',host:'127.0.0.1',port:5432,username:'postgres',database,synchronize:false,entities:[RetryE2ETestPlanEntity,taskSchema],extra:{max:1},logging:false});}
/** Exécute le traitement dans un processus séparé. */
async function worker(){const db=await source().initialize();process.send({ready:true,pid:process.pid,pgPid:(await db.query('select pg_backend_pid() as pid'))[0].pid});process.on('message',async message=>{if(!message.context)return;try{const action=await new RetryE2EHarnessService(db).hook(message.context,message.phase);process.send({action,pid:process.pid});}catch(e){process.send({error:e.message,pid:process.pid});}finally{await db.destroy();process.exit(0);}});}
/** Prépare deux opérations pour tester leur concurrence. */
async function pair(context,phase='INITIAL'){
 const children=[fork(__filename,['worker'],{stdio:['ignore','ignore','pipe','ipc']}),fork(__filename,['worker'],{stdio:['ignore','ignore','pipe','ipc']})];
 const ready=await Promise.all(children.map(c=>new Promise((resolve,reject)=>{c.once('message',resolve);c.once('error',reject);c.once('exit',code=>{if(code)reject(Error('worker startup failed'));});c.stderr.on('data',d=>process.stderr.write(d));})));
 assert.notEqual(ready[0].pid,ready[1].pid);assert.notEqual(ready[0].pgPid,ready[1].pgPid);
 const result=await Promise.all(children.map((c,i)=>new Promise((resolve,reject)=>{c.once('message',resolve);c.once('error',reject);c.send({context:Array.isArray(context)?context[i]:context,phase});})));
 await Promise.all(children.map(c=>c.exitCode===null?new Promise(r=>c.once('exit',r)):Promise.resolve()));
 return {ready,result};
}
/** Exécute les étapes principales de ce programme. */
async function main(){
 process.env.SECURITY_REMEDIATION_E2E_TEST_HARNESS_ENABLED='true';
 const db=await source().initialize();const report={database,productionDatabaseAccess:false,checks:{}};
 try{
 const prior=await db.query("select tablename from pg_tables where schemaname='public'");assert.equal(prior.length,0,'Disposable DB must be empty');
 await db.query(fs.readFileSync(require('path').resolve(__dirname,'../migrations/20261005_add_retry_e2e_test_plans.sql'),'utf8'));
 const tables=await db.query("select tablename from pg_tables where schemaname='public'");assert.deepEqual(tables.map(t=>t.tablename),['security_remediation_retry_e2e_plans']);
 const cols=await db.query("select column_name,data_type from information_schema.columns where table_name='security_remediation_retry_e2e_plans'");
 assert.deepEqual(cols.map(x=>x.column_name).sort(),['id','projectId','taskId','state','plan','createdAt','updatedAt'].sort());
 const constraints=await db.query("select contype from pg_constraint where conrelid='security_remediation_retry_e2e_plans'::regclass");assert.ok(constraints.some(x=>x.contype==='p'));assert.ok(constraints.some(x=>x.contype==='u'));assert.ok(constraints.some(x=>x.contype==='c'));
 const indexes=await db.query("select indexdef from pg_indexes where tablename='security_remediation_retry_e2e_plans'");assert.ok(indexes.some(x=>x.indexdef.includes("WHERE")&&x.indexdef.includes('ACTIVE')));
 report.checks.migrationUp=true;report.checks.schemaMatch=true;
 // Synthetic test-only task table: never insert scanner tasks into production.
 await db.query('CREATE TABLE manual_remediation_tasks (id uuid PRIMARY KEY, "projectId" uuid NOT NULL, "securityFindingRemediation" jsonb, "securityRemediationBatchId" varchar)');
 const tasks=db.getRepository(ManualRemediationTask),plans=db.getRepository(RetryE2ETestPlanEntity);
 const projectId=randomUUID(),taskId=randomUUID(),task={id:taskId,projectId,securityFindingRemediation:null};
 const a1=reserveAttempt(task,randomUUID(),new Date().toISOString());await tasks.save(task);
 const c1={projectId,taskId,attemptId:a1.attemptId,attemptNumber:1,batchId:a1.batchId};
 const plan={enabled:true,projectId,taskId,attempt1Mode:'FORCE_VERIFIER_TIMEOUT_ONCE',attempt2Mode:'STOP_BEFORE_GIT_WRITE_ONCE',expiresAt:new Date(Date.now()+600000).toISOString(),consumedAttempt1:false,consumedAttempt2:false,events:[]};
 const id=randomUUID();await plans.save({id,projectId,taskId,state:'ACTIVE',plan});
 const first=await pair(c1);assert.deepEqual(first.result.map(x=>x.action).sort(),['TIMEOUT','TIMEOUT_REPLAY']);
 let stored=await plans.findOneByOrFail({id});assert.equal(stored.plan.events.filter(e=>e.hook==='FORCE_VERIFIER_TIMEOUT_ONCE').length,1);assert.equal(stored.plan.consumedAttempt1,true);
 report.attempt1=first;report.checks.attempt1SingleConsumer=true;
 let current=await tasks.findOneByOrFail({id:taskId});completeAttempt(current,c1,{status:'TECHNICAL_FAILURE',reasonCode:'VERIFIER_TIMEOUT'},new Date().toISOString());const immutable=structuredClone(current.securityFindingRemediation.attempts[0]);
 const a2=reserveAttempt(current,randomUUID(),new Date().toISOString());await tasks.save(current);
 const c2={projectId,taskId,attemptId:a2.attemptId,attemptNumber:2,batchId:a2.batchId};assert.notEqual(c1.attemptId,c2.attemptId);assert.notEqual(c1.batchId,c2.batchId);
 const service=new RetryE2EHarnessService(db);assert.equal(await service.hook(c2,'INITIAL'),'NORMAL');
 const second=await pair(c2,'CANDIDATE_READY');assert.deepEqual(second.result.map(x=>x.action).sort(),['BARRIER','BARRIER_REPLAY']);
 stored=await plans.findOneByOrFail({id});assert.equal(stored.plan.events.filter(e=>e.hook==='STOP_BEFORE_GIT_WRITE_ONCE').length,1);assert.equal(stored.state,'COMPLETED');
 current=await tasks.findOneByOrFail({id:taskId});assert.equal(current.securityFindingRemediation.status,'OPERATOR_TEST_STOPPED');assert.equal(current.securityFindingRemediation.retryable,false);assert.deepEqual(current.securityFindingRemediation.attempts[0],immutable);assert.equal(current.securityFindingRemediation.attemptCount,2);
 report.attempt2=second;report.checks.attempt2SingleConsumer=true;report.checks.duplicateSingleFire=true;
 const before=JSON.stringify(current.securityFindingRemediation);const events=JSON.stringify(stored.plan.events);
 assert.equal(await service.hook({...c2,taskId:randomUUID()},'INITIAL'),'NORMAL');assert.equal(await service.hook({...c2,projectId:randomUUID()},'INITIAL'),'NORMAL');
 assert.equal(JSON.stringify((await tasks.findOneByOrFail({id:taskId})).securityFindingRemediation),before);assert.equal(JSON.stringify((await plans.findOneByOrFail({id})).plan.events),events);
 const crossTask=await pair([c2,{...c2,taskId:randomUUID()}],'CANDIDATE_READY');assert.deepEqual(crossTask.result.map(x=>x.action).sort(),['BARRIER_REPLAY','NORMAL']);
 const crossProject=await pair([c2,{...c2,projectId:randomUUID()}],'CANDIDATE_READY');assert.deepEqual(crossProject.result.map(x=>x.action).sort(),['BARRIER_REPLAY','NORMAL']);
 report.crossTask=crossTask;report.crossProject=crossProject;
 report.checks.crossTaskIsolation=true;report.checks.crossProjectIsolation=true;
 assert.throws(()=>completeAttempt(current,c1,{status:'TECHNICAL_FAILURE',reasonCode:'VERIFIER_TIMEOUT'}),/obsolète/);assert.equal(JSON.stringify(current.securityFindingRemediation),before);report.checks.staleCallback=true;
 // No existing enrollment: expiry activates neither hook; fail-closed conflict.
 const expiredTask={id:randomUUID(),projectId,securityFindingRemediation:null};const e1=reserveAttempt(expiredTask,randomUUID(),new Date().toISOString());await tasks.save(expiredTask);
 const expiredId=randomUUID();await plans.save({id:expiredId,projectId,taskId:expiredTask.id,state:'ACTIVE',plan:{...plan,taskId:expiredTask.id,expiresAt:new Date(Date.now()-60000).toISOString(),events:[]}});
 const ce1={projectId,taskId:expiredTask.id,attemptId:e1.attemptId,attemptNumber:1,batchId:e1.batchId};await assert.rejects(()=>service.hook(ce1,'INITIAL'),/expired/);
 assert.equal(await service.hook(ce1,'CANDIDATE_READY'),'NORMAL');assert.equal((await plans.findOneByOrFail({id:expiredId})).plan.events.length,0);
 completeAttempt(expiredTask,ce1,{status:'TECHNICAL_FAILURE',reasonCode:'VERIFIER_TIMEOUT'},new Date().toISOString());
 const e2=reserveAttempt(expiredTask,randomUUID(),new Date().toISOString());await tasks.save(expiredTask);
 const ep=await plans.findOneByOrFail({id:expiredId});ep.plan.consumedAttempt1=true;ep.plan.attempt1=ce1;await plans.save(ep);
 const ce2={projectId,taskId:expiredTask.id,attemptId:e2.attemptId,attemptNumber:2,batchId:e2.batchId};await assert.rejects(()=>service.hook(ce2,'INITIAL'),/expired/);await assert.rejects(()=>service.hook(ce2,'CANDIDATE_READY'),/not enrolled/);
 assert.equal((await plans.findOneByOrFail({id:expiredId})).plan.consumedAttempt2,false);
 report.checks.expiry=true;
 process.env.SECURITY_REMEDIATION_E2E_TEST_HARNESS_ENABLED='false';
 const originalTransaction=db.transaction;
 /** Exécute les opérations dans le cadre transactionnel prévu. */
 db.transaction=()=>{throw Error('Disabled harness touched DB');};assert.equal(await service.hook(c2,'INITIAL'),'NORMAL');db.transaction=originalTransaction;
 assert.equal(JSON.stringify((await tasks.findOneByOrFail({id:taskId})).securityFindingRemediation),before);report.checks.disabledNoLookup=true;
 console.log(JSON.stringify(report,null,2));
 }finally{await db.destroy();}
}
(process.argv[2]==='worker'?worker():main()).catch(e=>{console.error(e);process.exit(1);});
