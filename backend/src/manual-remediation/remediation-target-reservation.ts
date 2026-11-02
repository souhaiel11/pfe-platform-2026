/** Gère la réservation exclusive d'un fichier cible (typiquement pom.xml) pendant une remédiation, pour empêcher deux corrections concurrentes de toucher le même fichier. */
import { ConflictException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { randomUUID } from 'crypto';

export interface RemediationTargetKey {
  projectId: string;
  targetFile: string;
  dependencyCoordinate: string;
  lockGranularity: 'FILE';
  targetKey: string;
}
/** Valide un chemin de fichier cible (pas de `..`, pas de `.git`, caractères autorisés) et le renvoie inchangé — refuse plutôt que de le corriger silencieusement. */
export function normalizeTargetFile(value: string): string {
  if (typeof value !== 'string' || value.length > 512 || !/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(value) ||
      value.split('/').some(s => s === '.' || s === '..' || s.toLowerCase() === '.git')) {
    throw new ConflictException('REMEDIATION_TARGET_PATH_INVALID');
  }
  return value;
}
/** Construit la clé canonique de verrouillage d'un fichier cible (projet + fichier), après avoir validé le format de chaque composant. */
export function canonicalTarget(projectId: string, targetFile: string, component: string): RemediationTargetKey {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(projectId)) throw new ConflictException('REMEDIATION_TARGET_PROJECT_INVALID');
  if (!/^[A-Za-z0-9_.-]+:[A-Za-z0-9_.-]+$/.test(component)) throw new ConflictException('REMEDIATION_TARGET_COORDINATE_INVALID');
  const file = normalizeTargetFile(targetFile);
  return { projectId: projectId.toLowerCase(), targetFile: file, dependencyCoordinate: component,
    lockGranularity: 'FILE', targetKey: JSON.stringify(['v1', 'FILE', file]) };
}
/** Dérive la clé de réservation pour une tâche réelle — fige aujourd'hui sur `pom.xml` racine. */
export function productionTarget(task: any): RemediationTargetKey {
  return canonicalTarget(task.projectId, 'pom.xml', task.findingSnapshot.component);
}
/** Réserve (ou rejoint une réservation déjà active compatible) un fichier cible pour un ensemble de tâches, afin qu'aucune autre remédiation ne touche le même fichier en parallèle. */
export async function reserveTarget(tx: EntityManager, key: RemediationTargetKey, taskIds: string[]) {
  const claims = Object.fromEntries(taskIds.map(id => [id, { attemptId: null, batchId: null, status: 'RESERVED' }]));
  await tx.query(`INSERT INTO remediation_target_reservations
    (id,"projectId","targetKey","targetFile","ownerTaskId",claims,state)
    VALUES ($1,$2,$3,$4,$5,$6::jsonb,'ACTIVE')
    ON CONFLICT ("projectId","targetKey") WHERE state = 'ACTIVE' DO NOTHING`,
    [randomUUID(), key.projectId, key.targetKey, key.targetFile, taskIds[0], JSON.stringify(claims)]);
  const [reservation] = await tx.query(`SELECT * FROM remediation_target_reservations
    WHERE "projectId"=$1 AND "targetKey"=$2 AND state='ACTIVE' FOR UPDATE`, [key.projectId, key.targetKey]);
  if (!reservation || taskIds.some(id => !Object.prototype.hasOwnProperty.call(reservation.claims, id)) ||
      Object.entries(reservation.claims).some(([id, claim]: [string, any]) =>
        !taskIds.includes(id) && claim.status !== 'WAITING_RETRY')) {
    // DEUX situations très différentes partageaient ce même refus, et les
    // confondre a réellement induit en erreur : dire « examinez la correction
    // existante » n'aide pas quand il n'y a RIEN à examiner, parce que la
    // réservation a survécu à une remédiation déjà TERMINÉE en échec. La
    // tâche propriétaire est alors repassée à TODO et n'apparaît nulle part
    // comme « en cours » -- le développeur cherche une correction qui
    // n'existe plus. On distingue donc explicitement les deux cas.
    const blocking = Object.entries((reservation?.claims ?? {}) as Record<string, any>)
      .filter(([id, claim]) => !taskIds.includes(id) && claim?.status !== 'WAITING_RETRY')
      .map(([id, claim]) => ({ taskId: id, status: String(claim?.status ?? 'UNKNOWN') }));
    // `QUARANTINED` est posé par settleTargetClaim() à la FIN d'une tentative
    // qui ne peut ni être reprise automatiquement ni libérer sa cible : plus
    // aucune remédiation ne tourne, et seule une libération par un
    // administrateur (POST /manual-remediation/:id/abandon-target) débloque
    // le fichier. L'ancien code/message est conservé à l'identique pour le
    // cas d'une correction RÉELLEMENT en cours : aucun consommateur existant
    // n'est affecté.
    const quarantinedOnly = blocking.length > 0 && blocking.every(b => b.status === 'QUARANTINED');
    // Troisième cas, à ne pas confondre avec un échec : la tentative a RÉUSSI et sa Pull Request
    // attend d'être fusionnée. Le fichier se libère par « Merge effectué » (confirm-merge).
    // Mêmes règles et même formulation que le verrou Sonar (incidents/sonar-file-reservation.ts) : le refus nomme
    // le fichier, la PR qui le tient et ses CVE, et dit quoi faire. Une PR réutilisée (PR_REUSED) n'enregistre que
    // son URL : le numéro en est déduit, sinon ce cas retombait à tort sur le message d'échec ci-dessous.
    let holders: { taskId: string; status: string; prNumber: number; label: string }[] = [];
    try {
      const rows: any[] = await tx.query(`SELECT id, "ruleOrCve" AS cve, "findingSnapshot"->>'component' AS component,
          "securityFindingRemediation"->>'status' AS status, "securityFindingRemediation"->>'prNumber' AS pr, "securityFindingRemediation"->>'prUrl' AS url
        FROM manual_remediation_tasks WHERE id = ANY($1::uuid[])`, [blocking.map(b => b.taskId)]);
      holders = (rows || []).map(r => ({ taskId: r.id, status: String(r.status || ''),
        prNumber: Number(r.pr) > 0 ? Number(r.pr) : Number((String(r.url || '').match(/\/pull\/(\d+)\/?$/) || [])[1]) || 0,
        label: `${String(r.component || '').split(':')[1] || r.component} ${r.cve || ''}`.trim() }));
    } catch { holders = []; }
    const labels = holders.map(h => h.label).filter(Boolean).join(', ');
    const pendingPrs = holders.filter(h => h.status === 'CANDIDATE_READY' && h.prNumber > 0).map(h => ({ taskId: h.taskId, prNumber: h.prNumber }));
    if (quarantinedOnly && pendingPrs.length === blocking.length) {
      const prs = [...new Set(pendingPrs.map(p => `#${p.prNumber}`))].join(', ');
      throw new ConflictException({ code: 'REMEDIATION_TARGET_PR_PENDING_MERGE', status: 'TARGET_PR_PENDING',
        message: `Le fichier ${key.targetFile} est déjà modifié par la Pull Request ${prs}${labels ? ` (${labels})` : ''}, pas encore fusionnée. `
          + `Fusionnez-la sur GitHub puis cliquez « Merge effectué — libérer ${key.targetFile} » pour lancer cette correction. Aucune nouvelle correction n’a été lancée.`,
        targetKey: key.targetKey, targetFile: key.targetFile, blocking, pendingPullRequests: pendingPrs });
    }
    throw new ConflictException(quarantinedOnly
      ? { code: 'REMEDIATION_TARGET_BLOCKED_BY_FAILED_REMEDIATION', status: 'TARGET_QUARANTINED',
          message: 'Aucune correction n’est en cours : une tentative précédente a échoué et garde ce fichier de dépendances réservé.',
          targetKey: key.targetKey, targetFile: key.targetFile, blocking }
      : { code: 'REMEDIATION_TARGET_ALREADY_IN_PROGRESS', status: 'TARGET_BUSY',
          message: `Le fichier ${key.targetFile} est déjà en cours de correction${labels ? ` (${labels})` : ''}. `
            + 'Attendez la fin de cette correction et la création de sa Pull Request. Aucune nouvelle correction n’a été lancée.',
          targetKey: key.targetKey, targetFile: key.targetFile, blocking });
  }
  return reservation.id as string;
}
/** Associe une tentative de remédiation concrète (attemptId/batchId) à la réservation d'un fichier, en passant son état à DISPATCHING. */
export async function bindTargetAttempt(tx: EntityManager, reservationId: string, task: any) {
  const r = task.securityFindingRemediation;
  await tx.query(`UPDATE remediation_target_reservations SET
    claims=jsonb_set(claims,ARRAY[$2::text],$3::jsonb),"ownerTaskId"=$2::uuid,"ownerAttemptId"=$4,"ownerBatchId"=$5,"updatedAt"=now()
    WHERE id=$1 AND state='ACTIVE' AND claims ? $2`,
    [reservationId, task.id, JSON.stringify({ attemptId: r.attemptId, batchId: r.batchId, status: 'DISPATCHING' }), r.attemptId, r.batchId]);
}
/** Libère la part d'une tâche dans une réservation de fichier ; si c'était la dernière revendication active, marque la réservation entière RELEASED. */
export async function releaseTargetClaim(tx: EntityManager, task: any, reason: string) {
  await tx.query(`UPDATE remediation_target_reservations SET claims=claims - $1,
    state=CASE WHEN claims - $1 = '{}'::jsonb THEN 'RELEASED' ELSE 'ACTIVE' END,
    "releasedAt"=CASE WHEN claims - $1 = '{}'::jsonb THEN now() ELSE NULL END,
    "ownerTaskId"=COALESCE((SELECT key::uuid FROM jsonb_each(claims - $1) ORDER BY key LIMIT 1),"ownerTaskId"),
    "ownerAttemptId"=CASE WHEN claims - $1 = '{}'::jsonb THEN "ownerAttemptId" ELSE
      (SELECT NULLIF(value->>'attemptId','')::uuid FROM jsonb_each(claims - $1) ORDER BY key LIMIT 1) END,
    "ownerBatchId"=CASE WHEN claims - $1 = '{}'::jsonb THEN "ownerBatchId" ELSE
      (SELECT value->>'batchId' FROM jsonb_each(claims - $1) ORDER BY key LIMIT 1) END,
    "releaseReason"=$2,"updatedAt"=now()
    WHERE "projectId"=$3 AND state='ACTIVE' AND claims ? $1`, [task.id, reason, task.projectId]);
}
const preGitFinalFailures = new Set(['APPLICATION_TESTS_FAILED','APPLICATION_TESTS_NOT_EXECUTED',
  'MAVEN_RESOLUTION_MISMATCH','TARGET_CVE_STILL_OPEN_AFTER_PATCH','TARGET_CVE_NEVER_OBSERVED_IN_BASELINE',
  'INVALID_CANDIDATE','MAVEN_MUTATED_CANDIDATE_SOURCE',
  // Échecs de TRANSPORT entre le backend et son propre worker interne, ou du
  // runtime de ce worker. Ajoutés après un blocage réel : une cible restait
  // en quarantaine DÉFINITIVE sans aucune voie de récupération supportée
  // (`abandon-target` refusait « issue distante incertaine », et
  // `reconcile-stale-dispatch` ne couvre que les batchs restés DISPATCHING).
  //
  // Pourquoi c'est sûr, et pourquoi ce n'est PAS un affaiblissement :
  //  - Tous les sites d'émission de ces deux codes sont antérieurs à la
  //    phase d'écriture : soit un `fetch()` backend -> candidate-verifier qui
  //    n'aboutit pas (candidate-verification.service.ts), soit la conversion
  //    d'une ArtifactRuntimeError du worker en failureClass
  //    (security-remediation-orchestrator.service.ts). Dans les deux cas
  //    aucun candidat n'existe, donc aucune branche ni PR n'a pu être écrite.
  //  - La protection contre un effet Git NE REPOSE PAS sur cet ensemble :
  //    elle est assurée par assertNoSideEffect() (security-remediation-
  //    lifecycle.ts), un contrôle INDÉPENDANT qui inspecte prUrl/prNumber/
  //    branchName/unresolvedGitSideEffect sur la tentative courante ET tout
  //    l'historique, et qui s'exécute AVANT cette classification dans
  //    abandonTarget(). Il reste inchangé.
  //  - Depuis le 2026-10-25, ces codes figurent aussi dans `temporary`
  //    (security-remediation-lifecycle.ts) : ils sont réessayables, mais
  //    uniquement par le bouton Réessayer (aucune boucle de reprise), borné par
  //    assertNoSideEffect() et MAX_AUTOMATIC_ATTEMPTS. Tant qu'un réessai est
  //    possible, la cible reste réservée (WAITING_RETRY) ; abandon-target la libère.
  'VERIFIER_UNAVAILABLE','VERIFIER_PROTOCOL_ERROR']);
