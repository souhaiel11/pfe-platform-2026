// Modèle de "vérité scanner", orthogonal au statut de stage.
export type ProblemClass = 'PRODUCT_DEFECT' | 'FIXABLE_CONFIGURATION' | 'TECHNICAL_BLOCKER';

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

export type WorkflowRoute = 'WF2' | 'WF4' | 'WF5' | 'ADMIN_ACTION_REQUIRED' | 'NONE';

export interface ScannerTruth {
  executed: boolean | null;
  completed: boolean | null;
  resultAvailable: boolean | null;
  findingCount: number | null;
  technicalCode: TechnicalCode | null;
  problemClass: ProblemClass | null;
  owner: string | null;
  evidence: string[];
  route: WorkflowRoute;
}

export interface SonarTruth extends ScannerTruth {
  analysisSubmitted: boolean | null;
  qualityGateResolved: boolean | null;
}

/** Construit une vérité scanner neutre : tout à null/inconnu, jamais un défaut optimiste. */
export function emptyScannerTruth(): ScannerTruth {
  return {
    executed: null, completed: null, resultAvailable: null, findingCount: null,
    technicalCode: null, problemClass: null, owner: null, evidence: [], route: 'NONE',
  };
}

/** Construit une vérité Sonar neutre, avec les deux champs additionnels analysisSubmitted/qualityGateResolved également à null. */
export function emptySonarTruth(): SonarTruth {
  return { ...emptyScannerTruth(), analysisSubmitted: null, qualityGateResolved: null };
}

/** Fusionne `derived` avec les clés de `existing` réellement définies, sans jamais écraser une valeur par un undefined implicite. */
function overlayDefined<T extends object>(derived: T, existing?: Partial<T>): T {
  if (!existing) return derived;
  const out = { ...derived };
  for (const key of Object.keys(existing) as (keyof T)[]) {
    if (existing[key] !== undefined) out[key] = existing[key] as T[typeof key];
  }
  return out;
}

/** Déduit la vérité scanner (executed/completed/resultAvailable/findingCount...) à partir du scanState existant, sans jamais écraser un champ déjà posé par l'appelant. */
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
      derived = { ...base, executed: true, completed: true, resultAvailable: true, findingCount: existing?.findingCount ?? null };
      break;
    case 'MISSING':
    case 'FAILED':
      derived = {
        ...base,
        executed: existing?.executed === true || !!existing?.technicalCode ? true : (existing?.executed ?? null),
        completed: false,
        resultAvailable: false,
        findingCount: null,
      };
      break;
    default:
      derived = { ...base };
  }
  return overlayDefined(derived, existing);
}
