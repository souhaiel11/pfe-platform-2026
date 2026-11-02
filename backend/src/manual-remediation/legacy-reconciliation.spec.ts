// Teste le composant « legacy-reconciliation » et ses cas d’erreur.
import 'reflect-metadata';
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { assertAuditedLegacy, assertLegacyReadmission, legacyDigest, LEGACY_RECONCILIATION_REASON, legacyCatalog } from './legacy-reconciliation';
import { LegacyRemoteSettlement } from './legacy-remote-settlement';

test('missing identity, guessed historical shape and modern corruption do not establish audited legacy identity',()=>{
  const [group,entries]=Object.entries(legacyCatalog.groups)[0];const e=entries[0];
  const task:any={id:e.taskId,projectId:e.projectId,source:e.source,ruleOrCve:e.cve,status:'TODO',scannerStatus:'DETECTED',securityRemediationBatchId:group,
    securityFindingRemediation:{status:'CLOSED',attemptCount:1,attempts:[{attempt:1,at:'2026-09-30T00:00:00Z',status:'CLOSED'}]}};
  for (const extra of [{},{contractVersion:2},{attemptNumber:1},{attemptId:'modern'}, {batchId:undefined}]) assert.throws(()=>assertAuditedLegacy({...task,securityFindingRemediation:{...task.securityFindingRemediation,...extra}},group));
  assert.throws(()=>assertAuditedLegacy(task,'__proto__'));
});
test('canonical historical digest is independent of object key order and sensitive to counters',()=>{
  assert.equal(legacyDigest({b:2,a:{c:3}}),legacyDigest({a:{c:3},b:2}));assert.notEqual(legacyDigest({attemptCount:6}),legacyDigest({attemptCount:3}));
});
test('modern rows retain their admission behavior; archived rows require bounded explicit scan-bound authorization',()=>{
  assert.doesNotThrow(()=>assertLegacyReadmission({events:[]}));
  const retirement={reason:LEGACY_RECONCILIATION_REASON,legacyReconciliation:{action:'RETIRE',snapshotDigest:'archive'}};
  const task:any={events:[retirement]};assert.throws(()=>assertLegacyReadmission(task));
  const authorization={reason:LEGACY_RECONCILIATION_REASON,legacyReconciliation:{action:'AUTHORIZE_MODERN',archiveDigest:'archive',sourceCommitSha:'a'.repeat(40),expiresAt:new Date(Date.now()+60000).toISOString()}};
  task.events.push(authorization);assert.doesNotThrow(()=>assertLegacyReadmission(task,'a'.repeat(40)));assert.throws(()=>assertLegacyReadmission(task,'b'.repeat(40)));
  for(const expiry of ['bad-date','1970-01-01T00:00:00Z']){authorization.legacyReconciliation.expiresAt=expiry;assert.throws(()=>assertLegacyReadmission(task));}
});
test('remote retirement requires a server-owned settlement receipt, never just an operator request',async()=>{
  const old=process.env.SECURITY_LEGACY_SETTLEMENT_RECEIPTS_FILE;delete process.env.SECURITY_LEGACY_SETTLEMENT_RECEIPTS_FILE;
  try{await assert.rejects(()=>new LegacyRemoteSettlement().verify('group','digest','admin'),/LEGACY_OPERATOR_SETTLEMENT_RECEIPT_REQUIRED/);}finally{if(old!==undefined)process.env.SECURITY_LEGACY_SETTLEMENT_RECEIPTS_FILE=old;}
});
