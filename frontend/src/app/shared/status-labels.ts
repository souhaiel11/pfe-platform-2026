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
};

export function stageStatusLabel(raw: string | null | undefined): string {
  if (!raw) return 'Non disponible';
  const key = String(raw).toUpperCase();
  return STAGE_STATUS_LABELS[key] ?? raw;
}

const REMEDIATION_TYPE_LABELS: Record<string, string> = {
  AUTO_FIX_ELIGIBLE: 'Correction automatisable',
  DEVELOPER_ACTION_REQUIRED: 'Action développeur requise',
  ADMIN_ACTION_REQUIRED: 'Action administrateur requise',
};

export function remediationTypeLabel(raw: string | null | undefined): string {
  if (!raw) return '';
  const key = String(raw).toUpperCase();
  return REMEDIATION_TYPE_LABELS[key] ?? raw;
}
