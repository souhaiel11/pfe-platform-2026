/** DTO de récupération d'un dispatch WF6 bloqué : identifie uniquement QUELLE tentative récupérer (batchId + numéro de tentative), jamais le résultat à lui attribuer. */
import { IsInt, IsString, Min } from 'class-validator';

export class ReconcileStaleWf6DispatchDto {
  @IsString() batchId: string;
  @IsInt() @Min(1) attemptCount: number;
}
