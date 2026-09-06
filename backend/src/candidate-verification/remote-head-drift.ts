// R22-C — design/contract only, per explicit instruction not to implement
// remote mutation this phase. The future Git Writer must call this
// immediately before writing (existing-branch case: re-read the branch
// HEAD; new-branch case: re-resolve the baseline ref) and fail closed on
// any drift. No GitHub call is made here — the caller supplies the
// freshly-read remote SHA; this function only makes the comparison
// deterministic and impossible to skip/inline incorrectly, same pattern as
// write-guard.ts.
export type RemoteHeadDriftResult = { ok: true } | { ok: false; failureClass: 'CANDIDATE_BASE_MOVED' };

/**
 * @param remoteHeadSha the SHA the Git Writer just read from GitHub
 *   immediately before writing (existing branch's HEAD, or the baseline ref
 *   used for branch creation) -- null if the read itself failed/found
 *   nothing.
 * @param candidateBaseSha the SHA this candidate was verified against.
 */
export function assertRemoteHeadMatchesCandidateBase(
  remoteHeadSha: string | null,
  candidateBaseSha: string,
): RemoteHeadDriftResult {
  if (!remoteHeadSha) {
    return { ok: false, failureClass: 'CANDIDATE_BASE_MOVED' };
  }
  if (remoteHeadSha.toLowerCase() !== candidateBaseSha.toLowerCase()) {
    // NO FORCE: the correct response to drift is re-verification against
    // the new remote state, never overwriting it.
    return { ok: false, failureClass: 'CANDIDATE_BASE_MOVED' };
  }
  return { ok: true };
}
