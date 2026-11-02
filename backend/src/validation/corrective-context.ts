// Extrait de façon déterministe les causes bloquantes PROUVÉES d'un enregistrement de validation déjà calculé, pour préparer une tentative corrective gouvernée sur la même PR.

export interface BlockingCause {
  type: 'TARGET_FINDING_INVALID' | 'NEW_BLOCKING_FINDING' | 'DEFAULT_VALUE_SEMANTICS_DEFECT';
  findingId?: string;
  findingSource?: string | null;
  rule?: string | null;
  path?: string | null;
  line?: number | null;
  message?: string | null;
  evidenceRef?: string | null;
  scannerAnalysisId?: string | null;
  candidateSha: string;
  sourceType?: string;
  sourceField?: string;
  sourceDefault?: string | null;
  candidateType?: string;
  candidateField?: string;
  candidateDefault?: string | null;
  baselineAbsentBehavior?: string;
  candidateAbsentBehavior?: string;
  mappingPath?: string;
  behavioralInvariant?: string;
  sourceFile?: string;
  candidateFile?: string;
  mappingFile?: string;
}

export interface CorrectiveContext {
  previousAttempt: number;
  previousValidatedSha: string;
  currentPrHeadSha: string;
  reasonCodes: string[];
  blockingCauses: BlockingCause[];
  originalFindingResults: Array<{ findingId: string; result: string; evidence: string | null }>;
}

/** Extrait toutes les causes bloquantes prouvées d'un enregistrement de validation. */
export function extractBlockingCauses(validation: any): BlockingCause[] {
  const causes: BlockingCause[] = [];
  const candidateSha = String(validation?.checkoutSha || '').toLowerCase();
  const analysisId = validation?.analysisId ?? null;

  const findingResults: any[] = Array.isArray(validation?.findingResults) ? validation.findingResults : [];
  for (const result of findingResults) {
    if (result?.result !== 'INVALID') continue;
    causes.push({
      type: 'TARGET_FINDING_INVALID',
      findingId: String(result.findingId ?? ''),
      evidenceRef: result.evidence != null ? String(result.evidence) : null,
      scannerAnalysisId: analysisId,
      candidateSha,
    });
  }

  const regressionCandidateSha = String(validation?.regression?.candidateSha || candidateSha).toLowerCase();
  const blockingIntroduced: any[] = Array.isArray(validation?.regression?.blockingIntroducedFindings)
    ? validation.regression.blockingIntroducedFindings : [];
  for (const finding of blockingIntroduced) {
    causes.push({
      type: 'NEW_BLOCKING_FINDING',
      findingSource: finding?.source ?? null,
      rule: finding?.rule ?? null,
      path: finding?.path ?? null,
      line: typeof finding?.line === 'number' ? finding.line : null,
      message: finding?.message ?? null,
      scannerAnalysisId: analysisId,
      candidateSha: regressionCandidateSha,
    });
  }

  causes.push(...extractDefaultValueSemanticsCauses(validation, candidateSha));

  return causes;
}

// Instruction générique attachée à chaque cause DEFAULT_VALUE_SEMANTICS_DEFECT :
// nomme l'invariant à restaurer, pas un correctif précis — le générateur reste libre
// du mécanisme exact tant que l'invariant est respecté pour le type/champ du candidat.
const DEFAULT_VALUE_SEMANTICS_INVARIANT =
  'The candidate changes observable behavior for an omitted externally-deserialized property. Restore baseline-equivalent behavior for all four cases: '
  + 'when the property is ABSENT, the candidate must observably behave the same as the baseline default; when the property is EXPLICIT NULL, preserve '
  + 'the baseline’s explicit-null behavior; when the property carries an EXPLICIT VALUE, preserve the baseline’s explicit-value behavior; when the '
  + 'value is INVALID, preserve the baseline’s applicable rejection behavior. Do not restrict the fix to a single hardcoded literal or line — select '
  + 'whichever implementation genuinely restores this invariant for the candidate’s own type.';

