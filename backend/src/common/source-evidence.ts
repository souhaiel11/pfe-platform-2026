// Contrat UNIQUE de lien de source / preuve — seule définition, réutilisée par tous les consommateurs (projet, incident, remédiation, déploiement).

export type EvidenceProvider =
  | 'SONARQUBE'
  | 'JENKINS'
  | 'TRIVY'
  | 'OWASP'
  | 'ZAP'
  | 'GITHUB'
  | 'N8N'
  | 'AZURE'
  | 'ACR'
  | 'DOCKER';

// LINK      : url navigateur exacte, vérifiée — hyperlien autorisé.
// PATH_ONLY : la source est connue et nommée, mais aucune URL navigateur
//             n'existe (fichier dans un workspace, identifiant interne).
//             Le chemin est affiché TEL QUEL, sans hyperlien.
// UNAVAILABLE : aucune information de source — « Source non disponible ».
export type EvidenceAvailability = 'LINK' | 'PATH_ONLY' | 'UNAVAILABLE';

export const EVIDENCE_UNAVAILABLE_LABEL = 'Source non disponible';

export interface SourceEvidence {
  provider: EvidenceProvider;
  /** Identité stable de l'emplacement de preuve (clé machine, non traduite). */
  kind: string;
  /** Libellé d'action affiché ; déjà en français, jamais construit côté vue. */
  label: string;
  availability: EvidenceAvailability;
  /** Non null si et seulement si availability === 'LINK'. */
  url: string | null;
  /** Route de lecture authentifiée de la plateforme, résolue sur l’origine du navigateur. */
  applicationPath?: string | null;
  /** Chemin/identifiant de source exact, affiché tel quel. */
  sourcePath: string | null;
  /** Motif court et honnête d'absence d'URL (null quand une URL existe). */
  reason: string | null;
  buildNumber: number | null;
  commitSha: string | null;
  reportType: string | null;
  evidenceId: string | null;
}

/** Renvoie un texte utilisable à partir de la valeur. */
function text(value: unknown): string | null {
  const trimmed = String(value ?? '').trim();
  return trimmed ? trimmed : null;
}

/** Nettoie Slash. */
function trimSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

/** Lit un entier valide ou signale une valeur absente. */
function integer(value: unknown): number | null {
  if (typeof value === 'number') return Number.isSafeInteger(value) ? value : null;
  const raw = text(value);
  return raw && /^[0-9]{1,15}$/.test(raw) ? Number(raw) : null;
}

/** Un hôte est résoluble par un NAVIGATEUR s'il est localhost, une IP, ou un nom qualifié (au moins un point). */
export function isBrowserResolvableHost(host: string): boolean {
  const value = host.trim().toLowerCase();
  if (!value) return false;
  if (value === 'localhost' || value.endsWith('.localhost')) return true;
  // IPv6 littéral — URL.hostname le rend entre crochets.
  if (value.startsWith('[') && value.endsWith(']')) return true;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)) return true;
  return value.includes('.');
}

/** Assainissement — SEULE porte par laquelle une URL peut devenir cliquable. */
export function browserUrl(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (parsed.username || parsed.password) return null;
  if (!isBrowserResolvableHost(parsed.hostname)) return null;
  return parsed.toString();
}

/** Repère un chemin déjà exprimé comme URL http(s) (valeur de configuration mixte). */
function looksLikeUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

export interface EvidenceInput {
  provider: EvidenceProvider;
  kind: string;
  label: string;
  url?: unknown;
  sourcePath?: unknown;
  /** Motif d'absence d'URL — utilisé seulement si aucune URL ne survit. */
  reason?: string | null;
  buildNumber?: unknown;
  commitSha?: unknown;
  reportType?: string | null;
  evidenceId?: unknown;
}

const PATH_WITHOUT_URL_REASON =
  'Chemin de source connu ; aucune URL navigateur disponible pour cette preuve.';

