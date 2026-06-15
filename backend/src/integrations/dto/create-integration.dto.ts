import { IsString, IsOptional, IsEnum, IsBoolean } from 'class-validator';
import { IntegrationTool } from '../integration.entity';

export class CreateIntegrationDto {
  @IsEnum(IntegrationTool)
  toolType: IntegrationTool;

  @IsString()
  name: string;

  @IsString()
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
