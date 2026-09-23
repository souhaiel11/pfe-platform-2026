// R-SEC-V1.5 §4 — same narrow-whitelist discipline as
// SecurityRemediationEvaluateDto: `expectedCandidateIdentity` is accepted
// ONLY as a comparison value (an opaque sha256 identity string), never as
// authoritative candidate bytes. This DTO deliberately has NO field for
// candidate content/path/targetVersion/etc -- a caller literally cannot
// submit replacement candidate bytes for the backend to trust, because no
// such field exists on the accepted request model (§8 of V1.4, reapplied).
import { IsUUID, IsString, Matches } from 'class-validator';

export class SecurityRemediationRevalidateDto {
  @IsUUID()
  projectId: string;

  @IsUUID()
  findingTaskId: string;

  /** The candidateIdentity WF6 received from an earlier /evaluate call — compared against a FRESH recomputation, never trusted as-is. */
  @IsString()
  @Matches(/^[0-9a-f]{64}$/, { message: 'expectedCandidateIdentity must be a 64-hex-character sha256 digest.' })
  expectedCandidateIdentity: string;
}
