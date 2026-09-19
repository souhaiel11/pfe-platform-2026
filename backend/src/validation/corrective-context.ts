// BRIQUE 5 — deterministic extraction of PROVEN blocking causes from an
// already-computed validation/mergeAuthorization record, for a governed
// causal corrective attempt on the SAME PR. Pure, no I/O, no rule-specific
// or scanner-specific logic (a NEW_BLOCKING_FINDING cause is built from
// whatever generic RegressionFinding shape pr-regression-engine.ts already
// produces; a TARGET_FINDING_INVALID cause is built from the existing
// per-finding findingResults contract). Never invents evidence: a
// blockingReason with no corresponding structured record simply yields no
// cause for that reason, and the caller (incidents.service.ts
// #correctAndRevalidate) must refuse to dispatch when blockingCauses is
// empty rather than run blindly (Phase 3's "governed context-required
// state").
//
// R68 — a third cause kind, DEFAULT_VALUE_SEMANTICS_DEFECT, built the exact
// same way from validation.defaultValueSemantics (R66/R67's own persisted,
// bounded evidence — never a fresh source fetch during a corrective
// attempt). Generic by construction: nothing here names a rule, entity,
// DTO, or field — every identifier travels as plain data from whatever the
// generic default-value-semantics detector proved.

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
  // R68 — present only when type === 'DEFAULT_VALUE_SEMANTICS_DEFECT'.
  // Mirrors default-value-semantics.ts's DefaultValueSemanticsEvidence
  // verbatim, plus one generic, implementation-agnostic behavioral
  // invariant a corrective candidate must restore.
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
}

export interface CorrectiveContext {
  previousAttempt: number;
  previousValidatedSha: string;
  currentPrHeadSha: string;
  reasonCodes: string[];
  blockingCauses: BlockingCause[];
  originalFindingResults: Array<{ findingId: string; result: string; evidence: string | null }>;
}

/**
 * One BlockingCause per INVALID approved finding (TARGET_FINDING_INVALID)
 * plus one per finding the regression engine proved blocking-introduced
 * (NEW_BLOCKING_FINDING). Never both for the same record — the two arrays
 * are already mutually exclusive facts in validation itself (Brique 3/4's
 * strict semantic separation).
 */
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

// R68 — the generic, implementation-agnostic instruction attached to every
// DEFAULT_VALUE_SEMANTICS_DEFECT cause. Names the invariant to restore, not
// a fix: the generator remains free to choose whichever implementation
// genuinely satisfies it (a field initializer, a defaulting branch in the
// mapping code, or anything else) for the candidate's own field/type shape.
const DEFAULT_VALUE_SEMANTICS_INVARIANT =
  'The candidate changes observable behavior for an omitted externally-deserialized property. Restore baseline-equivalent behavior for all four cases: '
  + 'when the property is ABSENT, the candidate must observably behave the same as the baseline default; when the property is EXPLICIT NULL, preserve '
  + 'the baseline’s explicit-null behavior; when the property carries an EXPLICIT VALUE, preserve the baseline’s explicit-value behavior; when the '
  + 'value is INVALID, preserve the baseline’s applicable rejection behavior. Do not restrict the fix to a single hardcoded literal or line — select '
  + 'whichever implementation genuinely restores this invariant for the candidate’s own type.';

/**
 * R68 — one BlockingCause per PROVEN default-value-semantics evidence item,
 * fail-closed by construction (R68 §4): only reachable when the verdict
 * is exactly 'PROVEN_DEFECT', the blocking reason it produced is actually
 * present on mergeAuthorization, and the evidence was computed for the SAME
 * SHA this validation record is itself for — never stale, never a
 * verdict of NO_DEFECT/VERIFICATION_REQUIRED, never evidence left over from
 * a different candidate. Deduplicates identical evidence deterministically
 * (same source/candidate type+field+mapping) and skips (never fabricates)
 * any entry missing a required field.
 */
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
    // Every one of these fields is required for the cause to be exploitable
    // by a generator without guessing; a partial entry is skipped, never
    // fabricated (R68 negative test J).
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
    });
  }
  return causes;
}

export function buildCorrectiveContext(input: { previousAttempt: number; validation: any }): CorrectiveContext {
  const { previousAttempt, validation } = input;
  const previousValidatedSha = String(validation?.checkoutSha || '').toLowerCase();
  const findingResults: any[] = Array.isArray(validation?.findingResults) ? validation.findingResults : [];
  return {
    previousAttempt,
    previousValidatedSha,
    // The caller re-verifies (live GitHub) that the current PR head still
    // equals previousValidatedSha before ever reaching this builder -- see
    // Phase 1 items 5-7. Recorded again here so the dispatched context is
    // self-describing without forcing every consumer to cross-reference.
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
