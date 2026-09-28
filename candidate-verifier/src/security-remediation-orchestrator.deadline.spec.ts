/** V1.7 Blocker B — orchestrator-level regression coverage for the
 * enforceable overall deadline (candidate-verifier/src/worker-deadline.ts),
 * wired through SecurityRemediationOrchestratorService.orchestrate().
 *
 * Same fixture/git-clone pattern as security-remediation-orchestrator.spec.ts
 * (real WorkspaceManager, real git checkout of a local fixture repo,
 * injected Maven/scanner/decision fakes) -- this file adds only the five
 * scenarios the V1.7 runtime-integration audit asked for:
 *   1. slow generation is cancelled
 *   2. slow scanner is cancelled
 *   3. timeout leaves no candidate/process behind
 *   4. cleanup failure remains fail-closed (even under a timeout)
 *   5. remaining-budget exhaustion prevents starting another expensive phase
 *
 * Real subprocess kill/no-orphan proof (an actual OS process, not a fake)
 * lives separately in worker-deadline-real-termination.spec.ts -- this file
 * proves the ORCHESTRATION contract (which phases run, which are refused,
 * what result comes back, that cleanup still happens) using fast,
 * deterministic busy-wait fakes so it runs in well under a second.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createHash } from 'crypto';
import { execFileSync } from 'child_process';
import { SecurityRemediationOrchestratorService } from './security-remediation-orchestrator.service';
import { WorkspaceManager } from './workspace-manager.service';
import { trackedSourceDigest, SecurityArtifactScan } from './security-artifact-validator';

const f = JSON.parse(fs.readFileSync(path.join(__dirname, '../../backend/src/security-remediation/fixtures/v17/logback.json'), 'utf8'));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v17-deadline-'));
const repo = path.join(root, 'repo');
execFileSync('git', ['clone', '--no-hardlinks', process.env.SECURITY_TEST_REPO || '/home/souhaiel/pfe-2026/pfe-app-test', repo], { stdio: 'pipe' });
const workspacesRoot = path.join(root, 'workspaces');
const wm = new WorkspaceManager(workspacesRoot);
let serial = 0;
const input = (overallDeadlineMs: number) => ({
  repository: 'souhaiel11/pfe-app-test', candidateBaseSha: f.sha, requestId: 'v17-deadline-' + ++serial, batchId: 'tests', candidateAttempt: 0,
  overallDeadlineMs,
  finding: { findingIdentity: 'a'.repeat(64), cveId: 'CVE-2023-6378', source: 'TRIVY', package: 'ch.qos.logback:logback-classic', expectedInstalledVersion: '1.2.11', fixedVersion: '1.3.12, 1.4.12, 1.2.13' },
});
const decision = () => ({ findingIdentity: 'a'.repeat(64), evaluatedSha: f.sha, provenance: { ecosystem: 'MAVEN', kind: 'DIRECT_EXPLICIT', package: 'ch.qos.logback:logback-classic', installedVersion: '1.2.11', controllingFile: 'pom.xml', controllingElement: '<version>1.2.11</version>', controllingProperty: null, groundedSha: f.sha, evidence: 'fixture' }, fixedVersions: ['1.2.13'], selectedTargetVersion: '1.2.13', remediationType: 'AUTO_FIX_ELIGIBLE', reason: 'fixture' });

function busyWaitMs(ms: number): void {
  const start = process.hrtime.bigint();
  while (Number(process.hrtime.bigint() - start) / 1_000_000 < ms) { /* burn monotonic time, deterministic vs setTimeout */ }
}
function variant(w: string) {
  const s = fs.readFileSync(path.join(w, 'pom.xml'), 'utf8');
  if (s === f.source) return { source: f.source, tree: f.baseTree, effective: f.baseEffective };
  for (const k of ['v16', 'property-only', 'coordinated']) if (s === f[k].source) return f[k];
  throw new Error('UNEXPECTED_SOURCE');
}
function scan(w: string): SecurityArtifactScan {
  const v = variant(w), r = JSON.parse(JSON.stringify(v.source === f.source ? f.baseReport : v.source === f.coordinated.source ? f.coordinatedReport : f.v16Report));
  return { mode: 'TRIVY_IMAGE_ARCHIVE', sourceDigest: trackedSourceDigest(w), artifactDigest: 'b'.repeat(64),
    reportDigest: createHash('sha256').update(JSON.stringify(r)).digest('hex'), scannerVersion: 'unit-fixture', report: r, buildPassed: true,
    // Synthetic per-stage timings so the orchestrator's RUNTIME_DURATION_MS/
    // SCANNER_DURATION_MS/CLEANUP_DURATION_MS bucketing (security-remediation-
    // orchestrator.service.ts's own `bucket()`) has something real to
    // aggregate, same stage names TrivyImageArtifactValidator itself uses.
    timings: { PODMAN_PREFLIGHT: 1, TRIVY_PREFLIGHT: 1, IMAGE_BUILD: 2, IMAGE_SAVE: 1, TRIVY_SCAN: 3, IMAGE_EXISTS: 1, IMAGE_CLEANUP: 1 } };
}
// WorkspaceManager's own layout (workspace-manager.service.ts,
// workspaceId()): "<requestId>/<batchId>/attempt-<n>/step-<verificationStep>".
// `git worktree remove` (its forceCleanup()) only removes that LEAF
// directory -- the empty <requestId>/<batchId>/attempt-<n>/ scaffold above
// it is pre-existing, harmless residue unrelated to this phase, so "no
// leaked workspace" must check the actual leaf worktree directory is gone,
// not just the top-level per-request directory count.
function leafWorkspacePath(reqInput: { requestId: string; batchId: string; candidateAttempt: number }): string {
  return path.join(workspacesRoot, reqInput.requestId, reqInput.batchId, `attempt-${reqInput.candidateAttempt}`, 'step-1');
}

