// R-SEC-V1.2 §8/§9 — REAL, end-to-end proof against the real
// souhaiel11/pfe-app-test repository at the exact grounded SHA already
// used throughout V1/V1.1 (a81be457..., real merged main, this session's
// own R81 work). Same symlink-scratch pattern as grounded-maven-provenance.
// spec.ts / candidate-verification-executor.spec.ts — no network clone
// needed, but every checkout/Maven run below is real, unmocked I/O.
//
// §8 — real logback-classic CVE-2023-6378 (fixedVersion "1.3.12, 1.4.12,
// 1.2.13", a genuinely observed real Trivy value from this session's own
// earlier report-normalizer work) grounds to a real AUTO_FIX_ELIGIBLE
// decision; the deterministic writer produces a real, inspectable diff;
// the guard passes it. tomcat-embed-core (real TRANSITIVE, the task's own
// worked example) must produce NO patch at all -- the writer refuses
// before ever touching pom.xml.
//
// §9 — the produced patch is written into a SECOND, independent real
// exact-SHA worktree (never the same worktree grounding read from) and
// `mvn dependency:tree` is re-run for real against the patched file to
// prove the resolved version actually becomes targetVersion -- not just
// that the XML text looks right.
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GroundedMavenProvenanceService } from './grounded-maven-provenance.service';
import { SecurityFindingDecisionService } from './security-finding-decision.service';
import { WorkspaceManager } from './workspace-manager.service';
import { RepoCacheService } from './repo-cache.service';
import { MavenBuildAdapter } from './maven-build-adapter';
import { writeSecurityPatch } from '../../backend/src/security-remediation/maven-security-patch-writer';
import { assertSecurityPatchSafeToWrite } from '../../backend/src/security-remediation/security-patch-guard';
import { SecurityPatchRequest } from '../../backend/src/security-remediation/security-patch-request.types';

const REPO_PATH = '/home/souhaiel/pfe-2026/pfe-app-test';
const REPOSITORY = 'souhaiel11/pfe-app-test';
const EXACT_SHA = 'a81be45709aba07da50d44206d073c2eb55892b5';

const scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pfe-security-patch-proof-'));
const workspaceManager = new WorkspaceManager(scratchRoot);
const repoCacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pfe-security-patch-proof-repocache-'));
fs.symlinkSync(REPO_PATH, path.join(repoCacheRoot, 'souhaiel11__pfe-app-test'));
const repoCache = new RepoCacheService(repoCacheRoot);
const mavenAdapter = new MavenBuildAdapter();
const provenanceService = new GroundedMavenProvenanceService(workspaceManager, repoCache, mavenAdapter);
const decisionService = new SecurityFindingDecisionService(provenanceService);

let counter = 0;
const nextId = (label: string) => `${label}-${++counter}`;

// ============================================================================
// §8.A — real logback-classic: real grounding -> AUTO_FIX_ELIGIBLE, real
// writer diff, real guard pass.
// ============================================================================
const logbackDecision = decisionService.decide(
  {
    findingIdentity: 'real-trivy-CVE-2023-6378-logback-classic',
    source: 'TRIVY',
    package: 'ch.qos.logback:logback-classic',
    expectedInstalledVersion: '1.2.11',
    fixedVersion: '1.3.12, 1.4.12, 1.2.13', // real observed Trivy value (report-normalizer.spec.ts)
  },
  { repository: REPOSITORY, candidateBaseSha: EXACT_SHA, requestId: nextId('req'), batchId: 'r-sec-v1-2', candidateAttempt: 0 },
);
assert.equal(logbackDecision.remediationType, 'AUTO_FIX_ELIGIBLE', `§8.A: real grounding must be eligible: ${JSON.stringify(logbackDecision)}`);
assert.equal(logbackDecision.selectedTargetVersion, '1.2.13', '§8.A: lowest same-major fixed version > 1.2.11 among {1.3.12,1.4.12,1.2.13} is 1.2.13');
assert.equal(logbackDecision.evaluatedSha, EXACT_SHA.toLowerCase());
assert.equal(logbackDecision.provenance?.kind, 'DIRECT_EXPLICIT');
console.log(`§8.A) real logback-classic grounding -> AUTO_FIX_ELIGIBLE, target=${logbackDecision.selectedTargetVersion}: PASS`);

