// Présentation du score de sécurité (contrat backend : entier 0-100, ou null si non calculable) —
// ne recalcule jamais le score, formate seulement "<score> /100".

// Vrai seulement pour un nombre fini réellement dans le contrat 0-100.
export function isValidScoreOn100(score: unknown): score is number {
  return typeof score === 'number' && Number.isFinite(score) && score >= 0 && score <= 100;
}

// Formate le score en "<score> /100", ou renvoie null si la valeur n'est pas un score exploitable.
export function formatScoreOn100(score: unknown): string | null {
  return isValidScoreOn100(score) ? `${score} /100` : null;
}
