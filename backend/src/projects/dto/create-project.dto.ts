import { IsString, IsOptional, IsEnum, IsArray, IsBoolean, IsObject, IsUrl, Matches } from 'class-validator';
import { AzureDeploymentConfig } from '../project.entity';
import { ProjectEnvironment, CicdTool } from '../project.entity';

export class CreateProjectDto {
  // Général
  @IsString()
  name: string;

  @IsOptional() @IsString()
  description?: string;

  @IsOptional() @IsEnum(ProjectEnvironment)
  environment?: ProjectEnvironment;

  @IsOptional() @IsArray()
  tags?: string[];

  // CI/CD
  @IsOptional() @IsEnum(CicdTool)
  cicdTool?: CicdTool;

  // DEPRECATED — voir jenkinsInternalUrl / jenkinsPublicUrl.
  @IsOptional() @IsString()
  jenkinsUrl?: string;

  // URL Jenkins serveur-à-serveur (jamais un lien navigateur).
  @IsOptional() @IsString()
  jenkinsInternalUrl?: string;

  // URL Jenkins affichée/cliquée dans le navigateur (jamais un appel backend).
  @IsOptional() @IsString()
  jenkinsPublicUrl?: string;

  @IsOptional() @IsString()
  jenkinsJobName?: string;

  @IsOptional() @IsString()
  jenkinsJobPath?: string;

  // GitHub
  @IsOptional() @Matches(/^(?:https:\/\/github\.com\/)?[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/ , { message: 'Le dépôt doit avoir la forme propriétaire/dépôt.' })
  githubRepo?: string;

  // SonarQube
  @IsOptional() @IsUrl({ require_tld: false, protocols: ['http', 'https'], require_protocol: true, disallow_auth: true }, { message: 'L’URL SonarQube doit être une URL HTTP(S) sans identifiants.' })
  @Matches(/^[^?#]+$/, { message: 'L’URL SonarQube ne doit pas contenir de paramètres ni de fragment.' })
  sonarqubeUrl?: string;

  @IsOptional() @Matches(/^(?=.*[^0-9])[A-Za-z0-9_.:-]+$/, { message: 'La clé SonarQube doit contenir une lettre ou un séparateur autorisé.' })
  sonarqubeKey?: string;

  // Notifications
  @IsOptional() @IsBoolean()
  emailEnabled?: boolean;

  @IsOptional() @IsString()
  emailRecipient?: string;

  @IsOptional() @IsBoolean()
  slackEnabled?: boolean;

  @IsOptional() @IsString()
  slackChannel?: string;

  @IsOptional() @IsObject()
  azureConfig?: AzureDeploymentConfig;
}
