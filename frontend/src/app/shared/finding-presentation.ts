// Fonctions de présentation scanner-agnostiques pour le détail d'un finding (Sonar, Trivy, OWASP, ZAP, Jenkins...).

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

// Indique si une valeur est présente et non vide une fois convertie en texte.
function hasValue(v: unknown): boolean {
  return v !== null && v !== undefined && String(v).trim().length > 0;
}

// Renvoie le texte trimmé si présent, sinon null.
function textOrNull(v: unknown): string | null {
  return hasValue(v) ? String(v).trim() : null;
}

// Nettoyage typographique minimal (espaces, casse initiale, ponctuation finale) du texte source, sans en changer le fond.
function humanizeSentence(raw: string): string {
  const trimmed = raw.replace(/\s+/g, ' ').trim();
  if (!trimmed) return trimmed;
  const capitalized = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  return /[.!?…]$/.test(capitalized) ? capitalized : `${capitalized}.`;
}

// Description lisible du finding : reformule le premier champ texte disponible (description/message/title).
export function findingDescriptionText(finding: FindingLike): string {
  const raw = finding?.description ?? finding?.message ?? finding?.title;
  if (!hasValue(raw)) return "Aucune description détaillée n'est fournie par la source d'analyse.";
  return humanizeSentence(String(raw));
}

// Preuve technique brute (jamais reformulée) : la valeur evidence si exploitable, sinon le message brut, sinon null.
export function findingEvidenceText(finding: FindingLike): string | null {
  const evidence = textOrNull(finding?.evidence);
  const id = textOrNull(finding?.id ?? finding?.key);
  const isIdLike = !!evidence && (evidence === id || /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(evidence));
  if (evidence && !isIdLike) return evidence;
  return textOrNull(finding?.message ?? finding?.description);
}

// "Pourquoi c'est important" : l'explication fournie par la source si elle existe, sinon une phrase construite depuis les seuls champs factuels disponibles.
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

// "Action recommandée" : la recommandation fournie par la source si elle existe, sinon un message de repli utile.
export function findingRecommendationText(finding: FindingLike): string {
  const raw = finding?.recommendation;
  if (hasValue(raw)) return humanizeSentence(String(raw));

  const source = textOrNull(finding?.source ?? finding?.stage);
  const rule = textOrNull(finding?.rule ?? finding?.ruleKey);
  if (source && rule) return `Aucune recommandation fournie par l'outil source (${source}). Consultez la documentation de la règle ${rule} pour la démarche de correction.`;
  if (source) return `Aucune recommandation fournie par l'outil source (${source}).`;
  return "Aucune recommandation fournie par l'outil source.";
}

// "Responsable" : le responsable fourni par la source, sinon un libellé honnête d'absence.
export function findingResponsibleText(finding: FindingLike): string {
  const raw = finding?.owner ?? finding?.responsible ?? finding?.assignee;
  return hasValue(raw) ? String(raw) : 'Aucun responsable assigné pour le moment.';
}

// "Éligibilité" : traduit remediationType en libellé, en distinguant une correction de dépendance (déterministe) d'une correction de code source (candidate, non garantie).
export function findingEligibilityText(finding: FindingLike): string {
  if (finding?.remediationType !== 'AUTO_FIX_ELIGIBLE') return 'Nécessite une action humaine';
  const isSourceDefect = String(finding?.source || '').toUpperCase() === 'SONARQUBE';
  return isSourceDefect ? 'Correction assistée candidate' : 'Correction automatisable';
}
