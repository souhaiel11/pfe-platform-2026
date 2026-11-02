/** Logique de réconciliation des findings legacy : retrait sécurisé du flux moderne et réévaluation d'éligibilité à un fix automatique sur scan frais. */
import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { ManualRemediationTask } from './manual-remediation.entity';
import { Project } from '../projects/project.entity';
import { Incident } from '../incidents/incident.entity';
import { V1_8CompatibilityDecisionService } from '../dependency-compatibility/v1_8-compatibility-decision.service';
import { canDispatchSecurityRemediationV1_8 } from '../dependency-compatibility/v1_8-security-remediation-gate';
import { releaseTargetClaim } from './remediation-target-reservation';
import { LegacyRemoteSettlement } from './legacy-remote-settlement';
import { assertAuditedLegacy, legacyArchive, legacyCatalog, legacyDigest, legacySnapshot, LEGACY_RECONCILIATION_REASON } from './legacy-reconciliation';
@Injectable()
export class LegacyReconciliationService {
  /** Initialise les dépendances et l’état de ce composant. */
  constructor(private readonly db: DataSource, private readonly remote: LegacyRemoteSettlement) {}
  /** Vérifie que l'appelant est administrateur et que le flag de réconciliation legacy est explicitement activé. */
  private operator(user: any) {
    if (String(user?.role).toLowerCase() !== 'admin' || !user?.id) throw new ForbiddenException('Administrateur requis.');
    if (process.env.SECURITY_LEGACY_RECONCILIATION_ENABLED !== 'true') throw new NotFoundException();
  }
  /** Retourne les entrées auditées d'un groupe legacy, ou refuse si le groupe n'a jamais été audité. */
  private members(groupId: string) {
    const entries = Object.prototype.hasOwnProperty.call(legacyCatalog.groups, groupId) && legacyCatalog.groups[groupId];
    if (!entries) throw new ConflictException('LEGACY_GROUP_NOT_AUDITED');
    return entries;
  }
  /** Calcule l'empreinte stable d'un groupe entier (triée par taskId), pour détecter toute dérive du catalogue audité côté appelant. */
  groupDigest(groupId: string) {
    return legacyDigest(this.members(groupId).map(e => ({ taskId:e.taskId, digest:e.digest })).sort((a,b)=>a.taskId.localeCompare(b.taskId)));
  }
  /** Prépare le résultat lié à reconcile. */
  async reconcile(groupId: string, expectedGroupDigest: string, user: any) {
    this.operator(user);const entries=this.members(groupId), digest=this.groupDigest(groupId);
    if (digest !== expectedGroupDigest) throw new ConflictException('LEGACY_GROUP_DIGEST_MISMATCH');
    if (process.env.SECURITY_REMEDIATION_DISPATCH_ENABLED?.trim().toLowerCase() !== 'false') throw new ConflictException('LEGACY_RECONCILIATION_REQUIRES_DISPATCH_FREEZE');
    return this.db.transaction(async tx => {
      await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [entries[0].projectId+':FILE:pom.xml']);
      const repo=tx.getRepository(ManualRemediationTask), tasks:ManualRemediationTask[]=[];
      for (const entry of [...entries].sort((a,b)=>a.taskId.localeCompare(b.taskId))) {
        const t=await repo.findOne({where:{id:entry.taskId},lock:{mode:'pessimistic_write'}});
        if (!t) throw new ConflictException('LEGACY_GROUP_MEMBER_MISSING');tasks.push(t);
      }
      const archived=tasks.filter(t=>!!legacyArchive(t));
      if (archived.length) {
        if (archived.length !== tasks.length || tasks.some(t=>t.projectId !== entries.find(e=>e.taskId===t.id).projectId || t.source !== entries.find(e=>e.taskId===t.id).source || t.ruleOrCve !== entries.find(e=>e.taskId===t.id).cve || t.securityFindingRemediation !== null || t.securityRemediationBatchId !== null ||
            legacyArchive(t).groupDigest !== digest || legacyArchive(t).snapshotDigest !== entries.find(e=>e.taskId===t.id).digest ||
            legacyDigest(legacyArchive(t).original) !== legacyArchive(t).snapshotDigest)) throw new ConflictException('LEGACY_RECONCILIATION_REPLAY_CONFLICT');
        return { groupId, reconciled:0, idempotent:true };
      }
      const members=await tx.query(`SELECT id FROM manual_remediation_tasks WHERE "projectId"=$1 AND source IN ('TRIVY','OWASP')
        AND "securityFindingRemediation" IS NOT NULL AND COALESCE(NULLIF("securityFindingRemediation"->>'batchId',''),"securityRemediationBatchId",id::text)=$2`,[entries[0].projectId,groupId]);
      if (members.length!==tasks.length || members.some(m=>!entries.some(e=>e.taskId===m.id))) throw new ConflictException('LEGACY_GROUP_MEMBERSHIP_DRIFTED');
      for (const t of tasks) assertAuditedLegacy(t,groupId);
      const project=await tx.getRepository(Project).findOne({where:{id:entries[0].projectId}});
      if (project?.githubRepo !== legacyCatalog.repository) throw new ConflictException('LEGACY_REPOSITORY_BINDING_DRIFTED');
      const settlement=await this.remote.verify(groupId,digest,String(user.id));
      const table=(await tx.query("SELECT to_regclass('public.remediation_target_reservations') AS name"))[0].name;
      if (table) {
        const reservations=await tx.query(`SELECT * FROM remediation_target_reservations WHERE "projectId"=$1 AND state='ACTIVE' FOR UPDATE`,[entries[0].projectId]);
        for (const r of reservations) for (const t of tasks) {
          const claim=r.claims?.[t.id];
          if (claim && (claim.attemptId != null || ![null,t.securityFindingRemediation.batchId].includes(claim.batchId) || claim.status==='DISPATCHING'))
            throw new ConflictException('LEGACY_TARGET_CLAIM_AMBIGUOUS');
        }
      }
      for (const t of tasks) {
        const original=legacySnapshot(t);const at=new Date().toISOString();
        t.events=[...(t.events||[]),{at,actorId:String(user.id),actorDisplayName:'Administrateur',oldStatus:t.status,newStatus:t.status,
          reason:LEGACY_RECONCILIATION_REASON,buildNumber:null,legacyReconciliation:{action:'RETIRE',groupId,groupDigest:digest,snapshotDigest:legacyDigest(original),original,
            retiredAt:at,scanAtRetirement:{incidentId:t.incidentId,lastSeenBuild:t.lastSeenBuild??null},disposition:groupId==='c8fb2207-c8de-40af-acd4-1d2f96896715'?'KEEP_PR_37_HISTORICAL_REFERENCE':'RETIRED_LEGACY_REFERENCE',settlement}}];
        if (table) await releaseTargetClaim(tx,t,LEGACY_RECONCILIATION_REASON);
        t.securityFindingRemediation=null;t.securityRemediationBatchId=null;
        await repo.update(t.id,{events:t.events,securityFindingRemediation:null,securityRemediationBatchId:null,updatedAt:t.updatedAt});
      }
      return { groupId,reconciled:tasks.length,idempotent:false };
    });
  }
  /** Recharge une tâche archivée et réévalue si elle est éligible à un fix automatique moderne, à partir d'un scan frais postérieur à son archivage. */
  private async evaluate(tx:EntityManager,groupId:string,taskId:string,expectedArchiveDigest:string) {
    if (!this.members(groupId).some(e=>e.taskId===taskId)) throw new ConflictException('LEGACY_TASK_GROUP_MISMATCH');
    const task=await tx.getRepository(ManualRemediationTask).findOne({where:{id:taskId},lock:{mode:'pessimistic_write'}});
    const archive=task && legacyArchive(task);
    if (!archive || archive.snapshotDigest!==expectedArchiveDigest || archive.groupId!==groupId || task.securityFindingRemediation!==null ||
        task.securityRemediationBatchId!==null || !['TODO','REOPENED'].includes(task.status) || task.scannerStatus!=='DETECTED') throw new ConflictException('LEGACY_ARCHIVE_NOT_CURRENT');
    const project=await tx.getRepository(Project).findOne({where:{id:task.projectId}});
    const incident=task.incidentId && await tx.getRepository(Incident).findOne({where:{id:task.incidentId}});
    const commitSha=String(incident?.metadata?.sourceCommitSha || '');
    if (!project?.githubRepo || !incident || incident.projectId!==task.projectId || !/^[a-f0-9]{40}$/i.test(commitSha)) throw new ConflictException('FRESH_SCAN_BINDING_REQUIRED');
    const f=task.findingSnapshot;
    const evidence=new V1_8CompatibilityDecisionService().lookup(task.source,task.ruleOrCve,f.component,f.currentVersion);
    const gate=canDispatchSecurityRemediationV1_8({repository:project.githubRepo,commitSha,source:task.source,cve:task.ruleOrCve,component:f.component,installedVersion:f.currentVersion,statusPermitsDispatch:true},evidence);
    const freshScan = task.incidentId !== archive.scanAtRetirement?.incidentId && Number.isFinite(Date.parse(String(incident.createdAt))) && new Date(incident.createdAt).getTime() > Date.parse(archive.retiredAt) && new Date(incident.createdAt).getTime() <= Date.now();
    return {task,archive,gate: freshScan ? gate : {...gate,decision:'BLOCK' as const,reason:'FRESH_POST_RECONCILIATION_SCAN_REQUIRED'},commitSha};
  }
  /** Évalue l'éligibilité d'une tâche legacy à la réadmission moderne ; si `authorize` est vrai et le résultat ALLOW, écrit une autorisation valable 10 minutes. */
  async eligibility(groupId:string,taskId:string,expectedArchiveDigest:string,user:any,authorize=false) {
    this.operator(user);
    return this.db.transaction(async tx=>{
      const {task,archive,gate,commitSha}=await this.evaluate(tx,groupId,taskId,expectedArchiveDigest);
      if (authorize) {
        if (gate.decision!=='ALLOW') throw new ConflictException('FRESH_MODERN_ELIGIBILITY_NOT_ALLOWED');
        task.events=[...task.events,{at:new Date().toISOString(),actorId:String(user.id),actorDisplayName:'Administrateur',oldStatus:task.status,newStatus:task.status,
          reason:LEGACY_RECONCILIATION_REASON,buildNumber:null,legacyReconciliation:{action:'AUTHORIZE_MODERN',archiveDigest:archive.snapshotDigest,sourceCommitSha:commitSha,sourceIncidentId:task.incidentId,
            expiresAt:new Date(Date.now()+10*60_000).toISOString()}}];
        await tx.getRepository(ManualRemediationTask).save(task);
      }
      return {taskId,evaluable:true,decision:gate.decision,reason:gate.reason,sourceCommitSha:commitSha,authorized:authorize};
    });
  }
}
