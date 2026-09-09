// BRIQUE 3 — deterministic PR regression analysis: does the exact validated
// PR head introduce NEW blocking findings compared with the immutable
// remediation baseline?
//
// PHASE 0 AUDIT (this session, see the Brique 3 closeout report for the full
// write-up): the platform has no persisted `baselineSha` on
// Incident/fixRequest today, and the live WF3 pipeline only ever fetches
// Sonar issues filtered to the approved findings' own rule set ("Get
// SonarQube Approved Findings" -- never a full, unfiltered issue list for
// the PR-scoped analysis). Neither gap is fabricated here: this engine
// requires BOTH an attributable baseline snapshot and a complete candidate
// snapshot as explicit inputs, and fails closed (INCONCLUSIVE) whenever
// either is missing -- exactly the merge-authorization.ts comment this
// module finally answers ("the platform has no findings baseline /
// candidate-vs-baseline diff yet ... real regression detection is a
// SEPARATE effort").
//
// This module is pure and technology-neutral: it never mentions Sonar,
// Trivy, OWASP or ZAP by name, never inspects a rule string to decide
// anything, and never decides global business/lifecycle state (that stays
// merge-authorization.ts's job, unchanged, via the `regressionResult` it
// already accepts as an input). Scanner-specific normalization happens
// strictly behind an adapter (see sonar-regression-adapter.ts) before a
// RegressionFinding[] ever reaches this file.

import { computeFindingFingerprint } from './finding-fingerprint';

export interface RegressionFinding {
  /** Generic scanner family the adapter tagged this finding with. */
  source: string;
  rule: string;
  /** Raw, adapter-supplied path/component (pre-normalization; kept for evidence). */
  path: string;
  message?: string | null;
  severity?: string | null;
}

/** A finding whose confidently-computed identity, or the lack of one, drives comparison. */
export interface IdentifiedFinding extends RegressionFinding {
  fingerprint: string | null;
}

export interface RegressionSnapshot {
  /** The exact commit this finding set is attributable to. Null = unattributable. */
  sha: string | null;
  findings: readonly RegressionFinding[];
  /**
   * True only when `findings` is proven to be the COMPLETE finding set for
   * `sha` (not merely a subset such as "the approved findings' rules").
   * False/absent is treated as "cannot be trusted as complete".
   */
  complete: boolean;
}

/** Pure, total, deterministic: does this new finding block the PR? Supplied by the caller — this engine never hardcodes one. */
export interface RegressionPolicy {
  isBlocking(finding: RegressionFinding): boolean;
}

export interface RegressionInput {
  /** The already-governed validation target (Brique 2's frozen validationTargetSha) the candidate snapshot must match exactly. */
  expectedCandidateSha: string;
  baseline: RegressionSnapshot;
  candidate: RegressionSnapshot;
  policy: RegressionPolicy;
}

export type RegressionResult = 'CLEAN' | 'CHANGES_REQUIRED' | 'INCONCLUSIVE';

export interface RegressionOutput {
  baselineSha: string | null;
  candidateSha: string | null;
  preExistingFindings: IdentifiedFinding[];
  resolvedFindings: IdentifiedFinding[];
  introducedFindings: IdentifiedFinding[];
  ambiguousFindings: IdentifiedFinding[];
  blockingIntroducedFindings: IdentifiedFinding[];
  warnings: string[];
  result: RegressionResult;
}

// PHASE 6 design gap, reported explicitly rather than fabricated: this
// session audited backend/webhooks/reports and found no existing
// authoritative severity/rule-based classification of "does this finding
// block a merge" anywhere in the platform. Until one is defined, the only
// safe default is maximally conservative -- every newly-introduced finding
// blocks, with no exceptions -- so a real answer this platform cannot yet
// give never silently resolves to CLEAN. This is the ONLY policy the current
// production wiring (incidents.service.ts#saveValidation) uses; the engine
// itself accepts any RegressionPolicy and is fully exercised against
// non-trivial policies in pr-regression-engine.spec.ts.
export const conservativeRegressionPolicy: RegressionPolicy = { isBlocking: () => true };

function inconclusive(baseline: RegressionSnapshot, candidate: RegressionSnapshot, warnings: string[]): RegressionOutput {
  return {
    baselineSha: baseline.sha ?? null, candidateSha: candidate.sha ?? null,
    preExistingFindings: [], resolvedFindings: [], introducedFindings: [], ambiguousFindings: [], blockingIntroducedFindings: [],
    warnings, result: 'INCONCLUSIVE',
  };
}

