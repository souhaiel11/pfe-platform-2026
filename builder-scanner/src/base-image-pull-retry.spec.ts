// Teste le composant « base-image-pull-retry » et ses cas d’erreur.
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { performance } from 'perf_hooks';
import { TrivyImageArtifactValidator } from './security-artifact-validator';
import { ArtifactRuntimeError } from './security-artifact-validator';
import { pullBaseImageWithRetry, isTransientPullFailure, pullBackoffMs, MAX_PULL_ATTEMPTS, PullRetryEvent } from './security-artifact-validator';

/** Prépare les données nécessaires à ce scénario. */
function podmanError(status: number, stderr: string, extra: Record<string, any> = {}) {
  return Object.assign(new Error('injected'), { status, stderr, ...extra });
}

/** Prépare les données nécessaires à ce scénario. */
function makeClock(totalBudgetMs: number) {
  let elapsed = 0;
  return {
    /** Renvoie l’heure courante utilisée par le traitement. */
    now: () => elapsed,
    /** Prépare les données nécessaires à ce scénario. */
    advance: (ms: number) => { elapsed += ms; },
    /** Attend le délai prévu avant de poursuivre. */
    sleep: (ms: number) => { elapsed += ms; },
    /** Calcule le budget restant pour l’étape suivante. */
    remainingBudgetMs: () => totalBudgetMs - elapsed,
  };
}

const MIN_STAGE_BUDGET_MS = 1_000; // mirrors the real shared contract value; a local literal here only avoids importing backend code into a pure unit test

/** Prépare les dépendances communes au scénario. */
function baseDeps(overrides: Partial<Parameters<typeof pullBaseImageWithRetry>[0]>) {
  const events: PullRetryEvent[] = [];
  const deps = {
    /** Exécute une tentative et en collecte le résultat. */
    attempt: () => 'ok',
    /** Renvoie l’heure courante utilisée par le traitement. */
    now: () => 0,
    /** Attend le délai prévu avant de poursuivre. */
    sleep: () => {},
    /** Calcule le budget restant pour l’étape suivante. */
    remainingBudgetMs: () => undefined as number | undefined,
    cap: 1_200_000,
    maxAttempts: MAX_PULL_ATTEMPTS,
    minStageBudgetMs: MIN_STAGE_BUDGET_MS,
    isRetryable: isTransientPullFailure,
    backoffMs: pullBackoffMs,
    image: 'maven:3.8.6-openjdk-11',
    /** Prépare les données nécessaires à ce scénario. */
    onEvent: (e: PullRetryEvent) => events.push(e),
    ...overrides,
  };
  return { deps, events };
}

// === Test 1: first-attempt success -> one command only ===
{
  let calls = 0;
  const { deps, events } = baseDeps({ 
  /** Exécute une tentative et en collecte le résultat. */
  attempt: () => { calls++; return 'pulled'; } });
  const out = pullBaseImageWithRetry(deps);
  assert.equal(out, 'pulled');
  assert.equal(calls, 1, 'no retry needed on first-attempt success');
  assert.deepEqual(events.map(e => e.outcome), ['SUCCESS']);
  console.log('Test 1: PASS (first-attempt success -> exactly one command)');
}

// === Test 2: observed EOF then success -> bounded retry succeeds ===
{
  let calls = 0;
  const sleeps: number[] = [];
  const eof = podmanError(125, 'writing blob: storing blob to file "/var/tmp/x": happened during read: unexpected EOF');
  const { deps, events } = baseDeps({
    /** Exécute une tentative et en collecte le résultat. */
    attempt: () => { calls++; if (calls === 1) throw eof; return 'pulled'; },
    /** Attend le délai prévu avant de poursuivre. */
    sleep: (ms) => sleeps.push(ms),
  });
  const out = pullBaseImageWithRetry(deps);
  assert.equal(out, 'pulled');
  assert.equal(calls, 2, 'exactly one retry, then success');
  assert.deepEqual(sleeps, [pullBackoffMs(1)], 'exactly one backoff sleep, matching the policy for the first failed attempt');
  assert.deepEqual(events.map(e => e.outcome), ['RETRYING', 'SUCCESS']);
  assert.equal(events[0].classification, 'TRANSIENT_TRANSFER_INTERRUPTED');
  console.log('Test 2: PASS (observed unexpected-EOF pattern retried once, then succeeds)');
}

