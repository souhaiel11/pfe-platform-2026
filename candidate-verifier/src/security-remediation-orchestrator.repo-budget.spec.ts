/** Bounded-git-operations fix, Part 3 items 1-2 — proves
 * SecurityRemediationOrchestratorService's SECOND repository materialization
 * (§4 step 9, the isolated worktree used for patch/build/scan) now:
 *   1. receives the ACTUAL reduced remaining `deadline` budget (not the old
 *      unconditional call, which always meant "no timeoutMs at all" and
 *      silently defaulted to RepoCacheService's own flat GIT_OPERATION_CAP_MS);
 *   2. is refused outright -- zero ensureRepo() calls -- once the deadline
 *      is already exhausted by the time this stage is reached, exactly like
 *      every other deadline-gated stage already proven in
 *      security-remediation-orchestrator.deadline.spec.ts.
 *
 * Same real-fixture pattern as that file (real WorkspaceManager, real git
 * checkout of the local fixture repo, injected decision/Maven/scanner
 * fakes) -- only the repoCache is a recording spy here, since that is the
 * one call site this fix changes.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { SecurityRemediationOrchestratorService } from './security-remediation-orchestrator.service';
import { WorkspaceManager } from './workspace-manager.service';
import { RepoCacheService, GIT_OPERATION_CAP_MS } from './repo-cache.service';
import { trackedSourceDigest, SecurityArtifactScan } from './security-artifact-validator';

const f = JSON.parse(fs.readFileSync(path.join(__dirname, '../../backend/src/security-remediation/fixtures/v17/logback.json'), 'utf8'));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v17-repo-budget-'));
const repo = path.join(root, 'repo');
execFileSync('git', ['clone', '--no-hardlinks', process.env.SECURITY_TEST_REPO || '/home/souhaiel/pfe-2026/pfe-app-test', repo], { stdio: 'pipe' });
const workspacesRoot = path.join(root, 'workspaces');
const wm = new WorkspaceManager(workspacesRoot);
let serial = 0;
const input = (overallDeadlineMs: number) => ({
  repository: 'souhaiel11/pfe-app-test', candidateBaseSha: f.sha, requestId: 'v17-repo-budget-' + ++serial, batchId: 'tests', candidateAttempt: 0,
  overallDeadlineMs,
  finding: { findingIdentity: 'a'.repeat(64), cveId: 'CVE-2023-6378', source: 'TRIVY', package: 'ch.qos.logback:logback-classic', expectedInstalledVersion: '1.2.11', fixedVersion: '1.3.12, 1.4.12, 1.2.13' },
});
const decision = () => ({ findingIdentity: 'a'.repeat(64), evaluatedSha: f.sha, provenance: { ecosystem: 'MAVEN', kind: 'DIRECT_EXPLICIT', package: 'ch.qos.logback:logback-classic', installedVersion: '1.2.11', controllingFile: 'pom.xml', controllingElement: '<version>1.2.11</version>', controllingProperty: null, groundedSha: f.sha, evidence: 'fixture' }, fixedVersions: ['1.2.13'], selectedTargetVersion: '1.2.13', remediationType: 'AUTO_FIX_ELIGIBLE', reason: 'fixture' });

function busyWaitMs(ms: number): void {
  const start = process.hrtime.bigint();
  while (Number(process.hrtime.bigint() - start) / 1_000_000 < ms) { /* burn monotonic time, deterministic vs setTimeout */ }
}

// Spies on the REAL RepoCacheService's ensureRepo() -- records every
// timeoutMs it was called with, still delegates to the real (local,
// no-network) implementation so the rest of orchestration proceeds exactly
// as it would in production.
function spyingRepoCache(calls: Array<number | undefined>) {
  const real = { ensureRepo: (r: string) => repo }; // repo is already local + up to date; the real RepoCacheService isn't needed here, only its call contract
  return { ensureRepo: (repository: string, timeoutMs?: number) => { calls.push(timeoutMs); return real.ensureRepo(repository); } } as any as RepoCacheService;
}

