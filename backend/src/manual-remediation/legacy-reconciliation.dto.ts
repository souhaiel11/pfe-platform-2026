/** DTO de validation pour les requêtes de réconciliation legacy : empreinte de groupe attendue, et identité d'une tâche pour la réadmission moderne. */
import { IsString, Matches, IsUUID } from 'class-validator';
export class LegacyReconciliationDto {
  @IsString() @Matches(/^[0-9a-f]{64}$/) expectedGroupDigest: string;
}
export class LegacyModernEligibilityDto {
  @IsUUID() taskId: string;
  @IsString() @Matches(/^[0-9a-f]{64}$/) expectedArchiveDigest: string;
}
