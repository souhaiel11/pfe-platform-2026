// Valide la demande d'évaluation de plusieurs findings dans un même lot de correction.
import { Type } from 'class-transformer';
import { Wf6AttemptCorrelationDto } from './wf6-attempt-correlation.dto';
import { IsOptional, ValidateNested } from 'class-validator';
// Increment 1 (WF6 multi-CVE wiring) — mirrors security-remediation-
// evaluate.dto.ts's own narrow-whitelist discipline exactly: the ONLY
// structural difference is a LIST of findingTaskId instead of one. No
// other field exists on this class, so nothing else can reach the
// controller regardless of what a caller sends (global
// ValidationPipe({whitelist:true}), same as the singular DTO).
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsUUID, IsString } from 'class-validator';

export class SecurityRemediationEvaluateBatchDto {
  @IsOptional() @IsString() batchId?: string;
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(8) @ValidateNested({ each: true }) @Type(() => Wf6AttemptCorrelationDto)
  attempts?: Wf6AttemptCorrelationDto[];

  @IsUUID()
  projectId: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(8)
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  findingTaskIds: string[];
}