try {
  // 1. Slow generation is cancelled: grounding (decide()) alone overruns a
  // tiny deadline -- no Maven or scanner call must ever happen, and no
  // workspace must be left behind.
  {
    const calls = { tree: 0, effective: 0, packageCandidate: 0, inspect: 0 };
    const adapter: any = {
      dependencyTree: (w: string) => { calls.tree++; return { status: 'SUCCESS', text: variant(w).tree }; },
      effectivePom: (w: string) => { calls.effective++; return { status: 'SUCCESS', text: variant(w).effective }; },
      packageCandidate: () => { calls.packageCandidate++; return { status: 'SUCCESS' }; },
    };
    const scanner = { inspect: (w: string) => { calls.inspect++; return scan(w); } };
    const slowDecision = { decide: () => { busyWaitMs(300); return decision(); } };
    const reqInput = input(150); // 150ms budget; grounding alone takes 300ms
    const result = new SecurityRemediationOrchestratorService(slowDecision as any, wm, { ensureRepo: () => repo } as any, adapter, scanner)
      .orchestrate(reqInput);
    assert.equal(result.status, 'TECHNICAL_FAILURE', '1: slow generation must stop the whole evaluation');
    assert.equal(result.failureClass, 'VERIFIER_TIMEOUT');
    assert.match(result.reason, /WORKER_DEADLINE_EXCEEDED/);
    assert.equal(calls.tree, 0, '1: no Maven dependency:tree call after a slow-generation timeout');
    assert.equal(calls.effective, 0, '1: no Maven effective-pom call after a slow-generation timeout');
    assert.equal(calls.inspect, 0, '1: no scanner call after a slow-generation timeout');
    assert.equal(calls.packageCandidate, 0, '1: no build call after a slow-generation timeout');
    assert.equal(result.candidateManifest, null);
    assert.equal(result.candidateIdentity, null);
    assert.equal(fs.existsSync(leafWorkspacePath(reqInput)), false, '1/3: no leaked workspace directory after a deadline-exceeded result');
  }

  // 2. Slow scanner is cancelled: the FIRST (base) scan overruns the
  // deadline -- the SECOND (closure) scan, and every Maven call after it,
  // must never be attempted.
  {
    const calls = { inspect: 0, tree: 0 };
    const adapter: any = {
      dependencyTree: (w: string) => { calls.tree++; return { status: 'SUCCESS', text: variant(w).tree }; },
      effectivePom: (w: string) => ({ status: 'SUCCESS', text: variant(w).effective }),
      packageCandidate: () => ({ status: 'SUCCESS' }),
    };
    const scanner = { inspect: (w: string) => { calls.inspect++; busyWaitMs(600); return scan(w); } };
    const reqInput = input(1_300); // enough budget to start the base scan, not enough to survive it
    const result = new SecurityRemediationOrchestratorService({ decide: decision } as any, wm, { ensureRepo: () => repo } as any, adapter, scanner)
      .orchestrate(reqInput);
    assert.equal(result.status, 'TECHNICAL_FAILURE', '2: slow scanner must stop the whole evaluation');
    assert.equal(result.failureClass, 'VERIFIER_TIMEOUT');
    assert.equal(calls.inspect, 1, '2: the base scan was attempted exactly once; the closure scan never ran');
    assert.equal(calls.tree, 0, '2: no Maven call survives a scanner call that consumed the remaining deadline');
    assert.equal(result.candidateManifest, null);
    assert.equal(result.candidateIdentity, null);
    assert.equal(fs.existsSync(leafWorkspacePath(reqInput)), false, '2/3: no leaked workspace directory after a deadline-exceeded result');
  }

  // 4. Cleanup failure remains fail-closed even when the underlying outcome
  // was itself a deadline timeout -- mirrors security-remediation-
  // orchestrator.spec.ts's own leakingManager test, but through the TIMEOUT
  // path rather than the CANDIDATE_READY path, proving the `finally` throw
  // (existing JS semantics) supersedes a pending TIMEOUT return exactly as
  // it supersedes a pending CANDIDATE_READY return.
  //
  // Bounded-git-operations fix note: this scenario used to overrun DURING
  // grounding itself (a slow decide() against a 150ms budget), but the
  // second repository materialization (§4 step 9) now correctly REFUSES to
  // even start once the deadline is already gone (see this file's sibling
  // security-remediation-orchestrator.repo-budget.spec.ts, scenario 2) --
  // meaning a workspace would never have been created for this leaking
  // manager to fail to clean up in the first place. Relocated to overrun at
  // the BASE_SCAN stage instead (identical timing to scenario 2 above,
  // already proven non-flaky there): grounding/materialization/workspace
  // creation all succeed first for real, THEN the deadline expires inside
  // the try/finally this test exists to prove cleanup-failure-supersedes
  // for.
  {
    const leakingManager = new WorkspaceManager(path.join(root, 'cleanup-failure-deadline'));
    leakingManager.cleanupWorkspace = () => {};
    const mustNotRun: any = {
      dependencyTree: () => { throw new Error('MUST_NOT_RUN'); },
      effectivePom: () => { throw new Error('MUST_NOT_RUN'); },
      packageCandidate: () => { throw new Error('MUST_NOT_RUN'); },
    };
    const scanner = { inspect: (w: string) => { busyWaitMs(600); return scan(w); } };
    assert.throws(
      () => new SecurityRemediationOrchestratorService({ decide: decision } as any, leakingManager, { ensureRepo: () => repo } as any, mustNotRun, scanner)
        .orchestrate(input(1_300)),
      /RUNTIME_CLEANUP_FAILED:WORKSPACE_CLEANUP/,
      '4: cleanup failure must still throw (fail-closed) even though the underlying evaluation was itself a deadline timeout',
    );
  }

  // 5. Remaining-budget exhaustion prevents starting ANOTHER expensive
  // phase: everything up through the post-patch dependency:tree call
  // succeeds (proving earlier phases DID run), but that one call is made
  // deliberately slow so the deadline is gone by the time the BUILD phase
  // would start -- packageCandidate() must never be called at all.
  {
    const calls = { packageCandidate: 0, coordinatedTreeCalls: 0 };
    const adapter: any = {
      dependencyTree: (w: string) => {
        const v = variant(w);
        if (v.source === f.coordinated.source) { calls.coordinatedTreeCalls++; busyWaitMs(1_300); }
        return { status: 'SUCCESS', text: v.tree };
      },
      effectivePom: (w: string) => ({ status: 'SUCCESS', text: variant(w).effective }),
      packageCandidate: () => { calls.packageCandidate++; return { status: 'SUCCESS' }; },
    };
    const scanner = { inspect: (w: string) => scan(w) };
    const reqInput = input(2_000);
    const result = new SecurityRemediationOrchestratorService({ decide: decision } as any, wm, { ensureRepo: () => repo } as any, adapter, scanner)
      .orchestrate(reqInput);
    assert.equal(calls.coordinatedTreeCalls, 1, '5: the post-patch dependency:tree call (the slow one) did run');
    assert.equal(calls.packageCandidate, 0, '5: budget exhausted by that call must prevent the build phase from starting at all');
    assert.equal(result.status, 'TECHNICAL_FAILURE');
    assert.equal(result.failureClass, 'VERIFIER_TIMEOUT');
    assert.match(result.reason, /WORKER_DEADLINE_EXCEEDED:CANDIDATE_BUILD/);
    assert.equal(result.candidateManifest, null);
    assert.equal(fs.existsSync(leafWorkspacePath(reqInput)), false, '5/3: no leaked workspace directory after a deadline-exceeded result');
  }

  // A budget generous enough for everything (the existing orchestrator
  // spec's own default construction) must still reach CANDIDATE_READY --
  // confirms the deadline machinery does not accidentally interfere with
  // the ordinary, well-within-budget path.
  {
    const adapter: any = {
      dependencyTree: (w: string) => ({ status: 'SUCCESS', text: variant(w).tree }),
      effectivePom: (w: string) => ({ status: 'SUCCESS', text: variant(w).effective }),
      packageCandidate: () => ({ status: 'SUCCESS' }),
    };
    const scanner = { inspect: (w: string) => scan(w) };
    const result = new SecurityRemediationOrchestratorService({ decide: decision } as any, wm, { ensureRepo: () => repo } as any, adapter, scanner)
      .orchestrate(input(60_000));
    assert.equal(result.status, 'CANDIDATE_READY', 'a generous deadline must not itself cause any refusal');
    assert.ok(typeof result.executionTimings!.TOTAL_WORKER_DURATION_MS === 'number');
    assert.ok(typeof result.executionTimings!.GENERATION_DURATION_MS === 'number');
    assert.ok(typeof result.executionTimings!.RUNTIME_DURATION_MS === 'number');
    assert.ok(typeof result.executionTimings!.SCANNER_DURATION_MS === 'number');
    assert.ok(typeof result.executionTimings!.CLEANUP_DURATION_MS === 'number');
  }

  console.log('security-remediation-orchestrator deadline enforcement: PASS (5 required regression scenarios: slow generation cancelled, slow scanner cancelled, no leaked workspace on timeout, cleanup failure stays fail-closed under timeout, budget exhaustion blocks the next expensive phase; plus a generous-budget control case)');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
