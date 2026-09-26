/** V1.7 Blocker B measurement runner: REAL grounding + real Maven
 * scope-evidence control experiments + real patch application/guard + REAL
 * `mvn clean package` build, run N times end to end against a local
 * exact-SHA fixture. Only the two Trivy/Podman inspect() calls are
 * substituted with the retained fixture scan report -- Blocker A (see
 * n8n-workflows/WF6-V1_7-RUNTIME-INTEGRATION-AUDIT.md) means rootless
 * Podman cannot initialize in this environment, so those two stages cannot
 * be measured for real here; every other phase in this run IS real,
 * unmocked work (real git worktrees, real `mvn`, real filesystem I/O).
 * Never imported by the server/spec suite; a throwaway measurement runner,
 * not a correctness test (see security-remediation-orchestrator.spec.ts /
 * .deadline.spec.ts for those). Never starts the app, touches Jenkins,
 * writes GitHub/platform state, or performs any live/commit/push action.
 * Usage: localExactShaRepo outputDirectory [runs=5]
 */
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { execFileSync } from 'child_process';
import { WorkspaceManager } from '../src/workspace-manager.service';
import { RepoCacheService } from '../src/repo-cache.service';
import { MavenBuildAdapter } from '../src/maven-build-adapter';
import { GroundedMavenProvenanceService } from '../src/grounded-maven-provenance.service';
import { SecurityFindingDecisionService } from '../src/security-finding-decision.service';
import { SecurityRemediationOrchestratorService } from '../src/security-remediation-orchestrator.service';
import { trackedSourceDigest, SecurityArtifactScan } from '../src/security-artifact-validator';

const [localRepo, output, runsArg] = process.argv.slice(2);
if (!localRepo || !output) throw Error('Expected localRepo outputDirectory [runs=5]');
const runs = Number(runsArg || '5');
fs.mkdirSync(output, { recursive: true });
const cacheRoot = path.join(output, 'repos'), cached = path.join(cacheRoot, 'souhaiel11__pfe-app-test');
fs.mkdirSync(cacheRoot, { recursive: true });
if (!fs.existsSync(cached)) execFileSync('git', ['clone', '--no-hardlinks', path.resolve(localRepo), cached], { stdio: 'pipe' });
const origin = execFileSync('git', ['-C', cached, 'remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim();
if (origin !== path.resolve(localRepo)) throw Error('LOCAL_ORIGIN_REQUIRED');

const f = JSON.parse(fs.readFileSync(path.join(__dirname, '../../backend/src/security-remediation/fixtures/v17/logback.json'), 'utf8'));
function variant(w: string) {
  const s = fs.readFileSync(path.join(w, 'pom.xml'), 'utf8');
  if (s === f.source) return { source: f.source, tree: f.baseTree, effective: f.baseEffective };
  for (const k of ['v16', 'property-only', 'coordinated']) if (s === f[k].source) return f[k];
  throw new Error('UNEXPECTED_SOURCE');
}
function scan(w: string): SecurityArtifactScan {
  const v = variant(w), r = JSON.parse(JSON.stringify(v.source === f.source ? f.baseReport : v.source === f.coordinated.source ? f.coordinatedReport : f.v16Report));
  return { mode: 'TRIVY_IMAGE_ARCHIVE', sourceDigest: trackedSourceDigest(w), artifactDigest: 'b'.repeat(64),
    reportDigest: createHash('sha256').update(JSON.stringify(r)).digest('hex'), scannerVersion: 'RETAINED_FIXTURE_NOT_LIVE_SCAN', report: r, buildPassed: true };
}

const results: any[] = [];
for (let i = 0; i < runs; i++) {
  const runOutput = path.join(output, 'run-' + i);
  const wm = new WorkspaceManager(path.join(runOutput, 'workspaces')), cache = new RepoCacheService(cacheRoot), maven = new MavenBuildAdapter();
  const decisions = new SecurityFindingDecisionService(new GroundedMavenProvenanceService(wm, cache, maven));
  const worker = new SecurityRemediationOrchestratorService(decisions, wm, cache, maven, { inspect: scan });
  const started = Date.now();
  const result = worker.orchestrate({
    finding: { findingIdentity: 'a37e178f7ce1805b0b1b0e8ac2d41d20333041c26b4e88490f8af4e9885b7cf2', cveId: 'CVE-2023-6378',
      source: 'TRIVY', package: 'ch.qos.logback:logback-classic', expectedInstalledVersion: '1.2.11', fixedVersion: '1.3.12, 1.4.12, 1.2.13' },
    repository: 'souhaiel11/pfe-app-test', candidateBaseSha: '7ae0f954f99628b69ce9b42f42c1e2acc8568d99',
    requestId: 'v17-measure-' + i, batchId: 'phase-measurement', candidateAttempt: 0,
  });
  const wallMs = Date.now() - started;
  const entry = { run: i, status: result.status, reason: result.reason, wallMs, executionTimings: result.executionTimings };
  results.push(entry);
  console.log(JSON.stringify(entry));
}
fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2));

function pct(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}
const totals = results.map(r => r.wallMs);
const summary = {
  runs: results.length,
  allCandidateReady: results.every(r => r.status === 'CANDIDATE_READY'),
  P50_MS: pct(totals, 50), P95_MS: pct(totals, 95), MAX_MS: Math.max(...totals), MIN_MS: Math.min(...totals),
};
console.log(JSON.stringify(summary, null, 2));
fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify(summary, null, 2));
if (!summary.allCandidateReady) process.exitCode = 2;
