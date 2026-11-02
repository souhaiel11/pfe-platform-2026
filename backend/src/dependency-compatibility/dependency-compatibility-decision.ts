// Combine les preuves d'un candidat pour décider s'il est recommandé, alternatif ou non concluant.
import { RemediationPlan } from './remediation-plan';
import { CandidateExistenceStatus } from './candidate-existence-checker';
import { compareMavenVersions } from './maven-qualifier-comparator';
import { CandidateVersionPolicy, isAutomationEligiblePolicy } from './candidate-version-policy';

export type PassFail = 'PASS' | 'FAIL' | 'NOT_RUN';
export type TestOutcome = 'PASS' | 'FAIL' | 'NOT_EXECUTED' | 'NOT_RUN';
export type CandidateStatus = 'VALIDATED' | 'REJECTED' | 'NOT_TESTED';

export interface TestedCandidate {
  candidateVersion: string;
  actualEditTarget: string;
  existence: CandidateExistenceStatus;
  resolvedVersion: string | null;
  dependencyResolution: PassFail;
  build: PassFail;
  tests: TestOutcome;
  securityRescan: PassFail;
  targetCveClosed: boolean;
  newHighCriticalCount: number | null;
  dependencyGraphDelta: string[];
  versionPolicy: CandidateVersionPolicy;
  automationEligible: boolean;
  status: CandidateStatus;
  reason: string;
}

export type DependencyCompatibilityState =
  | 'VALIDATED_RECOMMENDED'
  | 'VALIDATED_ALTERNATIVES'
  | 'NO_COMPATIBLE_CANDIDATE'
  | 'SECURITY_TARGET_UNKNOWN'
  | 'PROJECT_CONTEXT_INSUFFICIENT'
  | 'VALIDATION_FAILED';

export interface DependencyCompatibilityDecision {
  state: DependencyCompatibilityState;
  vulnerableDependency: string;
  testedCandidates: TestedCandidate[];
  recommendedCandidate: TestedCandidate | null;
  recommendationReason: string;
  validationEvidence: string[];
}

/** Prépare le résultat lié à contrôle candidat. */
export function gateCandidate(evidence: Omit<TestedCandidate, 'status' | 'reason'>, expectedResolvedVersion: string | null): { status: CandidateStatus; reason: string } {
  if (evidence.existence === 'UNAVAILABLE') return { status: 'REJECTED', reason: 'ARTIFACT_UNAVAILABLE' };
  if (evidence.existence === 'UNKNOWN_REPOSITORY_ACCESS') return { status: 'NOT_TESTED', reason: 'REPOSITORY_ACCESS_UNKNOWN' };
  if (evidence.dependencyResolution !== 'PASS') return { status: 'REJECTED', reason: 'DEPENDENCY_RESOLUTION_FAILED' };
  if (expectedResolvedVersion && evidence.resolvedVersion !== expectedResolvedVersion) {
    return { status: 'REJECTED', reason: `RESOLVED_VERSION_MISMATCH: expected ${expectedResolvedVersion}, got ${evidence.resolvedVersion ?? 'null'}` };
  }
  if (evidence.build !== 'PASS') return { status: 'REJECTED', reason: 'BUILD_FAILED' };
  if (evidence.tests === 'NOT_EXECUTED') return { status: 'REJECTED', reason: 'TESTS_NOT_EXECUTED' };
  if (evidence.tests === 'NOT_RUN') return { status: 'NOT_TESTED', reason: 'TESTS_NOT_RUN' };
  if (evidence.tests !== 'PASS') return { status: 'REJECTED', reason: 'TESTS_FAILED' };
  if (!evidence.targetCveClosed) return { status: 'REJECTED', reason: 'TARGET_CVE_NOT_CLOSED' };
  if (evidence.newHighCriticalCount === null) return { status: 'NOT_TESTED', reason: 'SECURITY_RESCAN_NOT_RUN' };
  if (evidence.newHighCriticalCount > 0) return { status: 'REJECTED', reason: `NEW_SECURITY_REGRESSION: ${evidence.newHighCriticalCount} new HIGH/CRITICAL finding(s)` };
  if (evidence.securityRescan !== 'PASS') return { status: 'REJECTED', reason: 'SECURITY_RESCAN_FAILED' };
  return { status: 'VALIDATED', reason: 'ALL_GATES_PASSED' };
}

/** Prépare le résultat lié à rank Validated candidats. */
export function rankValidatedCandidates(
  validated: TestedCandidate[],
  installedVersion: string,
): { recommended: TestedCandidate | null; ambiguous: boolean } {
  // Phase 3/8 — a cross-major (or otherwise not-automation-eligible)
  // candidate is NEVER ranked into the recommendation, no matter how
  // cleanly it built/tested/rescanned. It is excluded here, one level
  // above the pure comparator, so ranking itself never needs to special-
  // case "but what if this one crossed a major version" -- it simply never
  // sees such a candidate as a ranking option.
  const eligible = validated.filter(c => c.automationEligible);
  if (!eligible.length) return { recommended: null, ambiguous: false };
  if (eligible.length === 1) return { recommended: eligible[0], ambiguous: false };

  const byGraphChurn = [...eligible].sort((a, b) => a.dependencyGraphDelta.length - b.dependencyGraphDelta.length);
  const minChurn = byGraphChurn[0].dependencyGraphDelta.length;
  const leastChurn = byGraphChurn.filter(c => c.dependencyGraphDelta.length === minChurn);
  if (leastChurn.length === 1) return { recommended: leastChurn[0], ambiguous: false };

  // Smallest safe step: the candidate whose version is closest to (but still
  // above) installedVersion, per the Maven-aware comparator. Any
  // INCOMPARABLE pairing among the remaining ties means ranking further is
  // unsafe -- report ambiguous rather than pick arbitrarily.
  let best: TestedCandidate | null = null;
  let ambiguous = false;
  for (const candidate of leastChurn) {
    if (!best) { best = candidate; continue; }
    const cmp = compareMavenVersions(candidate.candidateVersion, best.candidateVersion);
    if (cmp === 'INCOMPARABLE') { ambiguous = true; continue; }
    if (cmp < 0) { best = candidate; ambiguous = false; }
    else if (cmp === 0) { /* equal version, keep first-seen deterministically */ }
    // cmp > 0: candidate is a larger step than current best, ignore.
  }
  void installedVersion; // reserved: comparator already orders relative to itself; installedVersion kept for future distance-metric refinement, never used to break ties arbitrarily today.
  return { recommended: best, ambiguous };
}

