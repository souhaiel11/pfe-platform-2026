// Exécute les scénarios de qualification de l'outil legacy, y compris les cas qui doivent être rejetés.
'use strict';
require('./test-remote-preload.cjs');
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),crypto=require('crypto'),{spawn}=require('child_process');
const {database}=require('./database.cjs');
const {legacyCatalog,legacyDigest,legacyArchive,legacySnapshot}=require('../../src/manual-remediation/legacy-reconciliation');
const {assertRetryAllowed,assertLegacyCallback,reserveAttempt}=require('../../src/manual-remediation/security-remediation-lifecycle');
const {reserveTarget,canonicalTarget,bindTargetAttempt}=require('../../src/manual-remediation/remediation-target-reservation');
const {ManualRemediationTask}=require('../../src/manual-remediation/manual-remediation.entity');
const plan=require('./approved-plan.json');
const root=process.env.LEGACY_R2_AUDIT_DIR||'/audit';
const seed=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../../docs/qa/chain2a-legacy-reconciliation-20261007/full-live-tasks.json')));
if(process.env.CHAIN2B_R2_DISPOSABLE!=='network-none')throw Error('DISPOSABLE_ONLY');
const url='postgres://postgres@127.0.0.1/chain2b_r2_disposable';
const data=database(url);let sequence=0;
const report={scope:'NETWORK_NONE_DISPOSABLE_ONLY',reusedService:true,checks:{},runs:[]};
/** Prend une copie de l’état à comparer. */
const snapshot=async()=> (await data.query('SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),\'[]\') AS rows FROM manual_remediation_tasks t'))[0].rows;
/** Renvoie l’état courant de l’élément. */
const state=async()=>({tasks:await snapshot(),projects:await data.query('SELECT * FROM projects ORDER BY id'),incidents:await data.query('SELECT * FROM incidents ORDER BY id')});
/** Prépare les reçus utilisés pour vérifier l’opération. */
function receipts() {
  const inventory={references:legacyCatalog.remoteReferences.map(r=>({prNumber:r.prNumber,headSha:r.headSha,state:'CLOSED_UNMERGED',branch:'MISSING'})),branches:[{name:'main',sha:'a'.repeat(40)}]};
  const r={receipts:plan.groups.map(g=>({groupId:g.groupId,groupDigest:g.expectedGroupDigest,repository:plan.repository,targetFile:'pom.xml',approvedBy:'operator',evidenceReference:'DISPOSABLE_CONTROLLED_REMOTE',unrecordedEffectsReviewed:true,writerFreezeConfirmed:true,reviewedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+600000).toISOString(),inventoryDigest:legacyDigest(inventory)}))};
  fs.writeFileSync(root+'/receipts.json',JSON.stringify(r));return r;
}
/** Réinitialise l’état du scénario. */
async function reset() {
  await data.query('TRUNCATE manual_remediation_tasks,projects,incidents');
  await data.query('INSERT INTO projects(id,"githubRepo") VALUES($1,$2)',[plan.projectId,plan.repository]);
  await data.query('INSERT INTO incidents(id,"projectId",metadata,"createdAt") VALUES($1,$2,$3,$4)',[seed[0].incidentId,plan.projectId,JSON.stringify({sourceCommitSha:'7ae0f954f99628b69ce9b42f42c1e2acc8568d99'}),'2026-10-01']);
  for(const t of seed)await data.query('INSERT INTO manual_remediation_tasks SELECT * FROM json_populate_record(null::manual_remediation_tasks,$1::json)',[JSON.stringify(t)]);
  receipts();
}
/** Lance le sous-processus nécessaire au scénario. */
function child(options={}) {
  const audit=root+'/run-'+(++sequence)+'.json',manifest=options.manifest||path.resolve(__dirname,'approved-plan.json');
  const args=['--require',path.resolve(__dirname,'test-remote-preload.cjs'),process.env.LEGACY_R2_RUNNER_ENTRYPOINT||path.resolve(__dirname,'runner.cjs'),'--manifest',manifest,'--operator','operator','--audit',audit];
  if(options.apply)args.push('--apply','--reason','LEGACY_SINGLE_WRITER_RECONCILIATION','--confirm',crypto.createHash('sha256').update(fs.readFileSync(manifest)).digest('hex'));
  if(options.explicitDry)args.push('--dry-run');
  if(options.noConfirmation)args.splice(args.indexOf('--confirm'),2);
  const env={...process.env,LEGACY_RECONCILIATION_DATABASE_URL:url,SECURITY_LEGACY_RECONCILIATION_ENABLED:'true',SECURITY_REMEDIATION_DISPATCH_ENABLED:'false',SECURITY_LEGACY_SETTLEMENT_RECEIPTS_FILE:root+'/receipts.json',N8N_API_URL:'http://controlled.invalid',N8N_API_KEY:'DISPOSABLE_ONLY',GITHUB_TOKEN:'DISPOSABLE_ONLY',TEST_REMOTE_MODE:options.remote||'SETTLED',...options.env};
  return new Promise((resolve,reject)=>{const p=spawn(process.execPath,args,{env,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';p.stdout.on('data',d=>stdout+=d);p.stderr.on('data',d=>stderr+=d);p.on('error',reject);p.on('exit',code=>{const result={code,pid:p.pid,stdout,stderr,audit,report:fs.existsSync(audit)?JSON.parse(fs.readFileSync(audit)):null};report.runs.push({code,pid:p.pid,audit,mode:result.report?.mode,error:result.report?.error});resolve(result);});});
}
/** Vérifie que le scénario est refusé. */
async function rejected(options) {const before=await state(),r=await child(options);assert.notEqual(r.code,0,JSON.stringify(r));assert.deepEqual(await state(),before);return r;}
/** Exécute les étapes principales de ce programme. */
async function main(){await data.initialize();try{
  assert.equal((await data.query("SELECT count(*)::int n FROM pg_tables WHERE schemaname='public'"))[0].n,0);
  await data.synchronize();await reset();const original=await state();
  const dry=await child();assert.equal(dry.code,0,JSON.stringify(dry));assert.equal(dry.report.mode,'DRY_RUN');assert.equal(dry.report.groups.length,8);assert.equal(dry.report.committedRows,0);assert.deepEqual(await state(),original);report.checks.defaultDryRunZeroChanges=true;
  const explicit=await child({explicitDry:true});assert.equal(explicit.code,0,JSON.stringify(explicit));assert.deepEqual(await state(),original);report.checks.explicitDryRunZeroChanges=true;
  for(const remote of ['OPEN','DRIFT','MERGED','BRANCH','INFLIGHT','UNAVAILABLE'])await rejected({apply:true,remote});report.checks.remoteFailClosed=true;
  const stale=receipts();stale.receipts[0].reviewedAt='1970-01-01T00:00:00Z';fs.writeFileSync(root+'/receipts.json',JSON.stringify(stale));await rejected({apply:true});
  const wrong=receipts();wrong.receipts[0].groupDigest='0'.repeat(64);fs.writeFileSync(root+'/receipts.json',JSON.stringify(wrong));await rejected({apply:true});receipts();report.checks.staleAndWrongReceiptRejected=true;
  for(const env of [{SECURITY_REMEDIATION_DISPATCH_ENABLED:'true'},{SECURITY_LEGACY_RECONCILIATION_ENABLED:'false'}])await rejected({apply:true,env});report.checks.explicitFreezeAndOptInRequired=true;
  await rejected({apply:true,noConfirmation:true});report.checks.applyCannotOmitHashConfirmation=true;
  for(const mutate of [p=>p.groups[0].tasks[0].findingId='OTHER',p=>p.targetFile='other.xml',p=>p.groups.pop(),p=>p.groups[0].tasks.push(p.groups[1].tasks[0])]){
    const p=structuredClone(plan);mutate(p);const file=root+'/bad-plan.json';fs.writeFileSync(file,JSON.stringify(p));await rejected({apply:true,manifest:file});
  }report.checks.exactManifestRequired=true;
  await data.query('UPDATE manual_remediation_tasks SET "findingId"=\'OTHER\' WHERE id=$1',[seed[0].id]);await rejected({apply:true});await reset();report.checks.findingIdentityDriftRejected=true;
  const extra={...seed[0],id:crypto.randomUUID()};await data.query('INSERT INTO manual_remediation_tasks SELECT * FROM json_populate_record(null::manual_remediation_tasks,$1::json)',[JSON.stringify(extra)]);await rejected({apply:true});await reset();report.checks.extraTaskRejected=true;
  await data.query('DELETE FROM manual_remediation_tasks WHERE id=$1',[seed[0].id]);await rejected({apply:true});await reset();report.checks.missingTaskRejected=true;
  await data.query(`UPDATE manual_remediation_tasks SET "securityFindingRemediation"="securityFindingRemediation"||'{"contractVersion":2,"attemptId":null}'::jsonb WHERE id=$1`,[seed[0].id]);await rejected({apply:true});await reset();report.checks.corruptedModernFailsClosed=true;
  const multi=plan.groups.find(g=>g.tasks.length===6),failId=multi.tasks.map(t=>t.taskId).sort().at(-1);
  await data.query(`CREATE FUNCTION reject_archive() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id='${failId}'::uuid AND NEW."securityFindingRemediation" IS NULL THEN RAISE EXCEPTION 'controlled failure'; END IF; RETURN NEW; END $$`);
  await data.query('CREATE TRIGGER reject_archive BEFORE UPDATE ON manual_remediation_tasks FOR EACH ROW EXECUTE FUNCTION reject_archive()');
  const beforeFailure=await snapshot(),failure=await child({apply:true});assert.notEqual(failure.code,0);const afterFailure=await snapshot();
  assert.deepEqual(afterFailure.filter(t=>multi.tasks.some(e=>e.taskId===t.id)),beforeFailure.filter(t=>multi.tasks.some(e=>e.taskId===t.id)));
  assert.equal(failure.report.groups.length,plan.groups.findIndex(g=>g.groupId===multi.groupId));
  await data.query('DROP TRIGGER reject_archive ON manual_remediation_tasks');await data.query('DROP FUNCTION reject_archive()');await reset();report.checks.groupRollbackAfterEarlierWrite=true;
  const beforeApply=await state(),applied=await child({apply:true});assert.equal(applied.code,0,JSON.stringify(applied));assert.equal(applied.report.committedRows,14);assert.equal(applied.report.groups.length,8);
  const checkpoint=await state();assert.deepEqual(checkpoint.projects,beforeApply.projects);assert.deepEqual(checkpoint.incidents,beforeApply.incidents);
  for(const t of checkpoint.tasks){const old=beforeApply.tasks.find(s=>s.id===t.id);assert.deepEqual(legacyArchive(t).original,legacySnapshot(old));assert.equal(t.createdAt,old.createdAt);assert.equal(t.updatedAt,old.updatedAt);assert.equal(t.scannerStatus,'DETECTED');assert.equal(t.status,old.status);assert.throws(()=>assertRetryAllowed(t));assert.throws(()=>assertLegacyCallback(t,old.securityRemediationBatchId,{status:'CLOSED'}));}
  assert.equal(applied.report.activeLegacyClaims,0);assert.equal(applied.report.activeLegacyWriters,0);report.checks.apply14Tasks8GroupsZeroClaims=true;report.checks.historyCountersExecutionReferencesAndMicrosecondsPreserved=true;
  const replay=await child({apply:true});assert.equal(replay.code,0,JSON.stringify(replay));assert.equal(replay.report.committedRows,0);assert(replay.report.groups.every(g=>g.idempotent));assert.deepEqual(await state(),checkpoint);report.checks.secondRunIdempotent=true;
  await reset();const race=await Promise.all([child({apply:true}),child({apply:true})]);assert(race.every(r=>r.code===0),JSON.stringify(race));assert.notEqual(race[0].report.databaseIdentity.connectionPid,race[1].report.databaseIdentity.connectionPid);assert.equal(race.reduce((n,r)=>n+r.report.committedRows,0),14);
  for(const t of await snapshot())assert.equal(t.events.filter(e=>e.legacyReconciliation?.action==='RETIRE').length,1);report.checks.twoIndependentProcessesSafe=true;report.race=race.map(r=>({pid:r.pid,connectionPid:r.report.databaseIdentity.connectionPid,committedRows:r.report.committedRows}));
  // Last runner apply is immediately followed by the exact unmodified migration:
  // no repair or fixture update occurs between reconciliation and guard execution.
  await data.query(fs.readFileSync(path.resolve(__dirname,'../../migrations/20261006_add_remediation_target_reservations.sql'),'utf8'));
  assert.equal((await data.query("SELECT count(*)::int n FROM remediation_target_reservations WHERE state='ACTIVE'"))[0].n,0);report.checks.real4GGuardPass=true;
  const eligibilityBefore=await state();
  const {LegacyReconciliationService}=require('../../src/manual-remediation/legacy-reconciliation.service');
  const {LegacyRemoteSettlement}=require('../../src/manual-remediation/legacy-remote-settlement');
  process.env.SECURITY_LEGACY_RECONCILIATION_ENABLED='true';
  const eligibilityTask=(await snapshot())[0],eligibilityGroup=plan.groups.find(g=>g.tasks.some(t=>t.taskId===eligibilityTask.id));
  const eligibility=await new LegacyReconciliationService(data,new LegacyRemoteSettlement()).eligibility(eligibilityGroup.groupId,eligibilityTask.id,legacyArchive(eligibilityTask).snapshotDigest,{id:'operator',role:'admin'});
  assert.equal(eligibility.evaluable,true);assert.equal(eligibility.authorized,false);assert.equal(eligibility.reason,'FRESH_POST_RECONCILIATION_SCAN_REQUIRED');assert.deepEqual(await state(),eligibilityBefore);report.checks.futureEligibilityEvaluableWithoutMutation=true;
  const tasks=await data.getRepository(ManualRemediationTask).find({order:{id:'ASC'}}),A=tasks.find(t=>t.source==='TRIVY'),B=tasks.find(t=>t.source==='OWASP');
  const siblingBefore=await snapshot();await data.transaction(async tx=>{const rid=await reserveTarget(tx,canonicalTarget(A.projectId,'pom.xml',A.findingSnapshot.component),[A.id]);reserveAttempt(A,'sec-batch-disposable-owner',new Date().toISOString());await bindTargetAttempt(tx,rid,A);await tx.getRepository(ManualRemediationTask).save(A);});
  await assert.rejects(()=>data.transaction(async tx=>{await reserveTarget(tx,canonicalTarget(B.projectId,'pom.xml',B.findingSnapshot.component),[B.id]);reserveAttempt(B,'NEVER','NEVER');}),e=>e.getResponse().code==='REMEDIATION_TARGET_ALREADY_IN_PROGRESS');
  assert.deepEqual((await snapshot()).find(t=>t.id===B.id),siblingBefore.find(t=>t.id===B.id));assert.equal((await data.query("SELECT count(*)::int n FROM remediation_target_reservations WHERE state='ACTIVE'"))[0].n,1);report.checks.singleWriterSiblingBlockedBeforeAttempt=true;
  report.reconciliation={tasks:14,groups:8,activeClaims:0,activeWriters:0,findingsFixed:0,findingsVerified:0,newAttempts:0,counterChanges:0};report.singleWriterSeparateFromReconciliationCheckpoint=true;report.pass=true;
}finally{fs.writeFileSync(root+'/qualification.json',JSON.stringify(report,null,2)+'\n');await data.destroy();}}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
