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

  @IsOptional() @IsString()
  jenkinsUrl?: string;

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
