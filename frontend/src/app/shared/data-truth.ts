/** Presentation only: absence and scanner failure must never become a clean count. */
export function availableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}
export function scannerHasResult(block: any): boolean {
  if (!block || typeof block !== 'object') return false;
  if (block.status && block.status !== 'COMPLETED') return false;
  if (block.executed === false) return false;
  // R46 — `resultAvailable` ne porte pas le même sens d'un scanner à l'autre.
  // Pour Trivy/OWASP/ZAP il dit « le scan a produit un rapport exploitable ».
  // Pour Sonar, WF1 y reporte la résolution du CONTRÔLE QUALITÉ, qui exige un
  // analysisId que seuls les builds de PR résolvent : sur un build de branche
  // il vaut donc false alors que les mesures (bugs, vulnérabilités, code
  // smells, couverture) sont bien présentes et réelles. Le bloc Sonar expose
  // précisément cette distinction par son propre champ `qualityGateResolved`.
  // Quand ce champ est présent, c'est lui qui qualifie le contrôle qualité, et
  // `resultAvailable` ne doit plus masquer des mesures réellement mesurées.
  // Aucune exception par nom de scanner ni par projet : la décision repose sur
  // les champs que le bloc déclare lui-même.
  const gateTracked = block.qualityGateResolved !== undefined;
  if (block.resultAvailable === false && !gateTracked) return false;
  return block.status === 'COMPLETED' || block.resultAvailable === true || gateTracked
    || (!block.status && ['cves','issues','alerts'].some(k => Array.isArray(block[k])));
}

/**
 * Contrôle qualité Sonar, strictement distinct du statut d'exécution.
 *
 * Une analyse peut s'être parfaitement exécutée sans que le contrôle qualité
 * soit résolu, et un contrôle « OK » ne signifie pas « aucun problème » : les
 * conditions portent sur le code nouveau. On ne fusionne donc jamais les deux,
 * et une valeur non résolue reste non résolue.
 */
export function sonarQualityGate(block: any): string | null {
  if (!block || typeof block !== 'object') return null;
  const raw = String(block.quality_gate ?? block.qualityGate ?? '').trim().toUpperCase();
  if (!raw) return null;
  // Marqueurs d'indisponibilité émis par la plateforme : ce ne sont pas des
  // verdicts, et ils ne doivent pas s'afficher comme tels.
  const notAVerdict = new Set([
    'QUALITY_GATE_UNAVAILABLE', 'QUALITY_GATE_NOT_COMPUTED', 'API_ERROR',
    'SONAR_ANALYSIS_FAILED', 'SONAR_ANALYSIS_CANCELED', 'SONAR_ANALYSIS_TIMEOUT',
  ]);
  return notAVerdict.has(raw) ? null : raw;
}
/**
 * Couverture mesuree par l'etape de tests du build.
 *
 * L'etape de tests rapporte des issues de style Jenkins (SUCCESS, UNSTABLE,
 * FAILURE, SKIPPED, UNKNOWN) et non le vocabulaire COMPLETED des scanners :
 * scannerHasResult() ne sait donc pas la qualifier. Seule une etape REELLEMENT
 * EXECUTEE peut avoir mesure une couverture. Quand l'etape a ete sautee ou que
 * son issue est inconnue, WF1 ecrit malgre tout `coverage: 0` -- un remplissage,
 * pas une observation. L'afficher comme « 0 % » revient a presenter une absence
 * de mesure comme une couverture reellement nulle.
 *
 * Un zero d'une etape executee reste un vrai zero et est conserve tel quel.
 */
