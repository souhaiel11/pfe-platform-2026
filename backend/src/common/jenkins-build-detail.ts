// Normalise les réponses brutes de Jenkins (build, Stage View, historique) en un objet unique pour la vue "Build".
export interface JenkinsBuildStage {
  id: string | null;
  name: string;
  status: string | null;
  startedAt: number | null;
  durationMs: number | null;
  error: string | null;
}

export interface JenkinsBuildCheckout {
  repo: string | null;
  sha: string | null;
  shortSha: string | null;
  branch: string | null;
  primary: boolean;
}

export interface JenkinsBuildChange {
  sha: string | null;
  shortSha: string | null;
  author: string | null;
  message: string | null;
  date: string | null;
  affectedPaths: string[];
}

export interface JenkinsBuildTests {
  total: number | null;
  failed: number | null;
  skipped: number | null;
  passed: number | null;
}

export interface JenkinsBuildDetail {
  available: boolean;
  reason: string | null;
  message: string | null;
  jobName: string | null;
  number: number | null;
  displayName: string | null;
  description: string | null;
  status: string | null;
  result: string | null;
  building: boolean;
  startedAt: number | null;
  durationMs: number | null;
  estimatedDurationMs: number | null;
  queueDurationMs: number | null;
  queueId: number | null;
  url: string | null;
  trigger: { description: string | null; userName: string | null; type: string | null } | null;
  commit: JenkinsBuildCheckout | null;
  commitReason: string | null;
  checkouts: JenkinsBuildCheckout[];
  changes: JenkinsBuildChange[];
  parameters: { name: string; value: string; masked: boolean }[];
  stages: JenkinsBuildStage[];
  stagesReason: string | null;
  tests: JenkinsBuildTests | null;
  artifacts: { fileName: string | null; relativePath: string | null }[];
  previousBuildNumber: number | null;
  nextBuildNumber: number | null;
  neighbours: { number: number; result: string | null; building: boolean; timestamp: number | null }[];
}

const MAX_CHANGES = 25;
const MAX_AFFECTED_PATHS = 12;
const MAX_PARAMETERS = 30;
const MAX_ARTIFACTS = 40;
const MAX_NEIGHBOURS = 20;

const SECRET_NAME = /(TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|APIKEY|API_KEY|PRIVATE_KEY)/i;

/** Convertit en entier strictement positif, ou renvoie null si la valeur Jenkins est absente ou invalide. */
function positiveInt(value: unknown): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Convertit en entier ≥ 0, ou renvoie null si la valeur Jenkins est absente ou invalide. */
function nonNegativeInt(value: unknown): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/** Renvoie la chaîne non vide après trim, ou null. */
function text(value: unknown): string | null {
  const s = typeof value === 'string' ? value.trim() : '';
  return s ? s : null;
}

/** Renvoie les 12 premiers caractères d'un SHA valide, pour l'affichage condensé. */
function shortSha(sha: string | null): string | null {
  return sha && /^[0-9a-f]{7,40}$/i.test(sha) ? sha.slice(0, 12) : null;
}

/** Valide qu'une valeur a bien la forme d'un SHA git (7 à 40 caractères hexadécimaux), sinon renvoie null. */
function sha(value: unknown): string | null {
  const s = String(value ?? '').trim();
  return /^[0-9a-f]{7,40}$/i.test(s) ? s.toLowerCase() : null;
}

