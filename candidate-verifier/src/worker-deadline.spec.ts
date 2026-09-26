/** V1.7 Blocker B — pure unit tests for the monotonic worker deadline
 * primitive itself (candidate-verifier/src/worker-deadline.ts). Integration
 * coverage proving the orchestrator actually enforces it lives in
 * security-remediation-orchestrator.deadline.spec.ts and
 * security-artifact-validator.spec.ts. */
import * as assert from 'assert';
import { createWorkerDeadline, DEFAULT_WORKER_BUDGET_MS, MAX_WORKER_BUDGET_MS, MIN_STAGE_BUDGET_MS, WORKER_DEADLINE_MS } from './worker-deadline';

function busyWaitMs(ms: number): void {
  const start = process.hrtime.bigint();
  while (Number(process.hrtime.bigint() - start) / 1_000_000 < ms) { /* burn monotonic time */ }
}

// 1. No requested budget falls back to the documented default.
{
  const d = createWorkerDeadline();
  assert.equal(d.totalBudgetMs, DEFAULT_WORKER_BUDGET_MS);
}

// 2. A caller-requested budget is honored...
{
  const d = createWorkerDeadline(5_000);
  assert.equal(d.totalBudgetMs, 5_000);
}

// 3. ...but clamped to MAX_WORKER_BUDGET_MS -- a caller cannot request an
// effectively-unbounded worker run.
{
  const d = createWorkerDeadline(MAX_WORKER_BUDGET_MS + 60_000);
  assert.equal(d.totalBudgetMs, MAX_WORKER_BUDGET_MS);
}

// 4. Non-finite/zero/negative requests fall back to the default rather than
// producing a zero or unbounded deadline.
for (const bad of [0, -100, NaN, Infinity]) {
  const d = createWorkerDeadline(bad);
  assert.equal(d.totalBudgetMs, DEFAULT_WORKER_BUDGET_MS, `bad requested budget ${bad}`);
}

// 5. The clock is monotonic and elapsed/remaining move together.
{
  const d = createWorkerDeadline(1_000);
  const before = d.elapsedMs();
  busyWaitMs(30);
  const after = d.elapsedMs();
  assert.ok(after > before, 'elapsedMs must advance');
  assert.ok(d.remainingMs() < 1_000, 'remainingMs must shrink as elapsed grows');
  assert.ok(d.remainingMs() >= 0, 'remainingMs must never go negative');
}

// 6. expired() (default threshold == MIN_STAGE_BUDGET_MS) becomes true once
// remaining drops below that minimum, and remainingMs() itself never goes
// negative even long after the deadline.
{
  const d = createWorkerDeadline(MIN_STAGE_BUDGET_MS + 200);
  assert.equal(d.expired(), false, 'not yet expired: remaining is still above MIN_STAGE_BUDGET_MS');
  busyWaitMs(250);
  assert.equal(d.expired(), true, 'expired once remaining has dropped below MIN_STAGE_BUDGET_MS');
  assert.ok(d.remainingMs() >= 0 && d.remainingMs() < MIN_STAGE_BUDGET_MS, 'remainingMs shrank below the minimum, never negative');
  busyWaitMs(2_000);
  assert.equal(d.remainingMs(), 0, 'remainingMs floors at exactly 0 long after the deadline, never negative');
}

// 7. expired(minimumMs) supports a caller-specific threshold distinct from
// the module default.
{
  const d = createWorkerDeadline(100);
  assert.equal(d.expired(1), false, 'plenty of budget left relative to a 1ms minimum');
  assert.equal(d.expired(1_000), true, 'not enough budget relative to a demanding 1000ms minimum');
}

// 8. budgetFor() caps to the smaller of (requested cap, remaining budget)...
{
  const d = createWorkerDeadline(10_000);
  assert.equal(d.budgetFor(500), 500, 'cap smaller than remaining wins');
  assert.ok(d.budgetFor(50_000) <= 10_000, 'remaining smaller than cap wins');
}

// 9. ...and NEVER returns exactly 0, even when the budget is already fully
// exhausted -- Node's child_process `timeout` option treats 0 as "no
// timeout" (unbounded), which would silently defeat the whole deadline.
{
  const d = createWorkerDeadline(10);
  busyWaitMs(50);
  assert.equal(d.remainingMs(), 0);
  assert.ok(d.budgetFor(60_000) >= 1, 'budgetFor must floor at 1, never 0, once expired');
}

// 10. V1.7 predeploy phase — Phase A deadline contract: DEFAULT and MAX are
// the SAME shared, backend-imported WORKER_DEADLINE_MS (600,000ms), not two
// independently-maintained local literals.
{
  assert.equal(DEFAULT_WORKER_BUDGET_MS, WORKER_DEADLINE_MS);
  assert.equal(MAX_WORKER_BUDGET_MS, WORKER_DEADLINE_MS);
}

// 11. Exact boundary behavior explicitly required this phase: one below the
// ceiling is honored as requested; exactly at the ceiling is honored;
// anything above is clamped down to it. Expressed relative to
// WORKER_DEADLINE_MS (not a second hardcoded literal) so this test stays
// correct across any future reconciliation of that shared contract value.
{
  assert.equal(createWorkerDeadline(WORKER_DEADLINE_MS - 1).totalBudgetMs, WORKER_DEADLINE_MS - 1, 'one below the ceiling accepted unchanged');
  assert.equal(createWorkerDeadline(WORKER_DEADLINE_MS).totalBudgetMs, WORKER_DEADLINE_MS, 'the ceiling itself accepted unchanged');
  assert.equal(createWorkerDeadline(WORKER_DEADLINE_MS + 1).totalBudgetMs, WORKER_DEADLINE_MS, 'one above the ceiling clamped down to it');
  assert.equal(createWorkerDeadline(WORKER_DEADLINE_MS * 20).totalBudgetMs, WORKER_DEADLINE_MS, 'a wildly larger request is clamped the same way, never unbounded');
}

console.log(`worker-deadline: PASS (default/clamp/monotonic/expired/budgetFor-floor unit coverage; ${WORKER_DEADLINE_MS - 1}/${WORKER_DEADLINE_MS}/${WORKER_DEADLINE_MS + 1} boundary; shared WORKER_DEADLINE_MS=${WORKER_DEADLINE_MS} contract)`);
