// Client backend-only pour l'API REST publique de n8n (endpoint d'arrêt d'exécution) — utilisé pour
// annuler une exécution WF2 en cours. N8N_API_KEY n'est jamais renvoyé au caller ni journalisé.
export type N8nStopOutcome =
  | 'STOP_SUCCEEDED'
  | 'ALREADY_STOPPED'
  | 'NOT_STOPPABLE'
  | 'NOT_FOUND'
  | 'AUTH_ERROR'
  | 'NETWORK_ERROR'
  | 'NOT_CONFIGURED';

export interface N8nStopResult {
  outcome: N8nStopOutcome;
  httpStatus?: number;
}

/** Demande à n8n d'arrêter une exécution WF2 en cours, et classe la réponse en un verdict exploitable (succès, déjà arrêtée, introuvable, etc.). */
export async function stopN8nExecution(executionId: string, timeoutMs = 10000): Promise<N8nStopResult> {
  const apiUrl = process.env.N8N_API_URL;
  const apiKey = process.env.N8N_API_KEY;
  if (!apiUrl || !apiKey) return { outcome: 'NOT_CONFIGURED' };
  if (!/^[1-9][0-9]{0,18}$/.test(executionId)) return { outcome: 'NOT_STOPPABLE' };
  let response: Response;
  try {
    response = await fetch(`${apiUrl.replace(/\/$/, '')}/api/v1/executions/${encodeURIComponent(executionId)}/stop`, {
      method: 'POST',
      redirect: 'error',
      headers: { 'X-N8N-API-KEY': apiKey },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return { outcome: 'NETWORK_ERROR' };
  }
  if (response.ok) return { outcome: 'STOP_SUCCEEDED', httpStatus: response.status };
  if (response.status === 404) return { outcome: 'NOT_FOUND', httpStatus: 404 };
  if (response.status === 401 || response.status === 403) return { outcome: 'AUTH_ERROR', httpStatus: response.status };
  let bodyText = '';
  try { bodyText = await response.text(); } catch { return { outcome: 'NETWORK_ERROR', httpStatus: response.status }; }
  if (new RegExp(`Only running or waiting executions can be stopped and ${executionId} is currently canceled(?:[\\"\\s}]|$)`).test(bodyText)) {
    return { outcome: 'ALREADY_STOPPED', httpStatus: response.status };
  }
  return { outcome: 'NOT_STOPPABLE', httpStatus: response.status };
}
