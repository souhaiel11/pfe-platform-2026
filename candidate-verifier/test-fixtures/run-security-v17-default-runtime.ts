/** Local acceptance probe: default adapter, no retained scan, Docker fallback,
 * workflow, GitHub write, commit or deployment. */
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { WorkspaceManager } from '../src/workspace-manager.service';
import { RepoCacheService } from '../src/repo-cache.service';
import { MavenBuildAdapter } from '../src/maven-build-adapter';
import { GroundedMavenProvenanceService } from '../src/grounded-maven-provenance.service';
import { SecurityFindingDecisionService } from '../src/security-finding-decision.service';
import { SecurityRemediationOrchestratorService } from '../src/security-remediation-orchestrator.service';
const [localRepo, output] = process.argv.slice(2);
if (!localRepo || !output) throw Error('Expected localRepo outputDirectory');
fs.mkdirSync(output, { recursive: true });
const cacheRoot = path.join(output, 'repos'), cached = path.join(cacheRoot, 'souhaiel11__pfe-app-test');
fs.mkdirSync(cacheRoot, { recursive: true });
if (!fs.existsSync(cached)) execFileSync('git', ['clone', '--no-hardlinks', path.resolve(localRepo), cached], { stdio: 'pipe' });
const origin = execFileSync('git', ['-C', cached, 'remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim();
if (origin !== path.resolve(localRepo)) throw Error('LOCAL_ORIGIN_REQUIRED');
const wm = new WorkspaceManager(path.join(output, 'workspaces')), cache = new RepoCacheService(cacheRoot), maven = new MavenBuildAdapter();
const decisions = new SecurityFindingDecisionService(new GroundedMavenProvenanceService(wm, cache, maven));
const worker = new SecurityRemediationOrchestratorService(decisions, wm, cache, maven); // DEFAULT fifth argument
const result = worker.orchestrate({
 finding: { findingIdentity: 'a37e178f7ce1805b0b1b0e8ac2d41d20333041c26b4e88490f8af4e9885b7cf2', cveId: 'CVE-2023-6378',
  source: 'TRIVY', package: 'ch.qos.logback:logback-classic', expectedInstalledVersion: '1.2.11', fixedVersion: '1.3.12, 1.4.12, 1.2.13' },
 repository: 'souhaiel11/pfe-app-test', candidateBaseSha: '7ae0f954f99628b69ce9b42f42c1e2acc8568d99',
 requestId: 'v17-default-runtime', batchId: 'isolated-proof', candidateAttempt: 0,
});
const worktrees = execFileSync('git', ['-C', cached, 'worktree', 'list', '--porcelain'], { encoding: 'utf8' });
fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(result, null, 2));
fs.writeFileSync(path.join(output, 'worktrees-after.txt'), worktrees);
if (worktrees.includes(path.join(output, 'workspaces'))) throw Error('LEAKED_WORKSPACE');
console.log(JSON.stringify({status:result.status,reason:result.reason,executionTimings:result.executionTimings}));
if (result.status !== 'CANDIDATE_READY') process.exitCode = 2;
