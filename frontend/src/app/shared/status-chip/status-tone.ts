// Tonalité visuelle d'un statut — SEULE définition, dérivée de la valeur canonique du backend.

export type StatusTone = 'success' | 'warning' | 'error' | 'pending' | 'neutral' | 'disabled';

const TONES: Record<string, StatusTone> = {
  // Réussite constatée
  SUCCESS: 'success', PASSED: 'success', OK: 'success', VERIFIED: 'success',
  VALID: 'success', VALIDATED: 'success', COMPLETED: 'success', READY: 'success',
  DEPLOYED: 'success', HEALTHY: 'success', UP: 'success', APPROVED: 'success',
  PROVENANCE_VERIFIED: 'success', MERGE_READY: 'success', NOT_DETECTED: 'success',

  // Échec constaté
  FAILURE: 'error', FAILED: 'error', ERROR: 'error', INVALID: 'error',
  CRITICAL: 'error', BLOCKER: 'error', CRITICAL_RISK: 'error', UNHEALTHY: 'error',
  REJECTED: 'error', VALIDATION_FAILED: 'error', HIGH: 'error',

  // Attention, sans échec final
  WARNING: 'warning', UNSTABLE: 'warning', CONDITIONAL: 'warning', MEDIUM: 'warning',
  MAJOR: 'warning', BLOCKED: 'warning', BLOCK: 'warning', STALE: 'warning',
  REVOKED: 'warning', INCONCLUSIVE: 'warning', STILL_DETECTED: 'warning',
  NOT_READY: 'warning', REOPENED: 'warning', TECHNICALLY_IMPOSSIBLE: 'warning',

  // En cours / en attente — JAMAIS un échec
  RUNNING: 'pending', PENDING: 'pending', QUEUED: 'pending', IN_PROGRESS: 'pending',
  PAUSED_PENDING_INPUT: 'pending',
  DISPATCHING: 'pending', ANALYZING: 'pending', VALIDATING: 'pending',
  REQUESTED: 'pending', TODO: 'pending',

  // Proposé, pas constaté — une proposition de correction n'est NI une
  // réussite NI un échec : elle attend une validation déterministe (§11).
  FIX_PROPOSED: 'pending', AUTO_FIX: 'pending', FIX_GENERATED: 'pending',
  CANDIDATE_READY: 'pending', ANALYZED: 'pending',
  NOTIFY_ONLY: 'neutral',

  // Volontairement non applicable / désactivé
  NOT_RUN: 'disabled', SKIPPED: 'disabled', NOT_ATTEMPTED: 'disabled',
  NOT_CONFIGURED: 'disabled', NOT_APPLICABLE: 'disabled', CLOSED: 'disabled',
  NO_BUILD: 'disabled',
  ABORTED: 'disabled', EXITED: 'disabled', NOT_REACHED: 'disabled',
  NOT_EXECUTED: 'disabled',

  // Information manquante — neutre, jamais rouge
  UNKNOWN: 'neutral', UNAVAILABLE: 'neutral', INDETERMINATE: 'neutral',
  INDETERMINE: 'neutral', LOW: 'neutral', MINOR: 'neutral', INFO: 'neutral',
};

/** Tonalité d'un statut. Une valeur absente ou non répertoriée vaut neutral — ne jamais la rendre en rouge : on ne constate pas d'échec, on constate qu'on ne sait pas. */
export function statusTone(raw: unknown): StatusTone {
  const key = String(raw ?? '').trim().toUpperCase();
  if (!key) return 'neutral';
  return TONES[key] ?? 'neutral';
}

// Repère non chromatique, requis pour ne jamais dépendre de la seule couleur.
const GLYPHS: Record<StatusTone, string> = {
  success: '✓', error: '✕', warning: '!', pending: '…', neutral: '–', disabled: '○',
};

/** Traduit une tonalité en repère non chromatique (✓ ✕ ! … – ○), pour que l'information ne repose jamais sur la seule couleur. */
export function statusGlyph(tone: StatusTone): string {
  return GLYPHS[tone];
}

// Variable de thème par tonalité — respecte le thème clair/sombre existant.
const COLORS: Record<StatusTone, string> = {
  success: 'var(--accent-green)',
  error: 'var(--accent-red)',
  warning: 'var(--color-warning)',
  pending: 'var(--accent-blue)',
  neutral: 'var(--text-muted)',
  disabled: 'var(--text-muted)',
};

/** Résout la couleur de thème (claire/sombre) correspondant à la tonalité d'un statut brut. */
export function statusColor(raw: unknown): string {
  return COLORS[statusTone(raw)];
}
