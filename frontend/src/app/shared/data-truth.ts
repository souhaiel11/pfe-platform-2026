// Fonctions de « vérité d'affichage ».

// Renvoie le nombre tel quel s'il est fini et positif, sinon null (une absence ne devient jamais 0).
export function availableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

// Détermine si un bloc scanner (Trivy/OWASP/ZAP/Sonar) porte un résultat réellement exploitable, et non une absence masquée.
export function scannerHasResult(block: any): boolean {
  if (!block || typeof block !== 'object') return false;
  if (block.status && block.status !== 'COMPLETED') return false;
  if (block.executed === false) return false;
  const gateTracked = block.qualityGateResolved !== undefined;
  if (block.resultAvailable === false && !gateTracked) return false;
  return block.status === 'COMPLETED' || block.resultAvailable === true || gateTracked
    || (!block.status && ['cves','issues','alerts'].some(k => Array.isArray(block[k])));
}

// Lit le verdict du contrôle qualité Sonar, en filtrant les marqueurs d'indisponibilité de la plateforme qui ne sont pas de vrais verdicts.
export function sonarQualityGate(block: any): string | null {
  if (!block || typeof block !== 'object') return null;
  const raw = String(block.quality_gate ?? block.qualityGate ?? '').trim().toUpperCase();
  if (!raw) return null;
  const notAVerdict = new Set([
    'QUALITY_GATE_UNAVAILABLE', 'QUALITY_GATE_NOT_COMPUTED', 'API_ERROR',
    'SONAR_ANALYSIS_FAILED', 'SONAR_ANALYSIS_CANCELED', 'SONAR_ANALYSIS_TIMEOUT',
  ]);
  return notAVerdict.has(raw) ? null : raw;
}

const TEST_STAGE_EXECUTED = ['SUCCESS', 'UNSTABLE', 'FAILURE', 'FAILED'];
const TEST_STAGE_NOT_EXECUTED = ['SKIPPED', 'NOT_RUN', 'NOT_REACHED', 'NOT_CONFIGURED'];

// Détermine si l'étape de tests a réellement tourné, pour ne jamais confondre un vrai 0 % de couverture avec une absence de mesure.
export function testStageExecuted(tests: any): boolean {
  if (!tests || typeof tests !== 'object') return false;
  const status = String(tests.status ?? '').trim().toUpperCase();
  if (TEST_STAGE_NOT_EXECUTED.includes(status)) return false;
  if (TEST_STAGE_EXECUTED.includes(status)) return true;
  return availableNumber(tests.total) !== null && tests.total > 0;
}

// Renvoie le taux de couverture mesuré, uniquement si l'étape de tests a réellement tourné.
export function testStageCoverage(tests: any): number | null {
  return testStageExecuted(tests) ? availableNumber(tests.coverage) : null;
}

// Motif précis d'absence de couverture, pour ne pas afficher « Non disponible » à tout.
export function testStageCoverageState(tests: any): string {
  if (!tests || typeof tests !== 'object') return 'Non disponible';
  const status = String(tests.status ?? '').trim().toUpperCase();
  if (!status || status === 'UNKNOWN') return 'Non disponible';
  if (['SKIPPED', 'NOT_RUN', 'NOT_REACHED'].includes(status)) return 'Non execute';
  if (status === 'NOT_CONFIGURED') return 'Non configure';
  return testStageCoverage(tests) === null ? 'Non disponible' : '';
}

// Détecte des constats hérités d'un build précédent (rapport non purgé entre builds) plutôt que produits par ce build-ci.
export function scannerHasStaleFindings(block: any): boolean {
  if (!block || typeof block !== 'object') return false;
  if (block.findingsStale !== true) return false;
  return ['cves', 'issues', 'alerts', 'findings'].some(k => Array.isArray(block[k]) && block[k].length > 0);
}

// Compte les constats « périmés » (hérités d'un build antérieur) détectés dans le bloc, selon le premier champ de liste non vide.
export function scannerStaleFindingCount(block: any): number | null {
  if (!scannerHasStaleFindings(block)) return null;
  for (const k of ['cves', 'issues', 'alerts', 'findings']) {
    if (Array.isArray(block[k]) && block[k].length > 0) return block[k].length;
  }
  return null;
}

// Lit un entier strict (nombre, ou chaîne entièrement numérique) ; toute autre forme reste absente plutôt que devinée.
export function sourceInteger(value: unknown): number | null {
  if (typeof value === 'number') return Number.isInteger(value) && value >= 0 ? value : null;
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!/^\d+$/.test(text)) return null;
  const n = Number(text);
  return Number.isSafeInteger(n) ? n : null;
}

// Traduit le statut d'enregistrement de provenance d'une image Docker en libellé français affichable.
export function dockerProvenanceState(docker: any): string {
  const raw = String(docker?.provenance_status ?? '').trim().toUpperCase();
  if (!raw) return 'Non disponible';
  return ({
    SUCCESS: 'Enregistrée', COMPLETED: 'Enregistrée',
    NOT_ATTEMPTED: 'Non tentée',
    PENDING: 'En attente d’ingestion',
    FAILED: 'Échec', ERROR: 'Échec',
    UNKNOWN: 'Non disponible',
  } as Record<string, string>)[raw] || raw;
}

