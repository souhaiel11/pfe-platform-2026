import { getV1_8Presentation } from './v1-8-compatibility-presentation';
// ─────────────────────────────────────────────────────────────────────
// OWASP remediation status, presented for a human. Pure, testable, and
// deliberately separate from cve-selection-eligibility.ts's own
// canSelectCveTask(): THIS module never re-implements the selectability
// gate -- it reuses it verbatim so the "can this checkbox be ticked" answer
// can never drift from the one launch-batch itself enforces server-side.
// This module only adds the user-facing STATE/LABEL/EXPLANATION layer on
// top of that same decision, per the platform's own rule: never mix the
// backend's technical status with the text a user reads.
//
// Scanner vs. fixed-version-source ambiguity (the whole point of this
// module): "Source: OWASP" can only ever mean "OWASP Dependency-Check
// detected this CVE" -- never "OWASP supplied this target version" (OWASP
// Dependency-Check carries no upgrade suggestion at all; see
// owasp-finding-normalizer.ts). When the displayed target version was
// borrowed from Trivy's own evidence (fixedVersionSource=TRIVY_CORRELATED),
// the UI says so explicitly and separately from the detecting scanner.
import { CveSelectionEligibility, resolveFixedVersion, resolveInstalledVersion } from './cve-selection-eligibility';

export type OwaspRemediationState =
  | 'NO_TASK'
  | 'MAVEN_DATA_MISSING'
  | 'MANUAL_REVIEW_MULTIPLE_TARGETS'
  | 'MANUAL_REVIEW_NO_TARGET'
  | 'AUTO_FIX_AVAILABLE'
  | 'DISPATCHING'
  | 'CANDIDATE_READY'
  | 'CLOSED'
  | 'FAILED';

/** Loose visual grouping only -- never used for any decision, purely a CSS hook. */
export type OwaspRemediationStyleKey = 'success' | 'warning' | 'muted' | 'progress' | 'danger';

export interface OwaspRemediationPresentation {
  state: OwaspRemediationState;
  label: string;
  explanation: string;
  /** Byte-identical to cve-selection-eligibility.ts's own canSelectCveTask() decision -- never recomputed differently. */
  selectable: boolean;
  /** Resolved from the task's own snapshot for OWASP (the raw scan row never carries it) -- never the raw OWASP row directly. */
  installedVersion: string | null;
  targetVersion: string | null;
  /** Human label for WHO supplied targetVersion -- never the detecting scanner. Null exactly when targetVersion is null. */
  targetSource: 'Trivy' | 'OWASP' | null;
  styleKey: OwaspRemediationStyleKey;
  prNumber?: number | null;
  prUrl?: string | null;
  /** Non-technical tooltip detail, shown only when there is something worth expanding on (e.g. the raw Trivy evidence for a multi-target case). Never a raw stack trace or internal code. */
  tooltip?: string | null;
}

const MAVEN_COORDINATE_RE = /^[A-Za-z0-9_.-]+:[A-Za-z0-9_.-]+$/;

// The backend's own status vocabulary for a batch remediation attempt is
// deliberately open-ended (Wf6BatchRemediationResultDto's own header: plain
// strings, "never @IsIn against an internal enum", so it never needs
// editing every time that internal enum gains a value). This UI mirrors
// that discipline: only the few statuses with a SPECIFIC, positive meaning
// are named below; every other non-empty status a real WF6 run could ever
// report is honestly presented as FAILED (attempted, not yet closed)
// rather than risk silently miscategorizing an unrecognized future status
// as still auto-fixable.
const IN_PROGRESS_STATUSES = new Set(['DISPATCHING']);
const READY_STATUSES = new Set(['CANDIDATE_READY']);
const CLOSED_STATUSES = new Set(['CLOSED']);

function humanizeFailureReason(reason: string | null | undefined): string {
  if (!reason) return "La tentative de correction automatique a échoué. Consultez l'historique de la tâche pour le détail technique.";
  return "La tentative de correction automatique a échoué. Consultez les détails de la tâche, puis vérifiez le projet avant de réessayer.";
}

/**
 * `eligibility` is the CALLER's own already-computed canSelectCveTask()
 * result (the exact same call the checkbox itself uses) -- never
 * recomputed here, so this module's `selectable` can never drift from the
 * one authoritative gate by construction, not merely by convention.
 */
