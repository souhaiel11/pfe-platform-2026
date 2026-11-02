/** Explicit OFFLINE proof runner, never imported by the server/spec suite.
 * Builds/scans artifacts through existing Docker/Trivy CLI tools; never starts
 * the application, invokes a Jenkins job, or writes GitHub/platform state.
 * Usage: localExactShaRepo retainedBaseEvidence outputDirectory offlineMavenCache
 */
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import * as assert from 'assert';
import { WorkspaceManager } from '../src/workspace-manager.service';
import { MavenBuildAdapter } from '../src/maven-build-adapter';
import { GroundedMavenProvenanceService } from '../src/grounded-maven-provenance.service';
import { SecurityFindingDecisionService } from '../src/security-finding-decision.service';
import { SecurityRemediationOrchestratorService } from '../src/security-remediation-orchestrator.service';
import { SecurityArtifactValidator, SecurityArtifactScan, trackedSourceDigest } from '../src/security-artifact-validator';
const [repo, retained, output, offlineMavenCache] = process.argv.slice(2);
if (!repo || !retained || !output || !offlineMavenCache) throw Error('Expected localRepo retainedEvidence outputDirectory offlineMavenCache');
fs.mkdirSync(output, { recursive: true });
const sha = '7ae0f954f99628b69ce9b42f42c1e2acc8568d99';
const basePom = execFileSync('git', ['-C', repo, 'show', sha + ':pom.xml'], { encoding: 'utf8' });
const baseline = JSON.parse(fs.readFileSync(path.join(retained, 'original-trivy-report.json'), 'utf8'));
assert.equal(baseline.ArtifactType, 'container_image');
assert.ok(baseline.Metadata.RepoTags.includes('pfe-app-test:149'));
const digest = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
function docker(args: string[]): string {
 return execFileSync('docker', ['exec', 'jenkins', 'docker', ...args], { encoding: 'utf8', timeout: 1200000, maxBuffer: 30000000 }).trim();
}
class OfflineScan implements SecurityArtifactValidator {
 constructor(private readonly run: number) {}
 inspect(workspace: string): SecurityArtifactScan {
  const sourceDigest = trackedSourceDigest(workspace);
  assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: workspace, encoding: 'utf8' }).trim(), sha);
  if (fs.readFileSync(path.join(workspace, 'pom.xml'), 'utf8') === basePom)
   return { mode: 'TRIVY_IMAGE_ARCHIVE', sourceDigest, artifactDigest: baseline.Metadata.ImageID.replace('sha256:', ''),
    reportDigest: digest(JSON.stringify(baseline)), buildPassed: true, scannerVersion: '0.72.0 retained build 149', report: baseline };
  const dir = path.join(output, 'run-' + this.run); fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(path.join(workspace, 'pom.xml'), path.join(dir, 'candidate.pom.xml'));
  const tag = 'wf6-v17-offline:proof-' + this.run;
  // The audit build injects a local cache instead of downloading it. The
  // package goal and the entire runtime stage remain the exact-SHA contract.
  // This Dockerfile is an audit input, never a candidate repository edit.
  const buildContext = path.join(dir, 'build-context');
  fs.mkdirSync(buildContext, { recursive: true });
  fs.cpSync(path.join(workspace, 'src'), path.join(buildContext, 'src'), { recursive: true });
  fs.copyFileSync(path.join(workspace, 'pom.xml'), path.join(buildContext, 'pom.xml'));
  fs.cpSync(offlineMavenCache, path.join(buildContext, 'offline-m2'), { recursive: true });
  const dockerfile = fs.readFileSync(path.join(workspace, 'Dockerfile'), 'utf8');
  assert.equal(dockerfile.split('RUN mvn dependency:go-offline -B').length, 2);
  assert.equal(dockerfile.split('RUN mvn clean package -DskipTests -B').length, 2);
  const offlineDockerfile = dockerfile.replace('RUN mvn dependency:go-offline -B', 'COPY offline-m2 /root/.m2/repository')
    .replace('RUN mvn clean package -DskipTests -B', 'RUN mvn -o clean package -DskipTests -B');
  fs.writeFileSync(path.join(buildContext, 'Dockerfile'), offlineDockerfile);
  fs.writeFileSync(path.join(dir, 'audit.Dockerfile'), offlineDockerfile);
  const context = execFileSync('tar', ['-C', buildContext, '-cf', '-', '.'], { maxBuffer: 512 * 1024 * 1024 });
  const log = fs.openSync(path.join(dir, 'image-build.log'), 'w');
  try { execFileSync('docker', ['exec', '-i', 'jenkins', 'docker', 'build', '--network=none', '--pull=false', '--progress=plain', '-t', tag, '-'],
   { input: context, timeout: 1200000, maxBuffer: 30000000, stdio: ['pipe', log, log] }); } finally { fs.closeSync(log); }
  const jdir = '/tmp/wf6-v17-offline-proof-' + this.run;
  execFileSync('docker', ['exec', 'jenkins', 'mkdir', '-p', jdir]);
  docker(['save', tag, '-o', jdir + '/image.tar']);
  const cid = docker(['create', '--network', 'none', '-v', 'trivy-cache:/root/.cache', '--entrypoint', 'sh', 'aquasec/trivy:latest', '-c', 'sleep 1800']);
  let report: any, version: string;
  try {
   docker(['start', cid]); docker(['cp', jdir + '/image.tar', cid + ':/image.tar']);
   version = docker(['exec', cid, 'trivy', '--version']);
   // All severities. Scanner cwd contains no repository ignore/config files.
   fs.writeFileSync(path.join(dir, 'trivy.log'), docker(['exec', cid, 'trivy', 'image', '--input', '/image.tar', '--scanners', 'vuln,misconfig',
    '--skip-db-update', '--skip-java-db-update', '--skip-check-update', '--skip-version-check', '--offline-scan', '--list-all-pkgs', '--exit-code', '0', '--format', 'json', '--no-progress',
    '--timeout', '20m', '--output', '/report.json']));
   docker(['cp', cid + ':/report.json', jdir + '/report.json']);
   execFileSync('docker', ['cp', 'jenkins:' + jdir + '/report.json', path.join(dir, 'trivy-report.json')]);
   report = JSON.parse(fs.readFileSync(path.join(dir, 'trivy-report.json'), 'utf8'));
  } finally { docker(['stop', cid]); }
  assert.equal(trackedSourceDigest(workspace), sourceDigest);
  const imageId = docker(['image', 'inspect', tag, '--format', '{{.Id}}']).replace('sha256:', '');
  fs.writeFileSync(path.join(dir, 'scanner-version.txt'), version);
  return { mode: 'TRIVY_IMAGE_ARCHIVE', sourceDigest, artifactDigest: imageId, reportDigest: digest(JSON.stringify(report)), scannerVersion: version, buildPassed: true, report };
 }
}
const hashes: string[] = [];
class EvidenceMaven extends MavenBuildAdapter {
 private sequence = 0;
 constructor(private readonly directory: string) { super(); fs.mkdirSync(directory, { recursive: true }); }
 dependencyTree(w: string) {
  const r = super.dependencyTree(w);
  const prefix = path.join(this.directory, String(++this.sequence).padStart(2, '0'));
  fs.writeFileSync(prefix + '.pom.xml', fs.readFileSync(path.join(w, 'pom.xml')));
  fs.writeFileSync(prefix + '.tree.txt', r.text ?? r.evidenceTail);
  return r;
 }
 effectivePom(w: string) {
  const r = super.effectivePom(w);
  fs.writeFileSync(path.join(this.directory, String(this.sequence).padStart(2, '0') + '.effective.xml'), r.text ?? r.evidenceTail);
  return r;
 }
 packageCandidate(w: string) {
  const r = super.packageCandidate(w);
  fs.writeFileSync(path.join(this.directory, 'package.log'), r.evidenceTail);
  return r;
 }
}
for (const run of [1, 2]) {
 const wm = new WorkspaceManager(path.join(output, 'workspaces-' + run)), cache: any = { ensureRepo: () => repo }, maven = new EvidenceMaven(path.join(output, 'maven-' + run));
 const service = new SecurityFindingDecisionService(new GroundedMavenProvenanceService(wm, cache, maven));
 const result = new SecurityRemediationOrchestratorService(service, wm, cache, maven, new OfflineScan(run)).orchestrate({
  finding: { findingIdentity: 'a37e178f7ce1805b0b1b0e8ac2d41d20333041c26b4e88490f8af4e9885b7cf2', cveId: 'CVE-2023-6378',
   source: 'TRIVY', package: 'ch.qos.logback:logback-classic', expectedInstalledVersion: '1.2.11', fixedVersion: '1.3.12, 1.4.12, 1.2.13' },
  repository: 'souhaiel11/pfe-app-test', candidateBaseSha: sha, requestId: 'v17-offline-proof', batchId: 'security-closure', candidateAttempt: 0,
 });
 fs.writeFileSync(path.join(output, 'result-' + run + '.json'), JSON.stringify(result, null, 2));
 assert.equal(result.status, 'CANDIDATE_READY', result.reason);
 assert.equal(result.decision.remediationScope!.controls.length, 2);
 assert.equal(result.securityValidationEvidence!.targetCveMatchCount, 0);
 const artifact = JSON.stringify({ candidateIdentity: result.candidateIdentity, remediationScope: result.decision.remediationScope, candidateManifest: result.candidateManifest });
 fs.writeFileSync(path.join(output, 'candidate-artifact-' + run + '.json'), artifact);
 hashes.push(digest(artifact));
 console.log(JSON.stringify({ run, status: result.status, hash: hashes[run - 1], identity: result.candidateIdentity, closure: result.securityValidationEvidence }));
}
assert.equal(hashes[0], hashes[1]);
fs.writeFileSync(path.join(output, 'determinism.json'), JSON.stringify({ hashes, identical: true }, null, 2));
