/** V1.7 orchestration unit/integration wiring. Maven/scanner outputs are explicitly
 * injected captured fixtures; the unmocked build+Trivy proof is a separate runner. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import { SecurityRemediationOrchestratorService } from './security-remediation-orchestrator.service';
import { WorkspaceManager } from './workspace-manager.service';
import { ArtifactRuntimeError, trackedSourceDigest, cveTargets, provesSecurityClosure, SecurityArtifactScan } from './security-artifact-validator';
const f = JSON.parse(fs.readFileSync(path.join(__dirname, '../../backend/src/security-remediation/fixtures/v17/logback.json'), 'utf8'));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v17-orchestrator-'));
const repo = path.join(root, 'repo');
execFileSync('git', ['clone', '--no-hardlinks', process.env.SECURITY_TEST_REPO || '/home/souhaiel/pfe-2026/pfe-app-test', repo], { stdio: 'pipe' });
const wm = new WorkspaceManager(path.join(root, 'workspaces'));
let serial = 0;
const input = () => ({ repository: 'souhaiel11/pfe-app-test', candidateBaseSha: f.sha, requestId: 'v17-' + ++serial, batchId: 'tests', candidateAttempt: 0,
 finding: { findingIdentity: 'a'.repeat(64), cveId: 'CVE-2023-6378', source: 'TRIVY', package: 'ch.qos.logback:logback-classic', expectedInstalledVersion: '1.2.11', fixedVersion: '1.3.12, 1.4.12, 1.2.13' } });
const decision = () => ({ findingIdentity: 'a'.repeat(64), evaluatedSha: f.sha, provenance: { ecosystem: 'MAVEN', kind: 'DIRECT_EXPLICIT', package: 'ch.qos.logback:logback-classic', installedVersion: '1.2.11', controllingFile: 'pom.xml', controllingElement: '<version>1.2.11</version>', controllingProperty: null, groundedSha: f.sha, evidence: 'fixture' }, fixedVersions: ['1.2.13'], selectedTargetVersion: '1.2.13', remediationType: 'AUTO_FIX_ELIGIBLE', reason: 'fixture' });
function variant(w: string) {
 const s = fs.readFileSync(path.join(w, 'pom.xml'), 'utf8');
 if (s === f.source) return { source: f.source, tree: f.baseTree, effective: f.baseEffective };
 for (const k of ['v16', 'property-only', 'coordinated']) if (s === f[k].source) return f[k];
 throw new Error('UNEXPECTED_SOURCE');
}
// V1.8 — every mocked packageCandidateWithTests() below stands in for a real
// `mvn clean package` that DID execute the application test suite; specs
// exercising a build failure set testsExecuted:false explicitly (no Surefire
// report ever existed for a build that failed before/without running tests).
const testsPassedResult = { status: 'SUCCESS', testsExecuted: true, testsPassed: true, testsTotal: 1, testsFailures: 0, testsErrors: 0, testsSkipped: 0, durationMs: 1, evidenceTail: '', timedOut: false };
const adapter: any = {
 dependencyTree: (w: string) => ({ status: 'SUCCESS', text: variant(w).tree }),
 effectivePom: (w: string) => ({ status: 'SUCCESS', text: variant(w).effective }),
 packageCandidateWithTests: () => testsPassedResult,
};
function scan(w: string): SecurityArtifactScan {
 const v = variant(w), r = JSON.parse(JSON.stringify(v.source === f.source ? f.baseReport
   : v.source === f.coordinated.source ? f.coordinatedReport : f.v16Report));
 return { mode: 'TRIVY_IMAGE_ARCHIVE', sourceDigest: trackedSourceDigest(w), artifactDigest: 'b'.repeat(64),
 reportDigest: createHash('sha256').update(JSON.stringify(r)).digest('hex'), scannerVersion: 'unit-fixture', report: r, buildPassed: true };
}
const make = (a: any = adapter, scanner: any = { inspect: scan }, d: any = { decide: decision }) =>
 new SecurityRemediationOrchestratorService(d, wm, { ensureRepo: () => repo } as any, a, scanner);
try {
 const first = make().orchestrate(input()), second = make().orchestrate(input());
 assert.equal(first.status, 'CANDIDATE_READY', first.reason);
 assert.equal(first.decision.provenance!.kind, 'DIRECT_EXPLICIT');
 assert.equal(first.decision.remediationScope!.controls.length, 2);
 assert.equal(first.securityValidationEvidence!.status, 'TARGET_CVE_CLOSED');
 assert.equal(first.candidateManifest!.files[0].content, f.coordinated.source);
 assert.equal(first.candidateIdentity, second.candidateIdentity);
 assert.equal(first.candidateManifest!.candidateDigest, second.candidateManifest!.candidateDigest);
 const v16: SecurityArtifactScan = { ...scanForReport(f.v16Report), sourceDigest: 'c'.repeat(64) };
 assert.equal(cveTargets(v16, 'CVE-2023-6378').length, 1);
 assert.equal(provesSecurityClosure(v16, first.decision.remediationScope!), false);
 const residual = make(adapter, { inspect: (w: string) => {
   const s = scan(w);
   if (variant(w).source === f.coordinated.source) s.report = f.v16Report;
   return s;
 } }).orchestrate(input());
 assert.equal(residual.status, 'CANDIDATE_SECURITY_VALIDATION_FAILED'); assert.equal(residual.candidateManifest, null);
 assert.equal(make({ ...adapter, packageCandidateWithTests: () => ({ status: 'FAILED', testsExecuted: false, testsPassed: null, durationMs: 1, evidenceTail: '', timedOut: false }) }).orchestrate(input()).status, 'CANDIDATE_BUILD_FAILED');
 assert.equal(make({ ...adapter, packageCandidateWithTests: () => ({ status: 'FAILED', testsExecuted: true, testsPassed: false, testsTotal: 3, testsFailures: 1, testsErrors: 0, testsSkipped: 0, durationMs: 1, evidenceTail: '', timedOut: false }) }).orchestrate(input()).status, 'APPLICATION_TESTS_FAILED');
 assert.equal(make({ ...adapter, packageCandidateWithTests: () => ({ status: 'SUCCESS', testsExecuted: false, testsPassed: null, durationMs: 1, evidenceTail: '', timedOut: false }) }).orchestrate(input()).status, 'APPLICATION_TESTS_NOT_EXECUTED');
 assert.equal(make({ ...adapter, packageCandidateWithTests: () => ({ status: 'FAILED', testsExecuted: false, testsPassed: null, durationMs: 1, evidenceTail: '', timedOut: true }) }).orchestrate(input()).status, 'TECHNICAL_FAILURE');
 const mutatingTree = { ...adapter, dependencyTree: (w: string) => {
   const result = adapter.dependencyTree(w);
   if (variant(w).source === f.coordinated.source) fs.appendFileSync(path.join(w, 'pom.xml'), '\n<!-- unauthorized mutation -->');
   return result;
 } };
 assert.equal(make(mutatingTree).orchestrate(input()).status, 'CANDIDATE_SECURITY_VALIDATION_FAILED');
 assert.equal(make(adapter, { inspect: () => { throw Error('SCANNER_UNAVAILABLE'); } }).orchestrate(input()).status, 'REMEDIATION_SCOPE_UNPROVEN');
 for (const code of ['RUNTIME_EXECUTABLE_UNAVAILABLE', 'ROOTLESS_BUILDER_REQUIRED', 'TRIVY_VERSION_MISMATCH',
   'RUNTIME_COMMAND_FAILED', 'RUNTIME_OPERATION_TIMEOUT', 'MALFORMED_SCANNER_JSON', 'RUNTIME_CLEANUP_FAILED']) {
  for (const phase of ['base', 'candidate']) {
   const failure = make(adapter, { inspect: (w: string) => {
    if (phase === 'base' || variant(w).source === f.coordinated.source) throw new ArtifactRuntimeError(code, 'FAULT_TEST');
    return scan(w);
   } }).orchestrate(input());
   assert.equal(failure.status, 'TECHNICAL_FAILURE');
   assert.equal(failure.failureClass, code === 'RUNTIME_OPERATION_TIMEOUT' ? 'VERIFIER_TIMEOUT' : 'VERIFIER_UNAVAILABLE');
   assert.equal(failure.candidateManifest, null); assert.equal(failure.candidateIdentity, null);
   assert.equal(failure.securityValidationEvidence, undefined);
  }
 }
 const leakingManager = new WorkspaceManager(path.join(root, 'cleanup-failure'));
 leakingManager.cleanupWorkspace = () => {};
 assert.throws(() => new SecurityRemediationOrchestratorService({ decide: decision } as any, leakingManager,
   { ensureRepo: () => repo } as any, adapter, { inspect: scan }).orchestrate(input()), /RUNTIME_CLEANUP_FAILED:WORKSPACE_CLEANUP/);
 assert.equal(make(adapter, { inspect: (w: string) => ({ ...scan(w), sourceDigest: 'bad' }) }).orchestrate(input()).status, 'REMEDIATION_SCOPE_UNPROVEN');
 const missingCve = input(); delete missingCve.finding.cveId;
 assert.equal(make().orchestrate(missingCve).status, 'REMEDIATION_SCOPE_UNPROVEN');
 for (const kind of ['TRANSITIVE', 'BOM_MANAGED', 'PLUGIN', 'UNRESOLVED']) {
  const d = decision(); d.provenance.kind = kind; d.remediationType = 'DEVELOPER_ACTION_REQUIRED';
  const result = make(adapter, { inspect: () => { throw Error('MUST_NOT_SCAN'); } }, { decide: () => d }).orchestrate(input());
  assert.equal(result.status, 'NOT_ELIGIBLE'); assert.equal(result.candidateManifest, null);
 }
 for (const report of [{}, { SchemaVersion: 2, ArtifactType: 'container_image', Results: [] }])
  assert.throws(() => cveTargets(scanForReport(report), 'CVE-2023-6378'), /INCOMPLETE/);
 for (const mutation of [
   (r: any) => r.Results.push(null),
   (r: any) => { r.Results[0].Vulnerabilities = [null]; },
   (r: any) => { r.Results[0].ModifiedFindings = [{ Status: 'ignored' }]; },
 ]) {
   const report = JSON.parse(JSON.stringify(f.baseReport)); mutation(report);
   assert.throws(() => cveTargets(scanForReport(report), 'CVE-2023-6378'));
 }
 const extra = JSON.parse(JSON.stringify(scanForReport(f.baseReport)));
 extra.report.Results[0].Vulnerabilities = [{ VulnerabilityID: 'CVE-2023-6378', PkgName: 'unrelated:other', InstalledVersion: '1.0.0' }];
 assert.equal(provesSecurityClosure(extra, first.decision.remediationScope!), false);
 const bad = decision(); bad.provenance.installedVersion = '1.9.9';
 assert.notEqual(make(adapter, { inspect: scan }, { decide: () => bad }).orchestrate(input()).status, 'CANDIDATE_READY');
 console.log('V1.7 orchestrator: coordinated scope, exact worktree, scanner/build fail-closed, complete CVE coverage, provenance and identity PASS (injected scanner/Maven fixtures)');
} finally { fs.rmSync(root, { recursive: true, force: true }); }
function scanForReport(report: any): SecurityArtifactScan {
 return { mode: 'TRIVY_IMAGE_ARCHIVE', sourceDigest: 'c'.repeat(64), artifactDigest: 'b'.repeat(64), reportDigest: 'd'.repeat(64), buildPassed: true, scannerVersion: 'fixture', report };
}
