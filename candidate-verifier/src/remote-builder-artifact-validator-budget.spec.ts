/** V1.7 final predeploy phase — Phase F: subprocess deadline invariant.
 * Pure unit tests for effectiveBudgetMs(), the function that decides what
 * budget RemoteBuilderArtifactValidator.inspect() forwards to the builder.
 * No HTTP round trip needed -- this is the exact computation, isolated. */
import * as assert from 'assert';
import { effectiveBudgetMs } from './remote-builder-artifact-validator';
import { WORKER_DEADLINE_MS } from '../../backend/src/security-remediation/security-remediation-deadline-contract';

// 1. Genuinely absent budget (undefined) -> falls back to the shared
// WORKER_DEADLINE_MS default, exactly like worker-deadline.ts's own
// createWorkerDeadline(undefined) does.
assert.equal(effectiveBudgetMs(undefined), WORKER_DEADLINE_MS);

// 2. NaN / non-finite -> treated the same as absent, never NaN forwarded
// to a subprocess timeout.
assert.equal(effectiveBudgetMs(NaN), WORKER_DEADLINE_MS);
assert.equal(effectiveBudgetMs(Infinity), WORKER_DEADLINE_MS);

// 3. A normal positive budget is floored (deadline.remainingMs() is a
// sub-millisecond float by construction) but otherwise passed through.
assert.equal(effectiveBudgetMs(30_000.789), 30_000);
assert.equal(effectiveBudgetMs(599_999), 599_999);

// 4. Phase F invariant -- a budget that was ACTUALLY PASSED but is zero or
// negative (e.g. a caller entering with only microseconds left after its
// own expired() gate, or a rounding edge case) must be clamped to a floor
// of 1ms, NEVER silently upgraded to the full WORKER_DEADLINE_MS ceiling.
// Falling back to the full default here would be the exact "unbounded
// subprocess" failure mode Phase F forbids: an almost-exhausted deadline
// would silently hand the builder a fresh 600000ms budget instead of
// failing fast.
assert.equal(effectiveBudgetMs(0), 1);
assert.equal(effectiveBudgetMs(-1), 1);
assert.equal(effectiveBudgetMs(-500), 1);
assert.equal(effectiveBudgetMs(0.4), 1, 'flooring 0.4 must still clamp to the 1ms floor, not 0');

console.log('effectiveBudgetMs: PASS (absent/non-finite budget defaults to WORKER_DEADLINE_MS; a passed-but-exhausted budget clamps to 1ms, never balloons back to the full ceiling)');
