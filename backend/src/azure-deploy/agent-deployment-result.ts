// Interprète la réponse brute de l'agent de déploiement Azure pour séparer deux faits distincts : l'appel HTTP a-t-il réussi, et le déploiement lui-même a-t-il réussi côté agent.
export interface AgentDeploymentResult {
  transportSuccess: boolean;
  deploymentSuccess: boolean;
  httpStatus: number | null;
  failureCode: string | null;
  failureReason: string | null;
}

/** Classe la réponse de l'agent en distinguant l'échec de transport HTTP de l'échec du déploiement lui-même ; ne devine jamais un succès. */
export function classifyAgentDeploymentResult(httpStatus: number | null, payload: unknown): AgentDeploymentResult {
  const transportSuccess = httpStatus !== null && httpStatus >= 200 && httpStatus < 300;
  /** Construit le résultat fail. */
  const fail = (failureCode: string, failureReason: string): AgentDeploymentResult => ({
    transportSuccess, deploymentSuccess: false, httpStatus, failureCode, failureReason,
  });
  if (httpStatus === null) return fail('AGENT_TRANSPORT_FAILED', 'Agent de déploiement Azure injoignable ou délai dépassé');
  const data = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as Record<string, unknown> : null;
  if (!transportSuccess) return fail('AGENT_HTTP_ERROR', typeof data?.error === 'string' ? data.error : `Agent HTTP ${httpStatus}`);
  if (!data || typeof data.success !== 'boolean' || typeof data.healthOk !== 'boolean') {
    return fail('AGENT_RESULT_INVALID', 'Réponse agent sans résultat de déploiement et de santé booléen');
  }
  if (!data.success) return fail('AGENT_DEPLOYMENT_FAILED', typeof data.error === 'string' ? data.error : 'Le conteneur ne fonctionne pas');
  if (!data.healthOk) return fail('AGENT_HEALTH_FAILED', 'Le contrôle de santé de l’application a échoué');
  return { transportSuccess, deploymentSuccess: true, httpStatus, failureCode: null, failureReason: null };
}
