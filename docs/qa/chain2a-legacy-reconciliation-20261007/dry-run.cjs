const fs=require('fs'),assert=require('assert/strict'),crypto=require('crypto');
require('/workspace/backend/node_modules/reflect-metadata');
require('/workspace/backend/node_modules/ts-node').register({transpileOnly:true,project:'/workspace/backend/tsconfig.json'});
const {Client}=require('/workspace/backend/node_modules/pg');
const {reserveTarget,bindTargetAttempt,canonicalTarget}=require('/workspace/backend/src/manual-remediation/remediation-target-reservation');
const {reserveAttempt,assertRetryAllowed,assertLegacyCallback,assertNoSideEffect}=require('/workspace/backend/src/manual-remediation/security-remediation-lifecycle');
const dir='/audit',original=JSON.parse(fs.readFileSync(dir+'/full-live-tasks.json'));
const migration=fs.readFileSync('/workspace/backend/migrations/20261006_add_remediation_target_reservations.sql','utf8');
const predicate=migration.split('CREATE TEMP VIEW remediation_target_cutover AS\n')[1].split(';')[0];
const c=new Client({host:'127.0.0.1',user:'postgres',database:'chain2a_disposable_v2'});
const digest=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const report={scope:'DISPOSABLE ONLY; hypothetical future remote settlement, NOT proof of current Git closure',productionAccess:false,proposedCompatibilityImplemented:false,checks:{}};
const tx={query:async(q,args)=>(await c.query(q,args)).rows};
async function selected(){return (await c.query('SELECT id,lifecycle FROM ('+predicate+') c')).rows;}
async function current(id){return (await c.query('SELECT * FROM manual_remediation_tasks WHERE id=$1',[id])).rows[0];}
async function save(t){await c.query('UPDATE manual_remediation_tasks SET "securityFindingRemediation"=$2::jsonb,"securityRemediationBatchId"=$3,events=$4::jsonb WHERE id=$1',[t.id,t.securityFindingRemediation===null?null:JSON.stringify(t.securityFindingRemediation),t.securityRemediationBatchId,JSON.stringify(t.events)]);}
// PROPOSED MODEL ONLY: operator-authenticated, settled, legacy-only archive-and-retire.
// Future implementation must obtain trusted settlement receipts; these are test premises.
async function reconcileGroup(ids,receipt){
 assert.equal(receipt.scope,'SIMULATED_REMOTE_SETTLED');assert.equal(receipt.noInflight,true);assert.equal(receipt.noOpenAuthoringPR,true);assert.equal(receipt.noWriter,true);
 await c.query('BEGIN');let changed=0;
 try{for(const id of [...ids].sort()){
  const t=(await c.query('SELECT * FROM manual_remediation_tasks WHERE id=$1 FOR UPDATE',[id])).rows[0];
  const prior=(t.events||[]).find(e=>e.reason==='LEGACY_SINGLE_WRITER_RECONCILIATION');
  if(prior){assert.equal(t.securityFindingRemediation,null);assert.equal(prior.reconciliation.settlementReceipt.scope,receipt.scope);continue;}
  const r=t.securityFindingRemediation;assert(r);assert(!r.attemptId);assert(!(r.attempts||[]).some(a=>a.attemptId));assert.notEqual(r.status,'DISPATCHING');assert.equal(t.scannerStatus,'DETECTED');
  const archived={securityFindingRemediation:r,securityRemediationBatchId:t.securityRemediationBatchId};
  t.events=[...(t.events||[]),{at:'SIMULATION_ONLY',actorId:null,actorDisplayName:'SIMULATED_OPERATOR',oldStatus:t.status,newStatus:t.status,reason:'LEGACY_SINGLE_WRITER_RECONCILIATION',buildNumber:null,reconciliation:{disposition:'RETIRED_LEGACY_REFERENCE',snapshotDigest:digest(archived),archivedLifecycle:archived,settlementReceipt:receipt}}];
  t.securityFindingRemediation=null;t.securityRemediationBatchId=null;await save(t);changed++;
 }await c.query('COMMIT');return changed;}catch(e){await c.query('ROLLBACK');throw e;}
}
(async()=>{await c.connect();try{
 assert.equal((await c.query("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public'")).rows[0].n,0);
 await c.query('CREATE TABLE manual_remediation_tasks (id uuid PRIMARY KEY,"projectId" uuid NOT NULL,source text,"findingId" text,"ruleOrCve" text,status text,"scannerStatus" text,"findingFingerprint" text,"findingSnapshot" jsonb,"securityFindingRemediation" jsonb,"securityRemediationBatchId" varchar,events jsonb)');
 for(const t of original)await c.query('INSERT INTO manual_remediation_tasks VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,$12::jsonb)',[t.id,t.projectId,t.source,t.findingId,t.ruleOrCve,t.status,t.scannerStatus,t.findingFingerprint,JSON.stringify(t.findingSnapshot),JSON.stringify(t.securityFindingRemediation),t.securityRemediationBatchId,JSON.stringify(t.events)]);
 const before=await selected();assert.equal(before.length,14);const groups={};for(const x of before)(groups[x.lifecycle]??=[]).push(x.id);assert.equal(Object.keys(groups).length,8);report.before={tasks:14,groups:8};report.groups=groups;
 try{await c.query(migration);throw Error('Expected cutover guard rejection');}catch(e){assert.match(e.message,/Existing independent co-target/);await c.query('ROLLBACK');report.checks.currentMigrationRejectsBaseline=true;}
 await c.query('BEGIN');await c.query(`UPDATE manual_remediation_tasks SET "securityFindingRemediation"=jsonb_set("securityFindingRemediation",'{status}','"REMEDIATION_ABANDONED"')`);const retained=await selected();assert(retained.length>0);report.statusOnlyRetainedClaims=retained.length;await c.query('ROLLBACK');
 const receipt={scope:'SIMULATED_REMOTE_SETTLED',noInflight:true,noOpenAuthoringPR:true,noWriter:true,evidence:'Hypothetical prerequisite; current remote PRs are still OPEN'};
 let changed=0;for(const ids of Object.values(groups))changed+=await reconcileGroup(ids,receipt);assert.equal(changed,14);
 for(const t0 of original){const t=await current(t0.id),e=t.events.at(-1),arch=e.reconciliation.archivedLifecycle;assert.deepEqual(arch.securityFindingRemediation,t0.securityFindingRemediation);assert.equal(arch.securityRemediationBatchId,t0.securityRemediationBatchId);assert.equal(arch.securityFindingRemediation.attemptCount,t0.securityFindingRemediation.attemptCount);assert.deepEqual(t.events.slice(0,-1),t0.events);assert.equal(t.status,t0.status);assert.equal(t.scannerStatus,t0.scannerStatus);assert.equal(t.findingFingerprint,t0.findingFingerprint);assert.equal(t.findingId,t0.findingId);assert.deepEqual(t.findingSnapshot,t0.findingSnapshot);assert.throws(()=>assertRetryAllowed(t));assert.throws(()=>assertLegacyCallback(t,t0.securityRemediationBatchId,{status:'CLOSED'}));assertNoSideEffect(t);}
 report.checks.archivedHistoryByteEquivalent=true;report.checks.findingIdentityAndStatusUnchanged=true;report.checks.legacyRetryAndCallbackRejected=true;
 const after=(await c.query('SELECT * FROM manual_remediation_tasks ORDER BY id')).rows;fs.writeFileSync(dir+'/simulated-reconciled-tasks.json',JSON.stringify(after,null,2));const afterDigest=digest(after);
 let replayChanges=0;for(const ids of Object.values(groups))replayChanges+=await reconcileGroup(ids,receipt);assert.equal(replayChanges,0);assert.equal(digest((await c.query('SELECT * FROM manual_remediation_tasks ORDER BY id')).rows),afterDigest);report.checks.idempotentReplay=true;
 assert.equal((await selected()).length,0);report.reconciliation={activeLegacyClaims:0,findingsMarkedFixed:0,newAttemptsCreated:0,attemptCountsFabricated:0,historyCountersPreserved:14,liveRemoteSettlementProven:false};
 await c.query(migration);report.checks.exactUnchangedMigrationGuardPass=true;assert.equal((await c.query("SELECT count(*)::int AS n FROM remediation_target_reservations WHERE state='ACTIVE'")).rows[0].n,0);
 const A=await current(original.find(x=>x.source==='TRIVY').id),B=await current(original.find(x=>x.source==='OWASP').id);
 // Separate post-reconciliation disposable proof: one genuinely NEW modern admission.
 await c.query('BEGIN');const key=canonicalTarget(A.projectId,'pom.xml',A.findingSnapshot.component);const rid=await reserveTarget(tx,key,[A.id]);const attempt=reserveAttempt(A,'sec-batch-'+crypto.randomUUID(),new Date().toISOString());await bindTargetAttempt(tx,rid,A);await save(A);await c.query('COMMIT');assert.equal(attempt.attemptNumber,1);
 const bBefore=await current(B.id);await c.query('BEGIN');let blocked=false;
 try{await reserveTarget(tx,canonicalTarget(B.projectId,'pom.xml',B.findingSnapshot.component),[B.id]);reserveAttempt(B,'SHOULD_NOT_EXIST','NEVER');}catch(e){blocked=true;assert.equal(e.getResponse().code,'REMEDIATION_TARGET_ALREADY_IN_PROGRESS');}finally{await c.query('ROLLBACK');}
 assert(blocked);assert.deepEqual(await current(B.id),bBefore);const count=(await c.query("SELECT count(*)::int AS n FROM remediation_target_reservations WHERE state='ACTIVE'")).rows[0].n;assert.equal(count,1);
 report.singleWriterProof={ownerTaskId:A.id,blockedTaskId:B.id,activeReservations:count,ownerAttemptNumber:attempt.attemptNumber,blockedSiblingNewAttemptCount:0,blockedSiblingHistoricalAttemptCountUnchanged:true,usesActualProductionReservationAndAttemptFunctions:true,normalV18AdmissionNotExercised:true};report.checks.singleWriterPostReconciliation=true;
 report.future={findingsRemainInBacklog:true,newModernLifecycleStructurallyPossible:true,automaticDispatchEligibilityNotGranted:true,explicitNewLifecycleAuthorizationRequired:true};
 report.pass=true;fs.writeFileSync(dir+'/dry-run-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }finally{await c.end();}})().catch(e=>{console.error(e.stack);process.exitCode=1});