const TEST_STAGE_EXECUTED = ['SUCCESS', 'UNSTABLE', 'FAILURE', 'FAILED'];
const TEST_STAGE_NOT_EXECUTED = ['SKIPPED', 'NOT_RUN', 'NOT_REACHED', 'NOT_CONFIGURED'];
export function testStageExecuted(tests: any): boolean {
  if (!tests || typeof tests !== 'object') return false;
  const status = String(tests.status ?? '').trim().toUpperCase();
  // Un statut explicite tranche, dans les deux sens.
  if (TEST_STAGE_NOT_EXECUTED.includes(status)) return false;
  if (TEST_STAGE_EXECUTED.includes(status)) return true;
  // Sans statut (ou UNKNOWN), on exige une preuve positive d'execution : des
  // tests reellement comptes. C'est ce qui distingue un vrai 0 % d'un
  // `coverage: 0` de remplissage ecrit par une etape qui n'a rien mesure.
  return availableNumber(tests.total) !== null && tests.total > 0;
}
export function testStageCoverage(tests: any): number | null {
  return testStageExecuted(tests) ? availableNumber(tests.coverage) : null;
}
/** Motif precis d'absence, pour ne pas afficher « Non disponible » a tout. */
export function testStageCoverageState(tests: any): string {
  if (!tests || typeof tests !== 'object') return 'Non disponible';
  const status = String(tests.status ?? '').trim().toUpperCase();
  if (!status || status === 'UNKNOWN') return 'Non disponible';
  if (['SKIPPED', 'NOT_RUN', 'NOT_REACHED'].includes(status)) return 'Non execute';
  if (status === 'NOT_CONFIGURED') return 'Non configure';
  return testStageCoverage(tests) === null ? 'Non disponible' : '';
}
/**
 * Constats retenus d'une execution ANTERIEURE (R48).
 *
 * WF1 etiquette desormais `findingsStale` quand un scanner hors perimetre pour
 * ce build portait malgre tout un rapport parsable : le volume de rapports
 * partage n'est pas purge entre builds, donc ces constats viennent d'un build
 * precedent. Ils sont REELS -- les masquer entierement perdait de l'information
 * vraie (323 CVE sur un cas constate) -- mais ils ne sont pas la preuve de ce
 * build. On les annonce donc comme tels.
 *
 * Volontairement sans effet sur scannerHasResult() / scannerMetric() : les
 * compteurs restent indisponibles pour CE build, ce qui est la regle qui
 * empeche un scanner non execute de paraitre propre.
 */
export function scannerHasStaleFindings(block: any): boolean {
  if (!block || typeof block !== 'object') return false;
  if (block.findingsStale !== true) return false;
  return ['cves', 'issues', 'alerts', 'findings'].some(k => Array.isArray(block[k]) && block[k].length > 0);
}
export function scannerStaleFindingCount(block: any): number | null {
  if (!scannerHasStaleFindings(block)) return null;
  for (const k of ['cves', 'issues', 'alerts', 'findings']) {
    if (Array.isArray(block[k]) && block[k].length > 0) return block[k].length;
  }
  return null;
}
/**
 * Entier provenant d'une source qui peut le livrer en chaine (R49).
 *
 * Jenkins renvoie le numero de build tantot en nombre (8, 151), tantot en
 * chaine ("41", "19") selon le type de job. availableNumber() est
 * deliberement strict — c'est le garde-fou central contre les coercitions —
 * donc il rejetait "41" et la vue affichait « Non disponible » alors que la
 * source portait bien 41.
 *
 * Ce lecteur n'accepte qu'un entier, ou une chaine faite UNIQUEMENT de
 * chiffres. Ni espaces significatifs, ni decimales, ni "1e3", ni "41abc" :
 * une valeur douteuse reste absente plutot que devinee.
 */
export function sourceInteger(value: unknown): number | null {
  if (typeof value === 'number') return Number.isInteger(value) && value >= 0 ? value : null;
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!/^\d+$/.test(text)) return null;
  const n = Number(text);
  return Number.isSafeInteger(n) ? n : null;
}
/**
 * Enregistrement de provenance, distinct de la publication (R50).
 *
 * Une image peut etre reellement poussee et sa provenance refusee : ce sont
 * deux faits, donc deux etats. Aucun des deux ne signifie « deployee ».
 */
export function dockerProvenanceState(docker: any): string {
  const raw = String(docker?.provenance_status ?? '').trim().toUpperCase();
  if (!raw) return 'Non disponible';
  return ({
    SUCCESS: 'Enregistrée', COMPLETED: 'Enregistrée',
    NOT_ATTEMPTED: 'Non tentée',
    // R51 — l'enregistrement a lieu APRES l'envoi du rapport : le backend
    // re-derive l'identite de build depuis l'incident issu de ce rapport, qui
    // n'existe pas encore au moment du push. Le rapport porte donc PENDING, un
    // etat vrai au moment ou il est emis -- ni un succes, ni un echec.
    PENDING: 'En attente d’ingestion',
    FAILED: 'Échec', ERROR: 'Échec',
    UNKNOWN: 'Non disponible',
  } as Record<string, string>)[raw] || raw;
}
/**
 * Etat de l'image Docker du build (R49).
 *
 * Les trois faits sont distincts et ne doivent jamais etre confondus :
 *   - l'ETAPE Docker a-t-elle tourne       (docker.build_status)
 *   - une IMAGE existe-t-elle              (docker.image_tag non vide)
 *   - l'image a-t-elle ete POUSSEE         (docker.push_status)
 *
 * Une etape reussie sans reference d'image signifie « image non construite ».
 * Un `image_tag` vide n'est pas un nom d'image, et `'-'` n'est pas un etat.
 */
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
/** Une reference d'image n'existe que si le build en a produit une. */
export function dockerImageRef(docker: any): string | null {
  const ref = String(docker?.image_tag ?? '').trim();
  return ref ? ref : null;
}
/** Repository/tag separes depuis la reference reelle, sans jamais en inventer. */
export function dockerImageParts(docker: any): { repository: string | null; tag: string | null } {
  const ref = dockerImageRef(docker);
  if (!ref) return { repository: null, tag: null };
  const i = ref.lastIndexOf(':');
  // Pas de ':' => pas de tag explicite ; on ne substitue PAS 'latest'.
  if (i <= 0) return { repository: ref, tag: null };
  return { repository: ref.slice(0, i) || null, tag: ref.slice(i + 1) || null };
}
/**
 * Statut de registre, strictement distinct de la construction.
 * NOT_ATTEMPTED et SKIPPED sont des faits differents, pas un echec.
 */
