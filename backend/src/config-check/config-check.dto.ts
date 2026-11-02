// Types du test de connexion : la configuration saisie dans le formulaire (jamais persistée ici) et le résultat détaillé par champ.
import { IsOptional, IsString } from 'class-validator';

export class CheckProjectConfigDto {
  @IsOptional() @IsString() jenkinsInternalUrl?: string;
  @IsOptional() @IsString() jenkinsJobName?: string;
  @IsOptional() @IsString() jenkinsJobPath?: string;
  @IsOptional() @IsString() jenkinsUsername?: string;
  @IsOptional() @IsString() jenkinsToken?: string;
  @IsOptional() @IsString() sonarqubeUrl?: string;
  @IsOptional() @IsString() sonarqubeKey?: string;
  @IsOptional() @IsString() githubRepo?: string;
}

export type EtatControle = 'ok' | 'ko' | 'skip';

export interface ResultatControle {
  id: string;
  champ: string;
  etat: EtatControle;
  message: string;
  section: 'cicd' | 'sonarqube';
}

export interface ResultatVerification {
  controles: ResultatControle[];
  bloquant: boolean;
  autoriseEnregistrement: boolean;
  verifieLe: string;
}
