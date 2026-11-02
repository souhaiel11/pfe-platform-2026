// Valide l'identité de la tâche demandée et les paramètres admis pour évaluer une correction de sécurité unitaire.
import { IsUUID } from 'class-validator';

export class SecurityRemediationEvaluateDto {
  @IsUUID()
  projectId: string;

  @IsUUID()
  findingTaskId: string;
}
