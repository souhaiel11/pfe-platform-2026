// R22-? Phase 1 — merge-authorization contract (types + one pure function).
//
// PURPOSE: give "may this PR be merged by a human?" its own vocabulary,
// separate from the three signals that already exist and must NOT be
// conflated into it:
//
//   1. remediation correctness  — per-finding verdicts, already authoritative
//      at `validation.findingResults[].result` / `validation.derived.findings[].verdict`
//      (FindingVerdict, finding-pipeline-separation.ts). Owned by WF3.
//   2. global pipeline health   — build/tests/QG/scanners, already at
//      `validation.derived.pipelineHealth` (PipelineHealth). INFORMATIVE here.
//   3. deploy readiness         — DeployReadiness / evaluateReadiness
//      (governance.ts). UNTOUCHED. The global Sonar Quality Gate stays a hard
//      blocker THERE; it is only advisory HERE.
//
// This module is a PURE contract. It is NOT wired into incidents.service, the
// lifecycle, the frontend or WF3 in this phase — it only declares the shape a
// later phase will consume, plus small pure helpers so the eventual wiring
// never has to re-implement the derivations Phase 0 pinned down.
//
// BRIQUE 3/4 UPDATE: real regression detection now exists (pr-regression-
// engine.ts) and its `result` is threaded into `regressionResult` below by
// incidents.service.ts#saveValidation. Before real evidence is available
// (no baselineSha/candidateFindingsSnapshot yet — see that engine's own
// header), the caller still passes 'INCONCLUSIVE', which by design keeps a
// fully-remediated PR at 'INCONCLUSIVE' (human diff review) rather than
// 'MERGE_READY' — never 'BLOCKED'.

import { FindingVerdict, PipelineHealth } from './finding-pipeline-separation';

// ── Vocabulary ────────────────────────────────────────────────────────────

/** Whether a human may merge the remediation PR. */
export type MergeAuthorization =
  | 'MERGE_READY'   // every merge precondition is positively satisfied
  | 'BLOCKED'       // a proven defect: an INVALID finding, or a required regression change
  | 'INCONCLUSIVE'  // not provably ready and not provably blocked — needs human judgement
  | 'VALIDATING';   // post-fix validation still running — ask again later

/**
 * Aggregate remediation verdict for the approved batch. Distinct spelling from
 * FindingVerdict on purpose: 'VALIDATED' is a statement about the WHOLE batch,
 * 'VALID' is about ONE finding.
 */
export type RemediationResult = 'VALIDATED' | 'INVALID' | 'INCONCLUSIVE';

/**
 * Result of "did this candidate re-introduce / leave findings that the merge
 * must not carry?" — a diff of candidate findings against an immutable
 * baseline. That baseline/diff does not exist yet, so 'INCONCLUSIVE' is the
 * honest default until the regression foundation lands.
 */
export type RegressionResult = 'CLEAN' | 'CHANGES_REQUIRED' | 'INCONCLUSIVE';
export type HeadVerificationResult = 'PASS' | 'CODE_FAILURE' | 'INCONCLUSIVE';

/** Machine-readable reasons a merge is not authorized. Stable string codes. */
export type MergeBlockingReason =
  | 'FINDING_INVALID'             // >= 1 approved finding is still open at the validated SHA
  | 'REMEDIATION_INCONCLUSIVE'    // the batch is neither all-VALID nor any-INVALID
  | 'REGRESSION_CHANGES_REQUIRED' // the candidate-vs-baseline diff demands changes before merge
  | 'REGRESSION_UNVERIFIED'       // regression could not be established (no baseline/diff yet, or it was inconclusive)
  | 'HEAD_VERIFICATION_UNVERIFIED'
  | 'HEAD_VERIFICATION_CODE_FAILURE'
  | 'STAGE_INCOMPLETE'            // a required pipeline stage (build/tests/sonar) did not complete
  | 'SHA_MISMATCH'               // validated commit != expected PR HEAD, or correlation unverified
  | 'VALIDATION_IN_PROGRESS'      // validation still running
  | 'DEFAULT_VALUE_SEMANTICS_REGRESSION'  // R66 — a proven entity/DTO migration default-value divergence (see default-value-semantics.ts)
  | 'DEFAULT_VALUE_SEMANTICS_UNVERIFIED'; // R79 — this batch's OWN corrective reason is a default-value-semantics defect, but the re-check for the authorized SHA is unresolved or stale — never a proven defect, but never silently ignored either

/** Non-blocking context. Never affects `authorization`. */
export interface MergeAdvisory {
  code: string;
  message: string;
}