/** Normalise un nom de branche Jenkins (retire le préfixe refs/remotes/.../refs/heads/) pour l'affichage. */
function branchName(raw: unknown): string | null {
  const value = text(raw);
  if (!value) return null;
  return value.replace(/^refs\/remotes\/[^/]+\//, '').replace(/^refs\/heads\//, '') || null;
}

/** Réduit une URL ou un nom de dépôt complet à sa forme "propriétaire/dépôt" en minuscules. */
export function repoSlug(raw: unknown): string | null {
  const value = text(raw);
  if (!value) return null;
  const cleaned = value
    .replace(/^git@([^:]+):/, '')
    .replace(/^https?:\/\/[^/]+\//, '')
    .replace(/\.git$/, '')
    .replace(/\/$/, '');
  const parts = cleaned.split('/').filter(Boolean);
  if (parts.length < 2) return null;
  return parts.slice(-2).join('/').toLowerCase();
}

/** Renvoie la liste des actions Jenkins attachées au build (objets non nuls uniquement). */
function actionsOf(build: any): any[] {
  return Array.isArray(build?.actions) ? build.actions.filter((a: any) => a && typeof a === 'object') : [];
}

/** Trouve la première action dont le `_class` Java contient ce fragment de nom. */
function actionByClass(build: any, needle: string): any | null {
  return actionsOf(build).find((a: any) => String(a._class || '').includes(needle)) || null;
}

/** Extrait qui/quoi a déclenché le build à partir de sa CauseAction. */
function extractTrigger(build: any): JenkinsBuildDetail['trigger'] {
  const cause = actionByClass(build, 'CauseAction')?.causes?.[0];
  if (!cause || typeof cause !== 'object') return null;
  const description = text(cause.shortDescription);
  const userName = text(cause.userName) || text(cause.userId);
  const type = text(String(cause._class || '').split(/[.$]/).pop());
  if (!description && !userName && !type) return null;
  return { description, userName, type };
}

/** Liste tous les checkouts git du build (dédupliqués par dépôt+SHA) et marque comme "primary" celui qui correspond au dépôt du projet. */
function extractCheckouts(build: any, repoHint: string | null): JenkinsBuildCheckout[] {
  const hint = repoSlug(repoHint);
  const seen = new Set<string>();
  const out: JenkinsBuildCheckout[] = [];
  for (const action of actionsOf(build)) {
    if (!String(action._class || '').includes('git.util.BuildData')) continue;
    const revision = action.lastBuiltRevision || {};
    const commitSha = sha(revision.SHA1);
    const repo = text(Array.isArray(action.remoteUrls) ? action.remoteUrls[0] : null);
    const branch = branchName(Array.isArray(revision.branch) ? revision.branch[0]?.name : null);
    const key = `${repo || ''}@${commitSha || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      repo, sha: commitSha, shortSha: shortSha(commitSha), branch,
      primary: hint !== null && repoSlug(repo) === hint,
    });
  }
  return out;
}

/** Liste les commits inclus dans le build (jusqu'à MAX_CHANGES), avec leurs fichiers touchés. */
function extractChanges(build: any): JenkinsBuildChange[] {
  const sets = Array.isArray(build?.changeSets) ? build.changeSets : [];
  const out: JenkinsBuildChange[] = [];
  for (const set of sets) {
    for (const item of Array.isArray(set?.items) ? set.items : []) {
      if (out.length >= MAX_CHANGES) return out;
      const commitSha = sha(item?.commitId);
      const paths = Array.isArray(item?.affectedPaths)
        ? item.affectedPaths.map((p: unknown) => text(p)).filter((p: string | null): p is string => p !== null)
        : [];
      out.push({
        sha: commitSha,
        shortSha: shortSha(commitSha),
        author: text(item?.author?.fullName) || text(item?.authorEmail),
        message: text(item?.msg) || text(item?.comment),
        date: text(item?.date),
        affectedPaths: paths.slice(0, MAX_AFFECTED_PATHS),
      });
    }
  }
  return out;
}

/** Liste les paramètres de build, en masquant la valeur de tout paramètre dont le nom ou le type évoque un secret. */
function extractParameters(build: any): JenkinsBuildDetail['parameters'] {
  const parameters = actionByClass(build, 'ParametersAction')?.parameters;
  if (!Array.isArray(parameters)) return [];
  const out: JenkinsBuildDetail['parameters'] = [];
  for (const parameter of parameters) {
    if (out.length >= MAX_PARAMETERS) break;
    const name = text(parameter?.name);
    if (!name) continue;
    const secret = SECRET_NAME.test(name) || String(parameter?._class || '').includes('Password');
    if (secret) { out.push({ name, value: '•••••', masked: true }); continue; }
    const raw = parameter?.value;
    const value = raw === null || raw === undefined ? '' : String(raw);
    out.push({ name, value: value.length > 200 ? `${value.slice(0, 200)}…` : value, masked: false });
  }
  return out;
}

/** Dérive le décompte de tests réussis uniquement quand total/échecs/ignorés sont tous connus. */
function extractTests(build: any): JenkinsBuildTests | null {
  const action = actionByClass(build, 'TestResultAction');
  if (!action) return null;
  const total = nonNegativeInt(action.totalCount);
  const failed = nonNegativeInt(action.failCount);
  const skipped = nonNegativeInt(action.skipCount);
  const passed = total !== null && failed !== null && skipped !== null
    ? Math.max(total - failed - skipped, 0)
    : null;
  if (total === null && failed === null && skipped === null) return null;
  return { total, failed, skipped, passed };
}

/** Liste les artefacts de build (jusqu'à MAX_ARTIFACTS), en ignorant les entrées sans nom ni chemin. */
function extractArtifacts(build: any): JenkinsBuildDetail['artifacts'] {
  const artifacts = Array.isArray(build?.artifacts) ? build.artifacts : [];
  return artifacts.slice(0, MAX_ARTIFACTS).map((a: any) => ({
    fileName: text(a?.fileName), relativePath: text(a?.relativePath),
  })).filter((a: any) => a.fileName || a.relativePath);
}

/** Convertit la Stage View Jenkins (wfapi/describe) en étapes normalisées ; distingue "plugin muet" de "aucune étape enregistrée". */
function extractStages(workflow: any): { stages: JenkinsBuildStage[]; reason: string | null } {
  if (!workflow || typeof workflow !== 'object') {
    return { stages: [], reason: 'STAGE_VIEW_UNAVAILABLE' };
  }
  const raw = Array.isArray(workflow.stages) ? workflow.stages : [];
  if (!raw.length) return { stages: [], reason: 'NO_STAGE_RECORDED' };
  return {
    stages: raw.map((s: any) => ({
      id: text(s?.id),
      name: text(s?.name) || 'Étape sans nom',
      status: text(s?.status)?.toUpperCase() ?? null,
      startedAt: positiveInt(s?.startTimeMillis),
      durationMs: nonNegativeInt(s?.durationMillis),
      error: text(s?.error?.message),
    })),
    reason: null,
  };
}

/** Liste les builds voisins (pour la navigation précédent/suivant), jusqu'à MAX_NEIGHBOURS. */
function extractNeighbours(history: any): JenkinsBuildDetail['neighbours'] {
  const builds = Array.isArray(history?.builds) ? history.builds : [];
  return builds.slice(0, MAX_NEIGHBOURS).map((b: any) => ({
    number: positiveInt(b?.number),
    result: text(b?.result),
    building: b?.building === true,
    timestamp: positiveInt(b?.timestamp),
  })).filter((b: any): b is JenkinsBuildDetail['neighbours'][number] => b.number !== null);
}

/** Construit la forme stable d'un détail de build indisponible (jamais un build fabriqué). */
export function unavailableBuildDetail(
  jobName: string | null, reason: string, message: string,
): JenkinsBuildDetail {
  return {
    available: false, reason, message,
    jobName: jobName || null,
    number: null, displayName: null, description: null,
    status: null, result: null, building: false,
    startedAt: null, durationMs: null, estimatedDurationMs: null,
    queueDurationMs: null, queueId: null, url: null,
    trigger: null, commit: null, commitReason: null,
    checkouts: [], changes: [], parameters: [],
    stages: [], stagesReason: null, tests: null, artifacts: [],
    previousBuildNumber: null, nextBuildNumber: null, neighbours: [],
  };
}

/** Assemble les trois réponses Jenkins (build, stage view, historique) en un objet unique pour la vue "Build", sans jamais inventer de valeur absente. */
export function normalizeJenkinsBuildDetail(input: {
  build: any;
  workflow?: any;
  history?: any;
  jobName?: string | null;
  repoHint?: string | null;
}): JenkinsBuildDetail {
  const { build } = input;
  const jobName = input.jobName || null;
  const building = build?.building === true || build?.inProgress === true;
  const result = text(build?.result);
  const checkouts = extractCheckouts(build, input.repoHint ?? null);
  const primaries = checkouts.filter(c => c.primary && c.sha);
  const commit = primaries.length === 1 ? primaries[0] : null;
  const commitReason = commit
    ? null
    : primaries.length > 1 ? 'AMBIGUOUS_PROJECT_CHECKOUT'
      : checkouts.length ? 'PROJECT_REPO_NOT_MATCHED'
        : 'NO_GIT_CHECKOUT_RECORDED';
  const { stages, reason: stagesReason } = extractStages(input.workflow);

  return {
    available: true, reason: null, message: null,
    jobName,
    number: positiveInt(build?.number),
    displayName: text(build?.displayName),
    description: text(build?.description),
    status: building ? 'RUNNING' : result,
    result,
    building,
    startedAt: positiveInt(build?.timestamp),
    durationMs: building ? null : (nonNegativeInt(build?.duration) || null),
    estimatedDurationMs: nonNegativeInt(build?.estimatedDuration) || null,
    queueDurationMs: nonNegativeInt(input.workflow?.queueDurationMillis),
    queueId: positiveInt(build?.queueId),
    url: text(build?.url),
    trigger: extractTrigger(build),
    commit, commitReason, checkouts,
    changes: extractChanges(build),
    parameters: extractParameters(build),
    stages, stagesReason,
    tests: extractTests(build),
    artifacts: extractArtifacts(build),
    previousBuildNumber: positiveInt(build?.previousBuild?.number),
    nextBuildNumber: positiveInt(build?.nextBuild?.number),
    neighbours: extractNeighbours(input.history),
  };
}

/** Renvoie les N dernières lignes d'un journal de console, sans jamais tronquer au milieu d'une ligne. */
export function tailConsoleLines(raw: unknown, tail: number): { lines: string[]; truncated: boolean; totalLines: number } {
  const content = typeof raw === 'string' ? raw : '';
  if (!content) return { lines: [], truncated: false, totalLines: 0 };
  const all = content.replace(/\r\n?/g, '\n').split('\n');
  if (all.length && all[all.length - 1] === '') all.pop();
  const size = Number.isInteger(tail) && tail > 0 ? tail : 200;
  return {
    lines: all.slice(-size),
    truncated: all.length > size,
    totalLines: all.length,
  };
}
