import { getV1_8Presentation } from './v1-8-compatibility-presentation';
import { SecurityRemediationTask } from './security-remediation.types';
import { CveSelectionEligibility, resolveFixedVersion, resolveInstalledVersion } from './cve-selection-eligibility';

export type SecurityRemediationState =
  | 'NO_TASK'
  | 'MAVEN_DATA_MISSING'
  | 'MANUAL_REVIEW_MULTIPLE_TARGETS'
  | 'MANUAL_REVIEW_NO_TARGET'
  | 'AUTO_FIX_AVAILABLE'
  | 'DISPATCHING'
  | 'CANDIDATE_READY'
  | 'PROJECT_FIX_VERIFIED'
  | 'RETRYABLE_FAILURE'
  | 'NON_RETRYABLE_FAILURE'
  | 'VERIFICATION_REQUIRED'
  | 'OPERATOR_TEST_STOPPED';

/** Loose visual grouping only -- never used for any decision, purely a CSS hook. */
export type SecurityRemediationStyleKey = 'success' | 'warning' | 'muted' | 'progress' | 'danger';

export interface SecurityRemediationPresentation {
  state: SecurityRemediationState;
  label: string;
  explanation: string;
  /** Initial-launch gate plus lifecycle restrictions; retry has its own action. */
  selectable: boolean;
  retryAllowed?: boolean;
  attemptNumber?: number;
  reasonCode?: string | null;
  historical?: boolean;
  /** Resolved from the task's own snapshot for OWASP (the raw scan row never carries it) -- never the raw OWASP row directly. */
  installedVersion: string | null;
  targetVersion: string | null;
  /** Human label for WHO supplied targetVersion -- never the detecting scanner. Null exactly when targetVersion is null. */
  targetSource: 'Trivy' | 'OWASP' | null;
  styleKey: SecurityRemediationStyleKey;
  prNumber?: number | null;
  prUrl?: string | null;
  /** Non-technical tooltip detail, shown only when there is something worth expanding on (e.g. the raw Trivy evidence for a multi-target case). Never a raw stack trace or internal code. */
  tooltip?: string | null;
}

const MAVEN_COORDINATE_RE = /^[A-Za-z0-9_.-]+:[A-Za-z0-9_.-]+$/;

// Unknown states fail closed. Backend retryable=true is required, and
// only known terminal failure states can expose the dedicated retry action.
const TERMINAL_FAILURE_STATUSES = new Set([
  'TECHNICAL_FAILURE', 'DISPATCH_FAILED', 'GROUNDING_FAILED', 'WORKSPACE_FAILURE',
  'MAVEN_RESOLUTION_FAILED', 'CANDIDATE_BUILD_FAILED', 'CANDIDATE_SECURITY_VALIDATION_FAILED',
]);
export const MAX_AUTOMATIC_ATTEMPTS = 3;
export function isProjectFixVerified(task: SecurityRemediationTask | null | undefined): boolean {
  return (task?.manualStatus ?? task?.status) === 'VERIFIED' && task?.scannerStatus === 'NOT_DETECTED';
}
const FAILURE_LABELS: Record<string, string> = {
  WARMUP_NETWORK_FAILURE: 'Service de validation temporairement indisponible',
  RUNTIME_OPERATION_TIMEOUT: 'La correction a dépassé le délai autorisé',
  WORKER_DEADLINE_EXCEEDED: 'La correction a dépassé le délai autorisé',
  VERIFIER_TIMEOUT: 'La validation a dépassé le délai autorisé',
  WARMUP_TIMEOUT: 'Le service de validation a dépassé le délai autorisé',
  DEPENDENCY_TREE_TIMEOUT: 'La vérification des dépendances a dépassé le délai autorisé',
  OPERATOR_TEST_STOPPED: 'Test opérateur terminé avant toute écriture Git.',
  APPLICATION_TESTS_FAILED: "Les tests de l'application ont échoué",
  APPLICATION_TESTS_NOT_EXECUTED: "Les tests de l'application n'ont pas pu être exécutés",
  MAVEN_RESOLUTION_MISMATCH: 'La dépendance résolue ne correspond pas au correctif attendu',
  TARGET_CVE_STILL_OPEN_AFTER_PATCH: 'La vulnérabilité reste présente dans le candidat',
  CANDIDATE_DRIFTED: 'Le candidat a changé depuis sa validation',
};
/** Never render raw reasonMessage/free text: older servers may include stacks/secrets. */
export function safeFailureLabel(code?: string | null): string {
  return (typeof code === 'string' && Object.prototype.hasOwnProperty.call(FAILURE_LABELS, code) && FAILURE_LABELS[code]) || "La correction automatique n'a pas pu être validée.";
}
export function safeReasonCode(code?: string | null): string | null {
  return typeof code === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/.test(code) ? code : null;
}
export function currentAttemptNumber(task: SecurityRemediationTask): number {
  const r = task.securityFindingRemediation;
  return Math.max(0, r?.attemptNumber ?? r?.attemptCount ?? 0,
    ...(r?.attempts ?? []).map(a => a.attemptNumber ?? a.attempt ?? 0));
}

