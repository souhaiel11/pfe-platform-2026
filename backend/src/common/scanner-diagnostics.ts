// ─────────────────────────────────────────────────────────────
//  Vérité scanner — orthogonale au statut de stage (PASSED/FAILED/...).
//  status répond à "où en est le pipeline" ; executed/completed/
//  resultAvailable répondent à "est-ce que le scanner a réellement produit
//  un résultat digne de confiance". Un scanner qui a démarré et échoué
//  techniquement (credential invalide, timeout réseau, race de fichier) est
//  executed=true, completed=false, resultAvailable=false — jamais confondu
//  avec un scanner qui n'a jamais tourné (NOT_RUN, executed=false).
//
//  Règle stricte (ticket QA-WF1-SCANNER-DIAGNOSTIC-AUDIT-R1 §10) : un scan
//  qui n'a pas complété ne donne JAMAIS findingCount=0 — 0 signifie
//  "complété et rien trouvé", pas "on ne sait pas". null = inconnu.
//
//  problemClass/technicalCode/owner/evidence ne sont PEUPLÉS avec certitude
//  que là où la preuve existe (typiquement posé par WF1, qui a accès au
//  payload Jenkins brut). Ce module fournit uniquement la table de repli
//  déterministe ci-dessous — jamais d'invention de cause.
// ─────────────────────────────────────────────────────────────

export type ProblemClass = 'PRODUCT_DEFECT' | 'FIXABLE_CONFIGURATION' | 'TECHNICAL_BLOCKER';

// Liste ouverte (string, pas un enum strict) : de nouveaux codes précis
// peuvent apparaître (ex: DOCKER_CONFIGURATION_ERROR, trouvé sur l'audit
// ZAP build #11) sans casser le typage existant.
export type TechnicalCode =
  | 'SONAR_CE_TASK_ID_MISSING'
  | 'SCANNER_CREDENTIAL_INVALID'
  | 'SCANNER_TIMEOUT'
  | 'SCANNER_DATABASE_DOWNLOAD_FAILED'
  | 'TARGET_UNAVAILABLE'
  | 'DOCKER_CONFIGURATION_ERROR'
  | 'SCANNER_REPORT_MISSING'
  | 'NETWORK_FAILURE'
  | 'RESOURCE_FAILURE'
  | 'UNKNOWN_TECHNICAL'
  | string;

// Décision de routage — distincte de problemClass. AUTO_FIX_ELIGIBLE (WF4/WF5)
// n'implique jamais une exécution automatique : voir webhooks.service.ts,
// seul jenkinsfile/dockerfile routent, et toujours avec garde anti-boucle.
export type WorkflowRoute = 'WF2' | 'WF4' | 'WF5' | 'ADMIN_ACTION_REQUIRED' | 'NONE';

export interface ScannerTruth {
  // scanState existant (WF1 "Merge All Fetched Data") : NOT_RUN | MISSING |
  // FAILED | COMPLETED_ZERO_FINDINGS | COMPLETED_WITH_FINDINGS — pas
  // redéfini ici, seulement consommé en entrée de deriveScannerTruth().
  executed: boolean | null;
  // "Le stage REQUIS a fini son traitement" — jamais interprété comme "le
  // résultat est fiable" (voir resultAvailable, seule source de vérité pour
  // ça). Sonar : voir analysisSubmitted/qualityGateResolved ci-dessous pour
  // la distinction fine entre "l'analyse a été soumise" et "le stage a
  // complété".
  completed: boolean | null;
  resultAvailable: boolean | null;
  findingCount: number | null;
  technicalCode: TechnicalCode | null;
  problemClass: ProblemClass | null;
  owner: string | null;
  evidence: string[];
  route: WorkflowRoute;
}

// Sonar seul : deux étapes distinctes dans le stage "SAST - SonarQube" —
// (1) l'analyse elle-même soumise au serveur Sonar, (2) la corrélation
// ceTaskId → quality gate côté Jenkins. Les deux peuvent diverger (build
// #11 : (1) réussie, (2) jamais faite) — ne jamais les fusionner dans le
// champ générique `completed`.
export interface SonarTruth extends ScannerTruth {
  analysisSubmitted: boolean | null;
  qualityGateResolved: boolean | null;
}

export function emptyScannerTruth(): ScannerTruth {
  return {
    executed: null, completed: null, resultAvailable: null, findingCount: null,
    technicalCode: null, problemClass: null, owner: null, evidence: [], route: 'NONE',
  };
}

export function emptySonarTruth(): SonarTruth {
  return { ...emptyScannerTruth(), analysisSubmitted: null, qualityGateResolved: null };
}

// Table de repli déterministe — n'écrase JAMAIS un champ déjà posé par WF1
// (préserve la logique "additive" : WF1 est la seule source qui a le
// contexte pour affirmer technicalCode/problemClass/owner/evidence/route
// avec preuve ; ce module ne fait que garantir qu'un ancien incident/report
// sans ces champs affiche quand même une vérité honnête plutôt qu'un
// `undefined` silencieux).
// Ne copie que les clés RÉELLEMENT définies de `existing` — un merge par
// spread naïf (`{...derived, ...existing}`) écraserait `derived.champ` par
// `undefined` dès que `existing` a la clé présente avec une valeur
// undefined (ex: `{ executed: block.executed }` où block.executed est
// undefined), ce qui romprait silencieusement le repli déterministe.
function overlayDefined<T extends object>(derived: T, existing?: Partial<T>): T {
  if (!existing) return derived;
  const out = { ...derived };
  for (const key of Object.keys(existing) as (keyof T)[]) {
    if (existing[key] !== undefined) out[key] = existing[key] as T[typeof key];
  }
  return out;
}

export function deriveScannerTruth(scanState: string | undefined, existing?: Partial<ScannerTruth>): ScannerTruth {
  const base = emptyScannerTruth();
  let derived: ScannerTruth;
  switch (scanState) {
    case 'NOT_RUN':
      derived = { ...base, executed: false, completed: false, resultAvailable: false, findingCount: null };
      break;
    case 'COMPLETED_ZERO_FINDINGS':
      derived = { ...base, executed: true, completed: true, resultAvailable: true, findingCount: 0 };
      break;
    case 'COMPLETED_WITH_FINDINGS':
      // findingCount réel posé par l'appelant (existing.findingCount) — ce
      // module ne connaît pas le compte, seulement l'état ; ne jamais
      // deviner un nombre ici.
      derived = { ...base, executed: true, completed: true, resultAvailable: true, findingCount: existing?.findingCount ?? null };
      break;
    case 'MISSING':
    case 'FAILED':
      // executed=true UNIQUEMENT si l'appelant a déjà une preuve positive
      // (technicalCode connu, ou executed déjà affirmé true en amont) —
      // sinon tri-état "inconnu" (null), jamais fabriqué à false.
      derived = {
        ...base,
        executed: existing?.executed === true || !!existing?.technicalCode ? true : (existing?.executed ?? null),
        completed: false,
        resultAvailable: false,
        findingCount: null,
      };
      break;
    default:
      // scanState absent/inattendu — incertitude totale, jamais un défaut
      // optimiste.
      derived = { ...base };
  }
  return overlayDefined(derived, existing);
}
