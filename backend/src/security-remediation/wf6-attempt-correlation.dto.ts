// Définit les identifiants de corrélation de la tentative WF6. Ils permettent de rattacher un callback à l'exécution attendue.
import { IsInt, IsUUID, Min } from 'class-validator';
export class Wf6AttemptCorrelationDto {
  @IsUUID() findingTaskId: string;
  @IsUUID() attemptId: string;
  @IsInt() @Min(1) attemptNumber: number;
}
