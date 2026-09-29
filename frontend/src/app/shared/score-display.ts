// ─────────────────────────────────────────────────────────────────────
// Contrat plateforme (voir backend/src/common/security-score.ts,
// calculateSecurityScore) : Report.securityScore / Project.securityScore
// et le score "live" recalculé par dashboard.service.ts SONT LA MÊME
// FORMULE, TOUJOURS un entier 0-100 (Math.round + double Math.min/Math.max
// déjà appliqués côté backend) — jamais 0-1, jamais 0-10, jamais déjà
// suffixé/formaté en chaîne. Un score absent/non calculable est TOUJOURS
// `null` (jamais 0 fabriqué -- voir reports.service.ts:64).
//
// Ce module ne fait QUE la présentation ("<score> /100") : il ne recalcule
// jamais le score, ne le stocke jamais reformaté, et ne force jamais un
// arrondi -- le contrat backend est déjà un entier, donc aucune décimale à
// gérer ici. Scanner-agnostique par construction : il ne connaît aucun nom
// de scanner ni de projet, seulement "un nombre 0-100 ou son absence".
// ─────────────────────────────────────────────────────────────────────

/** true seulement pour un nombre fini réellement dans le contrat 0-100. */
export function isValidScoreOn100(score: unknown): score is number {
  return typeof score === 'number' && Number.isFinite(score) && score >= 0 && score <= 100;
}

/** "<score> /100", ou `null` si la valeur n'est pas un score exploitable -- au caller de choisir le libellé de repli adapté à son contexte UX. */
export function formatScoreOn100(score: unknown): string | null {
  return isValidScoreOn100(score) ? `${score} /100` : null;
}
