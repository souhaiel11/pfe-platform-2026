// ─────────────────────────────────────────────────────────────────────
// Présentation uniquement : traduit les valeurs canoniques du backend
// (statuts de stage, types de remédiation) en libellés humains FR pour
// l'affichage. Ne modifie jamais la valeur canonique elle-même — les
// composants continuent de lier/comparer sur la valeur brute (ex.
// [class]="status.toLowerCase()"), seul le TEXTE visible passe par ces
// fonctions.
// ─────────────────────────────────────────────────────────────────────

const STAGE_STATUS_LABELS: Record<string, string> = {
  VALIDATED_RECOMMENDED: 'Correction validée',
  VALIDATED_ALTERNATIVES: 'Corrections validées',
  NO_COMPATIBLE_CANDIDATE: 'Aucune correction compatible',
  SECURITY_TARGET_UNKNOWN: 'Version corrigée non déterminée',
  MAJOR_UPGRADE_REQUIRES_REVIEW: 'Mise à niveau majeure requise',
  VALIDATION_FAILED: 'Échec de la validation',
  PROJECT_CONTEXT_INSUFFICIENT: 'Contexte du projet insuffisant',
  NOT_YET_SANDBOXED: 'Validation non encore exécutée',
  CLOSED: 'Corrigée',
  OPEN: 'À traiter',
  DISPATCHING: 'En cours',
  CANDIDATE_READY: 'Correction proposée',
  FAILED: 'Échec',
  COMPLETED: 'Terminé',
  WARNING: 'Avertissement',
  NOT_ATTEMPTED: 'Non tenté',
  NOT_RUN: 'Non exécuté',
  NOT_REACHED: 'Non atteint',
  PASSED: 'Réussi',
  SUCCESS: 'Réussi',
  UNKNOWN: 'Indéterminé',
  FAILURE: 'Échec',
  ERROR: 'Échec',
  UP: 'Disponible',
  EXITED: 'Arrêté',
  CREATED: 'Créé',
  HEALTHY: 'Disponible',
  UNHEALTHY: 'Indisponible',
  DEPLOYED: 'Déployé',
  RUNNING: 'En cours',
  SKIPPED: 'Non exécuté',
  PENDING: 'En attente',
  BLOCK: 'Bloqué',
  BLOCKED: 'Bloqué',
  READY: 'Prêt',
  NOT_READY: 'Non prêt',
  UNVERIFIED: 'Non vérifié',
  VALID: 'Valide',
  INVALID: 'Invalide',
  INCONCLUSIVE: 'Non concluant',
  APPROVED: 'Approuvé',
  REJECTED: 'Refusé',
  ANALYZING: 'Analyse en cours',
  ANALYZED: 'Analysé',
  FIX_GENERATED: 'Correction générée',
  VALIDATING: 'Validation en cours',
  FIX_PROPOSED: 'Correction proposée',
  AUTO_FIX: 'Correction automatique',
  NOTIFY_ONLY: 'Information uniquement',
  TODO: 'À traiter',
  DONE_BY_USER: 'Traité manuellement',
  VERIFIED: 'Vérifié',
  REOPENED: 'Rouvert',
  DETECTED: 'Détecté',
  STILL_DETECTED: 'Toujours détecté',
  NOT_DETECTED: 'Non détecté',
  UNAVAILABLE: 'Indisponible',
  SCANNER_UNAVAILABLE: 'Analyse indisponible',
  CRITICAL: 'Critique',
  HIGH: 'Élevée',
  MEDIUM: 'Moyenne',
  LOW: 'Faible',
  INFO: 'Information',
  BLOCKER: 'Bloquant',
  BLOCKING: 'Bloquant',
  MAJOR: 'Majeur',
  MINOR: 'Mineur',
  MANUAL: 'Correction manuelle',
  AUTO_FIX_ELIGIBLE: 'Correction automatisable',
  DEVELOPER_ACTION_REQUIRED: 'Action développeur requise',
  ADMIN_ACTION_REQUIRED: 'Action administrateur requise',
  ADMIN: 'Administrateur',
  DEVELOPER: 'Développeur',
  VIEWER: 'Lecteur',
  AGENT: 'Agent',
  UNASSIGNED: 'Non assigné',
  BUILD: 'Build',
  TESTS: 'Tests',
  SONAR: 'SonarQube',
  SECURITY: 'Sécurité',
  TRIVY: 'Trivy',
  OWASP: 'OWASP Dependency-Check',
  ZAP: 'ZAP',
  CONTAINER: 'Conteneur',
  DOCKER: 'Docker',
  DEPLOY: 'Déploiement',
  ROOT_CAUSE: 'Analyse de la cause racine',
  REMEDIATION: 'Correction',
  JUDGE: 'Décision de gouvernance',
  PR_VALIDATION: 'Validation de la Pull Request',
  BUG: 'Anomalie',
  VULNERABILITY: 'Vulnérabilité',
  CODE_SMELL: 'Problème de maintenabilité',
  MAINTAINABILITY: 'Maintenabilité',
};

export function stageStatusLabel(raw: string | null | undefined): string {
  if (!raw) return 'Non disponible';
  const key = String(raw).toUpperCase();
  // Une valeur inconnue peut être un identifiant technique (règle, fichier,
  // clé projet). Ne jamais la déformer : seules les valeurs répertoriées sont
  // traduites pour la présentation.
  return STAGE_STATUS_LABELS[key] ?? String(raw);
}

export function remediationTypeLabel(raw: string | null | undefined): string {
  return stageStatusLabel(raw);
}

const RISK_LEVEL_LABELS: Record<string, string> = {
  CRITICAL: 'Critique', HIGH: 'Élevé', MEDIUM: 'Moyen', LOW: 'Faible',
  INDETERMINATE: 'Indéterminé', INDETERMINE: 'Indéterminé',
};

export function riskLevelLabel(raw: string | null | undefined): string {
  if (!raw) return 'Non disponible';
  return RISK_LEVEL_LABELS[String(raw).toUpperCase()] ?? String(raw);
}

export const presentationLabel = stageStatusLabel;

/** Translate known status tokens embedded in server recommendations. */
export function presentationText(value: unknown): string {
  return String(value || '').replace(/\bQuality Gate\b/gi, 'contrôle qualité').replace(/\bstatus:/gi, 'état :').replace(/\bstage(?=\s)/gi, 'étape').replace(/\b[A-Z][A-Z0-9_]+\b/g, token => token === 'OWASP' ? token : (STAGE_STATUS_LABELS[token] || token));
}

const ZAP_ALERT_LABELS: Record<string, string> = {
  'spring actuator information leak': 'Exposition d’informations via Spring Actuator',
  'weak authentication method': 'Méthode d’authentification insuffisante',
  'missing anti-clickjacking header': 'Protection contre le détournement de clics absente',
  'content security policy (csp) header not set': 'Politique de sécurité du contenu absente',
  'x-content-type-options header missing': 'Protection contre la détection du type de contenu absente',
  'sql injection': 'Injection SQL',
  'cross site scripting (reflected)': 'Injection de script réfléchie',
  'cross site scripting (persistent)': 'Injection de script persistante',
};
export function zapAlertLabel(title: unknown): string {
  return ZAP_ALERT_LABELS[String(title || '').trim().toLowerCase()] || 'Alerte de sécurité ZAP';
}
