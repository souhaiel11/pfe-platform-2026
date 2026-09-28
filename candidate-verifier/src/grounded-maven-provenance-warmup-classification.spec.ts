// Service contract test: deterministic workspace provider and real subprocess
// Maven stand-in. No external repository mutation, network or WF6 execution.
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GroundedMavenProvenanceService } from './grounded-maven-provenance.service';
import { WorkspaceManager } from './workspace-manager.service';
import { RepoCacheService } from './repo-cache.service';
import { MavenBuildAdapter } from './maven-build-adapter';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'option-b-service-'));
const bin = path.join(root, 'bin');
fs.mkdirSync(bin);
fs.writeFileSync(path.join(root, 'pom.xml'), '<project><modelVersion>4.0.0</modelVersion><groupId>com.example</groupId><artifactId>app</artifactId><version>1</version><dependencies><dependency><groupId>ch.qos.logback</groupId><artifactId>logback-classic</artifactId><version>1.2.11</version></dependency></dependencies></project>');
const sha = 'a'.repeat(40);
let cleanups = 0;
const workspace = {
  workspaceId: () => 'test',
  createWorkspace: () => ({ path: root, checkoutSha: sha, exactShaVerified: true }),
  cleanupWorkspace: () => { cleanups++; },
} as unknown as WorkspaceManager;
const repo = { ensureRepo: () => root } as unknown as RepoCacheService;
const service = new GroundedMavenProvenanceService(workspace, repo, new MavenBuildAdapter());
const originalPath = process.env.PATH;
const miss = 'Cannot access central (https://repo.maven.apache.org/maven2) in offline mode and the artifact com.example:missing:jar:2 has not been downloaded from it before.';
const goodTree = 'for a in "$@"; do case "$a" in -DoutputFile=*) printf "com.example:app:jar:1\\n\\\\- ch.qos.logback:logback-classic:jar:1.2.11:compile\\n" > "${a#-DoutputFile=}" ;; esac; done; echo TREE_CAPTURED; exit 0';
let count = 0;
try {
  process.env.PATH = `${bin}:${originalPath}`;
  for (const [warm, tree, expected] of [
    ['echo WARM_CAPTURED; exit 0', goodTree, undefined],
    ['echo WARM_TIMEOUT_CAPTURED; exec sleep 18.736', goodTree, undefined],
    ['echo WARM_TIMEOUT_CAPTURED; exec sleep 18.736', `echo '${miss}'; exit 1`, 'WARMUP_TIMEOUT'],
    ['echo "MDEP-82 plugin resolution failure"; exit 1', goodTree, undefined],
    ['echo "Connection reset by peer"; exit 1', `echo '${miss}'; exit 1`, 'WARMUP_NETWORK_FAILURE'],
    ['echo WARM_CAPTURED; exit 0', `echo '${miss}'; exit 1`, 'DEPENDENCY_NOT_IN_CACHE'],
    ['echo "Unexplained exit"; exit 1', `echo '${miss}'; exit 1`, 'WARMUP_FAILED'],
    ['echo WARM_CAPTURED; exit 0', 'echo "Invalid POM"; exit 1', 'DEPENDENCY_TREE_FAILED'],
  ]) {
    fs.writeFileSync(path.join(bin, 'mvn'), `#!/bin/sh\ncase "$*" in\n*dependency:go-offline*) ${warm} ;;\n*dependency:tree*) ${tree} ;;\nesac\n`, { mode: 0o755 });
    const result = service.resolve({ repository: 'test/repo', candidateBaseSha: sha, requestId: 'test', batchId: 'b', candidateAttempt: 0, package: 'ch.qos.logback:logback-classic', expectedInstalledVersion: '1.2.11', timeoutMs: 800 });
    assert.equal(result.ok, expected === undefined, JSON.stringify(result));
    if (result.ok === false) {
      assert.equal(result.failureClass, expected);
      if (expected!.startsWith('WARMUP_')) assert.equal(result.retryable, true);
      if (expected === 'DEPENDENCY_NOT_IN_CACHE') assert.ok(result.detail.includes('com.example:missing:jar:2'));
    }
    assert.ok(result.evidence.mavenResolution.baselineWarmup.evidenceTail.length > 0);
    assert.ok(result.evidence.mavenResolution.analysis.evidenceTail.length > 0);
    assert.ok(!('text' in result.evidence.mavenResolution.analysis));
    assert.equal(result.evidence.evaluatedSha, sha);
    count++;
  }
  assert.equal(cleanups, count);
  console.log(`grounded-maven-provenance-warmup-classification: PASS (${count} scenarios)`);
} finally {
  process.env.PATH = originalPath;
  fs.rmSync(root, { recursive: true, force: true });
}
