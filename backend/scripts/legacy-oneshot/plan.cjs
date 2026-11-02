// Valide le plan opérateur et les identités/états attendus avant de traiter les groupes legacy.
'use strict';
const assert = require('node:assert/strict');
const {legacyCatalog,legacyDigest,legacySnapshot,legacyArchive,assertAuditedLegacy,LEGACY_RECONCILIATION_REASON} = require('../../src/manual-remediation/legacy-reconciliation');
const groups = Object.keys(legacyCatalog.groups).sort();
const entries = groups.flatMap(g=>legacyCatalog.groups[g]);
/** Vérifie l’égalité avec la valeur attendue. */
const exact = (a,b) => assert.deepEqual(a,b,'EXACT_MANIFEST_MISMATCH');
/** Valide le plan. */
function validatePlan(plan) {
  // Finding identity and target binding are pinned to the audited source pack,
  // not values that an arbitrary caller can substitute in its input document.
  exact(plan,require('./approved-plan.json'));
  exact(Object.keys(plan).sort(),['version','projectId','repository','targetFile','reason','historicalReferencePR','remoteReferences','groups'].sort());
  exact(plan.version,1);exact(plan.projectId,entries[0].projectId);exact(plan.repository,legacyCatalog.repository);
  exact(plan.targetFile,'pom.xml');exact(plan.reason,LEGACY_RECONCILIATION_REASON);exact(plan.historicalReferencePR,37);
  exact(plan.remoteReferences,legacyCatalog.remoteReferences.map(r=>({...r,state:'CLOSED_UNMERGED',merged:false,branchState:'MISSING'})));
  exact(plan.groups.map(g=>g.groupId).sort(),groups);
  const seen=[];
  for(const g of plan.groups) {
    exact(Object.keys(g).sort(),['groupId','expectedGroupDigest','tasks'].sort());
    exact(g.expectedGroupDigest,legacyDigest(legacyCatalog.groups[g.groupId].map(e=>({taskId:e.taskId,digest:e.digest})).sort((a,b)=>a.taskId.localeCompare(b.taskId))));
    exact(g.tasks.map(t=>t.taskId).sort(),legacyCatalog.groups[g.groupId].map(e=>e.taskId).sort());
    for(const t of g.tasks) {
      exact(Object.keys(t).sort(),['taskId','findingId','findingFingerprint','source','cve','findingSnapshotDigest'].sort());
      const e=entries.find(e=>e.taskId===t.taskId);exact(t.source,e.source);exact(t.cve,e.cve);
      assert.equal(typeof t.findingId,'string');assert.match(t.findingFingerprint,/^[a-f0-9]{64}$/);assert.match(t.findingSnapshotDigest,/^[a-f0-9]{64}$/);seen.push(t.taskId);
    }
  }
  exact(seen.sort(),entries.map(e=>e.taskId).sort());assert.equal(seen.length,14);assert.equal(groups.length,8);
}
/** Vérifie l’état attendu sous verrou. */
async function lockedState(tx,plan) {
  await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[plan.projectId+':FILE:pom.xml']);
  const rows=await tx.query(`SELECT to_jsonb(t) AS row FROM manual_remediation_tasks t
    WHERE "projectId"=$1 AND source IN ('TRIVY','OWASP') AND
    ("securityFindingRemediation" IS NOT NULL OR EXISTS
      (SELECT 1 FROM jsonb_array_elements(events) e WHERE e->>'reason'=$2 AND e->'legacyReconciliation'->>'action'='RETIRE'))
    ORDER BY id FOR UPDATE`,[plan.projectId,LEGACY_RECONCILIATION_REASON]);
  const tasks=rows.map(r=>r.row);exact(tasks.map(t=>t.id).sort(),entries.map(e=>e.taskId).sort());
  for(const g of plan.groups) for(const expected of g.tasks) {
    const t=tasks.find(t=>t.id===expected.taskId);
    exact(t.findingId,expected.findingId);exact(t.findingFingerprint,expected.findingFingerprint);
    exact(legacyDigest(t.findingSnapshot),expected.findingSnapshotDigest);
    exact(t.status==='TODO'||t.status==='REOPENED',true);exact(t.scannerStatus,'DETECTED');
    const archive=legacyArchive(t);
    if(!archive) assertAuditedLegacy(t,g.groupId);
    else {
      const e=entries.find(e=>e.taskId===t.id);
      exact(t.projectId,e.projectId);exact(t.source,e.source);exact(t.ruleOrCve,e.cve);
      exact(t.securityFindingRemediation,null);exact(t.securityRemediationBatchId,null);
      exact(archive.groupId,g.groupId);exact(archive.groupDigest,g.expectedGroupDigest);
      exact(archive.snapshotDigest,e.digest);exact(legacyDigest(archive.original),e.digest);
      exact(t.events.filter(e=>e.legacyReconciliation?.action==='RETIRE').length,1);
    }
  }
  if((await tx.query("SELECT to_regclass('public.remediation_target_reservations') AS name"))[0].name){
    const reservations=await tx.query('SELECT claims FROM remediation_target_reservations WHERE "projectId"=$1 AND state=\'ACTIVE\' FOR UPDATE',[plan.projectId]);
    for(const r of reservations) for(const [id,claim] of Object.entries(r.claims||{})){
      assert(entries.some(e=>e.taskId===id),'UNEXPECTED_ACTIVE_RESERVATION_CLAIM');
      assert(claim.attemptId==null,'MODERN_RESERVATION_CLAIM_FORBIDDEN');
      assert(tasks.find(t=>t.id===id)?.securityFindingRemediation!==null,'RETIRED_TASK_RETAINS_ACTIVE_CLAIM');
    }
  }
  return tasks;
}
/** Contrôle que les données conservées restent identiques. */
function preserved(before,after) {
  exact(before.map(t=>t.id),after.map(t=>t.id));
  for(const t of after) {
    const old=before.find(x=>x.id===t.id),archive=legacyArchive(t);
    /** Copie l’objet sans les champs exclus. */
    const omit=x=>Object.fromEntries(Object.entries(x).filter(([k])=>!['events','securityFindingRemediation','securityRemediationBatchId'].includes(k)));
    exact(omit(t),omit(old));exact(t.securityFindingRemediation,null);exact(t.securityRemediationBatchId,null);
    if(legacyArchive(old)) exact(t,old);
    else {exact(t.events.slice(0,-1),old.events);exact(archive.original,legacySnapshot(old));}
  }
}
module.exports={validatePlan,lockedState,preserved};
