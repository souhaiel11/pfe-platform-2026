// Reconstitue de façon fiable quel workflow (WF2/WF4/WF5) a traité une tentative de correction donnée,
// pour qu'un callback tardif ne soit jamais attribué à la mauvaise tentative.

/** Vérifie que la valeur a bien la forme d'un identifiant de workflow n8n valide. */
export function isWorkflowIdentity(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

/** Reconstitue l'identité de workflow réelle d'une tentative (valeur gelée si présente, sinon preuves historiques cohérentes), ou null si ambiguë. */
export function resolveAttemptWorkflowIdentity(fix: any, attempt: any): string | null {
  if (Object.prototype.hasOwnProperty.call(attempt, 'expectedWorkflowId')) {
    return isWorkflowIdentity(attempt.expectedWorkflowId) ? attempt.expectedWorkflowId : null;
  }
  const evidence: unknown[] = [attempt.workflowId];
  for (const event of Array.isArray(fix.workflowEvents) ? fix.workflowEvents : []) {
    if (Number(event.attempt) === Number(attempt.attempt)) evidence.push(event.workflowId);
  }
  if (Number(fix.attemptCount) === Number(attempt.attempt) && fix.workflowExecutionId
    && (!attempt.workflowExecutionId || String(attempt.workflowExecutionId) === String(fix.workflowExecutionId))) {
    evidence.push(fix.workflowId);
  }
  const supplied = evidence.filter(value => value !== undefined && value !== null);
  if (supplied.some(value => !isWorkflowIdentity(value))) return null;
  const identities = [...new Set(supplied)];
  return identities.length === 1 ? identities[0] as string : null;
}
