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

export interface SecurityCandidateIdentityInput {
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
  return createHash('sha256').update(parts.join('\n')).digest('hex');
}