export interface MergeAuthorizationInput {
  /** Aggregate of `validation.findingResults[].result` — see deriveRemediationResult(). */
  remediationResult: RemediationResult;
  /**
   * `validation.correlationVerified === true` AND the validated commit equals
   * the expected PR HEAD — see deriveExactCorrelationVerified().
   */
  exactCorrelationVerified: boolean;
  /** Required stages (build, tests, sonar) all completed — not the QG verdict, just "did it run". */
  requiredStagesComplete: boolean;
  /** For now always 'INCONCLUSIVE' from callers (no regression foundation yet). */
  regressionResult: RegressionResult;
  /** Explicit outcome of the exact HEAD_ONLY verifier. Missing means unverified. */
  headVerificationResult?: HeadVerificationResult;
  /**
   * INFORMATIVE ONLY. `validation.derived.pipelineHealth`. A red global Sonar
   * Quality Gate here becomes an advisory, never a merge blocker — it stays a
   * hard blocker in DeployReadiness, which this module does not touch.
   */
  pipelineHealth?: Partial<PipelineHealth> | null;
  /** True while post-fix validation is still running. */
  validationInProgress?: boolean;
  /**
   * R66 — verdict of the generic default-value/deserialization-semantics
   * invariant (default-value-semantics.ts), when it was run for this
   * candidate. Absent/undefined means "not evaluated" and has NO effect —
   * this keeps every existing caller (and every PR that never migrates an
   * entity/request-object field to a DTO) fully backward compatible.
   * 'VERIFICATION_REQUIRED' is a no-op UNLESS `defaultValueSemanticsRequired`
   * is also true (see below) — unresolved evidence must never be
   * misreported as a proven defect, and for an ORDINARY validation must not
   * by itself force INCONCLUSIVE either (that would regress every unrelated
   * validation lacking the source snapshots this check needs). 'PROVEN_DEFECT'
   * always has an effect, regardless of `defaultValueSemanticsRequired`: it
   * is a proven defect exactly like FINDING_INVALID or
   * REGRESSION_CHANGES_REQUIRED, and BLOCKED must be causally correctable
   * via correct-and-revalidate.
   */
  defaultValueSemanticsResult?: 'PROVEN_DEFECT' | 'VERIFICATION_REQUIRED' | 'NO_DEFECT' | null;
  /**
   * R79 — true iff this batch's OWN corrective blockingCauses declare a
   * DEFAULT_VALUE_SEMANTICS_DEFECT (i.e. the remediation's entire stated
   * purpose is fixing exactly the invariant this check verifies). Absent/
   * false means "this check is incidental/informative for this PR" and
   * preserves the existing no-op behavior for VERIFICATION_REQUIRED
   * (including every ordinary PR, and every corrective PR for an unrelated
   * cause). Only when true does an unresolved or stale re-check stop being
   * silently ignorable — because the platform is specifically claiming, via
   * this very remediation, to have resolved that exact defect.
   */
  defaultValueSemanticsRequired?: boolean;
  /**
   * R79 — true iff defaultValueSemanticsResult was computed for the SAME
   * SHA this authorization is FOR. Only meaningful (and only checked) when
   * defaultValueSemanticsRequired is true. Omit/undefined when the caller
   * has no evidence sha to compare (treated as a mismatch, i.e. unverified —
   * fail closed, never assume freshness).
   */
  defaultValueSemanticsEvaluatedShaMatches?: boolean;
  /**
   * R79 — total (type,field) pairs analyzeDefaultValueSemantics() actually
   * ran for this candidate (default-value-semantics-assembler.ts's
   * `checkedPairs`). A NO_DEFECT verdict reached via zero checked pairs
   * (no entity->DTO migration discoverable in THIS attempt's diff — the
   * common shape for a narrower follow-up fix after the migration itself
   * already happened in an earlier attempt) carries no information about
   * the specific defect this batch exists to fix, and must not be treated
   * as proof. Only meaningful when defaultValueSemanticsRequired is true.
   */
  defaultValueSemanticsCheckedPairs?: number;
  /**
   * R79 — true iff at least one of the pairs actually checked matches the
   * blocking cause's own (sourceType, sourceField, candidateType,
   * candidateField) identity AND was itself found safe (not
   * PROVEN_DEFECT — that case already short-circuits to BLOCKED above).
   * This is what distinguishes "the SPECIFIC field this remediation exists
   * to fix was re-checked and cleared" from "some OTHER, unrelated field in
   * the same migration was checked, or nothing relevant was checked at
   * all." Only meaningful when defaultValueSemanticsRequired is true.
   */
  defaultValueSemanticsRelevantPairChecked?: boolean;
}

