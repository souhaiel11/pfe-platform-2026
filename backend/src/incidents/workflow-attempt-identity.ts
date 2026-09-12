/** Identity is frozen on dispatch; callback validation never reads configuration. */
export function isWorkflowIdentity(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

export function resolveAttemptWorkflowIdentity(fix: any, attempt: any): string | null {
  // An explicitly frozen but malformed value must not fall back to legacy evidence.
  if (Object.prototype.hasOwnProperty.call(attempt, 'expectedWorkflowId')) {
    return isWorkflowIdentity(attempt.expectedWorkflowId) ? attempt.expectedWorkflowId : null;
  }
  // Legacy evidence must belong to this attempt, never a later attempt or current config.
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
