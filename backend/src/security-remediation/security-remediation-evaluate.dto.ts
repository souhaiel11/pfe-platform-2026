// R-SEC-V1.4 §2/§8 — the ONLY fields a caller may supply. Deliberately a
// NARROW whitelist DTO (not a partial/optional superset of the orchestrator's
// internal input): package/installedVersion/fixedVersions/targetVersion/
// provenance/controllingFile/controllingElement/controllingProperty/
// evaluatedSha/candidate content simply DO NOT EXIST as fields on this
// class, so they cannot reach the controller even if a caller sends them --
// combined with the app's global `ValidationPipe({ whitelist: true })`
// (main.ts), which strips any property not declared here before the
// controller method body ever runs.
import { IsUUID } from 'class-validator';

export class SecurityRemediationEvaluateDto {
  @IsUUID()
  projectId: string;

  @IsUUID()
  findingTaskId: string;
}
