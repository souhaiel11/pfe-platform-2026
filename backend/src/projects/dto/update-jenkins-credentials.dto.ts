import { IsString, MinLength } from 'class-validator';

// Endpoint dédié ADMIN-ONLY (PUT /projects/:id/jenkins-credentials) —
// jamais mélangé avec la configuration URL générale (UpdateProjectDto),
// jamais retourné par une réponse GET.
export class UpdateJenkinsCredentialsDto {
  @IsString() @MinLength(1)
  username: string;

  @IsString() @MinLength(1)
  token: string;
}