try {
  // 1. Grounding (decide()) deliberately consumes a KNOWN chunk of a KNOWN
  // total budget -- the second materialization's captured timeoutMs must
  // reflect what's ACTUALLY left afterward, never the full original budget
  // reused blindly and never the old unconditional (= no timeoutMs at all)
  // call.
  {
    const calls: Array<number | undefined> = [];
    const adapter: any = {
      dependencyTree: (w: string) => ({ status: 'SUCCESS', text: f.baseTree }),
      effectivePom: (w: string) => ({ status: 'SUCCESS', text: f.baseEffective }),
      packageCandidateWithTests: () => ({ status: 'SUCCESS', testsExecuted: true, testsPassed: true, testsTotal: 1, testsFailures: 0, testsErrors: 0, testsSkipped: 0, durationMs: 1, evidenceTail: '', timedOut: false }),
    };
    const scanner = { inspect: (w: string): SecurityArtifactScan => ({
      mode: 'TRIVY_IMAGE_ARCHIVE', sourceDigest: trackedSourceDigest(w), artifactDigest: 'b'.repeat(64),
      reportDigest: 'c'.repeat(64), scannerVersion: 'unit-fixture', report: f.baseReport, buildPassed: true, timings: {},
    }) };
    const slowDecision = { decide: () => { busyWaitMs(300); return decision(); } }; // consumes ~300ms of the total budget
    const totalBudgetMs = 2_000;
    const reqInput = input(totalBudgetMs);
    new SecurityRemediationOrchestratorService(slowDecision as any, wm, spyingRepoCache(calls), adapter, scanner).orchestrate(reqInput);
    assert.equal(calls.length, 1, '1: the second materialization called ensureRepo() exactly once');
    assert.ok(calls[0] !== undefined, '1: a timeoutMs was actually supplied (the regression this fix closes -- previously always undefined)');
    assert.ok(calls[0]! < totalBudgetMs - 200, `1: captured budget (${calls[0]}) must reflect the ~300ms grounding already consumed out of the ${totalBudgetMs}ms total, not the full original budget reused blindly`);
    assert.ok(calls[0]! > 0, '1: captured budget must still be positive -- there was genuinely budget left');
    assert.ok(calls[0]! <= GIT_OPERATION_CAP_MS, '1: never exceeds the per-git-operation cap either');
  }

  // 2. Grounding consumes almost the ENTIRE budget -- the second
  // materialization must be refused outright (zero ensureRepo() calls,
  // the explicit deadline.expired() guard firing before any git command is
  // even considered), with the standard VERIFIER_TIMEOUT contract, exactly
  // like every other deadline-gated stage in this same file.
  {
    const calls: Array<number | undefined> = [];
    const adapter: any = {
      dependencyTree: () => { throw new Error('MUST_NOT_RUN'); },
      effectivePom: () => { throw new Error('MUST_NOT_RUN'); },
      packageCandidateWithTests: () => { throw new Error('MUST_NOT_RUN'); },
    };
    const scanner = { inspect: () => { throw new Error('MUST_NOT_RUN'); } };
    const slowDecision = { decide: () => { busyWaitMs(250); return decision(); } }; // consumes almost all of a 260ms budget
    const result = new SecurityRemediationOrchestratorService(slowDecision as any, wm, spyingRepoCache(calls), adapter, scanner)
      .orchestrate(input(260));
    assert.equal(calls.length, 0, '2: ensureRepo() must never be called once the deadline is already exhausted -- refused outright, not attempted-then-timed-out');
    assert.equal(result.status, 'TECHNICAL_FAILURE');
    assert.equal(result.failureClass, 'VERIFIER_TIMEOUT');
    assert.match(result.reason, /WORKER_DEADLINE_EXCEEDED:PATCH_VALIDATION_WORKSPACE/, '2: the new explicit guard reports its own, distinguishable stage name');
    assert.equal(result.candidateManifest, null);
  }

  console.log('security-remediation-orchestrator.repo-budget.spec.ts: PASS (2/2 -- second materialization receives the actual reduced remaining budget; exhausted budget refuses it outright with zero ensureRepo() calls)');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