// === Test 3: repeated EOF -> stops at the configured attempt limit ===
{
  let calls = 0;
  const sleeps: number[] = [];
  const eof = podmanError(125, 'happened during read: unexpected EOF');
  const { deps, events } = baseDeps({
    /** Exécute une tentative et en collecte le résultat. */
    attempt: () => { calls++; throw eof; },
    /** Attend le délai prévu avant de poursuivre. */
    sleep: (ms) => sleeps.push(ms),
  });
  assert.throws(() => pullBaseImageWithRetry(deps), (e: any) => e === eof, 'the RAW last error is thrown, never re-wrapped');
  assert.equal(calls, MAX_PULL_ATTEMPTS, `exactly ${MAX_PULL_ATTEMPTS} total attempts, never more`);
  assert.deepEqual(sleeps, [pullBackoffMs(1), pullBackoffMs(2)], 'exactly maxAttempts-1 backoff sleeps');
  assert.deepEqual(events.map(e => e.outcome), ['RETRYING', 'RETRYING', 'GIVING_UP']);
  assert.equal(events[events.length - 1].classification, 'TRANSIENT_TRANSFER_INTERRUPTED', 'still classified transient -- it is the ATTEMPT COUNT, not the classification, that stopped it');
  console.log('Test 3: PASS (repeated unexpected EOF stops at the configured attempt limit, raw error surfaced)');
}

// === Test 4: exit code 125 alone (non-transient stderr) -> no retry ===
{
  let calls = 0;
  const generic125 = podmanError(125, 'Error: some internal podman failure with no known transient signature');
  const { deps, events } = baseDeps({ 
  /** Exécute une tentative et en collecte le résultat. */
  attempt: () => { calls++; throw generic125; } });
  assert.throws(() => pullBaseImageWithRetry(deps), (e: any) => e === generic125);
  assert.equal(calls, 1, 'exit code 125 alone must NOT trigger a retry');
  assert.equal(events[0].classification, 'NON_RETRYABLE');
  assert.equal(events[0].outcome, 'GIVING_UP');
  console.log('Test 4: PASS (bare exit code 125 with an unrecognized message is never retried)');
}

// === Test 5: authentication / reference / TLS / storage / permission errors -> no retry ===
{
  const nonRetryableCases: Array<[string, ReturnType<typeof podmanError>]> = [
    ['authentication', podmanError(125, 'Error: initializing source docker://docker.io/library/maven:3.8.6-openjdk-11: reading manifest 3.8.6-openjdk-11: unauthorized: authentication required')],
    ['invalid reference', podmanError(125, 'Error: invalid reference format')],
    ['TLS certificate', podmanError(125, 'Error: x509: certificate signed by unknown authority')],
    ['disk exhaustion', podmanError(125, 'Error: writing blob: adding layer: ApplyLayer exit status 1 stdout: stderr: no space left on device')],
    ['permission denied', podmanError(125, 'Error: creating build container: permission denied')],
    ['permission plus EOF', podmanError(125, 'permission denied; unexpected EOF')],
    ['disk plus reset', podmanError(125, 'no space left on device; connection reset by peer')],
    ['certificate plus timeout', podmanError(125, 'certificate verification failure; TLS handshake timeout; i/o timeout')],
    ['auth plus EOF', podmanError(125, 'unauthorized: authentication required; unexpected EOF')],
    ['reference plus timeout', podmanError(125, 'invalid reference format; timeout awaiting response headers')],
    ['missing executable', podmanError(undefined as any, '', { code: 'ENOENT', status: undefined })],
    ['unknown/generic', podmanError(1, 'Error: internal error occurred')],
  ];
  for (const [label, error] of nonRetryableCases) {
    let calls = 0;
    const { deps, events } = baseDeps({ 
    /** Exécute une tentative et en collecte le résultat. */
    attempt: () => { calls++; throw error; } });
    assert.throws(() => pullBaseImageWithRetry(deps), (e: any) => e === error, label);
    assert.equal(calls, 1, `${label}: must not be retried`);
    assert.equal(events[0].classification, 'NON_RETRYABLE', label);
    assert.equal(isTransientPullFailure(error), false, `${label}: classifier itself must reject this`);
  }
  console.log('Test 5: PASS (auth, invalid reference, TLS/certificate, disk, permission, missing-executable, and generic-unknown failures are all never retried)');
}

