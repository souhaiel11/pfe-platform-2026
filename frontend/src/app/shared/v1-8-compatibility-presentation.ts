import { presentationLabel } from './status-labels';
// V1.8 Phase 4 ticket — Phase 9: read-only presentation of the additive
// `v1_8Decision` field (backend: manual-remediation.service.ts's list(),
// opt-in via includeV18=true; source of truth: backend/src/dependency-
// compatibility/v1_8-evidence-store.json, real sandbox/mvn evidence).
//
// Deliberately NOT wired into cve-selection-eligibility.ts/canSelectCveTask()
// -- backend gates and dispatch rules remain authoritative. The scanner
// presentation uses these labels to explain blocked corrections.
export type V1_8PresentationStyleKey = 'success' | 'warning' | 'muted' | 'danger';

export interface V1_8Presentation {
  label: string;
  styleKey: V1_8PresentationStyleKey;
  installedVersion: string | null;
  securityVersion: string | null;
  recommendation: string;
  managedBy: string | null;
  validationLabel: string;
  reason: string;
}

const STATE_STYLES: Record<string, V1_8PresentationStyleKey> = {
  VALIDATED_RECOMMENDED: 'success',
  VALIDATED_ALTERNATIVES: 'success',
  SECURITY_TARGET_UNKNOWN: 'muted',
  PROJECT_CONTEXT_INSUFFICIENT: 'muted',
  MAJOR_UPGRADE_REQUIRES_REVIEW: 'warning',
  NO_COMPATIBLE_CANDIDATE: 'warning',
  VALIDATION_FAILED: 'danger',
  NOT_YET_SANDBOXED: 'muted',
};

function ownerLabel(ownerType: string | null, ownerCoordinate: string | null): string | null {
  if (!ownerType || !ownerCoordinate) return null;
  if (ownerCoordinate === 'org.springframework.boot:spring-boot-starter-parent') return 'Spring Boot Parent';
  const kind = ownerType === 'PARENT' ? 'Parent Maven' : ownerType === 'IMPORTED_BOM' ? 'BOM importé' : 'Gestion locale des dépendances';
  return `${kind} : ${ownerCoordinate}`;
}

/** `decision` is the raw `v1_8Decision` object attached by the backend (V1_8CompatibilityDecision), or null/undefined when includeV18 was not requested or the finding predates the evidence store. */
export function getV1_8Presentation(decision: any, installedVersion: string | null): V1_8Presentation | null {
  if (!decision) return null;
  const meta = { label: STATE_STYLES[decision.state] ? presentationLabel(decision.state) : 'Intervention manuelle requise', styleKey: STATE_STYLES[decision.state] || 'muted' as const };
  const recommendation = decision.recommendedVersion
    ? (decision.ownerCoordinate ? `${ownerLabel(decision.ownerType, decision.ownerCoordinate)} : ${decision.fromVersion || 'version actuelle'} → ${decision.recommendedVersion}` : decision.recommendedVersion)
    : 'Aucune correction automatique recommandée';
  return {
    label: meta.label, styleKey: meta.styleKey,
    installedVersion: decision.installedVersion || installedVersion || null,
    securityVersion: decision.recommendedVersion ?? null,
    recommendation,
    managedBy: ownerLabel(decision.ownerType, decision.ownerCoordinate),
    validationLabel: decision.sandboxValidated ? (decision.targetCveClosed ? 'Réussie' : 'Échec') : 'Non exécutée',
    reason: ({
      SECURITY_TARGET_UNKNOWN: "La vulnérabilité est confirmée, mais aucune version corrigée suffisamment fiable n’a été déterminée automatiquement.",
      NO_COMPATIBLE_CANDIDATE: decision.ownerCoordinate?.includes('spring-boot')
        ? "La dépendance est gérée par le parent Spring Boot. Aucune correction compatible avec la branche actuelle n’a été validée ; une mise à niveau du framework doit être examinée."
        : "Aucune correction compatible avec la configuration Maven actuelle n’a été validée.",
      MAJOR_UPGRADE_REQUIRES_REVIEW: "La correction nécessite une mise à niveau majeure. Vérifiez sa compatibilité avec le projet avant toute intervention.",
      VALIDATION_FAILED: "Une correction candidate a été testée, mais la vulnérabilité reste présente après la nouvelle analyse de sécurité.",
      PROJECT_CONTEXT_INSUFFICIENT: "Les informations du projet sont insuffisantes pour valider une correction. Vérifiez sa configuration Maven.",
    } as Record<string, string>)[decision.state] || (decision.sandboxValidated ? 'La correction a été vérifiée dans un environnement de validation.' : 'La validation de compatibilité reste à effectuer.'),
  };
}
