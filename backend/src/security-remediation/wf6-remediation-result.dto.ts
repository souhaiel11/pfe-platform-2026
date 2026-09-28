// Execution-2060 follow-up — the ONLY fields a WF6 result-recording caller
// may supply. Same narrow-whitelist discipline as
// security-remediation-evaluate.dto.ts (never a partial superset of an
// internal type): every field is declared explicitly, `status`/`reason`
// stay plain strings (never @IsIn against
// SecurityRemediationCandidateStatus's own union) so this DTO does not need
// editing every time that internal enum gains a value -- the GOAL here is
// "never silently drop a field the caller sent", not "validate WF6's own
// business logic a second time".
//
// Verified against the REAL, complete payload of execution 2060 (the first
// successful end-to-end WF6 run, PR #37, TARGET_CVE_CLOSED) -- every field
// below has a real, observed non-null example in that execution except
// where noted.
import { IsBoolean, IsInt, IsNumber, IsOptional, IsString, IsUUID, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

// Mirrors SecurityValidationEvidence exactly (security-remediation-orchestration.types.ts),
// observed verbatim in execution 2060:
// {status:"TARGET_CVE_CLOSED", targetCve:"CVE-2023-6378", mode:"TRIVY_IMAGE_ARCHIVE",
//  evaluatedSha, candidateContentSha256, artifactDigest, reportDigest,
//  scannerVersion:"Version: 0.72.0", targetCveMatchCount:0, buildPassed:true, tests:"SKIPPED"}
export class Wf6SecurityValidationEvidenceDto {
  @IsString() status: string;
  @IsOptional() @IsString() targetCve?: string;
  @IsOptional() @IsString() mode?: string;
  @IsOptional() @IsString() evaluatedSha?: string;
  @IsOptional() @IsString() candidateContentSha256?: string;
  @IsOptional() @IsString() artifactDigest?: string;
  @IsOptional() @IsString() reportDigest?: string;
  @IsOptional() @IsString() scannerVersion?: string;
  @IsOptional() @IsNumber() targetCveMatchCount?: number;
  @IsOptional() @IsBoolean() buildPassed?: boolean;
  @IsOptional() @IsString() tests?: string;
}

// Mirrors patchEvidence exactly, observed verbatim in execution 2060:
// {provenanceKind:"DIRECT_EXPLICIT", oldVersion:"1.2.11", targetVersion:"1.2.13",
//  controllingFile:"pom.xml", controllingElement:"<version>1.2.11</version>", controllingProperty:null}
export class Wf6PatchEvidenceDto {
  @IsOptional() @IsString() provenanceKind?: string;
  @IsOptional() @IsString() oldVersion?: string;
  @IsOptional() @IsString() targetVersion?: string;
  @IsOptional() @IsString() controllingFile?: string;
  @IsOptional() @IsString() controllingElement?: string;
  @IsOptional() @IsString() controllingProperty?: string;
}

export class Wf6RemediationResultDto {
  // Same identity pair as SecurityRemediationEvaluateDto -- this result
  // MUST be for a finding the caller can already legitimately name.
  @IsUUID() projectId: string;
  @IsUUID() findingTaskId: string;

  // "CANDIDATE_READY" / "NOT_ELIGIBLE" / "GROUNDING_FAILED" / "TECHNICAL_FAILURE"
  // / ...(SecurityRemediationCandidateStatus's own values, plus "REJECTED"/
  // "WRITE_AUTHORIZED"/"CANDIDATE_DRIFTED" the controller layer adds, plus
  // "PR_CREATED" which is a GitHub-side outcome /evaluate itself never
  // returns) -- deliberately NOT constrained to a fixed list, see file header.
  @IsString() status: string;
  @IsOptional() @IsString() reason?: string;

  @IsOptional() @IsString() candidateIdentity?: string;
  @IsOptional() @IsString() evaluatedSha?: string;
  @IsOptional() @IsString() branchName?: string;
  @IsOptional() @IsString() prUrl?: string;
  @IsOptional() @IsInt() prNumber?: number;
  // n8n's own execution id for this run -- not part of /evaluate's response
  // body, but the natural traceability key back to the source if a caller
  // has it (e.g. from n8n's own executions API, the same one used
  // throughout this session's own investigations).
  @IsOptional() @IsString() executionId?: string;

  @IsOptional() @ValidateNested() @Type(() => Wf6PatchEvidenceDto) patchEvidence?: Wf6PatchEvidenceDto;
  @IsOptional() @ValidateNested() @Type(() => Wf6SecurityValidationEvidenceDto) securityValidationEvidence?: Wf6SecurityValidationEvidenceDto;
}