/** Vrai seulement si l'échec d'une tentative est survenu avant toute écriture Git — alors la libération du fichier cible est sans risque. */
// Statuts terminaux rendus par l'ÉVALUATION du candidat (candidate-verifier), donc toujours avant toute
// écriture Git. Ajoutés le 2026-10-25 : un refus attendu (ex. NOT_ELIGIBLE / CROSS_MAJOR_ONLY) laissait
// pom.xml en quarantaine et bloquait toutes les corrections suivantes du fichier. Un effet Git éventuel
// reste détecté en amont par settleTargetClaim() (prUrl/branchName/unresolvedGitSideEffect), qui prime.
// ALREADY_MERGED (ajouté le 2026-10-27) : WF6 a retrouvé la PR déjà FUSIONNÉE de ce même correctif et n'a rien
// écrit de nouveau ; rien n'attend de merge, donc la quarantaine bloquait pom.xml sans raison.
const preGitEvaluationStatuses = new Set(['ALREADY_MERGED', 'NOT_ELIGIBLE', 'GROUNDING_FAILED', 'REMEDIATION_SCOPE_UNPROVEN',
  'CANDIDATE_BUILD_FAILED', 'CANDIDATE_SECURITY_VALIDATION_FAILED', 'MAVEN_RESOLUTION_FAILED', 'WORKSPACE_FAILURE']);