/** Fabrique UNIQUE. Toute preuve du produit passe ici, donc l'invariant « LINK ⟺ url assainie non nulle » est vrai par construction et non par discipline de chaque appelant. */
export function evidence(input: EvidenceInput): SourceEvidence {
  const url = browserUrl(input.url);
  const sourcePath = text(input.sourcePath);
  const availability: EvidenceAvailability = url ? 'LINK' : sourcePath ? 'PATH_ONLY' : 'UNAVAILABLE';
  return {
    provider: input.provider,
    kind: input.kind,
    label: input.label,
    availability,
    url,
    sourcePath,
    reason: url ? null : (text(input.reason) || (sourcePath ? PATH_WITHOUT_URL_REASON : EVIDENCE_UNAVAILABLE_LABEL)),
    buildNumber: integer(input.buildNumber),
    commitSha: normalizeCommitSha(input.commitSha),
    reportType: text(input.reportType),
    evidenceId: text(input.evidenceId),
  };
}

/** Identité de commit : hexadécimal 7–40, minusculisé. Jamais devinée. */
export function normalizeCommitSha(value: unknown): string | null {
  const raw = text(value);
  return raw && /^[0-9a-f]{7,40}$/i.test(raw) ? raw.toLowerCase() : null;
}

// ─────────────────────────────────────────────────────────────────────────
// Résolveurs de base navigateur
// ─────────────────────────────────────────────────────────────────────────

export interface SonarUrlSource {
  sonarqubePublicUrl?: string | null;
  sonarqubeUrl?: string | null;
}

/** Base SonarQube pour un lien NAVIGATEUR. */
export function resolveSonarqubeBrowserUrl(
  project: SonarUrlSource,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  return trimOrNull(browserUrl(project.sonarqubePublicUrl))
    || trimOrNull(browserUrl(env.SONARQUBE_PUBLIC_URL))
    || trimOrNull(browserUrl(project.sonarqubeUrl));
}

export interface JenkinsBrowserUrlSource {
  jenkinsPublicUrl?: string | null;
  jenkinsUrl?: string | null;
}

/** Base Jenkins pour un lien NAVIGATEUR — jamais jenkinsInternalUrl. */
export function resolveJenkinsBrowserUrl(
  project: JenkinsBrowserUrlSource,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  return trimOrNull(browserUrl(project.jenkinsPublicUrl))
    || trimOrNull(browserUrl(env.JENKINS_PUBLIC_URL))
    || trimOrNull(browserUrl(project.jenkinsUrl));
}

/** Base n8n pour un lien NAVIGATEUR. N8N_URL est interne et sera rejeté s'il l'est. */
export function resolveN8nBrowserUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  return trimOrNull(browserUrl(env.N8N_PUBLIC_URL)) || trimOrNull(browserUrl(env.N8N_URL));
}

/** Nettoie ou Null. */
function trimOrNull(value: string | null): string | null {
  return value ? trimSlash(value) : null;
}

/** Prépare le résultat lié à SonarQube projet preuve. */

export function sonarProjectEvidence(input: {
  baseUrl: string | null;
  projectKey: string | null | undefined;
}): SourceEvidence {
  const key = text(input.projectKey);
  const base = trimOrNull(input.baseUrl);
  return evidence({
    provider: 'SONARQUBE',
    kind: 'SONAR_PROJECT',
    label: 'Voir dans SonarQube',
    url: base && key ? `${base}/dashboard?id=${encodeURIComponent(key)}` : null,
    sourcePath: key,
    evidenceId: key,
    reason: !key
      ? 'Aucune clé de projet SonarQube configurée.'
      : 'Aucune URL SonarQube navigateur configurée (SONARQUBE_PUBLIC_URL ou URL publique du projet).',
  });
}

/** Prépare le résultat lié à SonarQube Issue preuve. */
export function sonarIssueEvidence(input: {
  baseUrl: string | null;
  projectKey: string | null | undefined;
  issueKey: string | null | undefined;
  rule?: string | null;
}): SourceEvidence {
  const base = trimOrNull(input.baseUrl);
  const key = text(input.projectKey);
  const issue = text(input.issueKey);
  const rule = text(input.rule);
  const url = base && key && issue
    ? `${base}/project/issues?id=${encodeURIComponent(key)}&issues=${encodeURIComponent(issue)}&open=${encodeURIComponent(issue)}`
    : null;
  return evidence({
    provider: 'SONARQUBE',
    kind: 'SONAR_ISSUE',
    label: 'Voir l’issue dans SonarQube',
    url,
    sourcePath: issue,
    evidenceId: issue,
    reportType: rule,
    reason: !issue
      ? 'Aucune clé d’issue SonarQube enregistrée pour ce constat.'
      : !key
        ? 'Aucune clé de projet SonarQube configurée.'
        : 'Aucune URL SonarQube navigateur configurée.',
  });
}