// Traduit l'état de construction de l'image Docker du build en libellé français affichable.
export function dockerImageState(docker: any): string {
  if (!docker || typeof docker !== 'object') return 'Non disponible';
  const status = String(docker.build_status ?? '').trim().toUpperCase();
  const hasRef = String(docker.image_tag ?? '').trim().length > 0;
  if (status === 'NOT_CONFIGURED') return 'Non configuré';
  if (['NOT_RUN', 'SKIPPED', 'NOT_REACHED'].includes(status)) return 'Non exécuté';
  if (['FAILED', 'FAILURE', 'ERROR'].includes(status)) return hasRef ? 'Échec de construction' : 'Image non construite';
  if (['RUNNING', 'PENDING'].includes(status)) return 'En attente';
  if (!status || status === 'UNKNOWN') return hasRef ? 'Non disponible' : 'Image non construite';
  return hasRef ? '' : 'Image non construite';
}

// Renvoie la référence de l'image construite, ou null si le build n'en a produit aucune.
export function dockerImageRef(docker: any): string | null {
  const ref = String(docker?.image_tag ?? '').trim();
  return ref ? ref : null;
}

// Sépare la référence d'image en repository/tag, sans jamais inventer de tag implicite.
export function dockerImageParts(docker: any): { repository: string | null; tag: string | null } {
  const ref = dockerImageRef(docker);
  if (!ref) return { repository: null, tag: null };
  const i = ref.lastIndexOf(':');
  if (i <= 0) return { repository: ref, tag: null };
  return { repository: ref.slice(0, i) || null, tag: ref.slice(i + 1) || null };
}

// Traduit le statut de poussée vers le registre en libellé français affichable, distinct du statut de construction.
export function dockerPushState(docker: any): string {
  const raw = String(docker?.push_status ?? '').trim().toUpperCase();
  if (!raw) return 'Non disponible';
  return ({
    SUCCESS: 'Poussée', PUSHED: 'Poussée', COMPLETED: 'Poussée',
    NOT_ATTEMPTED: 'Non tentée', SKIPPED: 'Non exécutée',
    NOT_CONFIGURED: 'Aucun registre configuré',
    FAILED: 'Échec', FAILURE: 'Échec', ERROR: 'Échec',
    UNKNOWN: 'Non disponible',
  } as Record<string, string>)[raw] || raw;
}

// Lit un champ numérique d'un bloc scanner, uniquement si ce scanner a un résultat exploitable — sinon renvoie null plutôt qu'une valeur trompeuse.
export function scannerMetric(block: any, field: string): number | null {
  return scannerHasResult(block) ? availableNumber(block[field]) : null;
}

// Traduit l'état technique d'un bloc scanner en un libellé français affichable (configuré/exécuté/disponible/en attente/indisponible).
export function scannerState(block: any): string {
  if (!block) return 'Non disponible';
  if (block.status === 'NOT_CONFIGURED') return 'Non configuré';
  if (['NOT_RUN','SKIPPED','NOT_REACHED'].includes(block.status)) return 'Non exécuté';
  if (['ERROR','FAILED','UNAVAILABLE','TIMEOUT'].includes(block.status)) return 'Indisponible';
  if (['RUNNING','PENDING'].includes(block.status)) return 'En attente';
  return scannerHasResult(block) ? 'Résultat disponible' : 'Non disponible';
}

// Recompose le résumé de sécurité global en ne cumulant que les projets/scanners réellement porteurs de données, pour éviter un total faussement bas.
export function securitySummaryForDisplay(data: any): any {
  if (!data?.summary) return null;
  const projects = (data.byProject || []).filter((p: any) => !(data.projectsWithoutData || []).includes(p.projectName));
  /** Compte les éléments correspondants. */
  const count = (scanner: string, field: string): number | null => {
    const values = projects.filter((p: any) => !(p.missingScanners || []).includes(scanner))
      .map((p: any) => availableNumber(p[scanner]?.[field])).filter((n: number | null) => n !== null);
    return values.length ? values.reduce((sum: number, n: number) => sum + n, 0) : null;
  };
  /** Regroupe les résultats en une valeur commune. */
  const combine = (a: number | null, b: number | null) => a === null && b === null ? null : (a ?? 0) + (b ?? 0);
  return {...data.summary,
    totalCriticalCves: combine(count('trivy','critical'),count('owasp','critical')),
    totalHighCves: combine(count('trivy','high'),count('owasp','high')),
    zapHighAlerts: count('zap','high'), zapMediumAlerts: count('zap','medium'),
    totalMediumCves: null,
    avgSecurityScore: data.projectsWithoutData?.length ? null : data.summary.avgSecurityScore,
  };
}

// Traduit le contrôle qualité Sonar en libellé + couleur affichables (Réussi/Échec/Non disponible), sans confondre verdict et statut d'exécution.
export function qualityGatePresentation(block: any): {label: string; color: string} {
  if (block?.status && block.status !== 'COMPLETED' && block.status !== 'SUCCESS') return {label: scannerState(block),color:'var(--text-muted)'};
  const gate = sonarQualityGate(block);
  if (gate && ['OK','PASSED'].includes(gate)) return {label:'Réussi',color:'var(--accent-green)'};
  if (gate && ['ERROR','FAILED'].includes(gate)) return {label:'Échec',color:'var(--accent-red)'};
  return {label:'Non disponible',color:'var(--text-muted)'};
}
