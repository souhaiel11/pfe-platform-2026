/** V1.8 — dedicated regression coverage for the new application-test gate
 * (MavenBuildAdapter.packageCandidateWithTests(), wired into both
 * SecurityRemediationOrchestratorService and SecurityRemediationBatchOrchestratorService).
 * Same real-fixture/real-repo-clone pattern as the sibling orchestrator
 * specs (security-remediation-orchestrator.spec.ts) -- Maven/scanner
 * outputs are injected fakes, so this runs fast and deterministically; the
 * REAL end-to-end proof (actual `mvn clean package`, actual Podman+Trivy)
 * is the separate OWASP E2E revalidation run, not this file.
 *
 * Covers this phase's own 12 required scenarios:
 *   1. tests PASS -> pipeline continues to CANDIDATE_READY
 *   2. test FAIL -> pipeline stops, image build/scanner NEVER called
 *   3. Maven compile FAIL -> candidate rejected (CANDIDATE_BUILD_FAILED)
 *   4. Maven timeout during tests -> candidate rejected, TECHNICAL_FAILURE
 *   5. deadline insufficient before Maven -> Maven never started
 *   6. build PASS + scanner-would-PASS but tests FAIL -> never CANDIDATE_READY
 *   7. tests PASS + build PASS + scanner PASS -> CANDIDATE_READY (== #1)
 *   8. cleanup always executed (PASS and FAIL paths alike)
 * Scenarios 9-12 (Trivy/OWASP unchanged, existing deadline tests still pass,
 * deterministic verdict stable) are covered by re-running the EXISTING
 * sibling specs unmodified in behavior -- see this increment's own report.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import { SecurityRemediationOrchestratorService } from './security-remediation-orchestrator.service';
import { SecurityRemediationBatchOrchestratorService } from './security-remediation-batch-orchestrator.service';
import { WorkspaceManager } from './workspace-manager.service';
import { trackedSourceDigest, SecurityArtifactScan } from './security-artifact-validator';

const f = JSON.parse(fs.readFileSync(path.join(__dirname, '../../backend/src/security-remediation/fixtures/v17/logback.json'), 'utf8'));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v18-app-tests-'));
const repo = path.join(root, 'repo');
execFileSync('git', ['clone', '--no-hardlinks', process.env.SECURITY_TEST_REPO || '/home/souhaiel/pfe-2026/pfe-app-test', repo], { stdio: 'pipe' });

function variant(w: string) {
  const s = fs.readFileSync(path.join(w, 'pom.xml'), 'utf8');
  if (s === f.source) return { source: f.source, tree: f.baseTree, effective: f.baseEffective };
  for (const k of ['v16', 'property-only', 'coordinated']) if (s === f[k].source) return f[k];
  throw new Error('UNEXPECTED_SOURCE');
}
function scan(w: string): SecurityArtifactScan {
  const v = variant(w), r = JSON.parse(JSON.stringify(v.source === f.source ? f.baseReport
    : v.source === f.coordinated.source ? f.coordinatedReport : f.v16Report));
  return { mode: 'TRIVY_IMAGE_ARCHIVE', sourceDigest: trackedSourceDigest(w), artifactDigest: 'b'.repeat(64),
    reportDigest: createHash('sha256').update(JSON.stringify(r)).digest('hex'), scannerVersion: 'unit-fixture', report: r, buildPassed: true };
}
const decision = () => ({ findingIdentity: 'a'.repeat(64), evaluatedSha: f.sha, provenance: { ecosystem: 'MAVEN', kind: 'DIRECT_EXPLICIT', package: 'ch.qos.logback:logback-classic', installedVersion: '1.2.11', controllingFile: 'pom.xml', controllingElement: '<version>1.2.11</version>', controllingProperty: null, groundedSha: f.sha, evidence: 'fixture' }, fixedVersions: ['1.2.13'], selectedTargetVersion: '1.2.13', remediationType: 'AUTO_FIX_ELIGIBLE', reason: 'fixture' });
let serial = 0;
const singularInput = () => ({ repository: 'souhaiel11/pfe-app-test', candidateBaseSha: f.sha, requestId: 'v18-' + ++serial, batchId: 'tests', candidateAttempt: 0,
  finding: { findingIdentity: 'a'.repeat(64), cveId: 'CVE-2023-6378', source: 'TRIVY', package: 'ch.qos.logback:logback-classic', expectedInstalledVersion: '1.2.11', fixedVersion: '1.3.12, 1.4.12, 1.2.13' } });
const batchInput = () => ({ repository: 'souhaiel11/pfe-app-test', candidateBaseSha: f.sha, requestId: 'v18-batch-' + ++serial, batchId: 'tests', candidateAttempt: 0,
  findings: [{ findingIdentity: 'a'.repeat(64), cveId: 'CVE-2023-6378', source: 'TRIVY', package: 'ch.qos.logback:logback-classic', expectedInstalledVersion: '1.2.11', fixedVersion: '1.3.12, 1.4.12, 1.2.13' }] });

const dependencyTree = (w: string) => ({ status: 'SUCCESS', text: variant(w).tree });
const effectivePom = (w: string) => ({ status: 'SUCCESS', text: variant(w).effective });
const PASS_RESULT = { status: 'SUCCESS', testsExecuted: true, testsPassed: true, testsTotal: 4, testsFailures: 0, testsErrors: 0, testsSkipped: 0, durationMs: 1200, evidenceTail: 'Tests run: 4, Failures: 0, Errors: 0, Skipped: 0', timedOut: false };
const FAIL_RESULT = { status: 'FAILED', testsExecuted: true, testsPassed: false, testsTotal: 4, testsFailures: 1, testsErrors: 0, testsSkipped: 0, durationMs: 900, evidenceTail: 'Tests run: 4, Failures: 1, Errors: 0, Skipped: 0', timedOut: false };
const COMPILE_FAIL_RESULT = { status: 'FAILED', testsExecuted: false, testsPassed: null, testsTotal: null, testsFailures: null, testsErrors: null, testsSkipped: null, durationMs: 400, evidenceTail: '[ERROR] cannot find symbol', timedOut: false };
const TIMEOUT_RESULT = { status: 'FAILED', testsExecuted: false, testsPassed: null, testsTotal: null, testsFailures: null, testsErrors: null, testsSkipped: null, durationMs: 300000, evidenceTail: 'WORKSPACE_TIMEOUT during mvn clean package (with tests)', timedOut: true };
const NOT_EXECUTED_RESULT = { status: 'SUCCESS', testsExecuted: false, testsPassed: null, testsTotal: null, testsFailures: null, testsErrors: null, testsSkipped: null, durationMs: 500, evidenceTail: '', timedOut: false };

function makeSingular(packageCandidateWithTests: () => any, inspect: (w: string) => SecurityArtifactScan = scan, wm = new WorkspaceManager(path.join(root, 'ws-' + Math.random()))) {
  const adapter: any = { dependencyTree, effectivePom, packageCandidateWithTests };
  return new SecurityRemediationOrchestratorService({ decide: decision } as any, wm, { ensureRepo: () => repo } as any, adapter, { inspect });
}
function makeBatch(packageCandidateWithTests: () => any, inspect: (w: string) => SecurityArtifactScan = scan, wm = new WorkspaceManager(path.join(root, 'ws-batch-' + Math.random()))) {
  const adapter: any = { dependencyTree, effectivePom, packageCandidateWithTests };
  return new SecurityRemediationBatchOrchestratorService({ decide: decision } as any, wm, { ensureRepo: () => repo } as any, adapter, { inspect });
}

try {
  // 1 & 7. tests PASS -> pipeline continues all the way to CANDIDATE_READY,
  // with the new evidence exposed and the closure evidence's own `tests`
  // literal now 'PASSED' (never 'SKIPPED').
  {
    const result = makeSingular(() => PASS_RESULT).orchestrate(singularInput());
    assert.equal(result.status, 'CANDIDATE_READY', result.reason);
    assert.equal(result.securityValidationEvidence!.tests, 'PASSED');
    assert.deepEqual(result.applicationTests, { executed: true, passed: true, total: 4, failures: 0, errors: 0, skipped: 0, durationMs: 1200, evidenceTail: 'Tests run: 4, Failures: 0, Errors: 0, Skipped: 0' });
  }
  console.log('1/7. tests PASS + build PASS + scanner PASS -> CANDIDATE_READY, tests:"PASSED", applicationTests exposed: PASS');

  // 2 & 6. test FAIL -> pipeline stops BEFORE the image build/scanner are
  // ever invoked, and never reaches CANDIDATE_READY even though the scanner
  // fake WOULD have reported closure if called.
  {
    // The BASE scan (scope-evidence derivation) already runs once, BEFORE
    // the build+test phase -- only the SECOND (closure) call is what a test
    // failure must prevent. Asserting the count stays at 1 (not 2) is the
    // real "scanner never re-invoked after this failure" proof.
    let inspectCalls = 0;
    const result = makeSingular(() => FAIL_RESULT, (w) => { inspectCalls++; return scan(w); }).orchestrate(singularInput());
    assert.equal(result.status, 'APPLICATION_TESTS_FAILED', result.reason);
    assert.equal(inspectCalls, 1, 'only the pre-build BASE scan may run; the closure scan must never follow a test failure');
    assert.equal(result.candidateManifest, null);
    assert.equal(result.candidateIdentity, null);
    assert.equal(result.applicationTests!.executed, true);
    assert.equal(result.applicationTests!.passed, false);
    assert.equal(result.applicationTests!.failures, 1);
  }
  console.log('2/6. test FAILURE -> APPLICATION_TESTS_FAILED, image build/scanner never called, never CANDIDATE_READY: PASS');

  // 3. Maven compile failure (no tests ever executed, non-zero exit) ->
  // CANDIDATE_BUILD_FAILED, distinct from a test failure.
  {
    let inspectCalls = 0;
    const result = makeSingular(() => COMPILE_FAIL_RESULT, (w) => { inspectCalls++; return scan(w); }).orchestrate(singularInput());
    assert.equal(result.status, 'CANDIDATE_BUILD_FAILED', result.reason);
    assert.equal(inspectCalls, 1, 'only the pre-build BASE scan may run');
    assert.equal(result.applicationTests!.executed, false);
    assert.equal(result.applicationTests!.passed, null);
  }
  console.log('3. Maven compile failure (tests never executed) -> CANDIDATE_BUILD_FAILED, not APPLICATION_TESTS_FAILED: PASS');

  // 4. A real subprocess timeout during the build+test phase -> the
  // subprocess is already killed by MavenBuildAdapter's own SIGKILL
  // discipline (runMaven(), unchanged) before this ever returns; the
  // orchestrator must map it to TECHNICAL_FAILURE/VERIFIER_TIMEOUT, never a
  // test verdict, and never proceed to build/scan.
  {
    let inspectCalls = 0;
    const result = makeSingular(() => TIMEOUT_RESULT, (w) => { inspectCalls++; return scan(w); }).orchestrate(singularInput());
    assert.equal(result.status, 'TECHNICAL_FAILURE', result.reason);
    assert.equal(result.failureClass, 'VERIFIER_TIMEOUT');
    assert.equal(inspectCalls, 1, 'only the pre-build BASE scan may run');
    assert.equal(result.applicationTests!.executed, false);
  }
  console.log('4. Maven timeout during build+tests -> TECHNICAL_FAILURE/VERIFIER_TIMEOUT, candidate rejected, no orphaned scan call: PASS');

  // 5. Deadline already insufficient before this phase starts -> the build
  // adapter must never even be invoked (reuses the EXISTING deadline.expired()
  // guard, no new/parallel timeout system).
  {
    let called = 0;
    const adapter: any = { dependencyTree, effectivePom, packageCandidateWithTests: () => { called++; return PASS_RESULT; } };
    const wm = new WorkspaceManager(path.join(root, 'ws-deadline5'));
    // Reuses the exact busy-wait deadline-exhaustion technique already
    // proven in security-remediation-orchestrator.deadline.spec.ts scenario 5:
    // make the post-patch dependency:tree call slow enough to exhaust a
    // small overall budget, so the build phase's own deadline.expired() gate
    // refuses to start.
    const slowTree = (w: string) => {
      const start = process.hrtime.bigint();
      while (Number(process.hrtime.bigint() - start) / 1_000_000 < 1300) { /* busy-wait */ }
      return { status: 'SUCCESS', text: variant(w).tree };
    };
    const svc = new SecurityRemediationOrchestratorService({ decide: decision } as any, wm, { ensureRepo: () => repo } as any,
      { dependencyTree: slowTree, effectivePom, packageCandidateWithTests: () => { called++; return PASS_RESULT; } } as any, { inspect: scan });
    const result = svc.orchestrate({ ...singularInput(), overallDeadlineMs: 2_000 });
    assert.equal(called, 0, '5: packageCandidateWithTests must never be called once the deadline is exhausted');
    assert.equal(result.status, 'TECHNICAL_FAILURE');
    assert.match(result.reason, /WORKER_DEADLINE_EXCEEDED/);
  }
  console.log('5. Deadline insufficient before the build+test phase -> Maven never started (existing deadline.expired() guard reused): PASS');

  // 8. Cleanup always runs -- proven by re-invoking WorkspaceManager's own
  // real cleanupWorkspace() (not a fake) after BOTH a PASS and a FAIL run,
  // and asserting the workspace directory no longer exists either time.
  {
    const wmPass = new WorkspaceManager(path.join(root, 'ws-cleanup-pass'));
    const passInput = singularInput();
    makeSingular(() => PASS_RESULT, scan, wmPass).orchestrate(passInput);
    const leafPass = path.join(root, 'ws-cleanup-pass', passInput.requestId, passInput.batchId, `attempt-${passInput.candidateAttempt}`, 'step-1');
    assert.equal(fs.existsSync(leafPass), false, '8: workspace cleaned up after a PASS run');

    const wmFail = new WorkspaceManager(path.join(root, 'ws-cleanup-fail'));
    const failInput = singularInput();
    makeSingular(() => FAIL_RESULT, scan, wmFail).orchestrate(failInput);
    const leafFail = path.join(root, 'ws-cleanup-fail', failInput.requestId, failInput.batchId, `attempt-${failInput.candidateAttempt}`, 'step-1');
    assert.equal(fs.existsSync(leafFail), false, '8: workspace cleaned up after a test-FAILURE run too');
  }
  console.log('8. Cleanup always executed (PASS and FAIL paths alike, real WorkspaceManager): PASS');

  // Package build succeeded but genuinely zero tests were proven to run ->
  // fail closed, never silently PASS.
  {
    let inspectCalls = 0;
    const result = makeSingular(() => NOT_EXECUTED_RESULT, (w) => { inspectCalls++; return scan(w); }).orchestrate(singularInput());
    assert.equal(result.status, 'APPLICATION_TESTS_NOT_EXECUTED', result.reason);
    assert.equal(inspectCalls, 1, 'only the pre-build BASE scan may run');
    assert.equal(result.applicationTests!.executed, false);
    assert.equal(result.applicationTests!.passed, null);
  }
  console.log('build succeeded but zero tests executed -> APPLICATION_TESTS_NOT_EXECUTED, never silently PASS: PASS');

  // The SAME 6 scenarios (1/7, 2/6, 3, 4) replayed through the BATCH
  // orchestrator, proving the batch path was not left with the old
  // -DskipTests gap while the singular path was fixed.
  {
    const ready = makeBatch(() => PASS_RESULT).orchestrate(batchInput());
    assert.equal(ready.status, 'CANDIDATE_READY', ready.reason);
    assert.equal(ready.applicationTests!.executed, true);

    let inspectCalls = 0;
    const failed = makeBatch(() => FAIL_RESULT, (w) => { inspectCalls++; return scan(w); }).orchestrate(batchInput());
    assert.equal(failed.status, 'APPLICATION_TESTS_FAILED', failed.reason);
    assert.equal(inspectCalls, 1, 'batch: only the pre-build BASE scan may run; the closure scan must never follow a test failure');
    assert.equal(failed.candidateManifest, null);

    const compileFailed = makeBatch(() => COMPILE_FAIL_RESULT).orchestrate(batchInput());
    assert.equal(compileFailed.status, 'CANDIDATE_BUILD_FAILED', compileFailed.reason);

    const notExecuted = makeBatch(() => NOT_EXECUTED_RESULT).orchestrate(batchInput());
    assert.equal(notExecuted.status, 'APPLICATION_TESTS_NOT_EXECUTED', notExecuted.reason);

    const timedOut = makeBatch(() => TIMEOUT_RESULT).orchestrate(batchInput());
    assert.equal(timedOut.status, 'TECHNICAL_FAILURE');
    assert.equal(timedOut.failureClass, 'VERIFIER_TIMEOUT');
  }
  console.log('batch orchestrator: identical application-test gate (PASS/FAIL/compile-fail/not-executed/timeout), no gap left on the batch path: PASS');

  console.log('security-remediation-orchestrator.application-tests.spec.ts: ALL CHECKS PASS');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
