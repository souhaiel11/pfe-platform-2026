/** Verrou de fichier des corrections SonarQube (WF2) : un fichier source modifié par une Pull Request de correction non fusionnée ne peut pas être repris par une autre correction tant que « Merge effectué » ne l'a pas libéré. */
// Même table et même clé canonique que le verrou de pom.xml (WF6) : un fichier
// n'a qu'une réservation ACTIVE par projet, quel que soit le workflow. Ici la
// revendication est portée par l'identifiant de l'incident (une seule demande
// de correction active par incident), là où WF6 utilise l'identifiant de tâche.
import { ConflictException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { randomUUID } from 'crypto';
import { normalizeTargetFile, releaseTargetClaim } from '../manual-remediation/remediation-target-reservation';
import { isPostWriteFailureNode } from './post-write-recovery';

/** Ce que l'on sait du détenteur d'une réservation, pour décider s'il bloque encore le fichier. */
export interface SonarFileHolder {
  kind: 'INCIDENT' | 'SECURITY_TASK' | 'ORPHAN';
  needsFiles: boolean;
  title?: string | null;
  prNumber?: number | null;
  prUrl?: string | null;
}

export interface SonarFileBlocker extends SonarFileHolder {
  file: string;
  holderId: string;
}

/** Statuts d'une demande de correction qui tiennent encore leurs fichiers (correction en cours ou PR ouverte). */
const ACTIVE_FIX_STATUSES = ['APPROVAL_REQUESTED', 'FIX_STARTING', 'DISPATCHED', 'PR_CREATED', 'VALIDATING', 'VALIDATED', 'CANCEL_REQUESTED'];

/** Clé canonique d'un fichier, identique à celle de WF6 (canonicalTarget). */
function fileKey(file: string): string {
  return JSON.stringify(['v1', 'FILE', file]);
}

/** Ramène le chemin d'un constat Sonar (`fichier` ou composant `cle:chemin`) au chemin relatif du dépôt, ou null s'il n'est pas exploitable. */
export function sonarTargetFile(value: unknown): string | null {
  let raw = String(value ?? '').trim();
  const colon = raw.indexOf(':');
  if (colon > 0 && !raw.slice(0, colon).includes('/')) raw = raw.slice(colon + 1);
  raw = raw.replace(/^\.\//, '');
  if (!raw) return null;
  try { return normalizeTargetFile(raw); } catch { return null; }
}

/** Liste triée et dédoublonnée des fichiers exploitables. */
export function sonarTargetFiles(values: unknown[]): string[] {
  return [...new Set((values || []).map(sonarTargetFile).filter((file): file is string => !!file))].sort();
}

/** Vrai tant que la demande de correction d'un incident doit garder ses fichiers : correction en cours, PR ouverte, ou écriture Git possible. */
export function fixRequestHoldsFiles(fix: any): boolean {
  if (!fix || fix.workflow !== 'WF2') return false;
  if (fix.fileLock?.releasedAt) return false;
  if (fix.prUrl || fix.prNumber || fix.branchName || fix.postWriteRecovery) return true;
  if (fix.status === 'FIX_FAILED' && isPostWriteFailureNode(fix.failedNode)) return true;
  return ACTIVE_FIX_STATUSES.includes(String(fix.status || ''));
}

/** Message affiché quand un fichier est déjà réservé par une autre correction. */
export function sonarFileConflict(blocking: SonarFileBlocker[]): ConflictException {
  const files = [...new Set(blocking.map(b => b.file))];
  const withPr = blocking.filter(b => b.prNumber);
  const owner = (b: SonarFileBlocker) => b.kind === 'INCIDENT' && b.title ? ` (incident « ${b.title} »)` : '';
  if (withPr.length === blocking.length) {
    const prs = [...new Set(withPr.map(b => `#${b.prNumber}`))].join(', ');
    return new ConflictException({
      code: 'SONAR_FILE_PR_PENDING_MERGE', status: 'TARGET_PR_PENDING',
      message: `${files.length > 1 ? 'Les fichiers' : 'Le fichier'} ${files.join(', ')} ${files.length > 1 ? 'sont déjà modifiés' : 'est déjà modifié'} par la Pull Request ${prs}${owner(withPr[0])}, pas encore fusionnée. `
        + 'Fusionnez-la sur GitHub puis cliquez « Merge effectué — libérer les fichiers » dans son incident pour lancer cette correction. Aucune nouvelle correction n’a été lancée.',
      files, blocking,
    });
  }
  return new ConflictException({
    code: 'SONAR_FILE_ALREADY_IN_PROGRESS', status: 'TARGET_BUSY',
    message: `${files.length > 1 ? 'Les fichiers' : 'Le fichier'} ${files.join(', ')} ${files.length > 1 ? 'sont déjà en cours' : 'est déjà en cours'} de correction${owner(blocking[0])}. `
      + 'Attendez sa Pull Request puis sa fusion avant de lancer cette correction. Aucune nouvelle correction n’a été lancée.',
    files, blocking,
  });
}

/** Réserve tous les fichiers d'un lot pour un incident, ou refuse si l'un d'eux est tenu par une autre correction encore active ; les réservations d'incidents terminés sans PR sont libérées au passage. */
export async function reserveSonarFiles(
  tx: EntityManager,
  input: { projectId: string; incidentId: string; batchId: string; files: string[] },
  describeHolder: (holderId: string) => Promise<SonarFileHolder>,
): Promise<string[]> {
  const files = sonarTargetFiles(input.files);
  const blocking: SonarFileBlocker[] = [];
  for (const file of files) {
    const [row] = await tx.query(`SELECT claims FROM remediation_target_reservations
      WHERE "projectId"=$1 AND "targetKey"=$2 AND state='ACTIVE' FOR UPDATE`, [input.projectId, fileKey(file)]);
    for (const holderId of Object.keys(row?.claims || {})) {
      if (holderId === input.incidentId) continue;
      const holder = await describeHolder(holderId);
      if (!holder.needsFiles) {
        await releaseTargetClaim(tx, { id: holderId, projectId: input.projectId }, `SONAR_HOLDER_INACTIVE:${holder.kind}`);
        continue;
      }
      blocking.push({ ...holder, file, holderId });
    }
  }
  if (blocking.length) throw sonarFileConflict(blocking);

  const claim = JSON.stringify({ attemptId: null, batchId: input.batchId, status: 'RESERVED', workflow: 'WF2' });
  for (const file of files) {
    await tx.query(`INSERT INTO remediation_target_reservations
      (id,"projectId","targetKey","targetFile","ownerTaskId","ownerBatchId",claims,state)
      VALUES ($1,$2,$3,$4,$5::uuid,$6,jsonb_build_object($8::text,$7::jsonb),'ACTIVE')
      ON CONFLICT ("projectId","targetKey") WHERE state = 'ACTIVE' DO NOTHING`,
      [randomUUID(), input.projectId, fileKey(file), file, input.incidentId, input.batchId, claim, input.incidentId]);
    const [row] = await tx.query(`SELECT id, claims FROM remediation_target_reservations
      WHERE "projectId"=$1 AND "targetKey"=$2 AND state='ACTIVE' FOR UPDATE`, [input.projectId, fileKey(file)]);
    // Une autre approbation a pris le fichier entre les deux lectures : même refus que ci-dessus.
    const others = Object.keys(row?.claims || {}).filter(id => id !== input.incidentId);
    if (others.length) {
      throw sonarFileConflict(await Promise.all(others.map(async holderId => ({ ...(await describeHolder(holderId)), file, holderId }))));
    }
    if (!Object.prototype.hasOwnProperty.call(row.claims, input.incidentId)) {
      await tx.query(`UPDATE remediation_target_reservations SET claims=claims || jsonb_build_object($2::text,$3::jsonb),"updatedAt"=now()
        WHERE id=$1 AND state='ACTIVE'`, [row.id, input.incidentId, claim]);
    }
  }
  return files;
}

/** Étend la réservation d'un incident aux fichiers réellement modifiés par sa PR (sans jamais refuser : la PR existe déjà) ; renvoie les fichiers déjà tenus par une autre correction. */
export async function extendSonarFiles(
  tx: EntityManager,
  input: { projectId: string; incidentId: string; batchId: string; files: string[] },
): Promise<{ files: string[]; contested: string[] }> {
  const claim = JSON.stringify({ attemptId: null, batchId: input.batchId, status: 'PR_OPEN', workflow: 'WF2' });
  const held: string[] = [];
  const contested: string[] = [];
  for (const file of sonarTargetFiles(input.files)) {
    await tx.query(`INSERT INTO remediation_target_reservations
      (id,"projectId","targetKey","targetFile","ownerTaskId","ownerBatchId",claims,state)
      VALUES ($1,$2,$3,$4,$5::uuid,$6,jsonb_build_object($8::text,$7::jsonb),'ACTIVE')
      ON CONFLICT ("projectId","targetKey") WHERE state = 'ACTIVE' DO NOTHING`,
      [randomUUID(), input.projectId, fileKey(file), file, input.incidentId, input.batchId, claim, input.incidentId]);
    const [row] = await tx.query(`SELECT id, claims FROM remediation_target_reservations
      WHERE "projectId"=$1 AND "targetKey"=$2 AND state='ACTIVE' FOR UPDATE`, [input.projectId, fileKey(file)]);
    if (Object.keys(row?.claims || {}).some(id => id !== input.incidentId)) { contested.push(file); continue; }
    await tx.query(`UPDATE remediation_target_reservations SET claims=claims || jsonb_build_object($2::text,$3::jsonb),"updatedAt"=now()
      WHERE id=$1 AND state='ACTIVE'`, [row.id, input.incidentId, claim]);
    held.push(file);
  }
  return { files: held, contested };
}

/** Libère tous les fichiers réservés par un incident (merge constaté, PR fermée, ou nouvelle sélection). */
export async function releaseSonarFiles(tx: EntityManager, projectId: string, incidentId: string, reason: string): Promise<void> {
  await releaseTargetClaim(tx, { id: incidentId, projectId }, reason);
}
