// Normalise les 3 champs d'erreur qu'un workflow n8n peut écrire sur une
// entité (errorReason/errorDetail/errorStep — Incident pour l'instant, voir
// diagnostic gestion d'erreurs n8n). reason est la seule donnée obligatoire.
//
// detail/step retombent explicitement à null plutôt que undefined : un
// update TypeORM ignore les clés absentes d'un objet partiel, donc si on
// laissait juste passer ce que le node n8n envoie, un PUT qui ne fournit que
// errorReason laisserait un errorDetail/errorStep d'une erreur PRÉCÉDENTE
// affiché à côté de la nouvelle raison. On force ici les 3 champs à être
// toujours écrits ensemble.
export interface WorkflowError {
  reason: string;
  detail?: string | null;
  step?: string | null;
}

export function writeErrorToEntity(error: WorkflowError) {
  return {
    errorReason: error.reason,
    errorDetail: error.detail ?? null,
    errorStep: error.step ?? null,
  };
}