// === Test 6: insufficient remaining budget to cover backoff -> stop instead of retrying ===
{
  const eof = podmanError(125, 'unexpected EOF');
  let calls = 0;
  const backoff = pullBackoffMs(1); // 250ms
  const clock = makeClock(MIN_STAGE_BUDGET_MS + backoff - 1); // one ms short of covering minStageBudgetMs + the backoff the first failure would incur
  const { deps, events } = baseDeps({
    /** Exécute une tentative et en collecte le résultat. */
    attempt: () => { calls++; throw eof; },
    now: clock.now, sleep: clock.sleep, remainingBudgetMs: clock.remainingBudgetMs,
  });
  assert.throws(() => pullBaseImageWithRetry(deps), (e: any) => e === eof);
  assert.equal(calls, 1, 'a transient failure is still classified retryable, but insufficient shared budget for the backoff must stop it at attempt 1');
  assert.equal(events[0].classification, 'TRANSIENT_TRANSFER_INTERRUPTED', 'classification is unaffected by the budget decision');
  assert.equal(events[0].outcome, 'GIVING_UP', 'outcome is downgraded from RETRYING to GIVING_UP purely by budget insufficiency');
  console.log('Test 6: PASS (transient failure correctly classified, but retried only if the shared budget can also cover the backoff)');
}

{
  let calls = 0;
  const clock = makeClock(MIN_STAGE_BUDGET_MS - 1); // already below the floor before this call begins
  const { deps, events } = baseDeps({
    /** Exécute une tentative et en collecte le résultat. */
    attempt: () => { calls++; throw new Error('must never be called -- the deadline was already exhausted'); },
    now: clock.now, sleep: clock.sleep, remainingBudgetMs: clock.remainingBudgetMs,
  });
  assert.throws(() => pullBaseImageWithRetry(deps), (e: any) => e instanceof ArtifactRuntimeError && e.code === 'WORKER_DEADLINE_EXCEEDED' && e.stage === 'PODMAN_BASE_IMAGE_PULL');
  assert.equal(calls, 0, 'an already-exhausted deadline (this codebase\'s cancellation signal) must prevent even the FIRST attempt');
  assert.equal(events[events.length - 1].attempt, calls, 'deadline log counts actual invocations, not the refused attempt');
  assert.equal(events[events.length - 1].classification, 'DEADLINE_EXCEEDED');
  console.log('Test 7: PASS (deadline/cancellation already in effect stops every further attempt, including the first)');
}

// === Test 8: backoff consumes the SAME overall budget, never a free extension of it ===
{
  const backoff1 = pullBackoffMs(1);
  // Budget covers attempt 1 (instant, simulated) plus its backoff, but NOT
  // a further attempt 2 afterward (its own would-be backoff before attempt
  // 3 is what actually gets starved) -- proves the backoff sleep itself
  // consumed real shared budget rather than being free/unbounded.
  const clock = makeClock(MIN_STAGE_BUDGET_MS + backoff1 + 10);
  let calls = 0;
  const eof = podmanError(125, 'unexpected EOF');
  const { deps, events } = baseDeps({
    /** Exécute une tentative et en collecte le résultat. */
    attempt: () => { calls++; throw eof; },
    now: clock.now, sleep: clock.sleep, remainingBudgetMs: clock.remainingBudgetMs,
  });
  assert.throws(() => pullBaseImageWithRetry(deps), (e: any) => e === eof);
  assert.equal(calls, 2, 'attempt 1 fails, backoff is taken (consuming budget), attempt 2 fails and finds too little left for a second backoff');
  assert.equal(events[0].outcome, 'RETRYING');
  assert.equal(events[1].outcome, 'GIVING_UP', 'the SECOND backoff no longer fits in what remains, precisely because the FIRST backoff already spent shared budget');
  console.log('Test 8: PASS (each backoff sleep measurably consumes the same shared budget, not a separate free allowance)');
}

