// ─────────────────────────────────────────────────────────────────────
// Présentation uniquement, scanner-agnostique : améliore la lisibilité du
// détail d'un finding (Sonar, Trivy, OWASP, ZAP, Jenkins, ...) sans jamais
// inventer une information non fournie par la source d'analyse.
//
// Règles suivies partout dans ce fichier :
//   - Jamais de littéral spécifique à une règle/outil (pas d'identifiant de
//     règle en dur, pas de "SonarQube" en dur) : uniquement les champs génériques déjà
//     présents sur `finding` (severity, type/category, source/stage,
//     rule/ruleKey, remediationType, owner/responsible).
//   - Un texte de repli n'affirme jamais un fait non prouvé : il ne fait
//     que reformuler les champs réellement disponibles, ou l'admet
//     honnêtement quand rien n'est disponible.
//   - La preuve technique brute (evidence/message) n'est jamais réécrite :
//     seule sa PRÉSENCE/ABSENCE est gérée proprement (voir findingEvidenceText).
// ─────────────────────────────────────────────────────────────────────

export interface FindingLike {
  message?: string | null;
  description?: string | null;
  title?: string | null;
  evidence?: string | null;
  impact?: string | null;
  whyImportant?: string | null;
  recommendation?: string | null;
  owner?: string | null;
  responsible?: string | null;
  assignee?: string | null;
  severity?: string | null;
  type?: string | null;
  category?: string | null;
  source?: string | null;
  stage?: string | null;
  rule?: string | null;
  ruleKey?: string | null;
  remediationType?: string | null;
  id?: string | null;
  key?: string | null;
}

function hasValue(v: unknown): boolean {
  return v !== null && v !== undefined && String(v).trim().length > 0;
}

function textOrNull(v: unknown): string | null {
  return hasValue(v) ? String(v).trim() : null;
}

// Nettoyage typographique minimal (espaces, casse initiale, ponctuation
// finale) -- ne reformule jamais le FOND du texte source, seulement sa forme.
function humanizeSentence(raw: string): string {
  const trimmed = raw.replace(/\s+/g, ' ').trim();
  if (!trimmed) return trimmed;
  const capitalized = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  return /[.!?…]$/.test(capitalized) ? capitalized : `${capitalized}.`;
}

/**
 * Description lisible du finding : reformule légèrement (casse, ponctuation)
 * le premier champ texte disponible (description/message/title), sans
 * jamais inventer un contenu que la source ne fournit pas.
 */
export function findingDescriptionText(finding: FindingLike): string {
  const raw = finding?.description ?? finding?.message ?? finding?.title;
  if (!hasValue(raw)) return "Aucune description détaillée n'est fournie par la source d'analyse.";
  return humanizeSentence(String(raw));
}

/**
 * Preuve technique BRUTE (jamais reformulée -- exigence de traçabilité) :
 * la valeur `evidence` si elle est exploitable (ni vide, ni simple doublon
 * de l'identifiant, ni un UUID technique), sinon le message brut, sinon
 * `null` (au caller de décider d'afficher un message neutre ou de masquer
 * le bloc).
 */
export function findingEvidenceText(finding: FindingLike): string | null {
  const evidence = textOrNull(finding?.evidence);
  const id = textOrNull(finding?.id ?? finding?.key);
  const isIdLike = !!evidence && (evidence === id || /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(evidence));
  if (evidence && !isIdLike) return evidence;
  return textOrNull(finding?.message ?? finding?.description);
}

/**
 * "Pourquoi c'est important" : utilise l'explication fournie par la source
 * si elle existe ; sinon construit une phrase générique à partir des SEULS
 * champs factuels disponibles (sévérité, type, règle, source) -- jamais une
 * affirmation de risque non prouvée. Si aucun champ n'est exploitable,
 * l'admet honnêtement plutôt que d'inventer.
 */
export function findingWhyImportantText(finding: FindingLike): string {
  const raw = finding?.impact ?? finding?.whyImportant;
  if (hasValue(raw)) return humanizeSentence(String(raw));

  const severity = textOrNull(finding?.severity);
  const type = textOrNull(finding?.type ?? finding?.category);
  const rule = textOrNull(finding?.rule ?? finding?.ruleKey);
  const source = textOrNull(finding?.source ?? finding?.stage);

  const clauses: string[] = [];
  if (severity) clauses.push(`sévérité ${severity.toLowerCase()}`);
  if (type) clauses.push(`de type ${type.toLowerCase()}`);
  if (rule) clauses.push(`règle ${rule}`);
  if (source) clauses.push(`source ${source}`);

  if (!clauses.length) return "Cette information n'est pas transmise par la source d'analyse.";
  return humanizeSentence(
    `L'outil source ne fournit pas d'explication détaillée pour ce problème ; il est classé avec les caractéristiques suivantes : ${clauses.join(', ')}`,
  );
}

/**
 * "Action recommandée" : la recommandation fournie par la source si elle
 * existe, sinon un message de repli utile (jamais "Non disponible" brut),
 * enrichi de la source/règle quand elles sont connues.
 */
export function findingRecommendationText(finding: FindingLike): string {
  const raw = finding?.recommendation;
  if (hasValue(raw)) return humanizeSentence(String(raw));

  const source = textOrNull(finding?.source ?? finding?.stage);
  const rule = textOrNull(finding?.rule ?? finding?.ruleKey);
  if (source && rule) return `Aucune recommandation fournie par l'outil source (${source}). Consultez la documentation de la règle ${rule} pour la démarche de correction.`;
  if (source) return `Aucune recommandation fournie par l'outil source (${source}).`;
  return "Aucune recommandation fournie par l'outil source.";
}

/**
 * "Responsable" : jamais "Non assigné" brut, et jamais un responsable
 * inventé -- un libellé honnête quand la source n'en fournit pas.
 */
export function findingResponsibleText(finding: FindingLike): string {
  const raw = finding?.owner ?? finding?.responsible ?? finding?.assignee;
  return hasValue(raw) ? String(raw) : 'Aucun responsable assigné pour le moment.';
}

/**
 * "Éligibilité" : dérivé exclusivement de remediationType (déjà un fait
 * fourni par le backend) -- jamais "Automatisation non disponible" (qui se
 * lit comme une donnée manquante) mais une formulation qui décrit l'état réel.
 */
export function findingEligibilityText(finding: FindingLike): string {
  return finding?.remediationType === 'AUTO_FIX_ELIGIBLE'
    ? 'Correction automatisable'
    : 'Nécessite une action humaine';
}
