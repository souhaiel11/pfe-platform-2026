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

export interface BlockingCause {
  type: 'TARGET_FINDING_INVALID' | 'NEW_BLOCKING_FINDING';
  findingId?: string;
  findingSource?: string | null;
  rule?: string | null;
  path?: string | null;
  line?: number | null;
  message?: string | null;
  evidenceRef?: string | null;
  scannerAnalysisId?: string | null;
  candidateSha: string;
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
