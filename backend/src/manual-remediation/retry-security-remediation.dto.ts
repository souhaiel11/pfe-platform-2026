/** DTO de relance manuelle d'une remédiation automatique, avec vérification optionnelle de concurrence optimiste. */
import { IsOptional, IsUUID } from 'class-validator';
export class RetrySecurityRemediationDto {
  @IsOptional() @IsUUID() expectedAttemptId?: string;
}
