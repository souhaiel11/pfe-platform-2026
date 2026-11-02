// Regroupe les traitements de workflow erreur.
export interface WorkflowError {
  reason: string;
  detail?: string | null;
  step?: string | null;
}

/** Construit l'objet des trois champs d'erreur (reason/detail/step) à écrire sur l'entité, detail/step valant explicitement null plutôt qu'undefined si absents. */
export function writeErrorToEntity(error: WorkflowError) {
  return {
    errorReason: error.reason,
    errorDetail: error.detail ?? null,
    errorStep: error.step ?? null,
  };
}
