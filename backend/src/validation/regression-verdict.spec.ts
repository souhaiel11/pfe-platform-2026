import * as assert from 'node:assert/strict';
import { combineRegressionVerdict, RegressionVerdictInput } from './regression-verdict';
import { analyzeRegression, IdentifiedFinding, RegressionOutput } from './pr-regression-engine';

const finding: IdentifiedFinding = {
  source: 'SONARQUBE', rule: 'generic-rule', path: 'src/example.ts',
  fingerprint: 'SONARQUBE::generic-rule::src/example.ts', line: 10, message: 'Example',
};

function diff(overrides: Partial<RegressionOutput> = {}): RegressionOutput {
  return {
    baselineSha: 'a'.repeat(40), candidateSha: 'b'.repeat(40),
    baselineSnapshotComplete: true, candidateSnapshotComplete: true,
    preExistingFindings: [], resolvedFindings: [], introducedFindings: [],
    ambiguousFindings: [], blockingIntroducedFindings: [],
    preExistingCount: 0, resolvedCount: 0, introducedCount: 0, ambiguousCount: 0,
    warnings: [], result: 'CLEAN', ...overrides,
  };
}

function input(overrides: Partial<RegressionVerdictInput> = {}): RegressionVerdictInput {
  return {
    headVerificationResult: 'PASS', evidenceIntegrity: { ok: true, reasons: [] },
    scannerDiff: diff(), ...overrides,
  };
}

const blockingDiff = diff({
  result: 'CHANGES_REQUIRED', introducedFindings: [finding], introducedCount: 1,
  blockingIntroducedFindings: [finding],
});

// Rows 1-3: HEAD code proof wins over missing scanner data; uncertainty never becomes CLEAN.
for (const scannerComparability of ['PROVEN', 'UNPROVEN'] as const) {
  const code = combineRegressionVerdict(input({
    headVerificationResult: 'CODE_FAILURE', scannerComparability,
    evidenceIntegrity: { ok: false, reasons: ['BASELINE_SHA_UNAVAILABLE'] },
    scannerDiff: diff({ result: 'INCONCLUSIVE', baselineSha: null, baselineSnapshotComplete: false }),
  }));
  assert.deepEqual(code, {
    result: 'CHANGES_REQUIRED', blockingCauses: [{ type: 'HEAD_CODE_FAILURE' }],
    advisories: [], decisionReasons: ['HEAD_CODE_FAILURE'],
  });

  const uncertain = combineRegressionVerdict(input({
    headVerificationResult: 'INCONCLUSIVE', scannerComparability, scannerDiff: blockingDiff,
    evidenceIntegrity: { ok: false, reasons: ['CANDIDATE_SHA_MISMATCH'] },
  }));
  assert.equal(uncertain.result, 'INCONCLUSIVE');
  assert.deepEqual(uncertain.blockingCauses, []);
  assert.deepEqual(uncertain.advisories, []);
  assert.deepEqual(uncertain.decisionReasons, ['HEAD_VERIFICATION_INCONCLUSIVE']);

  for (const reason of ['CANDIDATE_SHA_MISMATCH', 'BASELINE_SHA_UNAVAILABLE',
    'BASELINE_SNAPSHOT_INCOMPLETE', 'CANDIDATE_SNAPSHOT_INCOMPLETE']) {
    const incomplete = combineRegressionVerdict(input({
      scannerComparability, scannerDiff: blockingDiff,
      evidenceIntegrity: { ok: false, reasons: [reason] },
    }));
    assert.equal(incomplete.result, 'INCONCLUSIVE');
    assert.deepEqual(incomplete.blockingCauses, []);
    assert.deepEqual(incomplete.advisories, []);
    assert.deepEqual(incomplete.decisionReasons, ['EVIDENCE_INCOMPLETE', reason]);
  }
}

// Row 4, including the omitted default, zero findings and an ambiguous raw diff.
for (const scannerComparability of [undefined, 'UNPROVEN'] as const) {
  for (const scannerDiff of [diff(), blockingDiff, diff({ result: 'INCONCLUSIVE',
    ambiguousFindings: [finding], ambiguousCount: 1 })]) {
    const result = combineRegressionVerdict(input({ scannerComparability, scannerDiff }));
    assert.equal(result.result, 'CLEAN');
    assert.deepEqual(result.blockingCauses, []);
    assert.equal(result.advisories.length, scannerDiff.introducedFindings.length);
    assert.deepEqual(result.advisories.map(a => a.findingRef), scannerDiff.introducedFindings);
    assert.ok(result.advisories.every(a => a.code === 'SCANNER_FINDING_REVIEW_UNPROVEN_COMPARABILITY'));
    assert.deepEqual(result.decisionReasons,
      ['HEAD_VERIFICATION_PASS', 'SCANNER_ADVISORY_ONLY_UNPROVEN_COMPARABILITY']);
  }
}