/** A single scanner-neutral view. Initial eligibility cannot authorize retries
 * or override current lifecycle/scanner evidence. */
/** PR metadata decorates every state; it never determines lifecycle category. */
export function getSecurityRemediationPresentation(
  task: SecurityRemediationTask | null | undefined,
  eligibility: CveSelectionEligibility,
  cve: { fixedVersion?: string; pkg?: string; installedVersion?: string; historical?: boolean } = {},
): SecurityRemediationPresentation {
  return {
    ...classifySecurityRemediationPresentation(task, eligibility, cve),
    prUrl: task?.securityFindingRemediation?.prUrl ?? null,
    prNumber: task?.securityFindingRemediation?.prNumber ?? null,
  };
}

function classifySecurityRemediationPresentation(
  task: SecurityRemediationTask | null | undefined,
  eligibility: CveSelectionEligibility,
  cve: { fixedVersion?: string; pkg?: string; installedVersion?: string; historical?: boolean } = {},
): SecurityRemediationPresentation {
  if (!task?.id) {
    return {
      state: 'NO_TASK', label: 'Non suivi', explanation: 'Aucune tâche de correction associée à cette CVE pour le moment.',
      selectable: false, installedVersion: null, targetVersion: null, targetSource: null, styleKey: 'muted',
    };
  }

  const snapshot = task.findingSnapshot || {};
  const remediation = task.securityFindingRemediation;
  const status = remediation?.status ? String(remediation.status) : null;
  const installedVersion = task.v1_8Decision?.installedVersion || resolveInstalledVersion(cve, task) || null;

  const versionFields = {
    installedVersion: cve.historical ? null : installedVersion,
    targetVersion: cve.historical ? null : resolveFixedVersion(cve, task) || null,
    targetSource: cve.historical ? null : (snapshot.fixedVersionSource === 'TRIVY_CORRELATED' || task.source === 'TRIVY') ? 'Trivy' as const : null,
    historical: !!cve.historical,
    attemptNumber: currentAttemptNumber(task),
  };
  if (status === 'OPERATOR_TEST_STOPPED') return {
    ...versionFields, state: 'OPERATOR_TEST_STOPPED', label: 'Test opérateur terminé',
    explanation: 'Arrêt contrôlé avant toute écriture Git. La vulnérabilité reste suivie par le scanner.',
    reasonCode: 'OPERATOR_TEST_STOPPED', selectable: false, retryAllowed: false, styleKey: 'muted',
  };
  if (isProjectFixVerified(task)) return {
    ...versionFields, state: 'PROJECT_FIX_VERIFIED', label: 'Vulnérabilité corrigée',
    explanation: cve.historical ? 'Absente du dernier scan' : 'Une analyse du projet confirme que la vulnérabilité est absente.',
    selectable: false, retryAllowed: false, styleKey: 'muted',
  };
  if (status === 'DISPATCHING') return {
    ...versionFields, state: 'DISPATCHING', label: 'Correction en cours',
    explanation: 'Une tentative de correction est actuellement en cours.',
    selectable: false, retryAllowed: false, styleKey: 'progress',
  };
  if (status === 'CANDIDATE_READY') return {
    ...versionFields, state: 'CANDIDATE_READY', label: 'Correction proposée',
    explanation: 'Le candidat doit être examiné. Seul un scan du projet peut confirmer la correction.',
    selectable: false, retryAllowed: false, styleKey: 'success',
    prNumber: remediation?.prNumber ?? null, prUrl: remediation?.prUrl ?? null,
  };
  // CLOSED is candidate evidence, not a pending proposal or project closure.
  if (status === 'CLOSED') return {
    ...versionFields, state: 'VERIFICATION_REQUIRED', label: 'Correction à vérifier',
    explanation: 'La CVE est absente du candidat. Seul un scan du projet peut confirmer la correction.',
    selectable: false, retryAllowed: false, styleKey: 'warning',
  };
  if (status) {
    const retryable = remediation?.retryable === true && TERMINAL_FAILURE_STATUSES.has(status);
    const number = currentAttemptNumber(task);
    const effects = !!(remediation?.prUrl || remediation?.branchName || remediation?.unresolvedGitSideEffect
      || remediation?.attempts?.some(a => a.prUrl || a.branchName));
    return {
      ...versionFields, state: retryable ? 'RETRYABLE_FAILURE' : 'NON_RETRYABLE_FAILURE',
      label: retryable ? 'Échec de correction' : 'Intervention manuelle requise',
      explanation: safeFailureLabel(remediation?.reasonCode),
      reasonCode: safeReasonCode(remediation?.reasonCode),
      selectable: false, retryAllowed: retryable && number < MAX_AUTOMATIC_ATTEMPTS && !effects,
      styleKey: retryable ? 'danger' : 'warning',
    };
  }
  if (cve.historical) return {
    ...versionFields, state: 'MANUAL_REVIEW_NO_TARGET', label: 'Intervention manuelle requise',
    explanation: "Finding historique : une analyse actuelle est nécessaire avant une correction automatique.",
    selectable: false, retryAllowed: false, styleKey: 'muted',
  };

  const decision = task.v1_8Decision;
  if (decision && (decision.state !== 'VALIDATED_RECOMMENDED' || decision.requiresDeveloperReview === true)) {
    const v18 = getV1_8Presentation(decision, installedVersion)!;
    return { state: 'MANUAL_REVIEW_NO_TARGET', label: v18.label, explanation: v18.reason,
      selectable: false, installedVersion, targetVersion: null, targetSource: null, styleKey: v18.styleKey };
  }
  if (decision?.sandboxValidated && decision?.targetCveClosed && decision?.recommendedVersion) {
    return { state: 'AUTO_FIX_AVAILABLE', label: 'Correction automatique disponible',
      explanation: 'Une correction compatible a été validée par V1.8.', selectable: eligibility.selectable,
      installedVersion, targetVersion: decision.recommendedVersion, targetSource: null, styleKey: 'success' };
  }

  // ── No remediation attempt yet: classify by what the data actually
  // supports, fail-closed exactly like the server does. ──
  const component = String(snapshot.component ?? '').trim();
  if (!MAVEN_COORDINATE_RE.test(component)) {
    // Same state for both sources (shared classification), but the human
    // explanation must not say "Maven" for a Trivy finding whose component
    // isn't a Maven dependency at all (e.g. an OS/image package such as
    // openssl -- Trivy also reports real Maven coordinates for bundled
    // jars, which DO pass the regex above and never reach this branch).
    const isTrivy = task.source === 'TRIVY';
    return {
      state: 'MAVEN_DATA_MISSING',
      label: isTrivy ? 'Correction automatique non disponible' : 'Données Maven insuffisantes',
      explanation: isTrivy
        ? "Ce composant n'est pas géré comme une dépendance Maven (par exemple un paquet système de l'image de base). La plateforme ne peut pas proposer de correction automatique pour ce type de composant."
        : 'Les coordonnées Maven nécessaires à la correction automatique ne sont pas disponibles.',
      selectable: eligibility.selectable, installedVersion, targetVersion: null, targetSource: null, styleKey: 'muted',
    };
  }

  const targetVersion = resolveFixedVersion(cve, task) || null;
  if (targetVersion && /[,\s]/.test(targetVersion)) {
    return { state: 'MANUAL_REVIEW_MULTIPLE_TARGETS', label: 'Intervention manuelle requise',
      explanation: 'Plusieurs versions corrigées ont été identifiées. Une version cible unique doit être vérifiée avant toute correction.',
      selectable: false, installedVersion, targetVersion: null, targetSource: null, styleKey: 'warning' };
  }
  if (targetVersion) {
    return {
      state: 'AUTO_FIX_AVAILABLE', label: 'Correction automatique disponible',
      explanation: 'Une version corrigée unique a été identifiée. Cette vulnérabilité peut être soumise au processus automatique de correction et de validation.',
      selectable: eligibility.selectable, installedVersion, targetVersion,
      targetSource: (snapshot.fixedVersionSource === 'TRIVY_CORRELATED' || task.source === 'TRIVY') ? 'Trivy' : 'OWASP',
      styleKey: 'success',
    };
  }

  if (snapshot.fixedVersionUnavailableReason === 'MULTIPLE_CANDIDATES') {
    const rawEvidence = snapshot.fixedVersionEvidence?.trivyFixedVersionRaw ?? null;
    return {
      state: 'MANUAL_REVIEW_MULTIPLE_TARGETS', label: 'Intervention manuelle requise',
      explanation: 'Plusieurs versions corrigées possibles ont été identifiées. La plateforme ne sélectionne pas automatiquement une version afin d\'éviter une mise à jour incorrecte.',
      selectable: false, installedVersion, targetVersion: null, targetSource: null, styleKey: 'warning',
      tooltip: rawEvidence
        ? `Plusieurs versions corrigées ont été identifiées par le scanner (${rawEvidence}). La plateforme ne choisit pas automatiquement une version afin d'éviter une mise à jour incorrecte.`
        : "Plusieurs versions corrigées ont été identifiées par le scanner. La plateforme ne choisit pas automatiquement une version afin d'éviter une mise à jour incorrecte.",
    };
  }

  // MANUAL_REVIEW_NO_TARGET -- the honest default when nothing above matched.
  return {
    state: 'MANUAL_REVIEW_NO_TARGET', label: 'Intervention manuelle requise',
    explanation: "Aucune version corrigée fiable n'a pu être déterminée automatiquement pour cette vulnérabilité. Elle reste suivie par la plateforme mais nécessite une analyse manuelle.",
    selectable: false, installedVersion, targetVersion: null, targetSource: null, styleKey: 'warning',
    tooltip: "Aucune version corrigée fiable n'a pu être déterminée automatiquement. Cette vulnérabilité reste suivie mais nécessite une intervention manuelle.",
  };
}