export function getOwaspRemediationPresentation(
  task: any,
  eligibility: CveSelectionEligibility,
  cve: { fixedVersion?: string; pkg?: string; installedVersion?: string } = {},
): OwaspRemediationPresentation {
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

  // ── An attempt already exists: its OWN outcome takes priority over the
  // static eligibility classification below (an already-DISPATCHING/
  // CANDIDATE_READY/CLOSED/FAILED finding is never re-presented as if no
  // attempt had ever been made). ──
  if (status && IN_PROGRESS_STATUSES.has(status)) {
    return {
      state: 'DISPATCHING', label: 'Correction en cours',
      explanation: 'Une tentative de correction est actuellement en cours.',
      selectable: eligibility.selectable, installedVersion, targetVersion: resolveFixedVersion(cve, task) || null,
      targetSource: (snapshot.fixedVersionSource === 'TRIVY_CORRELATED' || task.source === 'TRIVY') ? 'Trivy' : null,
      styleKey: 'progress',
    };
  }
  if (status && READY_STATUSES.has(status)) {
    const prNumber = remediation?.prNumber ?? null;
    return {
      state: 'CANDIDATE_READY',
      label: prNumber ? `Correction proposée (PR #${prNumber})` : 'Correction proposée',
      explanation: 'Une correction candidate a été générée et validée par le pipeline.',
      selectable: eligibility.selectable, installedVersion, targetVersion: resolveFixedVersion(cve, task) || null,
      targetSource: (snapshot.fixedVersionSource === 'TRIVY_CORRELATED' || task.source === 'TRIVY') ? 'Trivy' : null,
      styleKey: 'success', prNumber, prUrl: remediation?.prUrl ?? null,
    };
  }
  if (status && CLOSED_STATUSES.has(status)) {
    const prNumber = remediation?.prNumber ?? null;
    return {
      state: 'CLOSED', label: 'Vulnérabilité corrigée',
      explanation: "La correction a été validée et la vulnérabilité ciblée n'est plus détectée par le rescan de sécurité.",
      selectable: eligibility.selectable, installedVersion, targetVersion: resolveFixedVersion(cve, task) || null,
      targetSource: (snapshot.fixedVersionSource === 'TRIVY_CORRELATED' || task.source === 'TRIVY') ? 'Trivy' : null,
      styleKey: 'success', prNumber, prUrl: remediation?.prUrl ?? null,
    };
  }
  if (status) {
    // Every other non-empty status this contract can carry (TECHNICAL_FAILURE,
    // DISPATCH_FAILED, NOT_ELIGIBLE, PATCH_CONFLICT, CANDIDATE_BUILD_FAILED,
    // APPLICATION_TESTS_FAILED, STILL_OPEN, ...) — a real attempt happened
    // and did not reach a positive outcome.
    return {
      state: 'FAILED', label: 'Correction automatique échouée',
      explanation: humanizeFailureReason(remediation?.reason),
      // Retry uses the SAME eligibility gate as a first attempt (existing
      // backend contract: launch-batch only refuses a re-launch when the
      // task is currently DISPATCHING/CANDIDATE_READY/CLOSED, none of which
      // apply here) -- never a new retry rule invented client-side.
      selectable: eligibility.selectable, installedVersion, targetVersion: resolveFixedVersion(cve, task) || null,
      targetSource: (snapshot.fixedVersionSource === 'TRIVY_CORRELATED' || task.source === 'TRIVY') ? 'Trivy' : null,
      styleKey: 'danger',
    };
  }

  if (task.status === 'VERIFIED' && task.scannerStatus === 'NOT_DETECTED') {
    return { state: 'CLOSED', label: 'Vulnérabilité corrigée',
      explanation: 'Une nouvelle analyse a confirmé que la vulnérabilité n’est plus détectée.',
      selectable: false, installedVersion, targetVersion: resolveFixedVersion(cve, task) || null,
      targetSource: task.source === 'TRIVY' || snapshot.fixedVersionSource === 'TRIVY_CORRELATED' ? 'Trivy' : null,
      styleKey: 'success' };
  }

  const decision = task.v1_8Decision;
  if (decision && (decision.state !== 'VALIDATED_RECOMMENDED' || decision.requiresDeveloperReview === true)) {
    const v18 = getV1_8Presentation(decision, installedVersion)!;
    return { state: 'MANUAL_REVIEW_NO_TARGET', label: v18.label, explanation: v18.reason,
      selectable: false, installedVersion, targetVersion: null, targetSource: null, styleKey: v18.styleKey };
  }
  if (decision?.sandboxValidated && decision?.targetCveClosed && decision?.recommendedVersion) {
    return { state: 'AUTO_FIX_AVAILABLE', label: 'Correction validée',
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

/**
 * Phase 5 — OWASP tab summary, computed from the SAME classification this
 * module uses per-row, never a second, independently-maintained tally.
 * `tasks` are the OWASP ManualRemediationTask rows for the CURRENT report's
 * findings only (caller's responsibility, same as the rest of this page).
 */
export interface OwaspRemediationSummary {
  total: number;
  autoFixAvailable: number;
  manualMultipleTargets: number;
  manualNoTarget: number;
  mavenDataMissing: number;
  dispatching: number;
  candidateReady: number;
  closed: number;
  failed: number;
  noTask: number;
}

export function summarizeOwaspRemediation<TCve extends { fixedVersion?: string; pkg?: string }>(
  owaspCves: TCve[],
  taskFor: (cve: TCve) => any,
  eligibilityFor: (task: any, cve: TCve) => CveSelectionEligibility,
): OwaspRemediationSummary {
  const summary: OwaspRemediationSummary = {
    total: owaspCves.length, autoFixAvailable: 0, manualMultipleTargets: 0, manualNoTarget: 0,
    mavenDataMissing: 0, dispatching: 0, candidateReady: 0, closed: 0, failed: 0, noTask: 0,
  };
  for (const cve of owaspCves) {
    const task = taskFor(cve);
    const presentation = getOwaspRemediationPresentation(task, eligibilityFor(task, cve), cve);
    switch (presentation.state) {
      case 'AUTO_FIX_AVAILABLE': summary.autoFixAvailable++; break;
      case 'MANUAL_REVIEW_MULTIPLE_TARGETS': summary.manualMultipleTargets++; break;
      case 'MANUAL_REVIEW_NO_TARGET': summary.manualNoTarget++; break;
      case 'MAVEN_DATA_MISSING': summary.mavenDataMissing++; break;
      case 'DISPATCHING': summary.dispatching++; break;
      case 'CANDIDATE_READY': summary.candidateReady++; break;
      case 'CLOSED': summary.closed++; break;
      case 'FAILED': summary.failed++; break;
      case 'NO_TASK': summary.noTask++; break;
    }
  }
  return summary;
}