// Row 5 has priority over blocking findings if the comparable diff is ambiguous.
const ambiguous = combineRegressionVerdict(input({ scannerComparability: 'PROVEN',
  scannerDiff: { ...blockingDiff, result: 'INCONCLUSIVE', ambiguousFindings: [finding], ambiguousCount: 1 },
}));
assert.equal(ambiguous.result, 'INCONCLUSIVE');
assert.deepEqual(ambiguous.blockingCauses, []);
assert.deepEqual(ambiguous.advisories, []);
assert.deepEqual(ambiguous.decisionReasons, ['HEAD_VERIFICATION_PASS', 'SCANNER_DIFF_INCONCLUSIVE']);

// Rows 6-7: use a real raw diff and a JSON round-trip, with colliding fingerprints.
const nonBlocking = { ...finding, line: 20, message: 'Non-blocking occurrence', severity: 'MINOR' };
for (const isBlocking of [(f: IdentifiedFinding) => f.severity !== 'MINOR', () => false]) {
  const raw = analyzeRegression({
    expectedCandidateSha: 'b'.repeat(40),
    baseline: { sha: 'a'.repeat(40), complete: true, findings: [] },
    candidate: { sha: 'b'.repeat(40), complete: true, findings: [finding, nonBlocking] },
    policy: { isBlocking },
  });
  const result = combineRegressionVerdict(input({
    scannerComparability: 'PROVEN', scannerDiff: JSON.parse(JSON.stringify(raw)),
  }));
  assert.equal(result.result, raw.blockingIntroducedFindings.length ? 'CHANGES_REQUIRED' : 'CLEAN');
  assert.deepEqual(result.blockingCauses,
    raw.blockingIntroducedFindings.map(f => ({ type: 'SCANNER_FINDING', finding: f })));
  assert.deepEqual(result.advisories.map(a => a.findingRef),
    raw.introducedFindings.filter(f => !isBlocking(f)));
  assert.ok(result.advisories.every(a => a.code === 'SCANNER_NON_BLOCKING_FINDING'));
  assert.deepEqual(result.decisionReasons, ['HEAD_VERIFICATION_PASS',
    raw.blockingIntroducedFindings.length ? 'SCANNER_PROVEN_BLOCKING_FINDINGS' : 'SCANNER_PROVEN_NO_BLOCKING_FINDINGS']);
}
const empty = combineRegressionVerdict(input({ scannerComparability: 'PROVEN' }));
assert.equal(empty.result, 'CLEAN');
assert.deepEqual(empty.blockingCauses, []);
assert.deepEqual(empty.advisories, []);

// Occurrences, not fingerprints, distinguish advisory and blocking evidence.
const duplicate = combineRegressionVerdict(input({ scannerComparability: 'PROVEN', scannerDiff: diff({
  result: 'CHANGES_REQUIRED', introducedFindings: [{ ...finding }, { ...finding }],
  introducedCount: 2, blockingIntroducedFindings: [{ ...finding }],
}) }));
assert.equal(duplicate.blockingCauses.length, 1);
assert.equal(duplicate.advisories.length, 1);

// No mutation, deterministic results, and returned records do not alias input findings.
function freezeDeep<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freezeDeep);
    Object.freeze(value);
  }
  return value;
}
for (const scannerComparability of ['PROVEN', 'UNPROVEN'] as const) {
  const frozen = freezeDeep(input({ scannerComparability, scannerDiff: blockingDiff }));
  const before = JSON.stringify(frozen);
  const first = combineRegressionVerdict(frozen);
  assert.deepEqual(first, combineRegressionVerdict(frozen));
  const cause = first.blockingCauses[0];
  if (cause?.type === 'SCANNER_FINDING') cause.finding.message = 'Output-only mutation';
  if (first.advisories[0]?.findingRef) first.advisories[0].findingRef.message = 'Output-only mutation';
  assert.equal(JSON.stringify(frozen), before);
}

console.log('regression-verdict: PASS (7 decision rows, precedence, defaults, evidence gates, occurrences, purity)');
