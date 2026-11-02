// Définit et contrôle les données des liens vers les preuves.

export type EvidenceProvider =
  | 'SONARQUBE' | 'JENKINS' | 'TRIVY' | 'OWASP' | 'ZAP'
  | 'GITHUB' | 'N8N' | 'AZURE' | 'ACR' | 'DOCKER';

export type EvidenceAvailability = 'LINK' | 'PATH_ONLY' | 'UNAVAILABLE';

export const EVIDENCE_UNAVAILABLE_LABEL = 'Source non disponible';

export type EvidenceLoadState = 'loading' | 'ready' | 'error';

export interface SourceEvidence {
  provider: EvidenceProvider;
  kind: string;
  label: string;
  availability: EvidenceAvailability;
  url: string | null;
  applicationPath?: string | null;
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
  jenkinsBaseUrl?: string | null;
  slots: Record<string, SourceEvidence>;
  sections: EvidenceSection[];
}

export interface LocalScannerReportInfo {
  scanner: string; available: boolean; sourcePath: string | null;
  relativePath?: string | null;
  filename: string; bytes: number | null; reason: string | null;
}

export interface IncidentSourceEvidence {
  localReports?: LocalScannerReportInfo[];
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

// Portillon de sortie des URLs externes : rejette tout ce qui n'est pas http(s) sans identifiants embarqués (donc en particulier javascript:, data:, user:password@).
export function safeEvidenceUrl(value: unknown): string | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  let parsed: URL;
  try { parsed = new URL(raw); } catch { return null; }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (parsed.username || parsed.password) return null;
  const host = parsed.hostname.toLowerCase();
  if (host !== 'localhost' && !host.endsWith('.localhost') && !host.includes('.') && !host.startsWith('[')) return null;
  return parsed.toString();
}

// Valide qu'un chemin interne correspond exactement au format attendu d'un rapport scanner local, puis le résout en URL absolue sur l'origine courante.
export function localScannerReportUrl(path: unknown, origin?: string | null): string | null {
  const value = String(path ?? '');
  if (!/^\/scanner-reports\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/(trivy|owasp|zap)$/i.test(value)) return null;
  const base = origin ?? (typeof location !== 'undefined' ? location.origin : null);
  const safeBase = safeEvidenceUrl(base);
  return safeBase ? new URL(value, safeBase).toString() : null;
}

// Normalise une preuve reçue du backend (URL assainie, disponibilité LINK/PATH_ONLY/UNAVAILABLE) ; une absence de preuve reste null.
export function normalizeEvidence(raw: any): SourceEvidence | null {
  if (!raw || typeof raw !== 'object') return null;
  const applicationPath = /^\/(scanner-reports)\//.test(String(raw.applicationPath || '')) ? raw.applicationPath : null;
  const url = localScannerReportUrl(applicationPath) || safeEvidenceUrl(raw.url);
  const sourcePath = String(raw.sourcePath ?? '').trim() || null;
  const availability: EvidenceAvailability = url ? 'LINK' : sourcePath ? 'PATH_ONLY' : 'UNAVAILABLE';
  return {
    provider: raw.provider,
    kind: String(raw.kind ?? ''),
    label: String(raw.label ?? '').trim() || 'Source',
    availability,
    url,
    applicationPath: localScannerReportUrl(applicationPath) ? applicationPath : null,
    sourcePath,
    reason: url ? null : (String(raw.reason ?? '').trim() || EVIDENCE_UNAVAILABLE_LABEL),
    buildNumber: typeof raw.buildNumber === 'number' ? raw.buildNumber : null,
    commitSha: String(raw.commitSha ?? '').trim() || null,
    reportType: String(raw.reportType ?? '').trim() || null,
    evidenceId: String(raw.evidenceId ?? '').trim() || null,
  };
}

// Normalise chaque emplacement de preuve d'une table de slots, en écartant silencieusement ceux qui ne se normalisent pas.
export function normalizeEvidenceSlots(raw: any): Record<string, SourceEvidence> {
  const slots: Record<string, SourceEvidence> = {};
  for (const [key, value] of Object.entries(raw || {})) {
    const item = normalizeEvidence(value);
    if (item) slots[key] = item;
  }
  return slots;
}

// Normalise une vue complète : les emplacements de premier niveau et ceux imbriqués (constats de scanner, issues Sonar, chaînes de remédiation).
export function normalizeEvidenceView<T extends {
  slots?: any;
  sonarIssues?: { slots?: any }[];
  findings?: { slots?: any }[];
  remediations?: { slots?: any }[];
}>(view: T): T {
  /** Ajoute les emplacements de preuve au résultat. */
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

// Forme visuelle abrégée d'un identifiant technique : n'abrège que les empreintes opaques (digest sha256, SHA de commit) dont le préfixe suffit à les reconnaître.
export function shortIdentifier(value: string | null | undefined): string | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const digest = /^(sha256:)([0-9a-f]{64})$/i.exec(raw);
  if (digest) return `${digest[1]}${digest[2].slice(0, 12)}…`;
  if (/^[0-9a-f]{40}$/i.test(raw)) return raw.slice(0, 7);
  return raw;
}

// Vrai quand l'abréviation masque réellement une partie de la valeur.
export function isAbbreviated(value: string | null | undefined): boolean {
  const raw = String(value ?? '').trim();
  return !!raw && shortIdentifier(raw) !== raw;
}

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

// Traduit un fournisseur de preuve en libellé affichable, ou « Source » pour une valeur inconnue.
export function providerLabel(provider: unknown): string {
  return EVIDENCE_PROVIDER_LABEL[provider as EvidenceProvider] || 'Source';
}

// Sélectionne un emplacement de preuve par clé, tolérant à une table de preuve absente.
export function evidenceSlot(
  view: { slots?: Record<string, SourceEvidence> } | null | undefined,
  slot: string,
): SourceEvidence | null {
  return view?.slots?.[slot] || null;
}
