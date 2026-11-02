// Contrat de détection de dérive de branche distante.
export type RemoteHeadDriftResult = { ok: true } | { ok: false; failureClass: 'CANDIDATE_BASE_MOVED' };

// Vérifie que la branche distante n'a pas bougé depuis la vérification du candidat :
// compare le SHA distant juste relu avec le SHA de base vérifié, et refuse en cas d'écart.
export function assertRemoteHeadMatchesCandidateBase(
  remoteHeadSha: string | null,
  candidateBaseSha: string,
): RemoteHeadDriftResult {
  if (!remoteHeadSha) {
    return { ok: false, failureClass: 'CANDIDATE_BASE_MOVED' };
  }
  if (remoteHeadSha.toLowerCase() !== candidateBaseSha.toLowerCase()) {
    return { ok: false, failureClass: 'CANDIDATE_BASE_MOVED' };
  }
  return { ok: true };
}