/** Extrait par défaut valeur sémantique Causes. */
function extractDefaultValueSemanticsCauses(validation: any, candidateSha: string): BlockingCause[] {
  const semantics = validation?.defaultValueSemantics;
  if (!semantics || semantics.verdict !== 'PROVEN_DEFECT') return [];
  const blockingReasons: string[] = Array.isArray(validation?.mergeAuthorization?.blockingReasons)
    ? validation.mergeAuthorization.blockingReasons : [];
  if (!blockingReasons.includes('DEFAULT_VALUE_SEMANTICS_REGRESSION')) return [];
  const evaluatedSha = String(semantics.evaluatedSha || '').toLowerCase();
  if (!evaluatedSha || evaluatedSha !== candidateSha) return [];

  const evidenceList: any[] = Array.isArray(semantics.evidence) ? semantics.evidence : [];
  const causes: BlockingCause[] = [];
  const seen = new Set<string>();
  for (const evidence of evidenceList) {
    const sourceType = evidence?.sourceType, sourceField = evidence?.sourceField;
    const candidateType = evidence?.candidateType, candidateField = evidence?.candidateField;
    const baselineAbsentBehavior = evidence?.baselineAbsentBehavior, candidateAbsentBehavior = evidence?.candidateAbsentBehavior;
    const mappingPath = evidence?.mappingPath;
    if (!sourceType || !sourceField || !candidateType || !candidateField || !baselineAbsentBehavior || !candidateAbsentBehavior || !mappingPath) continue;
    const dedupeKey = [sourceType, sourceField, candidateType, candidateField, mappingPath].join('␟');
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    causes.push({
      type: 'DEFAULT_VALUE_SEMANTICS_DEFECT',
      candidateSha,
      sourceType: String(sourceType), sourceField: String(sourceField),
      sourceDefault: evidence.sourceDefault != null ? String(evidence.sourceDefault) : null,
      candidateType: String(candidateType), candidateField: String(candidateField),
      candidateDefault: evidence.candidateDefault != null ? String(evidence.candidateDefault) : null,
      baselineAbsentBehavior: String(baselineAbsentBehavior), candidateAbsentBehavior: String(candidateAbsentBehavior),
      mappingPath: String(mappingPath),
      behavioralInvariant: DEFAULT_VALUE_SEMANTICS_INVARIANT,
      ...(evidence.sourceFile ? { sourceFile: String(evidence.sourceFile) } : {}),
      ...(evidence.candidateFile ? { candidateFile: String(evidence.candidateFile) } : {}),
      ...(evidence.mappingFile ? { mappingFile: String(evidence.mappingFile) } : {}),
    });
  }
  return causes;
}

// Construit le contexte complet d'une tentative corrective sur la même PR : SHA
// précédemment validé, codes de raison bloquants, causes bloquantes extraites, et
// verdicts originaux par finding.
export function buildCorrectiveContext(input: { previousAttempt: number; validation: any }): CorrectiveContext {
  const { previousAttempt, validation } = input;
  const previousValidatedSha = String(validation?.checkoutSha || '').toLowerCase();
  const findingResults: any[] = Array.isArray(validation?.findingResults) ? validation.findingResults : [];
  return {
    previousAttempt,
    previousValidatedSha,
    currentPrHeadSha: previousValidatedSha,
    reasonCodes: Array.isArray(validation?.mergeAuthorization?.blockingReasons)
      ? [...validation.mergeAuthorization.blockingReasons] : [],
    blockingCauses: extractBlockingCauses(validation),
    originalFindingResults: findingResults.map(result => ({
      findingId: String(result?.findingId ?? ''),
      result: String(result?.result ?? 'INCONCLUSIVE'),
      evidence: result?.evidence != null ? String(result.evidence) : null,
    })),
  };
}
