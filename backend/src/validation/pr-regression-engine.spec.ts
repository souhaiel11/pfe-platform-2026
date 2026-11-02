// Teste le composant « pr-regression-engine » et ses cas d’erreur.
import * as assert from 'node:assert/strict';
import { analyzeRegression, conservativeRegressionPolicy, RegressionFinding, RegressionPolicy } from './pr-regression-engine';
import { computeFindingFingerprint, normalizeFindingPath } from './finding-fingerprint';
import { normalizeSonarFindings, isActiveSonarIssue, RawSonarIssue } from './sonar-regression-adapter';


const ABC = 'a'.repeat(40);
const DEF = 'd'.repeat(40);

/** Simule la lecture des données demandées par le composant. */
function finding(rule: string, path = 'Service.java', message?: string): RegressionFinding {
  return { source: 'TEST', rule, path, message: message ?? null };
}

const alwaysBlocking: RegressionPolicy = {
/** Prépare les données nécessaires à ce scénario. */
isBlocking: () => true };
const neverBlocking: RegressionPolicy = {
/** Prépare les données nécessaires à ce scénario. */
isBlocking: () => false };

/** Exécute les étapes principales de ce programme. */
function main() {
  // ------------------------------------------------------------------
  // CASE A — clean incremental remediation
  // ------------------------------------------------------------------
  {
    const out = analyzeRegression({
      expectedCandidateSha: ABC,
      baseline: { sha: ABC, findings: ['A', 'B', 'C', 'D'].map(r => finding(r)), complete: true },
      candidate: { sha: ABC, findings: ['C', 'D'].map(r => finding(r)), complete: true },
      policy: alwaysBlocking,
    });
    assert.deepEqual(out.resolvedFindings.map(f => f.rule).sort(), ['A', 'B']);
    assert.deepEqual(out.preExistingFindings.map(f => f.rule).sort(), ['C', 'D']);
    assert.equal(out.introducedFindings.length, 0);
    assert.equal(out.result, 'CLEAN', 'CASE A: clean incremental remediation');
  }

  // ------------------------------------------------------------------
  // CASE B — new blocking regression
  // ------------------------------------------------------------------
  {
    const out = analyzeRegression({
      expectedCandidateSha: ABC,
      baseline: { sha: ABC, findings: ['A', 'B', 'C', 'D'].map(r => finding(r)), complete: true },
      candidate: { sha: ABC, findings: ['C', 'D', 'X'].map(r => finding(r)), complete: true },
      policy: {
      /** Prépare les données nécessaires à ce scénario. */
      isBlocking: f => f.rule === 'X' },
    });
    assert.deepEqual(out.introducedFindings.map(f => f.rule), ['X']);
    assert.deepEqual(out.blockingIntroducedFindings.map(f => f.rule), ['X']);
    assert.equal(out.result, 'CHANGES_REQUIRED', 'CASE B: new blocking regression');
  }

  // ------------------------------------------------------------------
  // CASE C — new non-blocking finding: introduced but must NOT fabricate
  // blocking status, and must not silently flip the result.
  // ------------------------------------------------------------------
  {
    const out = analyzeRegression({
      expectedCandidateSha: ABC,
      baseline: { sha: ABC, findings: ['A', 'B'].map(r => finding(r)), complete: true },
      candidate: { sha: ABC, findings: ['B', 'W'].map(r => finding(r)), complete: true },
      policy: {
      /** Prépare les données nécessaires à ce scénario. */
      isBlocking: f => f.rule === 'W' ? false : true },
    });
    assert.deepEqual(out.resolvedFindings.map(f => f.rule), ['A']);
    assert.deepEqual(out.preExistingFindings.map(f => f.rule), ['B']);
    assert.deepEqual(out.introducedFindings.map(f => f.rule), ['W'], 'CASE C: W is retained as evidence even though non-blocking');
    assert.equal(out.blockingIntroducedFindings.length, 0, 'CASE C: policy is respected, never fabricated as blocking');
    assert.equal(out.result, 'CLEAN', 'CASE C: a non-blocking new finding does not change the result, per policy');
  }
  // Same policy inverted (W blocking): proves the engine has no built-in
  // opinion of its own -- only the supplied policy decides.
  {
    const out = analyzeRegression({
      expectedCandidateSha: ABC,
      baseline: { sha: ABC, findings: ['A', 'B'].map(r => finding(r)), complete: true },
      candidate: { sha: ABC, findings: ['B', 'W'].map(r => finding(r)), complete: true },
      policy: {
      /** Prépare les données nécessaires à ce scénario. */
      isBlocking: f => f.rule === 'W' },
    });
    assert.equal(out.result, 'CHANGES_REQUIRED', 'CASE C (inverted policy): the exact same finding set flips result when only the policy changes');
  }

  // ------------------------------------------------------------------
  // CASE D — line moved, same logical finding (through the real Sonar
  // adapter: componentKey prefix stripping + line-independent identity).
  // ------------------------------------------------------------------
  {
    const baselineIssue: RawSonarIssue = { key: 'k1', rule: 'java:S1234', component: 'proj:Service.java', line: 30, status: 'OPEN' };
    const candidateIssue: RawSonarIssue = { key: 'k2', rule: 'java:S1234', component: 'proj-pr-25:Service.java', line: 42, status: 'OPEN' };
    assert.equal(
      computeFindingFingerprint({ source: 'SONARQUBE', rule: baselineIssue.rule!, path: baselineIssue.component! }),
      computeFindingFingerprint({ source: 'SONARQUBE', rule: candidateIssue.rule!, path: candidateIssue.component! }),
      'CASE D: same rule/path fingerprints identically across different Sonar project keys and line numbers',
    );
    const out = analyzeRegression({
      expectedCandidateSha: ABC,
      baseline: { sha: ABC, findings: normalizeSonarFindings([baselineIssue]), complete: true },
      candidate: { sha: ABC, findings: normalizeSonarFindings([candidateIssue]), complete: true },
      policy: alwaysBlocking,
    });
    assert.equal(out.introducedFindings.length, 0, 'CASE D: a moved line must never be classified as introduced');
    assert.equal(out.preExistingFindings.length, 1);
    assert.equal(out.result, 'CLEAN', 'CASE D');
  }

  // ------------------------------------------------------------------
  // CASE E — ambiguous identity: a candidate finding whose fingerprint
  // cannot be confidently computed (missing rule) must never be silently
  // classified either way.
  // ------------------------------------------------------------------
  {
    const out = analyzeRegression({
      expectedCandidateSha: ABC,
      baseline: { sha: ABC, findings: [finding('A')], complete: true },
      candidate: { sha: ABC, findings: [finding('A'), { source: 'TEST', rule: '', path: 'Unknown.java' }], complete: true },
      policy: neverBlocking, // even a policy that would call everything non-blocking must not rescue this to CLEAN
    });
    assert.ok(out.ambiguousFindings.length > 0, 'CASE E: ambiguous findings are recorded');
    assert.equal(out.result, 'INCONCLUSIVE', 'CASE E: ambiguous evidence never resolves to CLEAN or CHANGES_REQUIRED');
  }

  // Baseline evidence without an identity is equally unusable: never emit a
  // definitive CLEAN/CHANGES_REQUIRED result from a partially incomparable baseline.
  {
    const out = analyzeRegression({
      expectedCandidateSha: ABC,
      baseline: { sha: ABC, findings: [{ source: 'TEST', rule: '', path: 'Unknown.java' }], complete: true },
      candidate: { sha: ABC, findings: [], complete: true },
      policy: alwaysBlocking,
    });
    assert.equal(out.result, 'INCONCLUSIVE', 'baseline finding without fingerprint -> INCONCLUSIVE');
    assert.ok(out.warnings.includes('BASELINE_FINDING_UNFINGERPRINTABLE'));
  }

  // Population semantics are severity-agnostic: a pre-existing MINOR finding
  // is pre-existing, while a genuinely new MINOR blocks under the production policy.
  {
    const minor = finding('minor-rule', 'src/Minor.java');
    const clean = analyzeRegression({
      expectedCandidateSha: ABC,
      baseline: { sha: ABC, findings: [minor], complete: true },
      candidate: { sha: ABC, findings: [minor], complete: true },
      policy: conservativeRegressionPolicy,
    });
    assert.equal(clean.result, 'CLEAN');
    const introduced = analyzeRegression({
      expectedCandidateSha: ABC,
      baseline: { sha: ABC, findings: [], complete: true },
      candidate: { sha: ABC, findings: [minor], complete: true },
      policy: conservativeRegressionPolicy,
    });
    assert.equal(introduced.result, 'CHANGES_REQUIRED');
  }

  {
    const out = analyzeRegression({
      expectedCandidateSha: ABC,
      baseline: { sha: ABC, findings: [finding('DUP', 'Same.java', 'msg A'), finding('DUP', 'Same.java', 'msg B')], complete: true },
      candidate: { sha: ABC, findings: [finding('DUP', 'Same.java', 'msg A'), finding('DUP', 'Same.java', 'msg C')], complete: true },
      policy: alwaysBlocking,
    });
    // "msg A" pairs confidently (present on both sides) -> pre-existing.
    assert.equal(out.preExistingFindings.length, 1);
    // "msg B" (baseline-only) and "msg C" (candidate-only) cannot be
    // confidently told apart from "the same finding whose message changed" --
    // both must be ambiguous, never RESOLVED+INTRODUCED by raw count delta.
    assert.equal(out.ambiguousFindings.length, 2, 'TEST J: the unpaired leftovers on both sides are ambiguous');
    assert.equal(out.resolvedFindings.length, 0, 'TEST J: never silently RESOLVED when an equally-plausible introduction coexists');
    assert.equal(out.introducedFindings.length, 0, 'TEST J: never silently INTRODUCED when an equally-plausible resolution coexists');
    assert.equal(out.result, 'INCONCLUSIVE', 'TEST J: fail-closed ambiguity, never a false CLEAN or a fabricated CHANGES_REQUIRED');
  }
  // Same collision, but ONE-DIRECTIONAL evidence (no candidate-only leftover
  // exists to conflate with): a purely-resolved instance IS still
  // confidently classified, proving the design is not needlessly
  // conservative when there is genuinely nothing to disambiguate.
  {
    const out = analyzeRegression({
      expectedCandidateSha: ABC,
      baseline: { sha: ABC, findings: [finding('DUP', 'Same.java', 'msg A'), finding('DUP', 'Same.java', 'msg B')], complete: true },
      candidate: { sha: ABC, findings: [finding('DUP', 'Same.java', 'msg A')], complete: true },
      policy: alwaysBlocking,
    });
    assert.equal(out.preExistingFindings.length, 1);
    assert.equal(out.resolvedFindings.length, 1, 'msg B has no candidate-side counterpart to conflate with -- confidently RESOLVED');
    assert.equal(out.ambiguousFindings.length, 0);
    assert.equal(out.result, 'CLEAN', 'one-directional collision evidence is not needlessly flagged ambiguous');
  }

  // ------------------------------------------------------------------
  // CASE F — baseline snapshot unavailable
  // ------------------------------------------------------------------
  {
    const out = analyzeRegression({
      expectedCandidateSha: ABC,
      baseline: { sha: null, findings: [], complete: false },
      candidate: { sha: ABC, findings: [finding('A')], complete: true },
      policy: alwaysBlocking,
    });
    assert.equal(out.result, 'INCONCLUSIVE');
    assert.notEqual(out.result, 'CLEAN', 'CASE F: never CLEAN without a baseline');
  }

  // ------------------------------------------------------------------
  // CASE G — candidate scanner snapshot incomplete
  // ------------------------------------------------------------------
  {
    const out = analyzeRegression({
      expectedCandidateSha: ABC,
      baseline: { sha: ABC, findings: [finding('A')], complete: true },
      candidate: { sha: ABC, findings: [finding('A')], complete: false },
      policy: alwaysBlocking,
    });
    assert.equal(out.result, 'INCONCLUSIVE');
    assert.notEqual(out.result, 'CLEAN', 'CASE G: never CLEAN with an incomplete candidate snapshot');
  }

  // ------------------------------------------------------------------
  // CASE H — wrong candidate SHA: scanner evidence belongs to DEF, the
  // governed target is ABC.
  // ------------------------------------------------------------------
  {
    const out = analyzeRegression({
      expectedCandidateSha: ABC,
      baseline: { sha: ABC, findings: [finding('A')], complete: true },
      candidate: { sha: DEF, findings: [finding('A')], complete: true },
      policy: alwaysBlocking,
    });
    assert.equal(out.result, 'INCONCLUSIVE');
    assert.notEqual(out.result, 'CLEAN', 'CASE H: never CLEAN when candidate evidence belongs to the wrong SHA');
  }

  // ------------------------------------------------------------------
  // CASE I — global Quality Gate ERROR caused only by pre-existing findings
  // must never influence the result: the engine has no Quality Gate input
  // at all (structural proof, not just a behavioral one).
  // ------------------------------------------------------------------
  {
    const out = analyzeRegression({
      expectedCandidateSha: ABC,
      baseline: { sha: ABC, findings: Array.from({ length: 14 }, (_, i) => finding(`R${i}`)), complete: true },
      candidate: { sha: ABC, findings: Array.from({ length: 14 }, (_, i) => finding(`R${i}`)), complete: true },
      policy: alwaysBlocking,
    } as any /* deliberately no globalQualityGate field exists on RegressionInput */);
    assert.equal(out.result, 'CLEAN', 'CASE I: 14 pre-existing findings, global QG ERROR is not this engine\'s concern, result stays CLEAN');
  }

  {
    const PR25_SHA = '8a315b0dd508eb9843bb3037fe2827f02f6faa78';
    const otherRules = Array.from({ length: 14 }, (_, i) => ({
      key: `hist-${i}`, rule: `java:S${1000 + i}`, component: 'pfe-app-test:src/main/java/com/pfe/devsecops/Other.java', line: i + 1, status: 'OPEN',
    }));
    const s4684 = [
      { key: 's4684-a', rule: 'java:S4684', component: 'pfe-app-test:src/main/java/com/pfe/devsecops/dto/TaskDTO.java', line: 12, status: 'OPEN' },
      { key: 's4684-b', rule: 'java:S4684', component: 'pfe-app-test:src/main/java/com/pfe/devsecops/dto/TaskDTO.java', line: 34, status: 'OPEN' },
    ];
    const baselineIssues: RawSonarIssue[] = [...otherRules, ...s4684];
    // Candidate re-analysis (PR-scoped project key): the 2 approved S4684
    // issues are CLOSED/FIXED (never active per isActiveSonarIssue); the 14
    // historical issues remain untouched (same rule/path, different line
    // numbers are irrelevant per Case D).
    const candidateIssues: RawSonarIssue[] = [
      ...otherRules.map((issue, i) => ({ ...issue, key: `pr-hist-${i}`, component: issue.component.replace('pfe-app-test:', 'pfe-app-test-pr-25:'), line: issue.line + 100 })),
      { key: 'pr-s4684-a', rule: 'java:S4684', component: 'pfe-app-test-pr-25:src/main/java/com/pfe/devsecops/dto/TaskDTO.java', line: 12, status: 'CLOSED', resolution: 'FIXED' },
      { key: 'pr-s4684-b', rule: 'java:S4684', component: 'pfe-app-test-pr-25:src/main/java/com/pfe/devsecops/dto/TaskDTO.java', line: 34, status: 'CLOSED', resolution: 'FIXED' },
    ];

    const out = analyzeRegression({
      expectedCandidateSha: PR25_SHA,
      baseline: { sha: PR25_SHA, findings: normalizeSonarFindings(baselineIssues), complete: true },
      candidate: { sha: PR25_SHA, findings: normalizeSonarFindings(candidateIssues), complete: true },
      policy: conservativeRegressionPolicy,
    });
    assert.equal(out.resolvedFindings.length, 2, 'PR#25: both S4684 resolved');
    assert.equal(out.preExistingFindings.length, 14, 'PR#25: 14 historical findings remain, pre-existing');
    assert.equal(out.introducedFindings.length, 0, 'PR#25: no new finding');
    assert.equal(out.blockingIntroducedFindings.length, 0);
    assert.equal(out.result, 'CLEAN', 'PR#25: regressionResult CLEAN regardless of global Sonar Quality Gate status');
  }

  // Sonar adapter contract sanity: CLOSED/FIXED issues are inactive; issues
  // with no usable status field at all fail closed (treated as active).
  assert.equal(isActiveSonarIssue({ rule: 'x', status: 'OPEN' }), true);
  assert.equal(isActiveSonarIssue({ rule: 'x', status: 'CLOSED', resolution: 'FIXED' }), false);
  assert.equal(isActiveSonarIssue({ rule: 'x', resolution: 'WONTFIX' }), false);
  assert.equal(isActiveSonarIssue({ rule: 'x' }), true, 'no usable status field at all fails closed as still active');
  assert.equal(isActiveSonarIssue(null), false);

  // Fingerprint contract sanity.
  assert.equal(normalizeFindingPath('projKey:src/A.java'), 'src/a.java');
  assert.equal(normalizeFindingPath('src\\A.java'), 'src/a.java');
  assert.equal(computeFindingFingerprint({ source: 'sonarqube', rule: 'java:S1', path: 'projKey:A.java' }),
    computeFindingFingerprint({ source: 'SONARQUBE', rule: 'java:S1', path: 'otherProjKey:A.java' }));
  assert.equal(computeFindingFingerprint({ source: 'SONARQUBE', rule: '', path: 'A.java' }), null);
  assert.equal(computeFindingFingerprint({ source: 'SONARQUBE', rule: 'java:S1', path: '' }), null);

  console.log('PR regression engine (Brique 3, Cases A-I + PR#25 fixture): PASS');
}

main();
