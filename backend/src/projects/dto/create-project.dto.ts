// dto/create-project.dto.ts
import { IsString, IsOptional, IsEnum, IsArray, IsBoolean } from 'class-validator';
import { ProjectEnvironment } from '../project.entity';

export class CreateProjectDto {
  @IsString() name: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() githubRepo?: string;
  @IsOptional() @IsString() githubToken?: string;
  @IsOptional() @IsString() sonarqubeKey?: string;
  @IsOptional() @IsString() sonarqubeUrl?: string;
  @IsOptional() @IsString() sonarqubeToken?: string;
  @IsOptional() @IsString() jenkinsUrl?: string;
  @IsOptional() @IsString() jenkinsJobName?: string;
  @IsOptional() @IsString() jenkinsToken?: string;
  @IsOptional() @IsBoolean() trivyEnabled?: boolean;
  @IsOptional() @IsString() dockerImage?: string;
  @IsOptional() @IsEnum(ProjectEnvironment) environment?: ProjectEnvironment;
  @IsOptional() @IsArray() tags?: string[];
}
