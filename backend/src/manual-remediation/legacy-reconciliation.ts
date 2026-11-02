// Regroupe les traitements de ancien réconciliation.
import { auditedLegacyCatalog } from './legacy-reconciliation-catalog';
import { ConflictException } from '@nestjs/common';
import { createHash } from 'crypto';
export const LEGACY_RECONCILIATION_REASON = 'LEGACY_SINGLE_WRITER_RECONCILIATION';
export const legacyCatalog: { repository: string; targetFile: string; remoteReferences: {prNumber:number;branch:string;headSha:string}[]; groups: Record<string, {taskId:string;projectId:string;source:string;cve:string;digest:string}[]> } = auditedLegacyCatalog;
/** Sérialise une valeur de façon déterministe (clés d'objet triées) pour que deux objets équivalents produisent le même JSON, quel que soit l'ordre des clés. */
function canonical(value: any): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
/** Empreinte SHA-256 d'une valeur canonicalisée — utilisée pour vérifier qu'une tâche legacy n'a pas changé depuis l'audit. */
export const legacyDigest = (value: any) => createHash('sha256').update(canonical(value)).digest('hex');
/** Extrait le sous-ensemble d'une tâche à inclure dans l'empreinte d'audit (remédiation + batch). */
export const legacySnapshot = (task: any) => ({ remediation: task.securityFindingRemediation, batchId: task.securityRemediationBatchId ?? null });
/** Retrouve, dans l'historique d'une tâche, le dernier événement d'archivage legacy (action RETIRE), s'il existe. */
export function legacyArchive(task: any): any {
  return (task.events || []).find((e: any) => e.reason === LEGACY_RECONCILIATION_REASON && e.legacyReconciliation?.action === 'RETIRE')?.legacyReconciliation;
}
/** Vérifie qu'une tâche correspond EXACTEMENT à l'entrée auditée du catalogue legacy (identité, statut, empreinte) ; lève une exception sinon. */
export function assertAuditedLegacy(task: any, groupId: string): void {
  const expected = legacyCatalog.groups[groupId]?.find(e => e.taskId === task.id);
  const r = task.securityFindingRemediation;
  // Exact audited historical fingerprint, not absence of modern identifiers.
  // Any deviation, partial v2 identity or unrecognised row must stop.
  if (!expected || task.projectId !== expected.projectId || task.source !== expected.source || task.ruleOrCve !== expected.cve ||
      !['TODO','REOPENED'].includes(task.status) || task.scannerStatus !== 'DETECTED' ||
      !r || !Array.isArray(r.attempts) || !r.attempts.length || r.status === 'DISPATCHING' ||
      r.attemptId != null || r.attemptNumber != null || r.contractVersion != null ||
      r.attempts.some((a: any) => !a || !Number.isInteger(a.attempt) || !a.at || a.attemptId != null || a.attemptNumber != null || a.contractVersion != null) ||
      legacyDigest(legacySnapshot(task)) !== expected.digest) throw new ConflictException('LEGACY_ROW_NOT_AUDITED_OR_CORRUPTED');
}
/** Vérifie qu'une tâche archivée legacy a été ré-autorisée explicitement (et pas expirée) avant de la réadmettre dans le flux moderne. */
export function assertLegacyReadmission(task: any, sourceCommitSha?: string): void {
  const archive = legacyArchive(task);
  if (!archive) return;
  const authorization = [...(task.events || [])].reverse().find((e: any) => e.reason === LEGACY_RECONCILIATION_REASON && e.legacyReconciliation?.action === 'AUTHORIZE_MODERN');
  const a = authorization?.legacyReconciliation;
  if (!a || a.archiveDigest !== archive.snapshotDigest || a.sourceIncidentId !== task.incidentId || !Number.isFinite(Date.parse(a.expiresAt)) || Date.parse(a.expiresAt) <= Date.now() ||
      (sourceCommitSha && a.sourceCommitSha !== sourceCommitSha)) throw new ConflictException('LEGACY_MODERN_READMISSION_REQUIRES_FRESH_AUTHORIZATION');
}
