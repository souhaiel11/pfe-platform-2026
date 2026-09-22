// R-SEC-V1.3 §2/§3 — the orchestration contract connecting the pieces
// already built and committed in V1/V1.1 (grounded decision, foundation
// commit bcde8eb3) and V1.2 (deterministic writer + guard, commit
// 14846855) into one coherent flow. Pure types only; no I/O.
//
// §2 — "decision envelope": deliberately NOT a new type. SecurityFindingDecision
// (security-finding-decision.types.ts, committed in the Foundation) already
// carries exactly the shape this section asks for: findingIdentity,
// evaluatedSha, provenance{ecosystem,kind,package,installedVersion,
// controllingFile,controllingElement,controllingProperty,groundedSha,evidence},
// fixedVersions, selectedTargetVersion, remediationType, reason. Introducing
// a second, parallel "decision envelope" type here would be exactly the
// "duplicate existing types unnecessarily" this task explicitly forbids.
// The non-override guarantee the task asks for (evaluatedSha/provenance/
// installedVersion/targetVersion/controllingFile can never be caller/LLM-
// controlled) already holds structurally: SecurityFindingDecisionService.decide()
// (candidate-verifier/src/security-finding-decision.service.ts) accepts only
// {findingIdentity, source, package, expectedInstalledVersion, fixedVersion}
// plus workspace identity (repository/candidateBaseSha/requestId/batchId/
// candidateAttempt) as input -- every other field on SecurityFindingDecision
// is COMPUTED internally from real grounding + the pure classifier, never
// echoed back from caller input.
import { CandidateManifest } from '../candidate-verification/candidate-verification.types';
import { SecurityFindingDecision, SecurityFindingDecisionInput } from './security-finding-decision.types';
import { SecurityPatchGuardResult } from './security-patch-guard';
import { DependencyProvenanceKind } from './dependency-provenance.types';

/**
 * §4 step 1 input: trusted finding identity + project/repository context +
 * requested SHA. `finding` is passed through unchanged to
 * SecurityFindingDecisionService.decide() -- the orchestrator adds no new
 * input surface beyond what that already-proven service accepts.
 */
export interface SecurityRemediationOrchestrationInput {
  finding: SecurityFindingDecisionInput;
  repository: string;
  candidateBaseSha: string;
  requestId: string;
  batchId: string;
  candidateAttempt: number;
}

/**
 * Every non-terminal status is a proven, deterministic REASON to stop --
 * never a fabricated AUTO_FIX_ELIGIBLE (§5). `CANDIDATE_READY` is the only
 * status carrying a non-null candidateManifest.
 */
export type SecurityRemediationCandidateStatus =
  | 'CANDIDATE_READY'
  | 'NOT_ELIGIBLE'
  | 'GROUNDING_FAILED'
  | 'PATCH_GENERATION_FAILED'
  | 'GUARD_REJECTED'
  | 'WORKSPACE_FAILURE'
  | 'MAVEN_RESOLUTION_FAILED'
  | 'MAVEN_RESOLUTION_MISMATCH';

/**
 * §3 — the ONE new type this phase introduces. `candidateManifest` reuses
 * the EXISTING CandidateManifest/CandidateFile shape byte-for-byte (a
 * single-file manifest whose one entry is the SAME CandidateFile the V1.2
 * writer/guard already produce) so a future GitHub-write step can consume
 * it unchanged through the existing write-guard/candidate-verification
 * pipeline -- no second, incompatible candidate model.
 */
export interface SecurityRemediationCandidateResult {
  status: SecurityRemediationCandidateStatus;
  reason: string;
  decision: SecurityFindingDecision;
  candidateIdentity: string | null;
  candidateManifest: CandidateManifest | null;
  patchEvidence: {
    provenanceKind: DependencyProvenanceKind;
    oldVersion: string;
    targetVersion: string;
    controllingFile: string;
    controllingElement: string | null;
    controllingProperty: string | null;
  } | null;
  guardResult: SecurityPatchGuardResult | null;
  dependencyResolutionEvidence: {
    checked: boolean;
    resolvedMatch: boolean | null;
    evaluatedAtSha: string;
  } | null;
}
