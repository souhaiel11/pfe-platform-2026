// Historique lisible des déploiements Azure d'un projet, dérivé des tentatives enregistrées (deployment_attempts).

/** Lien http(s) vers l'application déployée (valeur renvoyée par l'agent), sinon null. */
function safeAppUrl(value: unknown): string | null {
  try {
    const url = new URL(String(value || ''));
    return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Ligne d'historique d'une tentative : statut, build, image, liens vers l'application et le portail Azure. */
export function deploymentHistoryEntry(attempt: any) {
  const agent = attempt?.dispatchResult?.agentResponse || {};
  const portalUrl = String(agent.portalUrl || '');
  return {
    attemptId: attempt.id,
    status: attempt.dispatchStatus,
    startedAt: attempt.createdAt,
    completedAt: attempt.completedAt,
    mainBuildNumber: attempt.mainBuildNumber,
    commitSha: attempt.commitSha,
    artifactDigest: attempt.artifactDigest,
    containerName: agent.containerName || null,
    state: agent.state || null,
    appUrl: attempt.dispatchStatus === 'DEPLOYED' ? safeAppUrl(agent.appUrl) : null,
    portalUrl: portalUrl.startsWith('https://portal.azure.com/') ? portalUrl : null,
    failureCode: attempt?.dispatchResult?.failureCode || null,
  };
}
