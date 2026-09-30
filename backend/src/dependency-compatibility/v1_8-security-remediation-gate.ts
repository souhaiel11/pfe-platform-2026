// V1.8 Phase 5 ticket — "Controlled WF6 Enforcement". The ONE authoritative,
// deterministic predicate this ticket asks for
// (canDispatchSecurityRemediationV18, Phase 4). Pure function, no I/O.
//
// ARCHITECTURE RULE this whole module exists to enforce: the Dependency
// Compatibility Resolver (V1.8) decides WHAT should change; WF6 only ever
// EXECUTES an already-validated plan. This function is the boundary between
// those two roles -- it is the only place that may say ALLOW, and it never
// selects a version/owner/strategy itself, it only checks that evidence
// ALREADY computed offline (v1_8-evidence-store.json) still exactly matches
// the live task it is about to authorize.
import { V1_8CompatibilityDecision } from './v1_8-compatibility-decision.types';

/**
 * Edit types the REAL, live production patch writer(s) can actually perform
 * today -- see this module's own Phase 8 audit. Never claim a type is
 * dispatchable if it is not in this set.
 *
 * V1.8 Phase 7 — PARENT_VERSION added: maven-parent-patch-writer.ts is the
 * real, fail-closed writer for it (separate from maven-security-patch-
 * writer.ts, which only ever handles DEPENDENCY_VERSION/PROPERTY_VERSION --
 * see that new file's own header for why a parent edit is never folded
 * into the same function). This flips the GATE's capability declaration
 * only; it does not, by itself, wire a PARENT_VERSION plan through the live
 * evaluate-batch/candidate-verifier decision pipeline (a separate,
 * not-yet-built integration) -- an ENFORCED-mode dispatch of a
 * PARENT_VERSION finding today would still fail safely downstream
 * (NOT_ELIGIBLE / DEVELOPER_ACTION_REQUIRED, never a wrong write) rather
 * than actually reach maven-parent-patch-writer.ts. See V1.8 Phase 7's own
 * report for the explicit "no live dispatch this phase" boundary.
 */
export const LIVE_WRITER_SUPPORTED_EDIT_TYPES = new Set(['DEPENDENCY_VERSION', 'PROPERTY_VERSION', 'PARENT_VERSION']);

export interface SecurityRemediationDispatchContext {
  repository: string;
  /** The CURRENT trusted commit SHA for this task's project (SecurityFindingResolverService's own incident.metadata.sourceCommitSha) -- never re-derived here, always supplied by the caller's own already-trusted resolution. */
  commitSha: string;
  source: string;
  cve: string;
  component: string;
  installedVersion: string;
  /** Whether the task's OWN status/lifecycle already permits a dispatch attempt (manual-remediation.service.ts's launchBatchRemediation() already computes and enforces this independently -- this predicate does not re-implement that check, only requires the caller to have already confirmed it, so the two authorization layers can never silently drift apart). */
  statusPermitsDispatch: boolean;
}

export type SecurityRemediationV1_8GateDecision =
  | { decision: 'ALLOW'; reason: 'ALL_GATES_PASSED'; evidence: V1_8CompatibilityDecision }
  | { decision: 'BLOCK'; reason: string; evidence: V1_8CompatibilityDecision | null };

function mismatch(field: string, expected: string, actual: string): string {
  return `V1_8_EVIDENCE_STALE: ${field} mismatch (evidence validated against "${expected}", task currently reports "${actual}") -- refusing to reuse stale evidence, never silently.`;
}

/**
 * Phase 3 — stale-evidence guard. Every field the ticket lists is compared,
 * in the order the ticket lists them. The FIRST mismatch wins (never a
 * partial/soft match) -- exact discipline as gateCandidate()
 * (dependency-compatibility-decision.ts) already uses elsewhere in this
 * module family.
 */
export function isEvidenceStale(task: SecurityRemediationDispatchContext, evidence: V1_8CompatibilityDecision): string | null {
  if (evidence.repository !== task.repository) return mismatch('repository', evidence.repository, task.repository);
  if (evidence.validatedCommitSha.toLowerCase() !== task.commitSha.toLowerCase()) return mismatch('commitSha', evidence.validatedCommitSha, task.commitSha);
  if (evidence.findingSource !== String(task.source).toUpperCase()) return mismatch('source', evidence.findingSource, task.source);
  if (evidence.cve !== task.cve) return mismatch('cve', evidence.cve, task.cve);
  if (evidence.component !== task.component) return mismatch('component', evidence.component, task.component);
  if (evidence.installedVersion !== task.installedVersion) return mismatch('installedVersion', evidence.installedVersion, task.installedVersion);
  return null;
}

/**
 * Phase 4 — the authoritative gate. ALLOW only when every clause the ticket
 * lists is true, checked in that exact order; the first failing clause is
 * the reported reason, never a generic "not eligible". Phase 5's own rule
 * ("no fallback to the old classifier") holds structurally: this function
 * never reads SecurityRemediationType/AUTO_FIX_ELIGIBLE at all -- only the
 * V1.8 evidence and the live task context are ever consulted.
 */
export function canDispatchSecurityRemediationV1_8(
  task: SecurityRemediationDispatchContext,
  evidence: V1_8CompatibilityDecision | null,
): SecurityRemediationV1_8GateDecision {
  if (!evidence) return { decision: 'BLOCK', reason: 'MISSING_EVIDENCE', evidence: null };

  const staleReason = isEvidenceStale(task, evidence);
  if (staleReason) return { decision: 'BLOCK', reason: staleReason, evidence };

  if (evidence.state !== 'VALIDATED_RECOMMENDED') return { decision: 'BLOCK', reason: evidence.state, evidence };
  if (evidence.sandboxValidated !== true) return { decision: 'BLOCK', reason: 'SANDBOX_NOT_VALIDATED', evidence };
  if (evidence.targetCveClosed !== true) return { decision: 'BLOCK', reason: 'TARGET_CVE_NOT_CLOSED', evidence };
  if (evidence.newHighCriticalCount !== 0) return { decision: 'BLOCK', reason: 'NEW_HIGH_CRITICAL_REGRESSION', evidence };
  if (evidence.recommendedVersion == null) return { decision: 'BLOCK', reason: 'RECOMMENDED_VERSION_MISSING', evidence };
  if (evidence.actualEditTarget == null) return { decision: 'BLOCK', reason: 'EDIT_TARGET_UNKNOWN', evidence };
  if (evidence.editType == null) return { decision: 'BLOCK', reason: 'EDIT_TYPE_UNKNOWN', evidence };
  if (evidence.requiresDeveloperReview === true) return { decision: 'BLOCK', reason: 'DEVELOPER_REVIEW_REQUIRED', evidence };

  // Phase 8 — the live writer's own real support matrix. A candidate that
  // passed EVERY sandbox gate is still never dispatchable if the live
  // production patch writer cannot perform this edit type at all (PARENT/
  // BOM/DEPENDENCY_MANAGEMENT today) -- see this module's own header
  // comment: WF6 executes, it never invents a writer capability that does
  // not exist yet.
  if (!LIVE_WRITER_SUPPORTED_EDIT_TYPES.has(evidence.editType)) return { decision: 'BLOCK', reason: 'UNSUPPORTED_EDIT_TYPE', evidence };

  if (!task.statusPermitsDispatch) return { decision: 'BLOCK', reason: 'TASK_STATUS_DOES_NOT_PERMIT_DISPATCH', evidence };

  return { decision: 'ALLOW', reason: 'ALL_GATES_PASSED', evidence };
}
