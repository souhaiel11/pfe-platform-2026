// Regroupe les traitements de projet liste ligne.
import { frenchDate, frenchRelative } from '../../shared/french-format';

// ───────────────────────────────────────────────────────────────────── Ligne de la liste des projets (§29).

export type BuildState = 'KNOWN' | 'NO_BUILD' | 'NOT_CONFIGURED' | 'UNAVAILABLE';
export type SecurityState = 'KNOWN' | 'INCOMPLETE' | 'UNAVAILABLE';
export type DeploymentState = 'READY' | 'NOT_READY' | 'NOT_CONFIGURED' | 'UNAVAILABLE';

export interface ProjectListBuild {
  state: BuildState;
  /** Résultat Jenkins du dernier build (SUCCESS, FAILURE, …) ou null. */
  status: string | null;
  number: number | null;
  /** Vrai quand le numéro vient de la corrélation plateforme, Jenkins muet. */
  numberFromPlatform: boolean;
  /** Motif exact quand l'état est UNAVAILABLE — affiché en infobulle. */
  detail: string | null;
}

export interface ProjectListSecurity {
  state: SecurityState;
  score: number | null;
  criticalCves: number | null;
  missingScanners: string[];
}

export interface ProjectListDeployment {
  state: DeploymentState;
  blockingCount: number | null;
  firstReason: string | null;
}

export interface ProjectListRow {
  id: string;
  name: string;
  repository: string | null;
  environment: string | null;
  build: ProjectListBuild;
  security: ProjectListSecurity;
  deployment: ProjectListDeployment;
  openIncidents: number | null;
  analyzingIncidents: number | null;
  lastActivity: string | null;
  lastActivityExact: string | null;
}

/** Entier, ou null. Le rejet explicite de null / undefined / '' / booléen n'est pas de la défense gratuite : Number(null) et Number('') valent 0. */
function integerOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const n = Number(value);
  return Number.isFinite(n) && Number.isInteger(n) ? n : null;
}

/** État du dernier build. */
export function buildCell(jenkins: any, readiness: any, project?: any): ProjectListBuild {
  const correlated = integerOrNull(readiness?.currentBuild);
  // Un job non configuré est un fait de CONFIGURATION, jamais une panne.
  // Testé avant tout le reste : il ne dépend d'aucune lecture distante.
  if (project && !String(project.jenkinsJobName ?? '').trim()) {
    return {
      state: 'NOT_CONFIGURED', status: null,
      number: null, numberFromPlatform: false,
      detail: 'Aucun job Jenkins n’est configuré pour ce projet.',
    };
  }
  if (!jenkins) {
    return {
      state: 'UNAVAILABLE', status: null,
      number: correlated, numberFromPlatform: correlated !== null,
      detail: 'Les données Jenkins n’ont pas été chargées.',
    };
  }
  const error = typeof jenkins.error === 'string' && jenkins.error.trim() ? jenkins.error.trim() : null;
  if (error) {
    // Deux FAITS juxtaposés, pas une cause déduite : le motif exact rapporté
    // par le backend, et — seulement s'il est vrai — l'absence d'identifiant
    // Jenkins enregistré pour ce projet. On n'écrit jamais « échec parce que
    // le credential manque » : le backend ne dit pas pourquoi, et deviner à
    // sa place serait inventer.
    const noCredential = project?.jenkinsCredentialConfigured === false
      ? ' Aucun identifiant Jenkins n’est enregistré pour ce projet.'
      : '';
    return {
      state: 'UNAVAILABLE', status: null,
      number: correlated, numberFromPlatform: correlated !== null,
      detail: error + noCredential,
    };
  }
  const last = jenkins.lastBuild;
  if (!last) {
    // Jenkins a répondu et ne rapporte aucun build : c'est un fait constaté,
    // pas une panne. Un projet sans job configuré tombe aussi ici.
    return {
      state: 'NO_BUILD', status: null,
      number: correlated, numberFromPlatform: correlated !== null,
      detail: null,
    };
  }
  return {
    state: 'KNOWN',
    status: typeof last.result === 'string' && last.result ? last.result : null,
    number: integerOrNull(last.number),
    numberFromPlatform: false,
    detail: null,
  };
}

/** État de sécurité. entry est l'entrée byProject de security-global. */
export function securityCell(entry: any): ProjectListSecurity {
  if (!entry) return { state: 'UNAVAILABLE', score: null, criticalCves: null, missingScanners: [] };
  const missing = Array.isArray(entry.missingScanners) ? entry.missingScanners.filter((s: unknown) => typeof s === 'string') : [];
  const score = integerOrNull(entry.securityScore);
  if (entry.incomplete === true) {
    return { state: 'INCOMPLETE', score, criticalCves: integerOrNull(entry.criticalCves), missingScanners: missing };
  }
  if (score === null) {
    return { state: 'UNAVAILABLE', score: null, criticalCves: integerOrNull(entry.criticalCves), missingScanners: missing };
  }
  return { state: 'KNOWN', score, criticalCves: integerOrNull(entry.criticalCves), missingScanners: missing };
}

