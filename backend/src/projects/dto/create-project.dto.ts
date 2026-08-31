import { IsString, IsOptional, IsEnum, IsArray, IsBoolean, IsObject } from 'class-validator';
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
  @IsOptional() @IsString()
  githubRepo?: string;

  // SonarQube
  @IsOptional() @IsString()
  sonarqubeUrl?: string;

  @IsOptional() @IsString()
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
