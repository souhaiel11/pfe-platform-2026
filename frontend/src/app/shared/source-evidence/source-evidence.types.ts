// Miroir frontend du contrat de preuve servi par
// backend/src/common/source-evidence.ts.
//
// Le frontend ne CONSTRUIT jamais d'URL de source : il affiche ce que le
// backend a dérivé. Cette règle existe parce que la logique d'URL éparpillée
// dans les composants est exactement ce qui avait produit des liens morts
// (`http://sonarqube:9000`, un alias Docker que le navigateur ne résout pas)
// et des liens vers l'accueil d'un outil présentés comme preuve exacte.
//
// Le SEUL traitement d'URL ici est un portillon de sortie (`safeEvidenceUrl`)
// qui rejette tout ce qui n'est pas un http(s) sans identifiants. Il ne
// fabrique rien : il refuse. Un contrat backend déjà assaini le traverse sans
// changement ; une valeur douteuse n'atteint jamais un attribut [href].

export type EvidenceProvider =
  | 'SONARQUBE' | 'JENKINS' | 'TRIVY' | 'OWASP' | 'ZAP'
  | 'GITHUB' | 'N8N' | 'AZURE' | 'ACR' | 'DOCKER';

export type EvidenceAvailability = 'LINK' | 'PATH_ONLY' | 'UNAVAILABLE';

export const EVIDENCE_UNAVAILABLE_LABEL = 'Source non disponible';

/**
 * État de CHARGEMENT de la table de preuve, strictement distinct de la
 * disponibilité d'un emplacement.
 *
 * « la requête a échoué » et « aucune preuve n'a été enregistrée » sont deux
 * faits différents, et les confondre est un mensonge dans les deux sens : on
 * affirme une absence qu'on n'a pas constatée, et on masque une panne que
 * l'utilisateur pourrait corriger en réessayant. C'est le même principe que
 * l'invariant LINK/PATH_ONLY/UNAVAILABLE, appliqué un niveau plus haut.
 */
export type EvidenceLoadState = 'loading' | 'ready' | 'error';

export interface SourceEvidence {
  provider: EvidenceProvider;
  kind: string;
  label: string;
  availability: EvidenceAvailability;
  url: string | null;
  sourcePath: string | null;
  reason: string | null;
  buildNumber: number | null;
  commitSha: string | null;
  reportType: string | null;
  evidenceId: string | null;
}

export interface EvidenceSection {
  id: string;
  title: string;
  slots: string[];
}

export interface SonarIssueEvidence {
  issueId: string;
  rule: string | null;
  file: string | null;
  line: number | null;
  slots: Record<string, SourceEvidence>;
}

/**
 * Preuve par CONSTAT de scanner (une CVE Trivy/OWASP, une alerte ZAP).
 * Deux faits distincts : l'AVIS public qui décrit la vulnérabilité, et le
 * RAPPORT de scan qui l'a observée sur ce build.
 */
export interface FindingEvidence {
  findingId: string;
  scanner: 'TRIVY' | 'OWASP' | 'ZAP';
  slots: Record<string, SourceEvidence>;
}

export interface RemediationChainEvidence {
  taskId: string;
  scanner: string | null;
  ruleOrCve: string | null;
  slots: Record<string, SourceEvidence>;
  sections: EvidenceSection[];
}

export interface ProjectSourceEvidence {
  projectId: string;
  projectName: string;
  generatedAt: string;
  slots: Record<string, SourceEvidence>;
  sections: EvidenceSection[];
}

export interface IncidentSourceEvidence {
  incidentId: string;
  projectId: string;
  projectName: string;
  buildNumber: number | null;
  commitSha: string | null;
  generatedAt: string;
  slots: Record<string, SourceEvidence>;
  sections: EvidenceSection[];
  sonarIssues: SonarIssueEvidence[];
  findings: FindingEvidence[];
  remediations: RemediationChainEvidence[];
}

/**
 * Portillon de sortie — jamais un constructeur d'URL. Rejette tout ce qui
 * n'est pas http(s) sans identifiants embarqués, donc en particulier
 * `javascript:`, `data:` et `user:password@`.
 */
export function safeEvidenceUrl(value: unknown): string | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  let parsed: URL;
  try { parsed = new URL(raw); } catch { return null; }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (parsed.username || parsed.password) return null;
  return parsed.toString();
}

/**
 * Normalise une preuve reçue du backend, puis ré-applique l'invariant
 * « LINK ⟺ url assainie ». Une absence de preuve n'est jamais inventée ici :
 * `null` reste `null`.
 */
