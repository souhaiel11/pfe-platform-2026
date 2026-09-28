// R-SEC-V1.3 §11 — deterministic identity for a security remediation
// candidate. Pure, no I/O, no randomness, no LLM input of any kind.
//
// Reuses the SAME convention already established by
// manual-remediation/finding-fingerprint.ts (SHA-256 of joined canonical,
// normalized parts) rather than inventing a second identity scheme.
// `findingFingerprint`/`findingIdentity` itself is NOT recomputed here --
// it is always supplied by the caller (already computed once, upstream,
// per finding-fingerprint.ts's own contract) and simply folded in as one
// of the canonical parts, exactly as the task specifies.
import { createHash } from 'crypto';

import { MavenRemediationScope } from './maven-remediation-scope';

export interface SecurityCandidateIdentityInput {
  remediationScope?: MavenRemediationScope;
  findingIdentity: string;
  evaluatedSha: string;
  package: string;
  installedVersion: string;
  targetVersion: string;
  controllingFile: string;
}

function norm(value: string): string {
  return String(value ?? '').trim();
}

/**
 * Same request + same SHA + same grounded evidence -> identical identity,
 * by construction: every input here is itself a deterministic output of
 * upstream grounding/eligibility (evaluatedSha, provenance.package/
 * installedVersion/controllingFile, decision.selectedTargetVersion) --
 * never a caller-supplied override, never an LLM value, never a random UUID.
 */
export function computeSecurityCandidateIdentity(input: SecurityCandidateIdentityInput): string {
  const parts = [
    norm(input.findingIdentity),
    norm(input.evaluatedSha).toLowerCase(),
    norm(input.package),
    norm(input.installedVersion),
    norm(input.targetVersion),
    norm(input.controllingFile),
  ];
  if (input.remediationScope) parts.push('security-remediation-v1.7', JSON.stringify(input.remediationScope));
  return createHash('sha256').update(parts.join('\n')).digest('hex');
}

// Increment 1 (WF6 multi-CVE wiring) — the ONE shared "combine N hashes
// into one" primitive. A single element passes through UNCHANGED (never
// wrapped in a second hash) so that every batch-of-1 identity this file
// derives is byte-identical to its plain singular counterpart -- this
// exact rule, applied consistently, is what feeds computeSecurityBranchName()
// downstream without ever changing a mono-CVE run's branch name. N>1
// combines via sha256 of the SORTED list, so caller array order never
// matters and no two distinct sets collide by construction any more than
// sha256 itself would.
function combineIdentities(hashes: string[]): string {
  const sorted = [...hashes].sort();
  return sorted.length === 1 ? sorted[0] : createHash('sha256').update(sorted.join('\n')).digest('hex');
}

// The ONE shared batch-identity function, used by BOTH the candidate-
// verifier orchestrator (computing it) and the backend's batch
// verification client (independently recomputing it to cross-check the
// worker's response) — extracted here, not duplicated in each,
// specifically because a duplicated copy is exactly what caused this
// increment's own N=1 non-regression bug (the orchestrator's inline
// version double-hashed a singleton identity before this fix). One
// function, one definition of "batch identity", forever.
export function computeSecurityBatchCandidateIdentity(perFindingInputs: SecurityCandidateIdentityInput[]): string {
  return combineIdentities(perFindingInputs.map(computeSecurityCandidateIdentity));
}

// The batch counterpart of a single finding's own findingIdentity, for
// computeSecurityBranchName()'s FIRST argument (its second argument is
// computeSecurityBatchCandidateIdentity() above). Same N=1-passthrough
// rule, same reason: a mono-CVE run through the batch path must address
// GitHub with the EXACT branch computeSecurityBranchName(findingIdentity,
// candidateIdentity) already produces today.
export function computeSecurityBatchFindingsFingerprint(findingIdentities: string[]): string {
  return combineIdentities(findingIdentities);
}
