/** Logique pure du harnais de test E2E de relance : fait avancer un plan de test à travers ses deux tentatives contrôlées (timeout forcé, puis arrêt avant écriture Git). */
import { ConflictException } from '@nestjs/common';
import { AttemptCorrelation, assertCorrelation, completeAttempt } from '../manual-remediation/security-remediation-lifecycle';
import { RetryE2ETestPlan } from './retry-e2e-test-plan.entity';
/** Indique si le harnais de test E2E est activé par variable d'environnement. */
export const harnessEnabled = () => process.env.SECURITY_REMEDIATION_E2E_TEST_HARNESS_ENABLED === 'true';
export interface HarnessContext extends AttemptCorrelation { projectId: string; taskId: string }
/** Vérifie que deux identités de tentative désignent exactement la même tentative (même attemptId/attemptNumber/batchId). */
export function sameIdentity(a: AttemptCorrelation | undefined, b: AttemptCorrelation): boolean {
  return !!a && a.attemptId === b.attemptId && a.attemptNumber === b.attemptNumber && a.batchId === b.batchId;
}
/** Fait avancer la machine à états du plan de test E2E d'une étape, selon la tentative et la phase courantes ; appelé uniquement sous verrou transactionnel. */
export function advanceHarness(plan: RetryE2ETestPlan, task: any, context: HarnessContext,
  phase: 'INITIAL' | 'CANDIDATE_READY' | 'EVALUATION_ABORTED', at: string): 'NORMAL' | 'TIMEOUT' | 'TIMEOUT_REPLAY' | 'BARRIER' | 'BARRIER_REPLAY' {
  if (context.projectId !== plan.projectId || context.taskId !== plan.taskId) return 'NORMAL';
  if (![1, 2].includes(context.attemptNumber)) throw new ConflictException('Operator E2E is limited to two attempts.');
  const bound = context.attemptNumber === 1 ? plan.attempt1 : plan.attempt2;
  if (bound && !sameIdentity(bound, context)) return 'NORMAL';
  const a = assertCorrelation(task, context);
  const expired = Date.parse(plan.expiresAt) <= Date.parse(at);
  if (context.attemptNumber === 1 && phase === 'INITIAL') {
    if (plan.attempt1 && !sameIdentity(plan.attempt1, context)) return 'NORMAL';
    if (!plan.attempt1 && expired) throw new ConflictException('E2E plan expired; no candidate may escape the controlled test.');
    if (a.finishedAt || task.securityFindingRemediation.status !== 'DISPATCHING') throw new ConflictException('Harness attempt is no longer dispatching.');
    plan.attempt1 ??= { attemptId: context.attemptId, attemptNumber: 1, batchId: context.batchId };
    if (plan.consumedAttempt1) return 'TIMEOUT_REPLAY';
    if (!plan.consumedAttempt1) {
      plan.consumedAttempt1 = true;
      plan.events.push({ hook: 'FORCE_VERIFIER_TIMEOUT_ONCE', at, attemptId: context.attemptId, batchId: context.batchId });
    }
    return 'TIMEOUT';
  }
  if (context.attemptNumber !== 2 || !plan.consumedAttempt1 || !plan.attempt1) return 'NORMAL';
  if (plan.attempt2 && !sameIdentity(plan.attempt2, context)) return 'NORMAL';
  if (phase === 'INITIAL') {
    const first = task.securityFindingRemediation.attempts.find((entry: any) => entry.attemptId === plan.attempt1.attemptId);
    if (!first?.finishedAt || first.attemptNumber !== 1 || first.batchId !== plan.attempt1.batchId || first.reasonCode !== 'VERIFIER_TIMEOUT' || context.batchId === plan.attempt1.batchId)
      throw new ConflictException('The first test attempt must remain a completed timeout with a distinct batch.');
    if (!plan.attempt2 && expired) throw new ConflictException('E2E plan expired: revoke it before retrying.');
    if (a.finishedAt) throw new ConflictException('Harness attempt is already terminal.');
    plan.attempt2 ??= { attemptId: context.attemptId, attemptNumber: 2, batchId: context.batchId };
    return 'NORMAL';
  }
  if (phase === 'EVALUATION_ABORTED' && !plan.attempt2) plan.attempt2 = { attemptId: context.attemptId, attemptNumber: 2, batchId: context.batchId };
  if (!sameIdentity(plan.attempt2, context)) throw new ConflictException('E2E attempt 2 was not enrolled.');
  if (plan.consumedAttempt2) return 'BARRIER_REPLAY';
  const result = { status: 'OPERATOR_TEST_STOPPED', reasonCode: 'OPERATOR_TEST_STOPPED',
    operatorTest: { controlledStop: true, candidateEvaluationPassed: phase === 'CANDIDATE_READY' },
    unresolvedGitSideEffect: false, prUrl: null, branchName: null };
  completeAttempt(task, context, result, at);
  if (!plan.consumedAttempt2) {
    plan.consumedAttempt2 = true;
    plan.events.push({ hook: phase === 'CANDIDATE_READY' ? 'STOP_BEFORE_GIT_WRITE_ONCE' : 'CONTROLLED_TEST_ABORT', at, attemptId: context.attemptId, batchId: context.batchId });
  }
  return 'BARRIER';
}
