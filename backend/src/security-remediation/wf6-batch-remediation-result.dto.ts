// Increment 1 — multi-CVE remediation callback. Same narrow-whitelist
// discipline as wf6-remediation-result.dto.ts (own header comment fully
// applies here too: status/reason stay plain strings, never @IsIn against
// an internal enum). The ONE structural difference from the singular DTO:
// a `findings` array carrying one entry per CVE in the batch, each with its
// OWN status/reason/evidence — the shared fields (candidateIdentity,
// branchName, prUrl, prNumber) describe the ONE candidate/PR the whole
// batch produced, never per-CVE.
import { IsArray, IsBoolean, IsInt, IsNumber, IsOptional, IsString, IsUUID, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { Wf6PatchEvidenceDto, Wf6SecurityValidationEvidenceDto } from './wf6-remediation-result.dto';

export class Wf6BatchFindingResultDto {
  @IsUUID() findingTaskId: string;
  @IsString() cveId: string;
  // 'CLOSED' / 'STILL_OPEN' / 'NOT_OBSERVED' / 'NOT_ELIGIBLE' /
  // 'GROUNDING_FAILED' / 'PATCH_CONFLICT' / 'PENDING' (SecurityRemediation
  // BatchFindingEvidence's own status union) — deliberately a plain string,
  // same reasoning as the singular DTO's own status field.
  @IsString() status: string;
  @IsOptional() @IsString() reason?: string;
  @IsOptional() @ValidateNested() @Type(() => Wf6PatchEvidenceDto) patchEvidence?: Wf6PatchEvidenceDto;
  @IsOptional() @ValidateNested() @Type(() => Wf6SecurityValidationEvidenceDto) securityValidationEvidence?: Wf6SecurityValidationEvidenceDto;
}

export class Wf6BatchRemediationResultDto {
  @IsUUID() projectId: string;
  // Correlation key shared by every ManualRemediationTask dispatched
  // together — matches ManualRemediationTask.securityRemediationBatchId.
  @IsString() batchId: string;

  @IsArray() @ValidateNested({ each: true }) @Type(() => Wf6BatchFindingResultDto) findings: Wf6BatchFindingResultDto[];

  // Global batch outcome — 'CANDIDATE_READY' / 'PATCH_CONFLICT' /
  // 'CANDIDATE_BUILD_FAILED' / 'CANDIDATE_SECURITY_VALIDATION_FAILED' /
  // 'NOT_ELIGIBLE' / 'TECHNICAL_FAILURE' / ... plus the controller-added
  // GitHub-side outcomes the singular DTO's own header already documents.
  @IsString() status: string;
  @IsOptional() @IsString() reason?: string;

  @IsOptional() @IsString() candidateIdentity?: string;
  @IsOptional() @IsString() evaluatedSha?: string;
  @IsOptional() @IsString() branchName?: string;
  @IsOptional() @IsString() prUrl?: string;
  @IsOptional() @IsInt() prNumber?: number;
  @IsOptional() @IsString() executionId?: string;
  // Captured Maven output on a whole-batch build failure — never
  // attributed to any single CVE (see the batch orchestrator's own header
  // for why attribution is deliberately not attempted).
  @IsOptional() @IsString() buildOutput?: string;
}
