import { IsString, IsOptional, IsEnum, IsBoolean, IsUrl, Matches } from 'class-validator';
import { IntegrationTool } from '../integration.entity';

export class CreateIntegrationDto {
  @IsEnum(IntegrationTool)
  toolType: IntegrationTool;

  @IsString()
  name: string;

  @IsUrl({ require_tld: false, require_protocol: true, protocols: ['http', 'https'], disallow_auth: true }, { message: 'L’URL du service doit être une URL HTTP(S) sans identifiants.' })
  @Matches(/^[^?#]+$/, { message: 'L’URL du service ne doit pas contenir de paramètres ni de fragment.' })
  url: string;

  @IsOptional() @IsString()
  token?: string;

  @IsOptional() @IsString()
  username?: string;

  @IsOptional() @IsString()
  password?: string;

  @IsOptional() @IsBoolean()
  enabled?: boolean;
}
