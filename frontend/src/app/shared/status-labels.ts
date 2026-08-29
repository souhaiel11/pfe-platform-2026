// ─────────────────────────────────────────────────────────────────────
// Présentation uniquement : traduit les valeurs canoniques du backend
// (statuts de stage, types de remédiation) en libellés humains FR pour
// l'affichage. Ne modifie jamais la valeur canonique elle-même — les
// composants continuent de lier/comparer sur la valeur brute (ex.
// [class]="status.toLowerCase()"), seul le TEXTE visible passe par ces
// fonctions.
// ─────────────────────────────────────────────────────────────────────

const STAGE_STATUS_LABELS: Record<string, string> = {
  FAILED: 'Échec',
  COMPLETED: 'Terminé',
  WARNING: 'Avertissement',
  NOT_RUN: 'Non exécuté',
  NOT_REACHED: 'Non atteint',
  PASSED: 'Réussi',
  SUCCESS: 'Réussi',
  UNKNOWN: 'Indéterminé',
  FAILURE: 'Échec',
  ERROR: 'Échec',
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