export function normalizeEvidence(raw: any): SourceEvidence | null {
  if (!raw || typeof raw !== 'object') return null;
  const url = safeEvidenceUrl(raw.url);
  const sourcePath = String(raw.sourcePath ?? '').trim() || null;
  const availability: EvidenceAvailability = url ? 'LINK' : sourcePath ? 'PATH_ONLY' : 'UNAVAILABLE';
  return {
    provider: raw.provider,
    kind: String(raw.kind ?? ''),
    label: String(raw.label ?? '').trim() || 'Source',
    availability,
    url,
    sourcePath,
    reason: url ? null : (String(raw.reason ?? '').trim() || EVIDENCE_UNAVAILABLE_LABEL),
    buildNumber: typeof raw.buildNumber === 'number' ? raw.buildNumber : null,
    commitSha: String(raw.commitSha ?? '').trim() || null,
    reportType: String(raw.reportType ?? '').trim() || null,
    evidenceId: String(raw.evidenceId ?? '').trim() || null,
  };
}

export function normalizeEvidenceSlots(raw: any): Record<string, SourceEvidence> {
  const slots: Record<string, SourceEvidence> = {};
  for (const [key, value] of Object.entries(raw || {})) {
    const item = normalizeEvidence(value);
    if (item) slots[key] = item;
  }
  return slots;
}

/**
 * Normalise une vue COMPLÈTE : les emplacements de premier niveau ET ceux
 * imbriqués (constats de scanner, issues Sonar, chaînes de remédiation).
 *
 * Sans cela, une preuve imbriquée traverserait le portillon sans être
 * assainie : c'est précisément le chemin par lequel une URL non navigable
 * redeviendrait un [href]. L'assainissement n'est utile que s'il est
 * appliqué partout, pas seulement à la racine.
 */
export function normalizeEvidenceView<T extends {
  slots?: any;
  sonarIssues?: { slots?: any }[];
  findings?: { slots?: any }[];
  remediations?: { slots?: any }[];
}>(view: T): T {
  const withSlots = <U extends { slots?: any }>(items: U[] | undefined): U[] | undefined =>
    items ? items.map(item => ({ ...item, slots: normalizeEvidenceSlots(item.slots) })) : items;
  return {
    ...view,
    slots: normalizeEvidenceSlots(view.slots),
    ...(view.sonarIssues ? { sonarIssues: withSlots(view.sonarIssues) } : {}),
    ...(view.findings ? { findings: withSlots(view.findings) } : {}),
    ...(view.remediations ? { remediations: withSlots(view.remediations) } : {}),
  };
}

/**
 * Forme VISUELLE abrégée d'un identifiant technique (§20).
 *
 * N'abrège QUE des empreintes opaques, dont le préfixe suffit à les
 * reconnaître : un digest `sha256:` et un SHA de commit. Un chemin de
 * fichier, une référence d'image ou un nom de ressource ne sont JAMAIS
 * tronqués — leur milieu porte l'information (quel fichier, quel dépôt), et
 * la couper rendrait la valeur fausse plutôt que compacte. La valeur
 * complète reste toujours disponible (attribut title + bouton copier).
 */
export function shortIdentifier(value: string | null | undefined): string | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const digest = /^(sha256:)([0-9a-f]{64})$/i.exec(raw);
  if (digest) return `${digest[1]}${digest[2].slice(0, 12)}…`;
  if (/^[0-9a-f]{40}$/i.test(raw)) return raw.slice(0, 7);
  return raw;
}

/** Vrai quand l'abréviation masque réellement une partie de la valeur. */
export function isAbbreviated(value: string | null | undefined): boolean {
  const raw = String(value ?? '').trim();
  return !!raw && shortIdentifier(raw) !== raw;
}

/** Pastille courte par fournisseur — identité visuelle, jamais une URL. */
export const EVIDENCE_PROVIDER_LABEL: Record<EvidenceProvider, string> = {
  SONARQUBE: 'SonarQube',
  JENKINS: 'Jenkins',
  TRIVY: 'Trivy',
  OWASP: 'OWASP',
  ZAP: 'ZAP',
  GITHUB: 'GitHub',
  N8N: 'n8n',
  AZURE: 'Azure',
  ACR: 'Azure Container Registry',
  DOCKER: 'Image',
};

export function providerLabel(provider: unknown): string {
  return EVIDENCE_PROVIDER_LABEL[provider as EvidenceProvider] || 'Source';
}

/** Sélection d'un emplacement, tolérante à une table de preuve absente. */
export function evidenceSlot(
  view: { slots?: Record<string, SourceEvidence> } | null | undefined,
  slot: string,
): SourceEvidence | null {
  return view?.slots?.[slot] || null;
}
