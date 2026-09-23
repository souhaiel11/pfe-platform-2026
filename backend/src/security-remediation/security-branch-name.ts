// R-SEC-V1.5 §6 — deterministic security remediation branch naming. Pure,
// no I/O, no caller-controlled text of any kind: both inputs are already-
// trusted, backend-computed hashes (findingFingerprint identifies the
// finding across builds; candidateIdentity -- see security-candidate-
// identity.ts -- binds evaluatedSha+package+installedVersion+targetVersion+
// controllingFile). Computed HERE, server-side, and returned directly on
// the /evaluate and /revalidate responses so WF6 needs ZERO branch-naming
// logic of its own (no n8n Code node reimplementing this, no risk of the
// two diverging) -- "WF6 only orchestrates already-authoritative backend
// results" applies to branch identity exactly as much as to patch content.
//
// Both inputs are sha256 hex digests (64 lowercase [0-9a-f] chars) --
// already git-ref-safe by construction (no need to sanitize arbitrary
// caller text, because no caller text is ever an input here).
const HEX_PREFIX_LENGTH = 12; // 12 hex chars = 48 bits per segment; two segments combined (96 bits) is collision-resistant enough for this platform's scale, short enough to stay a readable branch name.

export function computeSecurityBranchName(findingFingerprint: string, candidateIdentity: string): string {
  if (!/^[0-9a-f]{64}$/.test(findingFingerprint)) {
    throw new Error(`computeSecurityBranchName: findingFingerprint must be a 64-hex sha256 digest, got ${JSON.stringify(findingFingerprint)}.`);
  }
  if (!/^[0-9a-f]{64}$/.test(candidateIdentity)) {
    throw new Error(`computeSecurityBranchName: candidateIdentity must be a 64-hex sha256 digest, got ${JSON.stringify(candidateIdentity)}.`);
  }
  return `security/fix/${findingFingerprint.slice(0, HEX_PREFIX_LENGTH)}-${candidateIdentity.slice(0, HEX_PREFIX_LENGTH)}`;
}