export function safeTerminalTargetRelease(r: any): boolean {
  return r.status === 'OPERATOR_TEST_STOPPED' || preGitEvaluationStatuses.has(String(r.status || ''))
    || preGitFinalFailures.has(String(r.reasonCode || '').split(':')[0]);
}
/** Décide, à la fin d'une tentative, si la réservation du fichier doit être libérée, mise en quarantaine, ou laissée en attente de retry. */
export async function settleTargetClaim(tx: EntityManager, task: any) {
  const r = task.securityFindingRemediation;
  if (!r) return;
  const effects = r.unresolvedGitSideEffect || r.prUrl || r.prNumber || r.branchName ||
    (r.attempts || []).some((a: any) => a.unresolvedGitSideEffect || a.prUrl || a.prNumber || a.branchName);
  if (effects || r.retryable || ['DISPATCHING','CANDIDATE_READY','CLOSED','PROJECT_VERIFIED'].includes(r.status) || !r.finishedAt || !safeTerminalTargetRelease(r)) {
    const status = effects || (!r.retryable && !safeTerminalTargetRelease(r)) ? 'QUARANTINED' : r.retryable ? 'WAITING_RETRY' : r.status;
    await tx.query(`UPDATE remediation_target_reservations SET
      claims=jsonb_set(claims,ARRAY[$1::text,'status'],to_jsonb($2::text)),"updatedAt"=now()
      WHERE "projectId"=$3 AND state='ACTIVE' AND claims ? $1`, [task.id, status, task.projectId]);
    return;
  }
  await releaseTargetClaim(tx, task, r.status);
}