/** État de déploiement. */
export function deploymentCell(readiness: any): ProjectListDeployment {
  if (!readiness) return { state: 'UNAVAILABLE', blockingCount: null, firstReason: null };
  if (readiness.deploymentConfigured === false) return { state: 'NOT_CONFIGURED', blockingCount: null, firstReason: null };
  const reasons: string[] = Array.isArray(readiness.blockingReasons)
    ? readiness.blockingReasons.filter((r: unknown) => typeof r === 'string' && r.trim())
    : (Array.isArray(readiness.reasons) ? readiness.reasons.filter((r: unknown) => typeof r === 'string' && r.trim()) : []);
  if (readiness.ready === true) return { state: 'READY', blockingCount: 0, firstReason: null };
  if (readiness.ready === false) {
    return { state: 'NOT_READY', blockingCount: reasons.length, firstReason: reasons[0] ?? null };
  }
  return { state: 'UNAVAILABLE', blockingCount: null, firstReason: null };
}

/** Construit projet liste ligne. */
export function buildProjectListRow(
  project: any,
  security: any,
  jenkins: any,
  readiness: any,
  now: Date = new Date(),
): ProjectListRow {
  const activity = project?.updatedAt || project?.createdAt || null;
  const relative = frenchRelative(activity, now);
  return {
    id: String(project?.id ?? ''),
    name: project?.name || 'Projet sans nom',
    repository: project?.githubRepo || null,
    environment: project?.environment || null,
    build: buildCell(jenkins, readiness, project),
    security: securityCell(security),
    deployment: deploymentCell(readiness),
    openIncidents: integerOrNull(project?.openIncidents),
    analyzingIncidents: integerOrNull(project?.analyzingIncidents),
    lastActivity: relative,
    lastActivityExact: relative && activity ? frenchDate(activity) : null,
  };
}

/** Un projet « demande une attention » quand un fait CONSTATÉ le dit : un build en échec, un incident ouvert, un déploiement refusé, ou un score de sécurité bas. */
export function needsAttention(row: ProjectListRow): boolean {
  if (row.build.state === 'KNOWN' && ['FAILURE', 'FAILED', 'ERROR', 'UNSTABLE', 'ABORTED'].includes(String(row.build.status).toUpperCase())) return true;
  if ((row.openIncidents ?? 0) > 0) return true;
  if (row.deployment.state === 'NOT_READY') return true;
  if (row.security.score !== null && row.security.score < 60) return true;
  return false;
}

/** Les raisons EXACTES pour lesquelles un projet demande une attention. */
export function attentionReasons(row: ProjectListRow): string[] {
  const reasons: string[] = [];
  if (row.build.state === 'KNOWN' && ['FAILURE', 'FAILED', 'ERROR'].includes(String(row.build.status).toUpperCase())) {
    reasons.push(row.build.number !== null ? `Build #${row.build.number} en échec` : 'Dernier build en échec');
  }
  if (row.build.state === 'KNOWN' && ['UNSTABLE', 'ABORTED'].includes(String(row.build.status).toUpperCase())) {
    reasons.push(row.build.number !== null ? `Build #${row.build.number} instable ou interrompu` : 'Dernier build instable ou interrompu');
  }
  const open = row.openIncidents ?? 0;
  if (open > 0) reasons.push(`${open} incident${open > 1 ? 's' : ''} ouvert${open > 1 ? 's' : ''}`);
  if (row.deployment.state === 'NOT_READY') {
    const n = row.deployment.blockingCount ?? 0;
    reasons.push(n > 0
      ? `Déploiement bloqué — ${n} condition${n > 1 ? 's' : ''} non satisfaite${n > 1 ? 's' : ''}`
      : 'Déploiement bloqué');
  }
  if (row.security.score !== null && row.security.score < 60) {
    reasons.push(`Score de sécurité ${row.security.score}/100`);
  }
  return reasons;
}

/** Projets triés « ce qui va mal d'abord » (§28) : attention en tête, puis par score croissant, les scores inconnus en dernier. */
export function sortByAttention(rows: ProjectListRow[]): ProjectListRow[] {
  return [...rows].sort((a, b) => {
    const attention = Number(needsAttention(b)) - Number(needsAttention(a));
    if (attention !== 0) return attention;
    const aScore = a.security.score ?? Number.POSITIVE_INFINITY;
    const bScore = b.security.score ?? Number.POSITIVE_INFINITY;
    if (aScore !== bScore) return aScore - bScore;
    return a.name.localeCompare(b.name, 'fr');
  });
}