function identify(finding: RegressionFinding): IdentifiedFinding {
  return { ...finding, fingerprint: computeFindingFingerprint(finding) };
}

/**
 * PHASE 8 — exact-SHA evidence gate, then PHASE 5 — comparison semantics.
 * Never guesses: any missing/mismatched/incomplete evidence short-circuits
 * to INCONCLUSIVE before any finding is ever compared.
 */
export function analyzeRegression(input: RegressionInput): RegressionOutput {
  const { baseline, candidate, policy, expectedCandidateSha } = input;

  if (!baseline.sha) return inconclusive(baseline, candidate, ['BASELINE_SHA_UNAVAILABLE']);
  if (!baseline.complete) return inconclusive(baseline, candidate, ['BASELINE_SNAPSHOT_INCOMPLETE']);
  if (!candidate.sha) return inconclusive(baseline, candidate, ['CANDIDATE_SHA_UNAVAILABLE']);
  if (!candidate.complete) return inconclusive(baseline, candidate, ['CANDIDATE_SNAPSHOT_INCOMPLETE']);
  if (!expectedCandidateSha || candidate.sha.toLowerCase() !== String(expectedCandidateSha).toLowerCase()) {
    return inconclusive(baseline, candidate, ['CANDIDATE_SHA_MISMATCH']);
  }

  const warnings: string[] = [];

  const baselineIdentified = baseline.findings.map(identify);
  const candidateIdentified = candidate.findings.map(identify);

  // Multiset matching, not set membership: two independent findings that
  // happen to share the same (source, rule, path) fingerprint -- e.g. the
  // same rule violated twice in the same file -- must each be accounted for
  // individually. Set/"has fingerprint" matching would silently collapse N
  // occurrences into one, undercounting RESOLVED and, more importantly,
  // failing to notice a genuinely NEW occurrence added alongside an
  // already-existing one (both would wrongly read as merely PRE_EXISTING).
  const bucket = (findings: IdentifiedFinding[]) => {
    const map = new Map<string, IdentifiedFinding[]>();
    for (const finding of findings) {
      if (finding.fingerprint == null) continue;
      const existing = map.get(finding.fingerprint);
      if (existing) existing.push(finding); else map.set(finding.fingerprint, [finding]);
    }
    return map;
  };
  const baselineBuckets = bucket(baselineIdentified);
  const candidateBuckets = bucket(candidateIdentified);
  if (baselineIdentified.some(f => f.fingerprint == null)) warnings.push('BASELINE_FINDING_UNFINGERPRINTABLE');

  const preExistingFindings: IdentifiedFinding[] = [];
  const introducedFindings: IdentifiedFinding[] = [];
  const ambiguousFindings: IdentifiedFinding[] = candidateIdentified.filter(f => f.fingerprint == null);
  const blockingIntroducedFindings: IdentifiedFinding[] = [];
  const resolvedFindings: IdentifiedFinding[] = [];

  const allFingerprints = new Set([...baselineBuckets.keys(), ...candidateBuckets.keys()]);
  for (const fingerprint of allFingerprints) {
    const baselineOccurrences = baselineBuckets.get(fingerprint) ?? [];
    const candidateOccurrences = candidateBuckets.get(fingerprint) ?? [];
    const matched = Math.min(baselineOccurrences.length, candidateOccurrences.length);
    for (let i = 0; i < matched; i++) preExistingFindings.push(candidateOccurrences[i]);
    for (let i = matched; i < candidateOccurrences.length; i++) {
      const introduced = candidateOccurrences[i];
      introducedFindings.push(introduced);
      if (policy.isBlocking(introduced)) blockingIntroducedFindings.push(introduced);
    }
    for (let i = matched; i < baselineOccurrences.length; i++) resolvedFindings.push(baselineOccurrences[i]);
  }

  // PHASE 5 — any ambiguous evidence is treated as blocking-significant: we
  // cannot safely prove it is NOT a newly-introduced blocking finding, so it
  // is never allowed to resolve to CLEAN by omission.
  const result: RegressionResult = ambiguousFindings.length > 0
    ? 'INCONCLUSIVE'
    : blockingIntroducedFindings.length > 0
    ? 'CHANGES_REQUIRED'
    : 'CLEAN';

  return {
    baselineSha: baseline.sha, candidateSha: candidate.sha,
    preExistingFindings, resolvedFindings, introducedFindings, ambiguousFindings, blockingIntroducedFindings,
    warnings, result,
  };
}