export function dockerPushState(docker: any): string {
  const raw = String(docker?.push_status ?? '').trim().toUpperCase();
  if (!raw) return 'Non disponible';
  return ({
    SUCCESS: 'Poussée', PUSHED: 'Poussée', COMPLETED: 'Poussée',
    NOT_ATTEMPTED: 'Non tentée', SKIPPED: 'Non exécutée',
    // R50 — le pipeline peut desormais dire « aucun ACR configure pour ce
    // projet ». C'est un etat honnete, distinct d'un echec et d'un non-essai.
    NOT_CONFIGURED: 'Aucun registre configuré',
    FAILED: 'Échec', FAILURE: 'Échec', ERROR: 'Échec',
    UNKNOWN: 'Non disponible',
  } as Record<string, string>)[raw] || raw;
}
export function scannerMetric(block: any, field: string): number | null {
  return scannerHasResult(block) ? availableNumber(block[field]) : null;
}
export function scannerState(block: any): string {
  if (!block) return 'Non disponible';
  if (block.status === 'NOT_CONFIGURED') return 'Non configuré';
  if (['NOT_RUN','SKIPPED','NOT_REACHED'].includes(block.status)) return 'Non exécuté';
  if (['ERROR','FAILED','UNAVAILABLE','TIMEOUT'].includes(block.status)) return 'Indisponible';
  if (['RUNNING','PENDING'].includes(block.status)) return 'En attente';
  return scannerHasResult(block) ? 'Résultat disponible' : 'Non disponible';
}
/** Count observations only from scanners the API identifies as having results. */
export function securitySummaryForDisplay(data: any): any {
  if (!data?.summary) return null;
  const projects = (data.byProject || []).filter((p: any) => !(data.projectsWithoutData || []).includes(p.projectName));
  const count = (scanner: string, field: string): number | null => {
    const values = projects.filter((p: any) => !(p.missingScanners || []).includes(scanner))
      .map((p: any) => availableNumber(p[scanner]?.[field])).filter((n: number | null) => n !== null);
    return values.length ? values.reduce((sum: number, n: number) => sum + n, 0) : null;
  };
  const combine = (a: number | null, b: number | null) => a === null && b === null ? null : (a ?? 0) + (b ?? 0);
  return {...data.summary,
    totalCriticalCves: combine(count('trivy','critical'),count('owasp','critical')),
    totalHighCves: combine(count('trivy','high'),count('owasp','high')),
    zapHighAlerts: count('zap','high'), zapMediumAlerts: count('zap','medium'),
    totalMediumCves: null, // The API's residual count includes LOW/UNKNOWN; it is not a MEDIUM count.
    avgSecurityScore: data.projectsWithoutData?.length ? null : data.summary.avgSecurityScore,
  };
}
export function qualityGatePresentation(block: any): {label: string; color: string} {
  if (block?.status && block.status !== 'COMPLETED' && block.status !== 'SUCCESS') return {label: scannerState(block),color:'var(--text-muted)'};
  // Une seule définition de « est-ce un verdict » : voir sonarQualityGate().
  const gate = sonarQualityGate(block);
  if (gate && ['OK','PASSED'].includes(gate)) return {label:'Réussi',color:'var(--accent-green)'};
  if (gate && ['ERROR','FAILED'].includes(gate)) return {label:'Échec',color:'var(--accent-red)'};
  return {label:'Non disponible',color:'var(--text-muted)'};
}