/** Construit dépendance compatibilité décision. */
export function buildDependencyCompatibilityDecision(
  vulnerableDependency: string,
  plans: RemediationPlan[],
  manualReviewReason: string | null,
  testedCandidates: TestedCandidate[],
): DependencyCompatibilityDecision {
  const evidence: string[] = [];
  if (!plans.length) {
    evidence.push(manualReviewReason || 'NO_PLAN_GENERATED');
    const state: DependencyCompatibilityState = manualReviewReason === 'NO_SECURITY_CANDIDATE' ? 'SECURITY_TARGET_UNKNOWN' : 'PROJECT_CONTEXT_INSUFFICIENT';
    return { state, vulnerableDependency, testedCandidates: [], recommendedCandidate: null, recommendationReason: manualReviewReason || 'NO_PLAN_GENERATED', validationEvidence: evidence };
  }

  const validated = testedCandidates.filter(c => c.status === 'VALIDATED');
  const notTested = testedCandidates.filter(c => c.status === 'NOT_TESTED');
  const rejected = testedCandidates.filter(c => c.status === 'REJECTED');

  if (!testedCandidates.length || (!validated.length && notTested.length > 0 && !rejected.length)) {
    return { state: 'PROJECT_CONTEXT_INSUFFICIENT', vulnerableDependency, testedCandidates, recommendedCandidate: null, recommendationReason: 'No candidate has been sandbox-tested yet.', validationEvidence: evidence };
  }

  if (!validated.length) {
    return { state: 'NO_COMPATIBLE_CANDIDATE', vulnerableDependency, testedCandidates, recommendedCandidate: null, recommendationReason: `All ${rejected.length} tested candidate(s) failed at least one required gate: ${rejected.map(c => `${c.candidateVersion} (${c.reason})`).join('; ')}.`, validationEvidence: evidence };
  }

  const installedVersion = plans[0].fromVersion;
  const eligibleValidated = validated.filter(c => c.automationEligible);
  const majorUpgradeOnly = validated.filter(c => !c.automationEligible);

  // Phase 3/8 — technically-clean candidates exist, but EVERY one of them
  // requires a major-version bump (or the version step is otherwise unsafe
  // to automate). Never silently recommend one: report the equivalent of
  // NO_AUTO_COMPATIBLE_CANDIDATE + MAJOR_UPGRADE_AVAILABLE_FOR_REVIEW,
  // keeping the major-upgrade candidate(s) visible as evidence, never lost.
  if (!eligibleValidated.length) {
    return {
      state: 'NO_COMPATIBLE_CANDIDATE', vulnerableDependency, testedCandidates, recommendedCandidate: null,
      recommendationReason: `NO_AUTO_COMPATIBLE_CANDIDATE: ${majorUpgradeOnly.length} candidate(s) passed every technical gate but require a major-version upgrade (MAJOR_UPGRADE_AVAILABLE_FOR_REVIEW): ${majorUpgradeOnly.map(c => `${c.candidateVersion} (${c.versionPolicy.reason})`).join('; ')}. Kept as evidence for a future developer-approved major-upgrade flow, never discarded.`,
      validationEvidence: evidence,
    };
  }

  const { recommended, ambiguous } = rankValidatedCandidates(validated, installedVersion);
  if (!recommended) {
    return { state: 'VALIDATION_FAILED', vulnerableDependency, testedCandidates, recommendedCandidate: null, recommendationReason: 'Validated, automation-eligible candidates exist but ranking could not select one safely.', validationEvidence: evidence };
  }
  const majorUpgradeNote = majorUpgradeOnly.length ? ` (${majorUpgradeOnly.length} additional major-upgrade candidate(s) kept as evidence, never auto-recommended: ${majorUpgradeOnly.map(c => c.candidateVersion).join(', ')})` : '';
  if (ambiguous || eligibleValidated.length > 1) {
    return {
      state: 'VALIDATED_ALTERNATIVES', vulnerableDependency, testedCandidates, recommendedCandidate: recommended,
      recommendationReason: `${eligibleValidated.length} same-major-or-safer candidates passed every gate; ${recommended.candidateVersion} is the smallest validated change, but at least one alternative could not be strictly ordered against it (Maven qualifier ambiguity) -- surfaced as an alternative, never silently discarded.${majorUpgradeNote}`,
      validationEvidence: evidence,
    };
  }
  return {
    state: 'VALIDATED_RECOMMENDED', vulnerableDependency, testedCandidates, recommendedCandidate: recommended,
    recommendationReason: `${recommended.candidateVersion} passed every required gate (dependency resolution, build, tests, target CVE closure, no new HIGH/CRITICAL) and is the smallest safe (same-major) change from ${installedVersion}.${majorUpgradeNote}`,
    validationEvidence: evidence,
  };
}