export interface MergeAuthorizationResult {
  authorization: MergeAuthorization;
  /** Echoed straight from the input — BRIQUE 4: a single authoritative record carries all three facts, no recomputation needed downstream. */
  remediationResult: RemediationResult;
  regressionResult: RegressionResult;
  headVerificationResult: HeadVerificationResult;
  /** PROVEN defects only (FINDING_INVALID, REGRESSION_CHANGES_REQUIRED) — exactly what makes `authorization` 'BLOCKED'. */
  blockingReasons: MergeBlockingReason[];
  /** Unresolved/uncertain evidence (SHA_MISMATCH, STAGE_INCOMPLETE, REMEDIATION_INCONCLUSIVE, REGRESSION_UNVERIFIED, VALIDATION_IN_PROGRESS) — never a proven defect, exactly what makes `authorization` 'INCONCLUSIVE' or 'VALIDATING' when no blockingReason exists. */
  technicalReasons: MergeBlockingReason[];
  advisories: MergeAdvisory[];
}

// ── Pure helpers (reuse existing FindingVerdict, no duplication) ───────────

/**
 * VALIDATED iff there is at least one verdict and every verdict is VALID;
 * INVALID if any verdict is INVALID; INCONCLUSIVE otherwise (including empty).
 * Mirrors the rule Phase 0 documented for `validation.findingResults`.
 */
export function deriveRemediationResult(findingVerdicts: readonly FindingVerdict[]): RemediationResult {
  if (findingVerdicts.some(v => v === 'INVALID')) return 'INVALID';
  if (findingVerdicts.length > 0 && findingVerdicts.every(v => v === 'VALID')) return 'VALIDATED';
  return 'INCONCLUSIVE';
}

/**
 * The exact-correlation gate as Phase 0 found it persisted: WF3's
 * `validation.correlationVerified` AND the validated checkout SHA matching the
 * expected PR HEAD SHA (case-insensitive, both full 40-hex).
 */
export function deriveExactCorrelationVerified(input: {
  correlationVerified: unknown;
  checkoutSha: unknown;
  expectedPrHeadSha: unknown;
}): boolean {
  const a = String(input.checkoutSha ?? '').toLowerCase();
  const b = String(input.expectedPrHeadSha ?? '').toLowerCase();
  const shaOk = /^[a-f0-9]{40}$/.test(a) && a === b;
  return input.correlationVerified === true && shaOk;
}

const CODE_FAILURE_CLASSES = new Set(['CANDIDATE_COMPILE_FAILURE', 'CANDIDATE_TEST_REGRESSION']);

/** Maps the worker's Brique 2 result without ever treating unknown FAIL as a code defect. */
export function deriveHeadVerificationResult(input: {
  overall?: unknown;
  failureClass?: unknown;
} | null | undefined): HeadVerificationResult {
  if (!input || input.overall === 'INCONCLUSIVE') return 'INCONCLUSIVE';
  if (input.overall === 'PASS') return 'PASS';
  if (input.overall === 'FAIL' && CODE_FAILURE_CLASSES.has(String(input.failureClass || ''))) return 'CODE_FAILURE';
  return 'INCONCLUSIVE';
}

// ── The contract ─────────────────────────────────────────────────────────

/**
 * Pure. Deterministic. No IO. Decides merge authorization from signals that
 * ALREADY EXIST, WITHOUT requiring regression detection.
 *
 *  MERGE_READY   only if remediation VALIDATED AND exact/correlation verified
 *                AND required stages complete AND regressionResult === 'CLEAN'.
 *  BLOCKED       if any finding INVALID, OR regressionResult === 'CHANGES_REQUIRED'
 *                — a PROVEN defect, never merely unresolved evidence.
 *  VALIDATING    if validation is still running.
 *  INCONCLUSIVE  otherwise — notably: remediation VALIDATED but regression
 *                INCONCLUSIVE (no baseline yet) => merge is not auto-certifiable,
 *                a human must review the diff. Never treated as BLOCKED: an
 *                unresolved/uncertain signal is not a proven defect.
 *
 *  The global Sonar Quality Gate (pipelineHealth.sonarQualityGate) is NEVER a
 *  merge blocker here — only an advisory. It remains blocking for DEPLOYMENT
 *  via the untouched DeployReadiness path.
 */