// === Test 9: logs remain sanitized and bounded ===
{
  const hugeSecretLookingStderr = 'unexpected EOF ' + 'x'.repeat(50_000) + ' Authorization: Bearer should-never-appear-in-an-event';
  const eof = podmanError(125, hugeSecretLookingStderr);
  let calls = 0;
  const { deps, events } = baseDeps({ 
  /** Exécute une tentative et en collecte le résultat. */
  attempt: () => { calls++; if (calls < 2) throw eof; return 'ok'; } });
  pullBaseImageWithRetry(deps);
  for (const e of events) {
    assert.deepEqual(Object.keys(e).sort(), ['attempt', 'classification', 'durationMs', 'image', 'outcome', 'remainingBudgetMs'].sort(), 'event shape is fixed and small -- no stderr field exists on it at all');
    const serialized = JSON.stringify(e);
    assert.ok(serialized.length < 300, 'a single retry-event log line is small and bounded regardless of how large the underlying error text was');
    assert.ok(!serialized.includes('Authorization'), 'raw stderr content (even if it looked sensitive) never reaches the retry-event log');
    assert.ok(!serialized.includes('x'.repeat(100)), 'the bulk of a huge stderr never reaches the retry-event log');
  }
  console.log('Test 9: PASS (per-attempt retry logs are structurally bounded and carry no stderr content)');
}

// === Test 10: final failure preserves the existing external error contract ===
{
  const finalError = podmanError(125, 'Error: invalid reference format');
  let calls = 0;
  const { deps } = baseDeps({ 
  /** Exécute une tentative et en collecte le résultat. */
  attempt: () => { calls++; throw finalError; } });
  let thrown: any;
  try { pullBaseImageWithRetry(deps); } catch (e) { thrown = e; }
  assert.strictEqual(thrown, finalError, 'the exact same error object surfaces on give-up -- nothing about its .status/.stderr/.code is altered or lost');
  assert.equal(calls, 1, 'non-retryable, so this is identical to the pre-retry single-attempt behavior');
  console.log('Test 10: PASS (final failure hands the caller the unmodified raw error, preserving the existing external conversion path)');
}

// Exercise the real inspect() wiring with a simulated clock and commands.
// No Podman, image pull, application build, or scanner is executed.
{
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'pull-budget-wiring-'));
  const originalNow = Object.getOwnPropertyDescriptor(performance, 'now');
  const originalLog = console.error;
  let elapsed = 0;
  const events: PullRetryEvent[] = [];
  const counts = new Map<string, number>();
  const timeouts: number[] = [];
  try {
    fs.writeFileSync(path.join(workspace, 'Dockerfile'), 'FROM first:1 AS first\nFROM second:1\n');
    execFileSync('git', ['init', '-q', workspace]);
    execFileSync('git', ['-C', workspace, 'add', 'Dockerfile']);
    Object.defineProperty(performance, 'now', { configurable: true, 
    /** Prépare les données nécessaires à ce scénario. */
    value: () => elapsed });
    /** Traite l’erreur reçue et termine le suivi de la demande. */
    console.error = (line: string) => {
      const event = JSON.parse(line);
      if (event.event === 'ARTIFACT_PULL_RETRY') events.push(event);
    };
    const adapter = new TrivyImageArtifactValidator((cmd, args, options) => {
      if (args[0] === 'image' && args[1] === 'exists') throw podmanError(1, 'absent');
      timeouts.push(options.timeout);
      elapsed += 100;
      if (args[0] === 'info') return 'true';
      if (args[0] === '--version') return 'Version: 0.72.0';
      if (args[0] === 'pull') {
        const count = (counts.get(args[1]) || 0) + 1;
        counts.set(args[1], count);
        if (count < 3) throw podmanError(125, 'unexpected EOF');
        return '';
      }
      if (args[0] === 'build' || args[0] === 'save') return '';
      if (cmd === 'trivy' && args[0] === 'image') throw podmanError(1, 'intentional scan stop');
      throw Error('Unexpected simulated command');
    }, ms => { elapsed += ms; });
    assert.throws(() => adapter.inspect(workspace, 10_000),
      (e: any) => e.code === 'RUNTIME_COMMAND_FAILED' && e.stage === 'TRIVY_SCAN');
    assert.deepEqual([...counts.values()], [3, 3]);
    assert.deepEqual(timeouts, [10000, 9900, 9800, 9450, 8850, 8750, 8400, 7800, 7700, 7600, 7500],
      'all attempts, both images, backoffs, build, save and scan consume one deadline');
    assert.deepEqual(events.map(e => e.attempt), [1, 2, 3, 1, 2, 3], 'logged attempts match command invocations per image');
  } finally {
    console.error = originalLog;
    if (originalNow) Object.defineProperty(performance, 'now', originalNow);
    else delete (performance as any).now;
    fs.rmSync(workspace, { recursive: true, force: true });
  }
  console.log('Test 11: PASS (real adapter wiring shares one budget across two images, retries, backoff and later stages)');
}

console.log('Bounded base-image-pull retry: PASS (11/11)');
