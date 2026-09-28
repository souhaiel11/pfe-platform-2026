// Increment 1 (WF6 multi-CVE wiring) — mirrors security-remediation-
// evaluate.dto.ts's own narrow-whitelist discipline exactly: the ONLY
// structural difference is a LIST of findingTaskId instead of one. No
// other field exists on this class, so nothing else can reach the
// controller regardless of what a caller sends (global
// ValidationPipe({whitelist:true}), same as the singular DTO).
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsUUID } from 'class-validator';

export class SecurityRemediationEvaluateBatchDto {
  @IsUUID()
  projectId: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(8)
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  findingTaskIds: string[];
}
