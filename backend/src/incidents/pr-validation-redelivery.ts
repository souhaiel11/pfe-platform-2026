// Récupération d'un callback WF3 perdu : quand le build Jenkins de validation PR est SUCCESS mais que le
// résultat n'est jamais arrivé au backend (WF3 en erreur, backend indisponible, 409…), on retrouve dans
// l'historique n8n la notification Jenkins d'origine de CE build et on la renvoie à WF1. Aucun nouveau build,
// aucune nouvelle demande : saveValidation() reste l'unique juge (corrélation SHA, job, batch, demande active).

// Liste légère (sans données) puis chargement unitaire : une exécution WF1 pèse plusieurs Mo.
const MAX_EXECUTIONS_LISTED = 100;
const MAX_EXECUTIONS_INSPECTED = 10;

/** Notification Jenkins d'origine (corps du webhook WF1) correspondant exactement au build et à la demande attendus, ou null. */
export function findPrValidationDelivery(executions: any[], expected: { buildPath: string; buildNumber: number; validationRequestId: string }): any | null {
  const suffix = `${expected.buildPath.replace(/\/+$/, '')}/${expected.buildNumber}/`;
  for (const execution of executions || []) {
    const body = execution?.data?.resultData?.runData?.['Incident Webhook']?.[0]?.data?.main?.[0]?.[0]?.json?.body;
    if (!body || body.event !== 'pr_validation') continue;
    if (Number(body.build_number) !== expected.buildNumber) continue;
    let path: string;
    try { path = new URL(String(body.build_url || '')).pathname; } catch { continue; }
    if (!path.replace(/\/?$/, '/').endsWith(suffix)) continue;
    if (!JSON.stringify(body).includes(expected.validationRequestId)) continue;
    return body;
  }
  return null;
}

/** Configuration requise ; null si la récupération automatique n'est pas configurée (on garde alors le refus historique). */
export function redeliveryConfig(env: NodeJS.ProcessEnv = process.env) {
  const apiUrl = String(env.N8N_API_URL || '').replace(/\/+$/, '');
  const apiKey = String(env.N8N_API_KEY || '');
  const webhookUrl = String(env.N8N_URL || '').replace(/\/+$/, '');
  const webhookKey = String(env.N8N_JENKINS_EVENT_KEY || '');
  const wf1Id = String(env.N8N_WF1_ID || '');
  if (!apiUrl || !apiKey || !webhookUrl || !webhookKey || !wf1Id) return null;
  return { apiUrl, apiKey, webhookUrl, webhookKey, wf1Id };
}

/** Recherche dans l'historique n8n de WF1 (exécutions postérieures à notBefore) la notification Jenkins d'origine du build attendu. */
export async function findPrValidationDeliveryInN8n(config: NonNullable<ReturnType<typeof redeliveryConfig>>,
  expected: { buildPath: string; buildNumber: number; validationRequestId: string; notBefore?: number }): Promise<any | null> {
  const headers = { 'X-N8N-API-KEY': config.apiKey };
  const list = await fetch(`${config.apiUrl}/api/v1/executions?workflowId=${encodeURIComponent(config.wf1Id)}&limit=${MAX_EXECUTIONS_LISTED}`,
    { headers, signal: AbortSignal.timeout(20_000) });
  if (!list.ok) throw new Error(`n8n executions HTTP ${list.status}`);
  const notBefore = Number.isFinite(expected.notBefore) ? Number(expected.notBefore) : 0;
  const candidates = (((await list.json()) as any)?.data || [])
    .filter((e: any) => Date.parse(String(e?.startedAt || '')) >= notBefore)
    .slice(0, MAX_EXECUTIONS_INSPECTED);
  for (const candidate of candidates) {
    const res = await fetch(`${config.apiUrl}/api/v1/executions/${encodeURIComponent(String(candidate.id))}?includeData=true`,
      { headers, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) continue;
    const body = findPrValidationDelivery([await res.json()], expected);
    if (body) return body;
  }
  return null;
}

/** Renvoie la notification d'origine au webhook de WF1, avec l'en-tête attendu par son authentification. */
export async function postPrValidationDelivery(config: NonNullable<ReturnType<typeof redeliveryConfig>>, body: any): Promise<void> {
  const post = await fetch(`${config.webhookUrl}/webhook/jenkins-event`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-Key': config.webhookKey },
    body: JSON.stringify(body), signal: AbortSignal.timeout(20_000),
  });
  if (!post.ok) throw new Error(`WF1 webhook HTTP ${post.status}`);
}
