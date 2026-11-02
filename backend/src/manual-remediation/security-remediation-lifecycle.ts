/** Modélise le cycle de vie des tentatives de remédiation de sécurité automatique : admission, classification des échecs, comptage et contrôle des relances. */
import { randomUUID, createHash } from 'crypto';
import { ConflictException, ServiceUnavailableException } from '@nestjs/common';

export const MAX_AUTOMATIC_ATTEMPTS = 3;
/** Vérifie que le déclenchement de nouvelles corrections automatiques n'est pas désactivé globalement (ne bloque jamais la lecture ou les callbacks de complétion). */
export function assertSecurityRemediationDispatchEnabled(): void {
  const value = process.env.SECURITY_REMEDIATION_DISPATCH_ENABLED;
  if (value === undefined || value.trim().toLowerCase() === 'true') return;
  throw new ServiceUnavailableException({
    statusCode: 503, error: 'Service Unavailable',
    code: 'SECURITY_REMEDIATION_TEMPORARILY_DISABLED',
    message: 'Les corrections automatiques sont temporairement suspendues.',
  });
}
export type SecurityRemediationCallbackContract = 1 | 2;
/** Détecte si un callback WF6 utilise la nouvelle identité de tentative (v2) ou l'ancien format sans attemptId/attemptNumber (v1). */
export function callbackContract(payload: { attemptId?: unknown; attemptNumber?: unknown;
  findings?: { attemptId?: unknown; attemptNumber?: unknown }[] }): SecurityRemediationCallbackContract {
  return [payload, ...(payload.findings || [])].some(f => f.attemptId !== undefined || f.attemptNumber !== undefined) ? 2 : 1;
}
/** Lit la limite de tentatives automatiques depuis l'environnement (1 à 3), ou renvoie la valeur par défaut. */
export function maxAutomaticAttempts(): number {
  const configured = process.env.SECURITY_REMEDIATION_MAX_ATTEMPTS;
  if (configured === undefined) return MAX_AUTOMATIC_ATTEMPTS;
  if (!/^[1-3]$/.test(configured)) throw new ServiceUnavailableException('La limite de tentatives automatiques est invalide.');
  return Number(configured);
}
export interface SecurityRemediationAttempt {
  contractVersion?: SecurityRemediationCallbackContract;
  attemptId?: string; attemptNumber: number; batchId?: string;
  startedAt?: string; finishedAt?: string | null; status: string;
  reasonCode?: string | null; reasonMessage?: string | null; retryable: boolean;
  executionId?: string | null; prUrl?: string | null; branchName?: string | null;
  candidateSha?: string | null; verificationEvidence?: Record<string, any> | null;
  legacyAttempt?: boolean; completionDigest?: string;
  [key: string]: any;
}
export interface SecurityFindingRemediation {
  status: string; attemptId?: string; attemptNumber?: number; attemptCount?: number;
  batchId?: string; attempts: SecurityRemediationAttempt[];
  [key: string]: any;
}
export interface AttemptCorrelation { attemptId: string; attemptNumber: number; batchId: string }

/** Indique si le projet confirme déjà, par son scan le plus récent, que la vulnérabilité est corrigée (jamais un déploiement, seulement le candidat validé). */
export function isProjectFixVerified(task: { status?: string; manualStatus?: string; scannerStatus?: string; securityFindingRemediation?: any }): boolean {
  return (task.manualStatus ?? task.status) === 'VERIFIED' && task.scannerStatus === 'NOT_DETECTED';
}
// VERIFIER_UNAVAILABLE / VERIFIER_PROTOCOL_ERROR (2026-10-25) : échec de
// transport backend <-> worker interne, toujours AVANT toute écriture Git (cf.
// preGitFinalFailures dans remediation-target-reservation.ts). Sans eux, une
// panne d'infrastructure passagère (worker absent, base OWASP manquante) rendait
// la CVE définitivement non corrigeable, même une fois la panne réparée.
// « Réessayable » ne déclenche aucune reprise automatique : seul le bouton
// Réessayer en profite, toujours borné par assertNoSideEffect et MAX_AUTOMATIC_ATTEMPTS.
const temporary = new Set(['RUNTIME_OPERATION_TIMEOUT', 'WORKER_DEADLINE_EXCEEDED', 'VERIFIER_TIMEOUT',
  'WARMUP_TIMEOUT', 'WARMUP_NETWORK_FAILURE', 'DEPENDENCY_TREE_TIMEOUT',
  'VERIFIER_UNAVAILABLE', 'VERIFIER_PROTOCOL_ERROR']);