// Real pom.xml source text at this exact SHA: the same fixture captured
// and cross-verified against real `git hash-object` in V1/V1.1 (see
// maven-security-patch-writer.spec.ts test A) -- not re-fetched here to
// avoid a THIRD checkout for the same file; already proven authentic.
const realPomXmlText = fs.readFileSync(
  path.join(__dirname, '..', '..', 'backend', 'src', 'security-remediation', 'fixtures', 'pfe-app-test.pom.xml'),
  'utf8',
);

const logbackRequest: SecurityPatchRequest = {
  findingIdentity: logbackDecision.findingIdentity,
  evaluatedSha: logbackDecision.evaluatedSha!,
  ecosystem: 'MAVEN',
  provenanceKind: logbackDecision.provenance!.kind,
  package: logbackDecision.provenance!.package,
  installedVersion: logbackDecision.provenance!.installedVersion,
  targetVersion: logbackDecision.selectedTargetVersion!,
  controllingFile: logbackDecision.provenance!.controllingFile!,
  controllingElement: logbackDecision.provenance!.controllingElement,
  controllingProperty: logbackDecision.provenance!.controllingProperty,
  sourceContent: realPomXmlText,
};

const writeResult = writeSecurityPatch(logbackRequest);
assert.equal(writeResult.ok, true, `§8.A: writer must succeed against the real grounded request: ${JSON.stringify(writeResult)}`);
const logbackCandidate = (writeResult as any).candidate;

// Real, inspectable diff -- printed, not just asserted.
{
  const before = realPomXmlText;
  const after = logbackCandidate.file.content;
  let start = 0; while (start < before.length && before[start] === after[start]) start++;
  let endB = before.length - 1, endA = after.length - 1;
  while (endB > start && endA > start && before[endB] === after[endA]) { endB--; endA--; }
  const removed = before.slice(start, endB + 1);
  const added = after.slice(start, endA + 1);
  console.log(`§8.A) REAL DIFF at offset ${start}: "${removed}" -> "${added}"`);
  assert.equal(removed, '1', '§8.A: only the differing trailing digit of the old version is removed');
  assert.equal(added, '3', '§8.A: only the differing trailing digit of the new version is added (1.2.11 -> 1.2.13)');
}

const guardResult = assertSecurityPatchSafeToWrite(logbackDecision as any, logbackRequest, logbackCandidate);
assert.equal(guardResult.ok, true, `§8.A: guard must pass the real, untampered candidate: ${JSON.stringify(guardResult)}`);
console.log('§8.A) real logback-classic: writer diff + guard PASS: PASS');

// ============================================================================
// §8.B — real tomcat-embed-core (TRANSITIVE, the task's own worked
// example): real grounding proves TRANSITIVE, writer refuses, NO patch
// produced at all.
// ============================================================================
const tomcatDecision = decisionService.decide(
  {
    findingIdentity: 'real-trivy-tomcat-embed-core',
    source: 'TRIVY',
    package: 'org.apache.tomcat.embed:tomcat-embed-core',
    expectedInstalledVersion: '9.0.63',
    fixedVersion: '9.0.99',
  },
  { repository: REPOSITORY, candidateBaseSha: EXACT_SHA, requestId: nextId('req'), batchId: 'r-sec-v1-2', candidateAttempt: 0 },
);
assert.equal(tomcatDecision.provenance?.kind, 'TRANSITIVE', '§8.B: real dependency:tree grounds tomcat-embed-core as TRANSITIVE (depth 2)');
assert.notEqual(tomcatDecision.remediationType, 'AUTO_FIX_ELIGIBLE', '§8.B: TRANSITIVE is never AUTO_FIX_ELIGIBLE in V1');

if (tomcatDecision.provenance) {
  const tomcatRequest: SecurityPatchRequest = {
    findingIdentity: tomcatDecision.findingIdentity, evaluatedSha: tomcatDecision.evaluatedSha!, ecosystem: 'MAVEN',
    provenanceKind: tomcatDecision.provenance.kind, package: tomcatDecision.provenance.package,
    installedVersion: tomcatDecision.provenance.installedVersion, targetVersion: '9.0.99',
    controllingFile: tomcatDecision.provenance.controllingFile ?? 'pom.xml', controllingElement: null, controllingProperty: null,
    sourceContent: realPomXmlText,
  };
  const tomcatWrite = writeSecurityPatch(tomcatRequest);
  assert.equal(tomcatWrite.ok, false, '§8.B: writer must refuse -- no patch produced for TRANSITIVE');
  assert.equal((tomcatWrite as any).reason, 'UNSUPPORTED_PROVENANCE_KIND');
}
console.log('§8.B) real tomcat-embed-core: real TRANSITIVE grounding -> writer refuses, no patch: PASS');

