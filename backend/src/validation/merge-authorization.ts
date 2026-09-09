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
// REGRESSION NOTE: the platform has no findings baseline / candidate-vs-baseline
// diff yet (Phase 0 verdict). Real regression detection is a SEPARATE effort.
// Until it exists, callers pass `regressionResult: 'INCONCLUSIVE'`, which by
// design keeps a fully-remediated PR at MergeAuthorization 'INCONCLUSIVE'
// (human diff review) rather than 'MERGE_READY' — never 'BLOCKED'.

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

/** Machine-readable reasons a merge is not authorized. Stable string codes. */
export type MergeBlockingReason =
  | 'FINDING_INVALID'             // >= 1 approved finding is still open at the validated SHA
  | 'REMEDIATION_INCONCLUSIVE'    // the batch is neither all-VALID nor any-INVALID
  | 'REGRESSION_CHANGES_REQUIRED' // the candidate-vs-baseline diff demands changes before merge
  | 'REGRESSION_UNVERIFIED'       // regression could not be established (no baseline/diff yet, or it was inconclusive)
  | 'STAGE_INCOMPLETE'            // a required pipeline stage (build/tests/sonar) did not complete
  | 'SHA_MISMATCH'               // validated commit != expected PR HEAD, or correlation unverified
  | 'VALIDATION_IN_PROGRESS';     // validation still running

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
  /**
   * INFORMATIVE ONLY. `validation.derived.pipelineHealth`. A red global Sonar
   * Quality Gate here becomes an advisory, never a merge blocker — it stays a
   * hard blocker in DeployReadiness, which this module does not touch.
   */
  pipelineHealth?: Partial<PipelineHealth> | null;
  /** True while post-fix validation is still running. */
  validationInProgress?: boolean;
}

export interface MergeAuthorizationResult {
  authorization: MergeAuthorization;
  blockingReasons: MergeBlockingReason[];
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

// ── The contract ─────────────────────────────────────────────────────────

/**
 * Pure. Deterministic. No IO. Decides merge authorization from signals that
 * ALREADY EXIST, WITHOUT requiring regression detection.
 *
 *  MERGE_READY   only if remediation VALIDATED AND exact/correlation verified
 *                AND required stages complete AND regressionResult === 'CLEAN'.
 *  BLOCKED       if any finding INVALID, OR regressionResult === 'CHANGES_REQUIRED'.
 *  VALIDATING    if validation is still running.
 *  INCONCLUSIVE  otherwise — notably: remediation VALIDATED but regression
 *                INCONCLUSIVE (no baseline yet) => merge is not auto-certifiable,
 *                a human must review the diff.
 *
 *  The global Sonar Quality Gate (pipelineHealth.sonarQualityGate) is NEVER a
 *  merge blocker here — only an advisory. It remains blocking for DEPLOYMENT
 *  via the untouched DeployReadiness path.
 */
export function computeMergeAuthorization(input: MergeAuthorizationInput): MergeAuthorizationResult {
  const advisories = buildAdvisories(input.pipelineHealth);

  if (input.validationInProgress === true) {
    return { authorization: 'VALIDATING', blockingReasons: ['VALIDATION_IN_PROGRESS'], advisories };
  }

  const blockingReasons: MergeBlockingReason[] = [];

  if (input.remediationResult === 'INVALID') blockingReasons.push('FINDING_INVALID');
  else if (input.remediationResult === 'INCONCLUSIVE') blockingReasons.push('REMEDIATION_INCONCLUSIVE');

  if (!input.exactCorrelationVerified) blockingReasons.push('SHA_MISMATCH');
  if (!input.requiredStagesComplete) blockingReasons.push('STAGE_INCOMPLETE');

  if (input.regressionResult === 'CHANGES_REQUIRED') blockingReasons.push('REGRESSION_CHANGES_REQUIRED');
  else if (input.regressionResult === 'INCONCLUSIVE') blockingReasons.push('REGRESSION_UNVERIFIED');

  const hardBlocked = blockingReasons.some(
    r => r === 'FINDING_INVALID' || r === 'REGRESSION_CHANGES_REQUIRED',
  );

  let authorization: MergeAuthorization;
  if (hardBlocked) {
    authorization = 'BLOCKED';
  } else if (blockingReasons.length === 0 && input.regressionResult === 'CLEAN') {
    authorization = 'MERGE_READY';
  } else {
    authorization = 'INCONCLUSIVE';
  }

  return { authorization, blockingReasons, advisories };
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
