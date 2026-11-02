#!/usr/bin/env node
// Pilote l'exécution du plan legacy, les contrôles d'identité et la production de résultats ; distingue les modes d'essai et d'application prévus par cet outil.
'use strict';
require('reflect-metadata');
require('ts-node').register({transpileOnly:true,project:require('node:path').resolve(__dirname,'../../tsconfig.json')});
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {database}=require('./database.cjs');
const {validatePlan,lockedState,preserved}=require('./plan.cjs');
const {LegacyReconciliationService}=require('../../src/manual-remediation/legacy-reconciliation.service');
const {OperatorRemoteSettlement}=require('./remote.cjs');
const {legacyDigest,LEGACY_RECONCILIATION_REASON}=require('../../src/manual-remediation/legacy-reconciliation');
/** Prépare les arguments de l’opération demandée. */
function argumentsFor(argv) {
  const values={},flags=new Set(['--apply','--dry-run']);
  for(let i=0;i<argv.length;i++) {
    const k=argv[i];assert(['--manifest','--operator','--audit','--confirm','--reason',...flags].includes(k),'UNKNOWN_OPTION');
    assert(!Object.hasOwn(values,k),'DUPLICATE_OPTION');values[k]=flags.has(k)?true:argv[++i];
    assert(values[k] && (flags.has(k)||!values[k].startsWith('--')),'OPTION_VALUE_REQUIRED');
  }
  assert(!(values['--apply']&&values['--dry-run']),'CONFLICTING_MODE');
  for(const k of ['--manifest','--operator','--audit'])assert(values[k],k+'_REQUIRED');
  assert.match(values['--operator'],/^[A-Za-z0-9@._:-]{1,128}$/);
  return values;
}
class DryRollback extends Error {
/** Initialise les dépendances et l’état de ce composant. */
constructor(value){super('DRY_ROLLBACK');this.value=value;}}
/** Renvoie precision gestionnaire pour le traitement ou l’affichage. */
function precisionManager(tx) {
  return new Proxy(tx,{
  /** Récupère les données demandées. */
  get(target,key){
    if(key==='getRepository')return entity=>{
      const repo=target.getRepository(entity);
      return new Proxy(repo,{
      /** Récupère les données demandées. */
      get(r,k){
        if(k==='update')return (id,patch)=>{
          assert.deepEqual(Object.keys(patch).sort(),['events','securityFindingRemediation','securityRemediationBatchId','updatedAt'].sort(),'UNEXPECTED_SERVICE_WRITE');
          return r.update(id,{...patch,
          /** Renvoie la date de dernière modification. */
          updatedAt:()=> '"updatedAt"'});
        };
        const v=r[k];return typeof v==='function'?v.bind(r):v;
      }});
    };
    const v=target[key];return typeof v==='function'?v.bind(target):v;
  }});
}
/** Retire les informations sensibles du message d’erreur. */
function cleanError(e) {
  const response=typeof e.getResponse==='function'?e.getResponse():null;
  return {name:e.name,code:/^[A-Z0-9_]+$/.test(String(e.code||''))?e.code:undefined,
    reason:typeof response==='string'?response:(/^[A-Z0-9_ -]+$/.test(e.message||'')?e.message:'RUNNER_VALIDATION_OR_DATABASE_FAILURE')};
}
/** Exécute les étapes principales de ce programme. */
async function main(argv=process.argv.slice(2)) {
  const args=argumentsFor(argv),raw=fs.readFileSync(args['--manifest']);assert(raw.length<1000000,'MANIFEST_TOO_LARGE');
  const plan=JSON.parse(raw);validatePlan(plan);const hash=crypto.createHash('sha256').update(raw).digest('hex');
  const apply=!!args['--apply'];
  if(apply){assert.equal(args['--reason'],LEGACY_RECONCILIATION_REASON,'EXPLICIT_REASON_REQUIRED');assert.equal(args['--confirm'],hash,'EXACT_MANIFEST_HASH_CONFIRMATION_REQUIRED');}
  else assert(!args['--confirm']&&!args['--reason'],'APPLY_OPTIONS_REQUIRE_APPLY');
  assert.equal(process.env.SECURITY_REMEDIATION_DISPATCH_ENABLED?.trim().toLowerCase(),'false','DISPATCH_FREEZE_REQUIRED');
  assert.equal(process.env.SECURITY_LEGACY_RECONCILIATION_ENABLED,'true','COMPATIBILITY_OPT_IN_REQUIRED');
  assert(process.env.LEGACY_RECONCILIATION_DATABASE_URL,'DATABASE_URL_REQUIRED');
  const receiptPath=process.env.SECURITY_LEGACY_SETTLEMENT_RECEIPTS_FILE;
  assert(receiptPath&&path.isAbsolute(receiptPath),'ABSOLUTE_RECEIPT_FILE_REQUIRED');
  const receiptStat=fs.lstatSync(receiptPath);
  assert(receiptStat.isFile()&&!(receiptStat.mode&0o022),'RECEIPT_FILE_MUST_NOT_BE_GROUP_OR_WORLD_WRITABLE');
  assert(receiptStat.uid===0||receiptStat.uid===process.getuid(),'RECEIPT_FILE_OWNER_MISMATCH');
  const receiptDoc=JSON.parse(fs.readFileSync(receiptPath,'utf8'));
  assert.deepEqual(Object.keys(receiptDoc),['receipts'],'RECEIPT_DOCUMENT_FIELDS');
  assert.equal(receiptDoc.receipts.length,8,'EXACT_RECEIPT_SET_REQUIRED');
  assert.deepEqual(receiptDoc.receipts.map(r=>r.groupId).sort(),plan.groups.map(g=>g.groupId).sort(),'RECEIPT_GROUP_SET_MISMATCH');
  for(const receipt of receiptDoc.receipts){
    assert.deepEqual(Object.keys(receipt).sort(),['groupId','groupDigest','repository','targetFile','approvedBy','evidenceReference','unrecordedEffectsReviewed','writerFreezeConfirmed','reviewedAt','expiresAt','inventoryDigest'].sort(),'UNEXPECTED_RECEIPT_FIELDS');
    assert.match(receipt.evidenceReference,/^[A-Za-z0-9_./:#-]{1,512}$/,'EVIDENCE_REFERENCE_MUST_BE_SECRET_FREE');
  }
  const report={runId:crypto.randomUUID(),operator:args['--operator'],timestamp:new Date().toISOString(),
    manifestHash:hash,mode:apply?'APPLY':'DRY_RUN',reason:plan.reason,projectId:plan.projectId,targetFile:plan.targetFile,
    taskIds:plan.groups.flatMap(g=>g.tasks.map(t=>t.taskId)),groupIds:plan.groups.map(g=>g.groupId),groups:[],
    httpServerStarted:false,phase4GGuard:{status:'NOT_INVOKED; separate read-only/disposable operation required'},status:'STARTED'};
  const audit=path.resolve(args['--audit']);fs.mkdirSync(path.dirname(audit),{recursive:true,mode:0o700});
  fs.writeFileSync(audit,JSON.stringify(report,null,2),{flag:'wx',mode:0o600});
  /** Enregistre l’état obtenu. */
  const persist=()=>{const tmp=audit+'.'+report.runId+'.tmp';fs.writeFileSync(tmp,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});fs.renameSync(tmp,audit);};
  const data=database(process.env.LEGACY_RECONCILIATION_DATABASE_URL),remote=new OperatorRemoteSettlement();
  /** Vérifie que les activités distantes sont terminées. */
  async function settled(g) {
    const receipt=await remote.verify(g.groupId,g.expectedGroupDigest,args['--operator']);
    assert(receipt.remoteInventory.references.every(r=>r.state==='CLOSED_UNMERGED'),'MERGED_PR_FORBIDDEN');
    return receipt;
  }
  try {
    await data.initialize();
    report.databaseIdentity=(await data.query('SELECT current_database() AS database,pg_backend_pid() AS "connectionPid"'))[0];
    report.preState=await data.transaction(tx=>lockedState(tx,plan));persist();
    // Validate every receipt before the first possible mutation. The qualified
    // service independently revalidates remote state inside each group transaction.
    report.remoteSettlement=[];for(const g of plan.groups)report.remoteSettlement.push(await settled(g));persist();
    const transactional={
    /** Exécute les opérations dans le cadre transactionnel prévu. */
    transaction:async callback=>{
      try{return await data.transaction(async tx=>{
        const before=await lockedState(tx,plan); // exact-set check under the same FILE/row locks
        const result=await callback(precisionManager(tx));
        const after=await lockedState(tx,plan);
        const changed=after.filter(t=>legacyDigest(t)!==legacyDigest(before.find(b=>b.id===t.id)));
        const thisGroup=plan.groups.find(g=>g.groupId===result.groupId);
        assert(changed.every(t=>thisGroup.tasks.some(e=>e.taskId===t.id)),'UNRELATED_ROW_CHANGED');
        preserved(before.filter(t=>thisGroup.tasks.some(e=>e.taskId===t.id)),after.filter(t=>thisGroup.tasks.some(e=>e.taskId===t.id)));
        const value={...result,preState:before.filter(t=>thisGroup.tasks.some(e=>e.taskId===t.id)),postState:after.filter(t=>thisGroup.tasks.some(e=>e.taskId===t.id))};
        if(!apply)throw new DryRollback(value);return value;
      });}catch(e){if(e instanceof DryRollback)return e.value;throw e;}
    }};
    const service=new LegacyReconciliationService(transactional,remote);
    for(const g of plan.groups) {
      const evidence=await settled(g); // also required for qualified idempotent replay
      const result=await service.reconcile(g.groupId,g.expectedGroupDigest,{id:args['--operator'],role:'admin'});
      report.groups.push({...result,committed:apply,remoteEvidenceReference:evidence.evidenceReference,
        transition:'ARCHIVE_LEGACY_AND_CLEAR_ACTIVE_POINTERS; FINDING_REMAINS_DETECTED'});persist();
    }
    report.postState=await data.transaction(tx=>lockedState(tx,plan));
    report.finalRemoteSettlement=[];
    for(const g of plan.groups)report.finalRemoteSettlement.push(await settled(g));
    if(apply)preserved(report.preState,report.postState);else assert.deepEqual(report.postState,report.preState,'DRY_RUN_CHANGED_DATABASE');
    report.activeLegacyTaskPointers=report.postState.filter(t=>t.securityFindingRemediation!==null||t.securityRemediationBatchId!==null).length;
    report.activeLegacyClaims=new Set(report.postState.filter(t=>t.securityFindingRemediation!==null).map(t=>t.securityFindingRemediation.batchId||t.securityRemediationBatchId||t.id)).size;
    report.activeLegacyWriters=report.activeLegacyClaims;
    report.findingStatuses=report.postState.map(t=>({taskId:t.id,findingId:t.findingId,status:t.status,scannerStatus:t.scannerStatus,fixed:false,verified:false}));
    report.newAttemptsCreated=0;report.attemptCountsChanged=0;report.committedRows=apply?report.groups.reduce((s,g)=>s+g.reconciled,0):0;
    report.status='PASS';persist();process.stdout.write(JSON.stringify({runId:report.runId,status:report.status,mode:report.mode,committedRows:report.committedRows,audit})+'\n');
    return report;
  }catch(e){report.status='FAIL';report.error=cleanError(e);persist();throw Object.assign(new Error(report.error.reason),{reported:true});}
  finally{if(data.isInitialized)await data.destroy();}
}
if(require.main===module)main().catch(e=>{process.stderr.write(JSON.stringify({status:'FAIL',error:cleanError(e)})+'\n');process.exitCode=1;});
module.exports={main,precisionManager,argumentsFor};