export type SecurityRemediationFilter = 'ALL' | 'AVAILABLE' | 'IN_PROGRESS' | 'PROPOSED' | 'FAILED' | 'CLOSED' | 'MANUAL';
export function remediationCategory(state: SecurityRemediationState): Exclude<SecurityRemediationFilter, 'ALL'> | 'OPERATOR_TEST' {
  switch (state) {
    case 'OPERATOR_TEST_STOPPED': return 'OPERATOR_TEST';
    case 'AUTO_FIX_AVAILABLE': return 'AVAILABLE';
    case 'DISPATCHING': return 'IN_PROGRESS';
    case 'CANDIDATE_READY': return 'PROPOSED';
    case 'RETRYABLE_FAILURE': return 'FAILED';
    case 'PROJECT_FIX_VERIFIED': return 'CLOSED';
    case 'VERIFICATION_REQUIRED': return 'MANUAL';
    default: return 'MANUAL';
  }
}
export interface SecurityRemediationSummary {
  total: number; autoFixAvailable: number; dispatching: number; candidateReady: number;
  failedRetryable: number; verifiedFixed: number; manualRequired: number; operatorTests: number;
}
export function summarizeSecurityRemediation<TCve extends { fixedVersion?: string; pkg?: string; historical?: boolean }>(
  cves: TCve[], taskFor: (cve: TCve) => SecurityRemediationTask | undefined,
  eligibilityFor: (task: SecurityRemediationTask | undefined, cve: TCve) => CveSelectionEligibility,
): SecurityRemediationSummary {
  const summary: SecurityRemediationSummary = {
    total: cves.length, autoFixAvailable: 0, dispatching: 0, candidateReady: 0,
    failedRetryable: 0, verifiedFixed: 0, manualRequired: 0, operatorTests: 0,
  };
  const keys = { AVAILABLE: 'autoFixAvailable', IN_PROGRESS: 'dispatching', PROPOSED: 'candidateReady',
    FAILED: 'failedRetryable', CLOSED: 'verifiedFixed', MANUAL: 'manualRequired', OPERATOR_TEST: 'operatorTests' } as const;
  for (const cve of cves) summary[keys[remediationCategory(getSecurityRemediationPresentation(taskFor(cve), eligibilityFor(taskFor(cve), cve), cve).state)]]++;
  return summary;
}
