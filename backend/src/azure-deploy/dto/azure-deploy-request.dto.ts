// DTO : les seuls champs qu'un appelant peut fournir à POST /azure-deploy/deploy.
import { IsBoolean, IsOptional, IsString, IsUUID, Matches } from 'class-validator';

const IMAGE_TAG_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

export class AzureDeployRequestDto {
  @IsUUID()
  projectId: string;

  @IsString()
  requestId: string;

  @IsBoolean()
  confirmed: boolean;

  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;

  @IsOptional()
  @IsString()
  @Matches(IMAGE_TAG_PATTERN, { message: 'imageTag doit respecter le charset Docker officiel (lettres/chiffres/._-).' })
  imageTag?: string;

  @IsOptional()
  @IsUUID()
  authorizationId?: string;
}