/** Règle Sonar (`java:S6204`) — page de règle, distincte de l'issue. */
export function sonarRuleEvidence(input: {
  baseUrl: string | null;
  rule: string | null | undefined;
}): SourceEvidence {
  const base = trimOrNull(input.baseUrl);
  const rule = text(input.rule);
  return evidence({
    provider: 'SONARQUBE',
    kind: 'SONAR_RULE',
    label: 'Voir la règle SonarQube',
    url: base && rule ? `${base}/coding_rules?open=${encodeURIComponent(rule)}&rule_key=${encodeURIComponent(rule)}` : null,
    sourcePath: rule,
    evidenceId: rule,
    reason: rule ? 'Aucune URL SonarQube navigateur configurée.' : 'Aucune règle SonarQube associée à ce constat.',
  });
}

/** Prépare le résultat lié à Jenkins Job URL chemin. */

/**
 * Chemin d'API/URL d'un job. `jenkinsJobPath` existe pour les jobs
 * multibranch (`dossier/job/branche`) où l'identité courte du job diffère du
 * chemin réel — voir project.entity.ts. On préfère donc le chemin quand il
 * est présent, et on le segmente correctement (`a/job/b` → `/job/a/job/b`).
 */
export function jenkinsJobUrlPath(jobPath: string | null | undefined): string | null {
  const raw = text(jobPath);
  if (!raw) return null;
  const segments = raw.split('/').map(s => s.trim()).filter(s => s.length > 0 && s !== 'job');
  if (!segments.length) return null;
  return segments.map(s => `/job/${encodeURIComponent(s)}`).join('');
}

/** Construit le lien de preuve vers le job Jenkins. */
export function jenkinsJobEvidence(input: {
  baseUrl: string | null;
  jobPath: string | null | undefined;
}): SourceEvidence {
  const base = trimOrNull(input.baseUrl);
  const path = jenkinsJobUrlPath(input.jobPath);
  return evidence({
    provider: 'JENKINS',
    kind: 'JENKINS_JOB',
    label: 'Voir le job Jenkins',
    url: base && path ? `${base}${path}/` : null,
    sourcePath: text(input.jobPath),
    evidenceId: text(input.jobPath),
    reason: !text(input.jobPath)
      ? 'Aucun job Jenkins configuré pour ce projet.'
      : 'Aucune URL Jenkins navigateur configurée (URL publique du projet ou JENKINS_PUBLIC_URL).',
  });
}

/** Build EXACT. Deux sources possibles, dans cet ordre : 1. */
export function jenkinsBuildEvidence(input: {
  baseUrl: string | null;
  jobPath: string | null | undefined;
  buildNumber: unknown;
  recordedBuildUrl?: string | null;
  label?: string;
}): SourceEvidence {
  const base = trimOrNull(input.baseUrl);
  const number = integer(input.buildNumber);
  const jobPath = jenkinsJobUrlPath(input.jobPath);
  let url: string | null = null;
  if (base && number !== null && number > 0) {
    let recorded: string | null = null;
    try {
      const source = new URL(String(input.recordedBuildUrl || ''));
      const start = source.pathname.indexOf('/job/');
      if (start >= 0 && source.pathname.replace(/\/+$/, '').endsWith(`/${number}`)) {
        recorded = source.origin + source.pathname.slice(start);
      }
    } catch { /* Reconstruct from the configured job and exact build below. */ }
    const rebased = rebaseOnto(base, recorded);
    url = rebased || (jobPath && number !== null ? `${base}${jobPath}/${number}/` : null);
  }
  return evidence({
    provider: 'JENKINS',
    kind: 'JENKINS_BUILD',
    label: input.label || 'Voir le build Jenkins',
    url,
    sourcePath: number !== null ? `#${number}` : null,
    buildNumber: number,
    evidenceId: number !== null ? String(number) : null,
    reason: number === null
      ? 'Aucun numéro de build enregistré pour cette preuve.'
      : 'Aucune URL Jenkins navigateur configurée.',
  });
}