// ============================================================================
// §9 — Maven resolution pre-validation. Write the real patched pom.xml
// into a SECOND, independent, real exact-SHA worktree and re-run
// `mvn dependency:tree` for real. No external scanner is invoked -- only
// the same MavenBuildAdapter.dependencyTree() already used for grounding.
// ============================================================================
function dependencyTreeResolvesTo(treeText: string, groupArtifact: string, version: string): boolean {
  // Real `mvn dependency:tree -DoutputType=text` lines look like:
  // "+- ch.qos.logback:logback-classic:jar:1.2.13:compile" (or "\- " for the
  // last child, with leading indentation) -- match the coordinate anchored
  // to a word boundary so e.g. "1.2.130" can never false-positive match "1.2.13".
  const escaped = groupArtifact.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`${escaped}:jar:${version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:[:\\s]|$)`, 'm');
  return pattern.test(treeText);
}

{
  const verifyRequestId = nextId('verifyreq');
  const verifyBatchId = 'r-sec-v1-2-verify';
  const verifyWorkspaceId = workspaceManager.workspaceId(verifyRequestId, verifyBatchId, 0);
  const repoPath = repoCache.ensureRepo(REPOSITORY);
  const handle = workspaceManager.createWorkspace({
    repoPath, candidateBaseSha: EXACT_SHA, requestId: verifyRequestId, batchId: verifyBatchId, candidateAttempt: 0,
  });
  try {
    assert.equal(handle.checkoutSha.toLowerCase(), EXACT_SHA.toLowerCase(), '§9: verification worktree is genuinely at the exact grounded SHA');

    // Sanity: BEFORE patching, dependency:tree must resolve the OLD version,
    // not the new one -- proves the tree we are about to re-run is real,
    // not a stale/cached artifact resolving to 1.2.13 regardless of pom content.
    const beforeTree = mavenAdapter.dependencyTree(handle.path);
    assert.equal(beforeTree.status, 'SUCCESS', `§9: baseline dependency:tree must succeed: ${beforeTree.evidenceTail}`);
    assert.ok(dependencyTreeResolvesTo(beforeTree.text!, 'ch.qos.logback:logback-classic', '1.2.11'), '§9: BEFORE patch, real tree resolves the OLD version (1.2.11)');
    assert.ok(!dependencyTreeResolvesTo(beforeTree.text!, 'ch.qos.logback:logback-classic', '1.2.13'), '§9: BEFORE patch, real tree does NOT yet resolve the target version');

    // Apply the real patch produced in §8.A into this SEPARATE worktree.
    const pomPath = path.join(handle.path, 'pom.xml');
    const onDiskPomBefore = fs.readFileSync(pomPath, 'utf8');
    assert.equal(onDiskPomBefore, realPomXmlText, '§9: the captured fixture is byte-identical to the real on-disk pom.xml at this exact SHA -- the patch is being validated against the SAME text it was derived from');
    fs.writeFileSync(pomPath, logbackCandidate.file.content, 'utf8');

    const afterTree = mavenAdapter.dependencyTree(handle.path);
    assert.equal(afterTree.status, 'SUCCESS', `§9: patched dependency:tree must resolve, not just parse: ${afterTree.evidenceTail}`);
    const dependencyResolutionMatch = dependencyTreeResolvesTo(afterTree.text!, 'ch.qos.logback:logback-classic', logbackCandidate.targetVersion);
    assert.equal(dependencyResolutionMatch, true, '§9: AFTER patch, real Maven dependency resolution actually resolves the target version (1.2.13), not merely edited XML text');
    assert.ok(!dependencyTreeResolvesTo(afterTree.text!, 'ch.qos.logback:logback-classic', '1.2.11'), '§9: the old version no longer appears in the resolved tree');

    console.log(`§9) DEPENDENCY_RESOLUTION_MATCH = ${dependencyResolutionMatch ? 'YES' : 'NO'}`);
    console.log('§9) real Maven pre-validation (separate worktree, real mvn dependency:tree before/after): PASS');
  } finally {
    workspaceManager.cleanupWorkspace(verifyWorkspaceId, repoPath);
  }
}

fs.rmSync(scratchRoot, { recursive: true, force: true });
fs.rmSync(repoCacheRoot, { recursive: true, force: true });
console.log('security-patch-real-proof.spec.ts: ALL CHECKS PASS');
