// Valide les identités attendues pour recontrôler un lot avant écriture ; protège contre un résultat devenu périmé.
import { Type } from 'class-transformer';
import { Wf6AttemptCorrelationDto } from './wf6-attempt-correlation.dto';
import { IsOptional, ValidateNested } from 'class-validator';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsString, IsUUID, Matches } from 'class-validator';

export class SecurityRemediationRevalidateBatchDto {
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

  @IsString()
  @Matches(/^[0-9a-f]{64}$/, { message: 'expectedCandidateIdentity must be a 64-hex-character sha256 digest.' })
  expectedCandidateIdentity: string;
}
