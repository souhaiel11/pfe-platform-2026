// DTO : les seuls champs qu'un appelant peut fournir à POST /azure-deploy/authorize/:projectId.
import { IsIn, IsInt, IsObject, IsOptional, IsString, Min } from 'class-validator';

export class AuthorizeDeploymentDto {
  @IsIn(['NORMAL', 'CONDITIONAL_EXCEPTION', 'CRITICAL_OVERRIDE'])
  mode: 'NORMAL' | 'CONDITIONAL_EXCEPTION' | 'CRITICAL_OVERRIDE';

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsObject()
  acknowledgements?: Record<string, boolean>;

  @IsOptional()
  @IsString()
  confirmationPhrase?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  mainBuildNumber?: number;

  @IsOptional()
  @IsString()
  tag?: string;
}
