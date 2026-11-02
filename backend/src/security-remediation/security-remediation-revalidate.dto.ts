// Valide la demande de recontrôle unitaire avant écriture, dont l’identité du candidat attendue. Le backend la compare à une identité fraîchement recalculée.
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