const rejected = new Set(['APPLICATION_TESTS_FAILED', 'APPLICATION_TESTS_NOT_EXECUTED', 'MAVEN_RESOLUTION_MISMATCH',
  'TARGET_CVE_STILL_OPEN_AFTER_PATCH', 'TARGET_CVE_NEVER_OBSERVED_IN_BASELINE', 'INVALID_CANDIDATE',
  'ANCESTRY_INVALID', 'CANDIDATE_DRIFTED', 'PR_HEAD_SHA_MISMATCH', 'GUARD_REJECTED', 'PATCH_CONFLICT',
  'BRANCH_CONTENT_CONFLICT', 'WRITE_CONFLICT', 'MAVEN_MUTATED_CANDIDATE_SOURCE']);
const retryTerminalStatuses = new Set(['TECHNICAL_FAILURE', 'DISPATCH_FAILED', 'GROUNDING_FAILED', 'WORKSPACE_FAILURE', 'MAVEN_RESOLUTION_FAILED', 'CANDIDATE_BUILD_FAILED', 'CANDIDATE_SECURITY_VALIDATION_FAILED']);
/** Classe un échec de remédiation en RETRYABLE (erreur technique temporaire), NON_RETRYABLE (nécessite une vérification humaine), ou UNKNOWN. */
export function classifySecurityRemediationFailure(input: { reasonCode?: string; reason?: string; underlyingReasonCode?: string; status?: string }) {
  const raw = input.reasonCode || input.reason || '';
  const code = /^[A-Z][A-Z0-9_]*(?::[A-Z][A-Z0-9_]*)?$/.test(raw) ? raw.split(':')[0] : 'UNKNOWN_FAILURE';
  const groundingCode = /^GROUNDING_FAILED:([A-Z][A-Z0-9_]*)$/.exec(raw)?.[1];
  const effective = code === 'WF6_STALE_DISPATCH_RECONCILED' ? input.underlyingReasonCode || code : groundingCode || code;
  const retryable = temporary.has(effective) && (!input.status || retryTerminalStatuses.has(input.status));
  return { retryable, category: retryable ? 'RETRYABLE_TECHNICAL' : rejected.has(effective) || rejected.has(input.status || '') ? 'NON_RETRYABLE_AUTOMATIC' : 'UNKNOWN',
    safeReasonCode: groundingCode || code, safeMessage: retryable ? 'Une erreur technique temporaire a interrompu la correction.' : 'Une vérification est requise avant toute nouvelle correction automatique.' };
}
/** Normalise le JSONB brut `securityFindingRemediation` : numérote les tentatives, déduit leur caractère réessayable/legacy, et calcule la catégorie d'échec courante. */
export function normalizeSecurityRemediation(value: any): SecurityFindingRemediation | null {
  if (!value) return null;
  const attempts = (Array.isArray(value.attempts) ? value.attempts : []).map((a: any, i: number) => {
    const policy = classifySecurityRemediationFailure({ ...a, reason: a.reasonCode || a.reason });
    return { ...a, attemptNumber: Number(a.attemptNumber || a.attempt) || i + 1,
      startedAt: a.startedAt || a.at, finishedAt: a.finishedAt ?? (a.status === 'DISPATCHING' ? null : a.at),
      reasonCode: a.reasonCode || policy.safeReasonCode, reasonMessage: a.reasonMessage || policy.safeMessage,
      retryable: policy.retryable, ...(!a.attemptId ? { legacyAttempt: true } : {}) };
  });
  const policy = classifySecurityRemediationFailure({ ...value, reason: value.reasonCode || value.reason });
  return { ...value, attempts, retryable: policy.retryable, failureCategory: policy.category, reasonCode: value.reasonCode || policy.safeReasonCode,
    reasonMessage: value.reasonMessage || policy.safeMessage };
}
/** Vérifie toutes les conditions avant d'autoriser un réessai manuel : tentative terminée, échec réessayable, aucun effet Git résiduel, plafond non atteint. */
export function assertRetryAllowed(task: any, expectedAttemptId?: string): void {
  const r = normalizeSecurityRemediation(task.securityFindingRemediation);
  if (!r || ['DISPATCHING', 'CANDIDATE_READY', 'CLOSED', 'PENDING', 'WRITE_AUTHORIZED', 'PR_CREATED', 'PR_REUSED', 'ALREADY_MERGED'].includes(r.status)) {
    throw new ConflictException('La tentative actuelle ne permet pas de nouvelle correction.');
  }
  if (expectedAttemptId && r.attemptId !== expectedAttemptId) throw new ConflictException('La tentative attendue n’est plus actuelle.');
  if (!retryTerminalStatuses.has(r.status)) throw new ConflictException('État terminal non pris en charge pour le réessai.');
  const current = r.attemptId ? r.attempts.find(a => a.attemptId === r.attemptId) : null;
  if (r.attemptId && (!current || current.status !== r.status || !current.finishedAt)) throw new ConflictException('La tentative actuelle n’est pas terminée.');
  const policy = classifySecurityRemediationFailure({ reasonCode: current?.reasonCode || r.reasonCode, status: r.status,
    underlyingReasonCode: current?.underlyingReasonCode || r.underlyingReasonCode });
  if (!policy.retryable || (current && current.retryable !== true)) throw new ConflictException('Cet échec ne permet pas de réessai automatique.');
  assertNoSideEffect(task);
  if (automaticAttemptCount(r) >= maxAutomaticAttempts()) throw new ConflictException('Le maximum de tentatives automatiques est atteint.');
}
/** Refuse tout nouveau déclenchement si le projet confirme déjà le correctif, ou si une tentative précédente a laissé une PR/branche Git non résolue. */
export function assertNoSideEffect(task: any): void {
  const r = task.securityFindingRemediation;
  if (isProjectFixVerified(task)) throw new ConflictException('Le projet confirme déjà la correction de cette vulnérabilité.');
  if (r && (r.prUrl || r.prNumber || r.branchName || r.unresolvedGitSideEffect || (r.attempts || []).some((a: any) => a.prUrl || a.prNumber || a.branchName || a.unresolvedGitSideEffect))) {
    throw new ConflictException('Un effet Git/PR persistant nécessite une vérification avant relance.');
  }
}
/** Compte le nombre de tentatives automatiques déjà effectuées, en prenant le maximum observé entre le compteur et l'historique (tolère les anciens callbacks). */
export function automaticAttemptCount(r: any): number {
  if (!r) return 0;
  return Math.max(Number(r.attemptNumber || r.attemptCount) || 0,
    ...(r.attempts || []).map((a: any) => Number(a.attemptNumber || a.attempt) || 0));
}
/** Crée et enregistre une nouvelle tentative DISPATCHING (identité v2) sur la tâche, après avoir vérifié que le plafond n'est pas dépassé. */
export function reserveAttempt(task: any, batchId: string, at: string): SecurityRemediationAttempt {
  const r = normalizeSecurityRemediation(task.securityFindingRemediation);
  const nextNumber = automaticAttemptCount(r) + 1;
  if (nextNumber > maxAutomaticAttempts()) throw new ConflictException('Le maximum de tentatives automatiques est atteint.');
  const attempt: SecurityRemediationAttempt = { contractVersion: 2, attemptId: randomUUID(), attemptNumber: nextNumber,
    batchId, startedAt: at, finishedAt: null, status: 'DISPATCHING', reasonCode: null, reasonMessage: null,
    retryable: false, executionId: null, prUrl: null, branchName: null, candidateSha: null, verificationEvidence: null };
  task.securityRemediationBatchId = batchId;
  task.securityFindingRemediation = { ...r, ...attempt, attemptCount: attempt.attemptNumber, updatedAt: at,
    reason: null, candidateStatus: null, batchStatus: null, candidateIdentity: null, evaluatedSha: null, prNumber: null,
    patchEvidence: null, securityValidationEvidence: null, completionDigest: null, legacyCallbackCompletionDigest: null, failureCategory: null, underlyingReasonCode: null,
    attempts: [...(r?.attempts || []), attempt] };
  return attempt;
}
/** Vérifie qu'un résultat WF6 entrant correspond bien à la tentative actuellement attendue (même attemptId/attemptNumber/batchId) avant d'accepter le callback. */
export function assertCorrelation(task: any, identity: AttemptCorrelation): SecurityRemediationAttempt {
  const r = task.securityFindingRemediation;
  if (!identity.attemptId || !Number.isInteger(identity.attemptNumber) || !identity.batchId ||
      r?.attemptId !== identity.attemptId || r?.attemptNumber !== identity.attemptNumber ||
      r?.batchId !== identity.batchId || task.securityRemediationBatchId !== identity.batchId) {
    throw new ConflictException('Résultat obsolète ou identité de tentative WF6 incorrecte.');
  }
  const a = r.attempts?.find((a: any) => a.attemptId === identity.attemptId);
  if (!a || a.attemptNumber !== identity.attemptNumber || a.batchId !== identity.batchId) throw new ConflictException('Tentative WF6 introuvable.');
  return a;
}
/** Sérialise une valeur de façon déterministe (clés triées) pour produire une empreinte stable d'un résultat WF6. */
function canonical(x: any): string {
  if (Array.isArray(x)) return '[' + x.map(canonical).join(',') + ']';
  if (x && typeof x === 'object') return '{' + Object.keys(x).filter(k => x[k] !== undefined).sort().map(k => JSON.stringify(k)+':'+canonical(x[k])).join(',') + '}';
  return JSON.stringify(x);
}
/** Vérifie, de façon purement structurelle, si la tentative courante d'une tâche est bien au format legacy (sans identité de tentative moderne). */
export function isLegacyCurrentAttempt(task: any): boolean {
  const raw = task.securityFindingRemediation;
  if (!raw || !Array.isArray(raw.attempts) || !raw.attempts.length ||
      raw.attempts.some((a: any) => !a || typeof a !== 'object' || Array.isArray(a))) return false;
  const r = normalizeSecurityRemediation(raw);
  if (!r || r.attemptId != null || r.contractVersion === 2 || !r.attempts.length ||
      r.attempts.some(a => a.attemptId != null || a.contractVersion === 2) ||
      typeof r.batchId !== 'string' || !r.batchId || task.securityRemediationBatchId !== r.batchId) return false;
  const number = Number(r.attemptCount ?? r.attemptNumber);
  const current = r.attempts[r.attempts.length - 1];
  const recordedNumber = Number(raw.attempts[raw.attempts.length - 1].attemptNumber ?? raw.attempts[raw.attempts.length - 1].attempt);
  if (r.attempts.slice(0, -1).some(a => a.batchId === r.batchId)) return false;
  return Number.isInteger(number) && number > 0 && Number.isInteger(recordedNumber) && recordedNumber === number && current.legacyAttempt === true &&
    current.attemptNumber === number && current.batchId === r.batchId && current.status === r.status &&
    r.attempts.filter(a => a.attemptNumber === number).length === 1;
}
/** Empreinte SHA-256 d'un résultat WF6 — permet de reconnaître un callback rejoué (même résultat) d'un conflit réel (résultat différent). */
function completionDigest(result: Record<string, any>): string {
  return createHash('sha256').update(canonical(result)).digest('hex');
}
/** Refuse un résultat WF6 dont le statut n'est pas terminal (encore DISPATCHING/PENDING/WRITE_AUTHORIZED). */
function assertTerminalResult(result: Record<string, any>): void {
  if (!result.status || ['DISPATCHING', 'PENDING', 'WRITE_AUTHORIZED'].includes(result.status)) throw new ConflictException('Résultat WF6 non terminal.');
}
/** Vérifie qu'un callback au format legacy (sans identité de tentative) correspond bien à la tentative legacy courante, ou à un rejeu exact du même résultat déjà enregistré. */
export function assertLegacyCallback(task: any, batchId: string, result: Record<string, any>): void {
  if (!isLegacyCurrentAttempt(task) || batchId !== task.securityFindingRemediation.batchId) {
    throw new ConflictException('Le résultat legacy ne correspond pas à une tentative legacy actuelle.');
  }
  assertTerminalResult(result);
  const r = normalizeSecurityRemediation(task.securityFindingRemediation)!;
  const current = r.attempts[r.attempts.length - 1];
  if (r.status === 'DISPATCHING' && !r.finishedAt && !current.finishedAt) return;
  const digest = completionDigest(result);
  if (r.contractVersion === 1 && r.legacyCallbackCompletionDigest === digest &&
      current.contractVersion === 1 && current.legacyCallbackCompletionDigest === digest &&
      r.finishedAt && current.finishedAt) return;
  throw new ConflictException('Cette tentative legacy n’attend plus de résultat.');
}
/** Termine la tentative legacy courante avec le résultat WF6 reçu, en calculant sa catégorie d'échec et son empreinte de complétion. */
export function completeLegacyAttempt(task: any, batchId: string, result: Record<string, any>, at = new Date().toISOString()): boolean {
  assertLegacyCallback(task, batchId, result);
  const r = normalizeSecurityRemediation(task.securityFindingRemediation)!;
  if (r.status !== 'DISPATCHING') return false;
  const index = r.attempts.length - 1;
  const a = r.attempts[index];
  const policy = classifySecurityRemediationFailure(result);
  const finished = { ...a, ...result, contractVersion: 1 as const, legacyAttempt: true,
    batchId, attemptNumber: a.attemptNumber, finishedAt: at,
    retryable: policy.retryable, failureCategory: policy.category,
    reasonCode: policy.safeReasonCode, reasonMessage: policy.safeMessage,
    legacyCallbackCompletionDigest: completionDigest(result),
    unresolvedGitSideEffect: result.unresolvedGitSideEffect === true || r.unresolvedGitSideEffect === true ||
      !!(r.prUrl || r.prNumber || r.branchName || r.attempts.some(a => a.prUrl || a.prNumber || a.branchName || a.unresolvedGitSideEffect)),
  };
  task.securityFindingRemediation = { ...r, ...finished, attemptCount: r.attemptCount, updatedAt: at,
    attempts: r.attempts.map((entry, i) => i === index ? finished : entry) };
  return true;
}
/** Termine la tentative moderne (v2) identifiée par `identity` avec le résultat WF6 ; un rejeu du même résultat est toléré (idempotence), un résultat différent est refusé. */
export function completeAttempt(task: any, identity: AttemptCorrelation, result: Record<string, any>, at = new Date().toISOString()): boolean {
  const a = assertCorrelation(task, identity);
  const digest = completionDigest(result);
  if (a.finishedAt) {
    if (a.completionDigest === digest) return false;
    throw new ConflictException('Cette tentative est déjà terminée avec un autre résultat.');
  }
  assertTerminalResult(result);
  const policy = classifySecurityRemediationFailure(result);
  const finished = { ...a, ...result, ...identity, finishedAt: at, retryable: policy.retryable, failureCategory: policy.category,
    reasonCode: policy.safeReasonCode, reasonMessage: policy.safeMessage, completionDigest: digest };
  const r = task.securityFindingRemediation;
  task.securityFindingRemediation = { ...r, ...finished, attemptCount: a.attemptNumber, updatedAt: at,
    attempts: r.attempts.map((entry: any) => entry.attemptId === a.attemptId ? finished : entry) };
  return true;
}