/** Prépare le résultat lié à Jenkins artefact preuve. */
export function jenkinsArtifactEvidence(input: {
  provider: EvidenceProvider;
  kind: string;
  label: string;
  baseUrl: string | null;
  jobPath: string | null | undefined;
  buildNumber: unknown;
  recordedBuildUrl?: string | null;
  artifactPath: string | null | undefined;
  archived: boolean;
  reportType?: string | null;
}): SourceEvidence {
  const artifact = text(input.artifactPath);
  const build = jenkinsBuildEvidence({
    baseUrl: input.baseUrl,
    jobPath: input.jobPath,
    buildNumber: input.buildNumber,
    recordedBuildUrl: input.recordedBuildUrl,
  });
  const url = input.archived && artifact && build.url
    ? `${trimSlash(build.url)}/artifact/${artifact.split('/').filter(Boolean).map(encodeURIComponent).join('/')}`
    : null;
  return evidence({
    provider: input.provider,
    kind: input.kind,
    label: input.label,
    url,
    sourcePath: artifact,
    buildNumber: input.buildNumber,
    reportType: input.reportType,
    reason: !artifact
      ? 'Aucun chemin de rapport configuré pour ce scanner.'
      : !input.archived
        ? 'Rapport présent dans le workspace du build ; non publié comme artefact navigable.'
        : 'Aucune URL Jenkins navigateur configurée.',
  });
}

/** Prépare le résultat lié à Jenkins console preuve. */
export function jenkinsConsoleEvidence(build: SourceEvidence, label = 'Voir le journal du build'): SourceEvidence {
  return evidence({
    provider: 'JENKINS',
    kind: `${build.kind}_LOGS`,
    label,
    url: build.url ? `${build.url.replace(/\/+$/, '')}/consoleText` : null,
    sourcePath: build.url ? 'consoleText' : null,
    buildNumber: build.buildNumber,
    reason: build.buildNumber === null
      ? 'Aucun numéro de build enregistré : aucun journal à désigner.'
      : 'Aucune URL Jenkins navigateur configurée.',
  });
}

/** Conserve le CHEMIN d'une URL enregistrée, en la rebasant sur une base de confiance. */
export function rebaseOnto(base: string, recorded: string | null | undefined): string | null {
  const raw = text(recorded);
  if (!raw) return null;
  let source: URL;
  let target: URL;
  try {
    source = new URL(raw);
    target = new URL(base);
  } catch {
    return null;
  }
  if (source.protocol !== 'http:' && source.protocol !== 'https:') return null;
  const prefix = target.pathname.replace(/\/+$/, '');
  const path = source.pathname;
  target.pathname = !prefix || path === prefix || path.startsWith(prefix + '/')
    ? path : prefix + '/' + path.replace(/^\/+/, '');
  target.search = source.search;
  target.hash = '';
  return browserUrl(target.toString());
}

// ─────────────────────────────────────────────────────────────────────────
// Rapports de scanner (Trivy / OWASP Dependency-Check / ZAP)
// ─────────────────────────────────────────────────────────────────────────

export interface ScannerReportInput {
  provider: 'TRIVY' | 'OWASP' | 'ZAP';
  /** Chemin configuré pour CE projet (jamais une convention d'outil supposée). */
  configuredPath?: string | null;
  /** Chemin constaté par le scanner lui-même sur ce build. */
  recordedPath?: string | null;
  /** URL constatée par le scanner lui-même (rare ; prioritaire si navigable). */
  recordedUrl?: string | null;
  /**
   * Build qui a PRODUIT le chemin constaté. Jamais supposé être le build
   * courant : sur une vue de portée projet, le chemin constaté peut venir
   * d'un build antérieur au dernier, et le dire est la seule façon de ne pas
   * le faire passer pour la preuve de l'analyse la plus récente.
   */
  buildNumber?: unknown;
  reportType?: string | null;
}

