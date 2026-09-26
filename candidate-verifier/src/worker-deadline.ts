// V1.7 Blocker B — enforceable overall deadline for one synchronous WF6
// worker evaluation (SecurityRemediationOrchestratorService.orchestrate()).
//
// Every expensive step in that call graph (git checkout, `mvn
// dependency:tree`/`help:effective-pom`/`clean package`, `podman
// build`/`save`, `trivy image`) runs through Node's execFileSync, which
// blocks the event loop until the child exits or ITS OWN `timeout` option
// kills it -- there is no way for surrounding JS to preempt a call already
// in flight. "Cancellation" for a fully synchronous worker therefore means
// two things, applied consistently at every call site:
//
//   1. Before starting any expensive operation, refuse to start it at all
//      once the remaining budget has dropped below MIN_STAGE_BUDGET_MS
//      (deterministic, fail-closed TIMEOUT -- never a 0ms/negative timeout
//      handed to execFileSync, which Node treats as "no timeout").
//   2. Otherwise hand that operation a subprocess timeout capped to
//      whatever budget is actually left (`budgetFor`), so it self-
//      terminates at the deadline instead of running to its own old fixed
//      per-call default.
//
// The clock is monotonic (process.hrtime.bigint()), immune to wall-clock
// adjustments -- never Date.now().
//
// V1.7 predeploy phase: MIN_STAGE_BUDGET_MS, and both the default (when a
// caller sends no overallDeadlineMs) and the hard clamp (the most a caller
// may request), are the SAME shared, backend-imported figures --
// security-remediation-deadline-contract.ts, never independently
// -maintained local literals. The dedicated builder/scanner
// (builder-scanner/src/security-artifact-validator.ts) imports the same
// MIN_STAGE_BUDGET_MS directly from that same shared contract. See that
// file's own comments for the real end-to-end measurements
// WORKER_DEADLINE_MS is set from.
import { WORKER_DEADLINE_MS, MIN_STAGE_BUDGET_MS } from '../../backend/src/security-remediation/security-remediation-deadline-contract';
export { WORKER_DEADLINE_MS, MIN_STAGE_BUDGET_MS };
export const DEFAULT_WORKER_BUDGET_MS = WORKER_DEADLINE_MS;
export const MAX_WORKER_BUDGET_MS = WORKER_DEADLINE_MS;

export interface WorkerDeadline {
  readonly totalBudgetMs: number;
  /** Monotonic elapsed time since this deadline was created. */
  elapsedMs(): number;
  /** Monotonic time left, clamped to >= 0. */
  remainingMs(): number;
  /** True once remaining budget has dropped below `minimumMs`. */
  expired(minimumMs?: number): boolean;
  /** min(capMs, remainingMs()), clamped to >= 0 -- never returns a value
   *  that would make execFileSync's `timeout` option mean "unbounded". */
  budgetFor(capMs: number): number;
}

class MonotonicWorkerDeadline implements WorkerDeadline {
  private readonly startedAtNs: bigint;
  constructor(public readonly totalBudgetMs: number) {
    this.startedAtNs = process.hrtime.bigint();
  }
  elapsedMs(): number {
    return Number(process.hrtime.bigint() - this.startedAtNs) / 1_000_000;
  }
  remainingMs(): number {
    return Math.max(0, this.totalBudgetMs - this.elapsedMs());
  }
  expired(minimumMs: number = MIN_STAGE_BUDGET_MS): boolean {
    return this.remainingMs() < minimumMs;
  }
  budgetFor(capMs: number): number {
    // Never 0: Node's child_process `timeout` option treats 0 as "no
    // timeout" (unbounded), the exact opposite of "no time left". Callers
    // that must refuse to even ATTEMPT an operation once the budget is
    // exhausted do so explicitly via expired(), not by inspecting this
    // return value -- this floor only protects whatever call DOES go
    // ahead (e.g. the very first, ungated grounding call) from silently
    // becoming unbounded.
    return Math.max(1, Math.min(capMs, Math.floor(this.remainingMs())));
  }
}

export function createWorkerDeadline(requestedMs?: number): WorkerDeadline {
  const requested = typeof requestedMs === 'number' && Number.isFinite(requestedMs) && requestedMs > 0
    ? requestedMs : DEFAULT_WORKER_BUDGET_MS;
  return new MonotonicWorkerDeadline(Math.min(requested, MAX_WORKER_BUDGET_MS));
}
