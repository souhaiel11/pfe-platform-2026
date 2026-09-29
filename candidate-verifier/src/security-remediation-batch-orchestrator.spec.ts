/** Increment 1 — multi-CVE batch orchestrator. Section A replays the SAME
 * real fixture/repo the singular orchestrator's own spec uses (non-
 * regression: singleton batch == today's proven PR #37 shape). Sections
 * B-E use a synthetic local git repo + fully injected fakes (no real
 * Maven/Trivy call) to exercise genuine multi-CVE coordination, conflict,
 * partial-closure, and build-failure paths deterministically. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import { SecurityRemediationBatchOrchestratorService } from './security-remediation-batch-orchestrator.service';
import { WorkspaceManager } from './workspace-manager.service';
import { trackedSourceDigest, SecurityArtifactScan } from './security-artifact-validator';
import { SecurityRemediationOrchestratorService } from './security-remediation-orchestrator.service';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v1-batch-orchestrator-'));

interface ScanTarget { id: string; pkg: string; installed: string; fixed: string }
// cveTargets()/allVulnerabilityIds() (security-artifact-scan.ts) both fail
// closed on an "incomplete" scan shape -- Type:'jar' + a non-empty Packages
// array is the completeness signal, exactly like a real Trivy image report.
// Takes explicit {id, pkg, installed, fixed} targets (not just bare ids) so
// each test controls exactly which package each CVE is reported against --
// required for deriveMavenRemediationScope()'s own package-family check.
function scanFor(targets: ScanTarget[], digest: string): SecurityArtifactScan {
  return {
    mode: 'TRIVY_IMAGE_ARCHIVE', sourceDigest: digest, artifactDigest: 'b'.repeat(64),
    reportDigest: createHash('sha256').update(JSON.stringify(targets)).digest('hex'), scannerVersion: 'unit-fixture', buildPassed: true,
    report: { SchemaVersion: 2, ArtifactType: 'container_image', Results: [{
      Target: 'app.jar', Type: 'jar',
      Packages: targets.map(t => ({ Name: t.pkg, Version: t.installed })),
      Vulnerabilities: targets.map(t => ({ VulnerabilityID: t.id, PkgName: t.pkg, InstalledVersion: t.installed, FixedVersion: t.fixed })),
    }] },
  };
}

try {
  // ==========================================================================
  // A. Batch of 1 — NON-REGRESSION. Replays the EXACT real fixture the
  // singular orchestrator's own spec (security-remediation-orchestrator.
  // spec.ts) uses for CVE-2023-6378/PR #37, as a singleton batch, and
  // asserts the resulting candidate content and identity-relevant fields
  // match what the SINGULAR orchestrator itself produces for the identical
  // input -- proving the new batch path is not a behavioral regression.
  // ==========================================================================
  {
    const f = JSON.parse(fs.readFileSync(path.join(__dirname, '../../backend/src/security-remediation/fixtures/v17/logback.json'), 'utf8'));
    const repoA = path.join(root, 'repo-a');
    execFileSync('git', ['clone', '--no-hardlinks', process.env.SECURITY_TEST_REPO || '/home/souhaiel/pfe-2026/pfe-app-test', repoA], { stdio: 'pipe' });
    const wmA = new WorkspaceManager(path.join(root, 'workspaces-a'));
    let serial = 0;
    const singularInput = () => ({ repository: 'souhaiel11/pfe-app-test', candidateBaseSha: f.sha, requestId: 'v1-batch-a-' + ++serial, batchId: 'tests', candidateAttempt: 0,
      finding: { findingIdentity: 'a'.repeat(64), cveId: 'CVE-2023-6378', source: 'TRIVY', package: 'ch.qos.logback:logback-classic', expectedInstalledVersion: '1.2.11', fixedVersion: '1.3.12, 1.4.12, 1.2.13' } });
    const batchInput = () => ({ repository: 'souhaiel11/pfe-app-test', candidateBaseSha: f.sha, requestId: 'v1-batch-a-' + ++serial, batchId: 'tests-batch', candidateAttempt: 0,
      findings: [{ findingIdentity: 'a'.repeat(64), cveId: 'CVE-2023-6378', source: 'TRIVY', package: 'ch.qos.logback:logback-classic', expectedInstalledVersion: '1.2.11', fixedVersion: '1.3.12, 1.4.12, 1.2.13' }] });
    const decision = () => ({ findingIdentity: 'a'.repeat(64), evaluatedSha: f.sha, provenance: { ecosystem: 'MAVEN', kind: 'DIRECT_EXPLICIT', package: 'ch.qos.logback:logback-classic', installedVersion: '1.2.11', controllingFile: 'pom.xml', controllingElement: '<version>1.2.11</version>', controllingProperty: null, groundedSha: f.sha, evidence: 'fixture' }, fixedVersions: ['1.2.13'], selectedTargetVersion: '1.2.13', remediationType: 'AUTO_FIX_ELIGIBLE', reason: 'fixture' });
    // Verbatim from security-remediation-orchestrator.spec.ts's own
    // variant()/adapter/scan() -- this section's whole point is proving the
    // batch path reproduces the SAME real fixture behavior, so it must
    // exercise it identically, not a simplified approximation.
    function variant(w: string) {
      const s = fs.readFileSync(path.join(w, 'pom.xml'), 'utf8');
      if (s === f.source) return { source: f.source, tree: f.baseTree, effective: f.baseEffective };
      for (const k of ['v16', 'property-only', 'coordinated']) if (s === f[k].source) return f[k];
      throw new Error('UNEXPECTED_SOURCE');
    }
    const adapter: any = {
      dependencyTree: (w: string) => ({ status: 'SUCCESS', text: variant(w).tree }),
      effectivePom: (w: string) => ({ status: 'SUCCESS', text: variant(w).effective }),
      packageCandidateWithTests: () => ({ status: 'SUCCESS', testsExecuted: true, testsPassed: true, testsTotal: 1, testsFailures: 0, testsErrors: 0, testsSkipped: 0, durationMs: 1, evidenceTail: '', timedOut: false }),
    };
    function scan(w: string): SecurityArtifactScan {
      const v = variant(w), r = JSON.parse(JSON.stringify(v.source === f.source ? f.baseReport
        : v.source === f.coordinated.source ? f.coordinatedReport : f.v16Report));
      return { mode: 'TRIVY_IMAGE_ARCHIVE', sourceDigest: trackedSourceDigest(w), artifactDigest: 'b'.repeat(64),
        reportDigest: createHash('sha256').update(JSON.stringify(r)).digest('hex'), scannerVersion: 'unit-fixture', report: r, buildPassed: true };
    }
    const singular = new SecurityRemediationOrchestratorService({ decide: decision } as any, wmA, { ensureRepo: () => repoA } as any, adapter, { inspect: scan });
    const singularResult = singular.orchestrate(singularInput());
    assert.equal(singularResult.status, 'CANDIDATE_READY', `A setup: singular orchestrator must reach CANDIDATE_READY, got ${singularResult.status}/${singularResult.reason}`);

    const batchSvc = new SecurityRemediationBatchOrchestratorService({ decide: decision } as any, wmA, { ensureRepo: () => repoA } as any, adapter, { inspect: scan });
    const batchResult = batchSvc.orchestrate(batchInput());
    assert.equal(batchResult.status, 'CANDIDATE_READY', `A: ${JSON.stringify(batchResult)}`);
    assert.equal(batchResult.findings.length, 1);
    assert.equal(batchResult.findings[0].cveId, 'CVE-2023-6378');
    assert.equal(batchResult.findings[0].status, 'CLOSED');
    assert.equal(batchResult.candidateManifest!.files[0].content, singularResult.candidateManifest!.files[0].content, 'A: singleton batch produces the SAME patched pom.xml content as the singular orchestrator');
    assert.equal(batchResult.candidateManifest!.files[0].contentSha256, singularResult.candidateManifest!.files[0].contentSha256);
    // ★ Caught by explicit field-by-field contract review before wiring
    // WF6's multi-CVE node: candidateIdentity feeds computeSecurityBranchName()
    // downstream -- a singleton batch MUST produce the IDENTICAL identity
    // the singular orchestrator does, or a mono-CVE run through the batch
    // path would compute a DIFFERENT branch name than today's real PR #37.
    assert.equal(batchResult.candidateIdentity, singularResult.candidateIdentity, 'A: singleton batch candidateIdentity must be byte-identical to the singular orchestrator (feeds branch naming downstream)');
  }
  console.log('security-remediation-batch-orchestrator A) singleton batch == singular orchestrator output (non-regression, real fixture, PR #37 shape): PASS');

  // ==========================================================================
  // Synthetic repo shared by B-E: two independent Maven dependencies
  // (logback-classic, jackson-databind) in ONE pom.xml, at a real commit.
  // ==========================================================================
  const repoBE = path.join(root, 'repo-be');
  fs.mkdirSync(repoBE, { recursive: true });
  const POM_BEFORE = `<project>\n  <dependencies>\n    <dependency><groupId>ch.qos.logback</groupId><artifactId>logback-classic</artifactId><version>1.2.11</version></dependency>\n    <dependency><groupId>com.fasterxml.jackson.core</groupId><artifactId>jackson-databind</artifactId><version>2.13.3</version></dependency>\n  </dependencies>\n</project>\n`;
  fs.writeFileSync(path.join(repoBE, 'pom.xml'), POM_BEFORE);
  execFileSync('git', ['init', '-q'], { cwd: repoBE });
  execFileSync('git', ['config', 'user.email', 'test@test.local'], { cwd: repoBE });
  execFileSync('git', ['config', 'user.name', 'test'], { cwd: repoBE });
  execFileSync('git', ['add', 'pom.xml'], { cwd: repoBE });
  execFileSync('git', ['commit', '-q', '-m', 'initial'], { cwd: repoBE });
  const SHA = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoBE, encoding: 'utf8' }).trim();
  const wmBE = new WorkspaceManager(path.join(root, 'workspaces-be'));

  const findingA = { findingIdentity: 'f-logback', cveId: 'CVE-2023-6378', source: 'TRIVY', package: 'ch.qos.logback:logback-classic', expectedInstalledVersion: '1.2.11', fixedVersion: '1.2.13' };
  const findingB = { findingIdentity: 'f-jackson', cveId: 'CVE-2020-36518', source: 'TRIVY', package: 'com.fasterxml.jackson.core:jackson-databind', expectedInstalledVersion: '2.13.3', fixedVersion: '2.13.5' };
  const TARGET_A: ScanTarget = { id: findingA.cveId, pkg: findingA.package, installed: findingA.expectedInstalledVersion, fixed: findingA.fixedVersion };
  const TARGET_B: ScanTarget = { id: findingB.cveId, pkg: findingB.package, installed: findingB.expectedInstalledVersion, fixed: findingB.fixedVersion };
  const decisionFor = (finding: any): any => ({
    findingIdentity: finding.findingIdentity, evaluatedSha: SHA,
    provenance: { ecosystem: 'MAVEN', kind: 'DIRECT_EXPLICIT', package: finding.package, installedVersion: finding.expectedInstalledVersion, controllingFile: 'pom.xml', controllingElement: `<version>${finding.expectedInstalledVersion}</version>`, controllingProperty: null, groundedSha: SHA, evidence: 'synthetic' },
    fixedVersions: [finding.fixedVersion], selectedTargetVersion: finding.fixedVersion, remediationType: 'AUTO_FIX_ELIGIBLE', reason: 'synthetic',
  });
  const decisionServiceFor = (findings: any[]) => {
    let call = 0;
    return { decide: (_finding: any) => decisionFor(findings[call++]) };
  };

  // Generic, content-driven Maven-tree/effective-pom fakes: read whatever
  // <version> values are ACTUALLY in the workspace's pom.xml right now and
  // synthesize real-shaped `mvn dependency:tree`/effective-pom text from
  // them — works unmodified for the baseline, every per-finding control
  // experiment, AND the final fully-chained candidate, since scope
  // derivation (maven-remediation-scope.ts) only cares that the text is
  // well-formed and internally consistent with the file it was "derived"
  // from, not that it came from a real `mvn` process.
  function parsePomVersions(pomText: string): Record<string, string> {
    const out: Record<string, string> = {};
    const depRe = /<dependency>\s*<groupId>([^<]+)<\/groupId>\s*<artifactId>([^<]+)<\/artifactId>\s*<version>([^<]+)<\/version>\s*<\/dependency>/g;
    let m: RegExpExecArray | null;
    while ((m = depRe.exec(pomText))) out[`${m[1]}:${m[2]}`] = m[3];
    return out;
  }
  function currentPom(workspacePath: string): string { return fs.readFileSync(path.join(workspacePath, 'pom.xml'), 'utf8'); }
  const genericDependencyTree = (w: string) => ({ status: 'SUCCESS', text: Object.entries(parsePomVersions(currentPom(w))).map(([ga, v]) => `+- ${ga}:jar:${v}:compile`).join('\n') + '\n' });
  const genericEffectivePom = (w: string) => ({ status: 'SUCCESS', text: `<project><dependencies>${Object.entries(parsePomVersions(currentPom(w))).map(([ga, v]) => { const [g, a] = ga.split(':'); return `<dependency><groupId>${g}</groupId><artifactId>${a}</artifactId><version>${v}</version></dependency>`; }).join('')}</dependencies></project>` });

  // ==========================================================================
  // B. Two DISTINCT, non-conflicting CVEs -> ONE build, ONE scan, BOTH closed.
  // ==========================================================================
  {
    const adapter: any = { dependencyTree: genericDependencyTree, effectivePom: genericEffectivePom, packageCandidateWithTests: () => ({ status: 'SUCCESS', testsExecuted: true, testsPassed: true, testsTotal: 1, testsFailures: 0, testsErrors: 0, testsSkipped: 0, durationMs: 1, evidenceTail: '', timedOut: false }) };
    let scanCall = 0;
    const scanner = { inspect: (w: string) => {
      scanCall++;
      const digest = trackedSourceDigest(w);
      // Call 1 = baseline (pre-patch, also reused per-finding for scope
      // evidence's cveTargets): both CVEs present. Last call = post-build
      // candidate: both gone.
      return scanCall === 1 ? scanFor([TARGET_A, TARGET_B], digest) : scanFor([], digest);
    } };
    const svc = new SecurityRemediationBatchOrchestratorService(decisionServiceFor([findingA, findingB]) as any, wmBE, { ensureRepo: () => repoBE } as any, adapter, scanner as any);
    const result = svc.orchestrate({ repository: 'x/y', candidateBaseSha: SHA, requestId: 'b-req', batchId: 'b-batch', candidateAttempt: 0, findings: [findingA, findingB] });
    assert.equal(result.status, 'CANDIDATE_READY', `B: ${JSON.stringify(result)}`);
    assert.equal(result.findings.length, 2);
    assert.ok(result.findings.every(f => f.status === 'CLOSED'), `B: both CVEs CLOSED, got ${JSON.stringify(result.findings)}`);
    assert.match(result.candidateManifest!.files[0].content, /<version>1\.2\.13<\/version>/);
    assert.match(result.candidateManifest!.files[0].content, /<version>2\.13\.5<\/version>/);
    assert.ok(result.candidateIdentity);
    // ★ WF6 multi-CVE wiring: the callback node must zip result.findings[i]
    // against the CALLER's own original findingTaskIds[i] by index -- this
    // only works if result.findings preserves the CALLER's input order,
    // never writeSecurityPatchBatch()'s internal cveId-sorted order.
    // findingA=CVE-2023-6378, findingB=CVE-2020-36518 is DELIBERATELY
    // reverse-alphabetical so this assertion actually distinguishes the two
    // orders (a same-order coincidence would hide a real bug here).
    assert.equal(result.findings[0].cveId, findingA.cveId, 'findings[0] must correspond to the FIRST input finding (input order), not cveId-sorted order');
    assert.equal(result.findings[1].cveId, findingB.cveId, 'findings[1] must correspond to the SECOND input finding');
  }
  console.log('security-remediation-batch-orchestrator B) two distinct CVEs -> one build/scan, both CLOSED, one PR-ready candidate, findings[] preserves CALLER input order: PASS');

  // ==========================================================================
  // C. ★ Conflict — two CVEs claim the SAME package/declaration with
  // incompatible expected installed versions -> refused BEFORE any
  // build/closure-scan (proven by making the build and the SECOND scanner
  // call throw if ever reached; the FIRST scanner call, the baseline scan
  // that legitimately runs before conflict detection, is allowed).
  // ==========================================================================
  {
    const conflictingB = { ...findingB, package: 'ch.qos.logback:logback-classic', expectedInstalledVersion: '1.2.11', fixedVersion: '1.2.20' }; // same package as A, different target
    const TARGET_CONFLICT_B: ScanTarget = { id: conflictingB.cveId, pkg: conflictingB.package, installed: conflictingB.expectedInstalledVersion, fixed: conflictingB.fixedVersion };
    const adapter: any = { dependencyTree: genericDependencyTree, effectivePom: genericEffectivePom, packageCandidateWithTests: () => { throw new Error('MUST_NOT_BUILD_ON_CONFLICT'); } };
    let scanCall = 0;
    const scanner = { inspect: (w: string) => {
      scanCall++;
      if (scanCall > 1) throw new Error('MUST_NOT_CLOSURE_SCAN_ON_CONFLICT');
      return scanFor([TARGET_A, TARGET_CONFLICT_B], trackedSourceDigest(w));
    } };
    const svc = new SecurityRemediationBatchOrchestratorService(decisionServiceFor([findingA, conflictingB]) as any, wmBE, { ensureRepo: () => repoBE } as any, adapter, scanner as any);
    const result = svc.orchestrate({ repository: 'x/y', candidateBaseSha: SHA, requestId: 'c-req', batchId: 'c-batch', candidateAttempt: 0, findings: [findingA, conflictingB] });
    assert.equal(result.status, 'PATCH_CONFLICT', `C: ${JSON.stringify(result)}`);
    assert.equal(result.candidateManifest, null);
    const conflicted = result.findings.filter(f => f.status === 'PATCH_CONFLICT');
    // Deterministic chain order is cveId-sorted (CVE-2020-36518 before
    // CVE-2023-6378), so whichever one is applied FIRST wins and the OTHER
    // one collides -- either way, exactly one of the two colliding CVEs
    // must be explicitly named, never zero, never silently resolved.
    assert.equal(conflicted.length, 1, `C: exactly one of the two colliding CVEs is named, got ${JSON.stringify(result.findings)}`);
    assert.ok([findingA.cveId, conflictingB.cveId].includes(conflicted[0].cveId), `C: the named CVE must be one of the two colliding ones, got ${conflicted[0].cveId}`);
  }
  console.log('security-remediation-batch-orchestrator C) two CVEs on the same declaration, incompatible targets -> PATCH_CONFLICT before any build/closure-scan, named: PASS');

  // ==========================================================================
  // D. Build succeeds, but ONE target CVE remains present in the candidate
  // scan (insufficient bump) -> whole batch fails (tout-ou-rien), per-CVE
  // detail names exactly which one stayed open.
  // ==========================================================================
  {
    const adapter: any = { dependencyTree: genericDependencyTree, effectivePom: genericEffectivePom, packageCandidateWithTests: () => ({ status: 'SUCCESS', testsExecuted: true, testsPassed: true, testsTotal: 1, testsFailures: 0, testsErrors: 0, testsSkipped: 0, durationMs: 1, evidenceTail: '', timedOut: false }) };
    let scanCall = 0;
    const scanner = { inspect: (w: string) => {
      scanCall++;
      const digest = trackedSourceDigest(w);
      // Baseline: both present. Candidate: jackson's CVE incorrectly still reported (simulates an insufficient real-world fix).
      return scanCall === 1 ? scanFor([TARGET_A, TARGET_B], digest) : scanFor([TARGET_B], digest);
    } };
    const svc = new SecurityRemediationBatchOrchestratorService(decisionServiceFor([findingA, findingB]) as any, wmBE, { ensureRepo: () => repoBE } as any, adapter, scanner as any);
    const result = svc.orchestrate({ repository: 'x/y', candidateBaseSha: SHA, requestId: 'd-req', batchId: 'd-batch', candidateAttempt: 0, findings: [findingA, findingB] });
    assert.equal(result.status, 'CANDIDATE_SECURITY_VALIDATION_FAILED', `D: ${JSON.stringify(result)}`);
    assert.equal(result.candidateManifest, null, 'D: no PR-worthy candidate when the batch is not all-closed');
    const byId = new Map(result.findings.map(f => [f.cveId, f.status]));
    assert.equal(byId.get('CVE-2023-6378'), 'CLOSED', 'D: the CVE that WAS fixed is still reported CLOSED');
    assert.equal(byId.get('CVE-2020-36518'), 'STILL_OPEN', 'D: the CVE that remained open is named exactly');
  }
  console.log('security-remediation-batch-orchestrator D) build OK, one CVE still open at scan -> whole batch fails, exact CVE named per-CVE: PASS');

  // ==========================================================================
  // E. Build breaks -> whole batch fails with the REAL Maven output
  // captured, and explicitly NO per-CVE attribution (every finding PENDING).
  // ==========================================================================
  {
    const MAVEN_ERROR_OUTPUT = '[ERROR] Failed to execute goal ... -> [Help 1]\nBUILD FAILURE';
    const adapter: any = { dependencyTree: genericDependencyTree, effectivePom: genericEffectivePom, packageCandidateWithTests: () => ({ status: 'FAILED', testsExecuted: false, testsPassed: null, durationMs: 1, evidenceTail: MAVEN_ERROR_OUTPUT, timedOut: false }) };
    const svc = new SecurityRemediationBatchOrchestratorService(decisionServiceFor([findingA, findingB]) as any, wmBE, { ensureRepo: () => repoBE } as any, adapter, { inspect: (w: string) => scanFor([TARGET_A, TARGET_B], trackedSourceDigest(w)) } as any);
    const result = svc.orchestrate({ repository: 'x/y', candidateBaseSha: SHA, requestId: 'e-req', batchId: 'e-batch', candidateAttempt: 0, findings: [findingA, findingB] });
    assert.equal(result.status, 'CANDIDATE_BUILD_FAILED', `E: ${JSON.stringify(result)}`);
    assert.equal(result.buildOutput, MAVEN_ERROR_OUTPUT, 'E: the real captured Maven output is returned verbatim');
    assert.equal(result.candidateManifest, null);
    assert.ok(result.findings.every(f => f.status === 'PENDING' && f.reason === 'BATCH_BUILD_FAILED_NOT_ATTRIBUTED'), `E: no CVE is blamed individually for a combined build failure, got ${JSON.stringify(result.findings)}`);
  }
  console.log('security-remediation-batch-orchestrator E) build failure -> whole batch fails, real Maven output captured, NO per-CVE attribution: PASS');

  console.log('security-remediation-batch-orchestrator.spec.ts: ALL CHECKS PASS');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