const SCANNER_REPORT_LABEL: Record<ScannerReportInput['provider'], string> = {
  TRIVY: 'Voir le rapport Trivy',
  OWASP: 'Voir le rapport OWASP',
  ZAP: 'Voir le rapport ZAP',
};

/** Renvoie scanner rapport preuve pour le traitement ou l’affichage. */
export function scannerReportEvidence(input: ScannerReportInput): SourceEvidence {
  const configured = text(input.configuredPath);
  const recorded = text(input.recordedPath);
  // Un chemin (configuré ou constaté) qui est déjà une URL http(s) est
  // traité comme une URL, pas comme un chemin de fichier.
  const configuredAsUrl = configured && looksLikeUrl(configured) ? configured : null;
  const recordedAsUrl = recorded && looksLikeUrl(recorded) ? recorded : null;
  const filePath = (recordedAsUrl ? null : recorded) || (configuredAsUrl ? null : configured) || null;
  return evidence({
    provider: input.provider,
    kind: `${input.provider}_REPORT`,
    label: SCANNER_REPORT_LABEL[input.provider],
    url: input.recordedUrl || recordedAsUrl || configuredAsUrl,
    sourcePath: filePath || recordedAsUrl || configuredAsUrl,
    buildNumber: input.buildNumber,
    reportType: input.reportType,
    reason: (configured || recorded)
      ? 'Rapport produit dans le workspace du build ; aucune URL navigateur enregistrée.'
      : 'Aucun chemin de rapport configuré ni constaté pour ce scanner.',
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Git / GitHub
// ─────────────────────────────────────────────────────────────────────────

// Le fournisseur est respecté : seules des coordonnées GitHub produisent des
// URL GitHub. Un dépôt d'un autre hébergeur n'est jamais réécrit en GitHub.
const GITHUB_HOST = 'https://github.com';
const GITHUB_SLUG = /^[\w.-]+\/[\w.-]+$/;

/** `owner/repo` ou une URL github.com complète → base de dépôt. null sinon. */
export function githubRepositoryBase(repo: unknown): string | null {
  const value = text(repo);
  if (!value) return null;
  if (GITHUB_SLUG.test(value)) return `${GITHUB_HOST}/${value}`;
  const direct = browserUrl(value);
  if (!direct) return null;
  const parsed = new URL(direct);
  if (parsed.hostname.toLowerCase() !== 'github.com') return null;
  const path = parsed.pathname.replace(/\.git$/, '').split('/').filter(Boolean);
  return path.length === 2 ? `${GITHUB_HOST}/${path[0]}/${path[1]}` : null;
}

/** Construit le lien de preuve vers le dépôt source. */
export function repositoryEvidence(repo: unknown): SourceEvidence {
  return evidence({
    provider: 'GITHUB',
    kind: 'GIT_REPOSITORY',
    label: 'Voir le dépôt',
    url: githubRepositoryBase(repo),
    sourcePath: text(repo),
    reason: text(repo)
      ? 'Dépôt configuré hors GitHub : aucun contrat de lien connu pour cet hébergeur.'
      : 'Aucun dépôt configuré pour ce projet.',
  });
}

/** Construit le lien de preuve vers le commit source. */
export function commitEvidence(input: {
  repo: unknown;
  commitSha: unknown;
  label?: string;
  kind?: string;
}): SourceEvidence {
  const base = githubRepositoryBase(input.repo);
  const sha = normalizeCommitSha(input.commitSha);
  return evidence({
    provider: 'GITHUB',
    kind: input.kind || 'GIT_COMMIT',
    label: input.label || 'Voir le commit',
    // Le SHA COMPLET est l'identité de source, même si l'UI n'en affiche que 7.
    url: base && sha ? `${base}/commit/${sha}` : null,
    sourcePath: sha,
    commitSha: sha,
    evidenceId: sha,
    reason: !sha
      ? 'Aucun commit source enregistré pour cette preuve.'
      : 'Dépôt non configuré, ou hébergeur sans contrat de lien connu.',
  });
}

/** Fichier source à un commit EXACT (blob/<sha>/<chemin>), jamais blob/main/... */
export function fileEvidence(input: {
  repo: unknown;
  commitSha: unknown;
  filePath: unknown;
  line?: unknown;
  label?: string;
  kind?: string;
}): SourceEvidence {
  const base = githubRepositoryBase(input.repo);
  const sha = normalizeCommitSha(input.commitSha);
  const file = text(input.filePath)?.replace(/^\/+/, '') || null;
  const line = integer(input.line);
  const anchor = line && line > 0 ? `#L${line}` : '';
  const url = base && sha && file
    ? `${base}/blob/${sha}/${file.split('/').map(encodeURIComponent).join('/')}${anchor}`
    : null;
  return evidence({
    provider: 'GITHUB',
    kind: input.kind || 'GIT_FILE',
    label: input.label || 'Voir le fichier source',
    url,
    sourcePath: file ? (line && line > 0 ? `${file}:${line}` : file) : null,
    commitSha: sha,
    reason: !file
      ? 'Aucun fichier source enregistré pour ce constat.'
      : !sha
        ? 'Aucun commit source enregistré : un lien de fichier sans commit désignerait un contenu différent.'
        : 'Dépôt non configuré, ou hébergeur sans contrat de lien connu.',
  });
}

/** Pull Request : on privilégie TOUJOURS l'URL enregistrée par le workflow. */
export function pullRequestEvidence(input: {
  prUrl?: unknown;
  prNumber?: unknown;
  repo?: unknown;
  label?: string;
  kind?: string;
}): SourceEvidence {
  const number = integer(input.prNumber);
  const base = githubRepositoryBase(input.repo);
  const url = browserUrl(input.prUrl) || (base && number !== null ? `${base}/pull/${number}` : null);
  return evidence({
    provider: 'GITHUB',
    kind: input.kind || 'PULL_REQUEST',
    label: input.label || 'Voir la Pull Request',
    url,
    sourcePath: number !== null ? `PR #${number}` : text(input.prUrl),
    evidenceId: number !== null ? String(number) : null,
    reason: 'Aucune Pull Request enregistrée pour cette preuve.',
  });
}

/** Prépare le résultat lié à published image preuve. */

/**
 * Image publiée. Une référence de registre (`<registre>.azurecr.io/<repo>:<tag>`)
 * est une COORDONNÉE, pas une URL : aucun navigateur ne l'ouvre. Elle reste
 * donc un chemin de source exact. Le lien navigable, quand il existe, est
 * celui du portail (voir acrRepositoryEvidence).
 */
export function publishedImageEvidence(input: {
  publishedReference?: unknown;
  registry?: unknown;
  repository?: unknown;
  tag?: unknown;
  digest?: unknown;
  buildNumber?: unknown;
  commitSha?: unknown;
}): SourceEvidence {
  const reference = text(input.publishedReference) || composeImageReference(input);
  return evidence({
    provider: 'DOCKER',
    kind: 'PUBLISHED_IMAGE',
    label: 'Image publiée',
    url: null,
    sourcePath: reference,
    buildNumber: input.buildNumber,
    commitSha: input.commitSha,
    evidenceId: text(input.digest),
    reason: reference
      ? 'Référence d’image de registre : coordonnée de tirage (docker pull), non une adresse navigable.'
      : 'Aucune image publiée enregistrée pour ce build.',
  });
}

/** Assemble la référence complète de l’image Docker. */
function composeImageReference(input: { registry?: unknown; repository?: unknown; tag?: unknown }): string | null {
  const registry = text(input.registry);
  const repository = text(input.repository);
  const tag = text(input.tag);
  if (!repository) return null;
  const host = registry ? (registry.includes('.') ? registry : `${registry}.azurecr.io`) : null;
  return `${host ? host + '/' : ''}${repository}${tag ? ':' + tag : ''}`;
}

/** Dockerfile au commit EXACT du build, jamais sur la branche par défaut. */
export function dockerfileEvidence(input: {
  repo: unknown;
  commitSha: unknown;
  dockerfilePath?: unknown;
}): SourceEvidence {
  return fileEvidence({
    repo: input.repo,
    commitSha: input.commitSha,
    filePath: input.dockerfilePath,
    kind: 'DOCKERFILE',
    label: 'Voir le Dockerfile',
  });
}

const AZURE_PORTAL = 'https://portal.azure.com';

/** Prépare le résultat lié à Azure Resource preuve. */
export function azureResourceEvidence(input: {
  subscriptionRef?: unknown;
  resourceGroup?: unknown;
  resourceProvider: string;
  resourceType: string;
  resourceName?: unknown;
  kind: string;
  label: string;
  sourcePathOverride?: string | null;
  provider?: EvidenceProvider;
}): SourceEvidence {
  const subscription = text(input.subscriptionRef);
  const group = text(input.resourceGroup);
  const name = text(input.resourceName);
  const isGuid = !!subscription && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(subscription);
  const resourceId = isGuid && group && name
    ? `/subscriptions/${subscription}/resourceGroups/${encodeURIComponent(group)}/providers/${input.resourceProvider}/${input.resourceType}/${encodeURIComponent(name)}`
    : null;
  return evidence({
    provider: input.provider || 'AZURE',
    kind: input.kind,
    label: input.label,
    url: resourceId ? `${AZURE_PORTAL}/#@/resource${resourceId}/overview` : null,
    // Sans NOM de ressource il n'y a pas de ressource à désigner : le
    // groupe seul n'est pas la cible (il a son propre emplacement de
    // preuve), donc l'emplacement devient honnêtement indisponible.
    sourcePath: input.sourcePathOverride !== undefined
      ? input.sourcePathOverride
      : (name ? [group, name].filter(Boolean).join(' / ') : null),
    evidenceId: name,
    reason: !name
      ? 'Aucune cible Azure configurée pour ce projet.'
      : !isGuid
        ? 'Aucun identifiant d’abonnement Azure enregistré : un permalien de portail ne peut pas être dérivé.'
        : 'Groupe de ressources Azure non configuré.',
  });
}

/** Prépare le résultat lié à n8n exécution preuve. */

// Exécution n8n EXACTE.
export function n8nExecutionEvidence(input: {
  baseUrl: string | null;
  workflowId?: unknown;
  executionId?: unknown;
  label?: string;
}): SourceEvidence {
  const base = trimOrNull(input.baseUrl);
  const workflow = text(input.workflowId);
  const execution = text(input.executionId);
  const validWorkflow = workflow && /^[A-Za-z0-9_-]{1,64}$/.test(workflow) ? workflow : null;
  const validExecution = execution && /^[0-9]{1,19}$/.test(execution) ? execution : null;
  return evidence({
    provider: 'N8N',
    kind: 'N8N_EXECUTION',
    label: input.label || 'Voir l’exécution n8n',
    url: base && validWorkflow && validExecution
      ? `${base}/workflow/${encodeURIComponent(validWorkflow)}/executions/${encodeURIComponent(validExecution)}`
      : null,
    sourcePath: validExecution ? `Exécution ${validExecution}` : null,
    evidenceId: validExecution,
    reason: !validExecution
      ? 'Aucune exécution n8n enregistrée pour cette tentative.'
      : !validWorkflow
        ? 'Identifiant de workflow n8n inconnu : la route d’exécution n8n l’exige, aucun lien exact n’est dérivable.'
        : 'Aucune URL n8n navigateur configurée (N8N_PUBLIC_URL).',
  });
}

/** Avis public d'une CVE/GHSA — preuve externe, distincte du rapport de scan. */
export function advisoryEvidence(input: {
  reference?: unknown;
  primaryUrl?: unknown;
  provider: 'TRIVY' | 'OWASP';
}): SourceEvidence {
  const reference = text(input.reference);
  const direct = browserUrl(input.primaryUrl);
  const derived = !direct && reference
    ? (/^CVE-/i.test(reference)
      ? `https://nvd.nist.gov/vuln/detail/${encodeURIComponent(reference)}`
      : /^GHSA-/i.test(reference)
        ? `${GITHUB_HOST}/advisories/${encodeURIComponent(reference)}`
        : null)
    : null;
  return evidence({
    provider: input.provider,
    kind: 'ADVISORY',
    label: 'Voir la fiche officielle',
    url: direct || derived,
    sourcePath: reference,
    evidenceId: reference,
    reason: reference
      ? 'Identifiant sans référentiel public connu (ni CVE ni GHSA).'
      : 'Aucun identifiant de vulnérabilité enregistré.',
  });
}
