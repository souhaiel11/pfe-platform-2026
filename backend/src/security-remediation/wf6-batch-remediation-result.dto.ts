// Valide le retour WF6 d'un lot avec résultat global et résultats par finding.
import { IsArray, IsBoolean, IsInt, IsNumber, IsOptional, IsString, IsUUID, ValidateIf, ValidateNested, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { Wf6PatchEvidenceDto, Wf6SecurityValidationEvidenceDto } from './wf6-remediation-result.dto';

export class Wf6BatchFindingResultDto {
  @IsUUID() findingTaskId: string;
  @ValidateIf((_object, value) => value !== undefined) @IsUUID() attemptId?: string;
  @ValidateIf((_object, value) => value !== undefined) @IsInt() @Min(1) attemptNumber?: number;
  @IsString() cveId: string;
  // 'CLOSED' / 'STILL_OPEN' / 'NOT_OBSERVED' / 'NOT_ELIGIBLE' /
  // 'GROUNDING_FAILED' / 'PATCH_CONFLICT' / 'PENDING' (SecurityRemediation
  // BatchFindingEvidence's own status union) — deliberately a plain string,
  // same reasoning as the singular DTO's own status field.
  @IsString() status: string;
  @IsOptional() @IsString() reason?: string;
  @IsOptional() @IsString() reasonCode?: string;
  @IsOptional() @IsString() reasonMessage?: string;
  @IsOptional() @ValidateNested() @Type(() => Wf6PatchEvidenceDto) patchEvidence?: Wf6PatchEvidenceDto;
  @IsOptional() @ValidateNested() @Type(() => Wf6SecurityValidationEvidenceDto) securityValidationEvidence?: Wf6SecurityValidationEvidenceDto;
}

export class Wf6BatchRemediationResultDto {
  @IsUUID() projectId: string;
  // Retain misplaced modern identity so whitelist parsing cannot disguise a
  // partial v2 body as v1. Service requires identity on EACH finding; these
  // top-level fields are never used to fill missing finding identities.
  @ValidateIf((_object, value) => value !== undefined) @IsUUID() attemptId?: string;
  @ValidateIf((_object, value) => value !== undefined) @IsInt() @Min(1) attemptNumber?: number;
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
  @IsOptional() @IsString() reasonCode?: string;
  @IsOptional() @IsString() reasonMessage?: string;

  @IsOptional() @IsString() candidateIdentity?: string;
  @IsOptional() @IsString() evaluatedSha?: string;
  @IsOptional() @IsString() branchName?: string;
  @IsOptional() @IsString() prUrl?: string;
  @IsOptional() @IsInt() prNumber?: number;
  @IsOptional() @IsString() executionId?: string;
  @IsOptional() @IsBoolean() unresolvedGitSideEffect?: boolean;
  // Captured Maven output on a whole-batch build failure — never
  // attributed to any single CVE (see the batch orchestrator's own header
  // for why attribution is deliberately not attempted).
  @IsOptional() @IsString() buildOutput?: string;
}