export function computeMergeAuthorization(input: MergeAuthorizationInput): MergeAuthorizationResult {
  const advisories = buildAdvisories(input.pipelineHealth);
  const headVerificationResult = input.headVerificationResult ?? 'INCONCLUSIVE';

  if (input.validationInProgress === true) {
    return {
      authorization: 'VALIDATING', remediationResult: input.remediationResult, regressionResult: input.regressionResult,
      headVerificationResult,
      blockingReasons: [], technicalReasons: ['VALIDATION_IN_PROGRESS'], advisories,
    };
  }

  // BRIQUE 4 — reason codes are bucketed by PROVEN-defect vs
  // unresolved/uncertain-evidence as they are derived, not sorted
  // afterward: a code can only ever land in the array matching why it
  // exists. `blockingReasons` alone determines 'BLOCKED'; a non-empty
  // `technicalReasons` (with no blockingReasons) determines 'INCONCLUSIVE'.
  const blockingReasons: MergeBlockingReason[] = [];
  const technicalReasons: MergeBlockingReason[] = [];

  if (input.remediationResult === 'INVALID') blockingReasons.push('FINDING_INVALID');
  else if (input.remediationResult === 'INCONCLUSIVE') technicalReasons.push('REMEDIATION_INCONCLUSIVE');

  if (!input.exactCorrelationVerified) technicalReasons.push('SHA_MISMATCH');
  if (!input.requiredStagesComplete) technicalReasons.push('STAGE_INCOMPLETE');

  if (input.regressionResult === 'CHANGES_REQUIRED') blockingReasons.push('REGRESSION_CHANGES_REQUIRED');
  else if (input.regressionResult === 'INCONCLUSIVE') technicalReasons.push('REGRESSION_UNVERIFIED');

  if (headVerificationResult === 'CODE_FAILURE') blockingReasons.push('HEAD_VERIFICATION_CODE_FAILURE');
  else if (headVerificationResult !== 'PASS') technicalReasons.push('HEAD_VERIFICATION_UNVERIFIED');

  // R66/R79 — see defaultValueSemanticsResult/defaultValueSemanticsRequired
  // doc above. PROVEN_DEFECT always blocks. Otherwise, only when this
  // batch's own corrective cause IS a default-value-semantics defect does an
  // unresolved verdict or a stale/mismatched evaluation SHA stop being a
  // no-op — for every other caller (undefined/false `defaultValueSemanticsRequired`)
  // behavior is byte-identical to before R79.
  if (input.defaultValueSemanticsResult === 'PROVEN_DEFECT') {
    blockingReasons.push('DEFAULT_VALUE_SEMANTICS_REGRESSION');
  } else if (input.defaultValueSemanticsRequired === true) {
    const stale = input.defaultValueSemanticsEvaluatedShaMatches !== true;
    // A NO_DEFECT verdict only counts as positive evidence for THIS gate
    // when it came from actually checking >=1 pair AND at least one checked
    // pair is the specific one the blocking cause names. "No migration
    // discoverable in this diff" (checkedPairs===0) or "only unrelated
    // fields were checked" must never be conflated with "the required pair
    // was checked and found safe" — the bare verdict string cannot tell
    // those apart, which is exactly why the two extra inputs exist.
    const relevantProofPresent = input.defaultValueSemanticsResult === 'NO_DEFECT'
      && (input.defaultValueSemanticsCheckedPairs ?? 0) > 0
      && input.defaultValueSemanticsRelevantPairChecked === true;
    if (stale || !relevantProofPresent) {
      technicalReasons.push('DEFAULT_VALUE_SEMANTICS_UNVERIFIED');
    }
  }

  const hardBlocked = blockingReasons.length > 0;

  let authorization: MergeAuthorization;
  if (hardBlocked) {
    authorization = 'BLOCKED';
  } else if (technicalReasons.length === 0
    && headVerificationResult === 'PASS'
    && input.remediationResult === 'VALIDATED'
    && input.exactCorrelationVerified
    && input.requiredStagesComplete
    && input.regressionResult === 'CLEAN') {
    authorization = 'MERGE_READY';
  } else {
    authorization = 'INCONCLUSIVE';
  }

  return { authorization, remediationResult: input.remediationResult, regressionResult: input.regressionResult,
    headVerificationResult, blockingReasons, technicalReasons, advisories };
}

function buildAdvisories(health?: Partial<PipelineHealth> | null): MergeAdvisory[] {
  const advisories: MergeAdvisory[] = [];
  if (!health) return advisories;

  const qg = String(health.sonarQualityGate ?? '').toUpperCase();
  if (qg && qg !== 'OK' && qg !== 'PASSED' && qg !== 'UNKNOWN') {
    advisories.push({
      code: `SONAR_QUALITY_GATE_${qg}`,
      message:
        'Le Quality Gate SonarQube global du projet n’est pas au vert. Informatif pour le merge ' +
        '(la correction du batch reste prouvée) ; reste bloquant pour le déploiement via DeployReadiness.',
    });
  }
  if (health.technicalFailure) {
    advisories.push({
      code: 'PIPELINE_TECHNICAL_FAILURE',
      message: 'Le pipeline de validation a signalé une défaillance technique — vérifier le build/infra.',
    });
  }
  return advisories;
}
