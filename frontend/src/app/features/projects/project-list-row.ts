import { frenchDate, frenchRelative } from '../../shared/french-format';

// ─────────────────────────────────────────────────────────────────────
//  Ligne de la liste des projets (§29).
//
//  La liste doit rendre les projets COMPARABLES : nom, dépôt, dernier build,
//  état de sécurité, état de déploiement, dernière activité. Chacun de ces
//  cinq faits vient d'une source différente, et chacune peut manquer
//  indépendamment des autres.
//
//  D'où le choix de modéliser un ÉTAT par colonne plutôt qu'une simple
//  valeur nullable. « Jenkins n'a pas répondu » et « ce projet n'a aucun
//  build » produisent tous deux `status = null` ; les afficher pareil est
//  faux dans les deux sens — l'un se réessaie, l'autre non (§17). Le même
//  raisonnement sépare « déploiement non configuré » de « déploiement
//  bloqué » : la première n'est pas un problème, la seconde en est un.
//
//  Aucune valeur n'est fabriquée ici. Pas de 0 pour un inconnu, pas de
//  repli sur un autre projet, pas de score hérité de Project.securityScore
//  (désynchronisable sans alerte) : le score vient de security-global, qui
//  est la lecture live.
// ─────────────────────────────────────────────────────────────────────

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

/**
 * Entier, ou null.
 *
 * Le rejet explicite de null / undefined / '' / booléen n'est pas de la
 * défense gratuite : `Number(null)` et `Number('')` valent 0. Un helper
 * naïf transforme donc « score non enregistré » en « score de 0 » — soit
 * exactement le mensonge que §31 interdit, et dans le pire sens possible
 * (un projet non mesuré s'afficherait en rouge critique).
 */
function integerOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const n = Number(value);
  return Number.isFinite(n) && Number.isInteger(n) ? n : null;
}

/**
 * État du dernier build.
 *
 * `jenkins` est l'entrée de GET /dashboard/jenkins-global pour CE projet, ou
 * null quand l'appel global a échoué / n'a pas encore abouti. `readiness`
 * sert uniquement de source du NUMÉRO de build corrélé — jamais de son
 * résultat : la plateforme sait quel build elle a gouverné, elle ne sait pas
 * à sa place si Jenkins l'a réussi.
 *
 * `project` sert à une seule chose, et elle est essentielle : savoir si ce
 * projet a un job Jenkins DU TOUT. Sans cette information, un projet sans
 * job est absent de jenkins-global exactement comme un projet dont la
 * lecture a échoué — et les deux s'affichaient « Indisponible — les données
 * Jenkins n'ont pas été chargées ». C'est faux : rien n'a échoué, il n'y a
 * simplement rien à lire. Affirmer une panne non constatée est précisément
 * ce que la discipline de données interdit, et dans le pire sens : cela
 * envoie le développeur chercher une infrastructure en défaut alors qu'il
 * lui manque une ligne de configuration.
 */
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

/**
 * État de sécurité.
 *
 * `entry` est l'entrée byProject de security-global. Absente, le score reste
 * null — jamais un repli sur Project.securityScore, ni sur la moyenne
 * plateforme, ni sur le score d'un autre projet. `incomplete` est conservé
 * tel quel : un score calculé sans tous les scanners est affiché comme
 * partiel, pas comme un verdict.
 */
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

/**
 * État de déploiement.
 *
 * `deploymentConfigured === false` est un fait renvoyé par le backend : le
 * projet n'a pas de cible, donc ni « prêt » ni « bloqué » ne s'appliquent.
 * Un refus de gouvernance expose son NOMBRE de motifs et le premier d'entre
 * eux, parce que « bloqué » sans pourquoi n'est pas actionnable (§14).
 */
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

/**
 * Un projet « demande une attention » quand un fait CONSTATÉ le dit : un
 * build en échec, un incident ouvert, un déploiement refusé, ou un score
 * de sécurité bas. Jamais une absence d'information : ne pas savoir n'est
 * pas un problème de sécurité, et le présenter comme tel noierait les vrais
 * problèmes (§28).
 */
export function needsAttention(row: ProjectListRow): boolean {
  if (row.build.state === 'KNOWN' && ['FAILURE', 'FAILED', 'ERROR', 'UNSTABLE', 'ABORTED'].includes(String(row.build.status).toUpperCase())) return true;
  if ((row.openIncidents ?? 0) > 0) return true;
  if (row.deployment.state === 'NOT_READY') return true;
  if (row.security.score !== null && row.security.score < 60) return true;
  return false;
}

/**
 * Les raisons EXACTES pour lesquelles un projet demande une attention.
 *
 * « À traiter » sans pourquoi fait exactement ce que §14 reproche à un
 * « CRITICAL_RISK » nu : annoncer un problème sans donner la prise. Chaque
 * entrée correspond donc à un fait constaté et nommé, et la liste est vide
 * — pas « aucun problème détecté » — quand rien n'a été constaté.
 */
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

/**
 * Projets triés « ce qui va mal d'abord » (§28) : attention en tête, puis
 * par score croissant, les scores inconnus en dernier. Ne JAMAIS remonter
 * un projet parce qu'on ignore son état : l'inconnu n'est pas une alerte.
 */
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
