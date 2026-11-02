// Teste le composant « owner-discovery-trial » et ses cas d’erreur.
import { strict as assert } from 'assert';
import { readFileSync, mkdtempSync, rmSync, cpSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { extractResolvedVersion, runOwnerDiscoveryTrial } from './owner-discovery-trial';

const FIXTURES = join(__dirname, 'fixtures');
const realTreeAfterParentBump = readFileSync(join(FIXTURES, 'pfe-app-test.dependency-tree.parent-2.7.18-trial.real.txt'), 'utf8');

// 1. Real H2 resolution after the real Spring Boot 2.7.0 -> 2.7.18 parent bump.
{
  const resolved = extractResolvedVersion(realTreeAfterParentBump, 'com.h2database:h2');
  assert.equal(resolved, '2.1.214', 'real captured evidence: parent 2.7.18 resolves h2 to 2.1.214 (was 2.1.212 at parent 2.7.0)');
}
console.log('1. extractResolvedVersion(h2) on the real post-bump dependency:tree -> 2.1.214: PASS');

// 2. Real spring-web resolution after the same real bump -- proves resolution changed, NOT that it reaches the security target (5.3.33) by itself (Phase 7's own point).
{
  const resolved = extractResolvedVersion(realTreeAfterParentBump, 'org.springframework:spring-web');
  assert.equal(resolved, '5.3.31');
  assert.notEqual(resolved, '5.3.33', 'real evidence: the parent-only bump to 2.7.18 resolves spring-web to 5.3.31, short of the CVE-2024-22259 security target 5.3.33 -- never assumed closed from version-number proximity alone');
}
console.log('2. real spring-web resolution after the parent bump (5.3.31, short of the 5.3.33 security target): PASS');

// 3. A coordinate absent from the tree text returns null, never a guess.
{
  assert.equal(extractResolvedVersion(realTreeAfterParentBump, 'com.example:does-not-exist'), null);
  assert.equal(extractResolvedVersion('', 'com.h2database:h2'), null);
}
console.log('3. absent/empty tree text -> null, never fabricated: PASS');

// ── LIVE (real mvn, real scratch checkout of pfe-app-test) ──────────────
{
  const sourceRepo = process.env.SECURITY_TEST_REPO || '/home/souhaiel/pfe-2026/pfe-app-test';
  if (existsSync(sourceRepo) && existsSync(join(sourceRepo, 'pom.xml'))) {
    const scratch = mkdtempSync(join(tmpdir(), 'owner-discovery-trial-'));
    try {
      cpSync(sourceRepo, scratch, { recursive: true, 
      /** Retient les éléments qui respectent le filtre. */
      filter: (src) => !src.includes(`${sourceRepo}/.git`) });
      const plan = { editType: 'PARENT_VERSION' as const, editCoordinate: 'org.springframework.boot:spring-boot-starter-parent', vulnerableDependency: 'com.h2database:h2', fromVersion: '2.7.0' };
      const result = runOwnerDiscoveryTrial({ workspacePath: scratch, pomRelativePath: 'pom.xml', plan, ownerCandidateVersion: '2.7.18', timeoutMs: 120000 });
      assert.equal(result.status, 'RESOLVED', JSON.stringify(result.evidence));
      assert.equal(result.resolvedVulnerableVersion, '2.1.214');
      assert.equal(result.ownerFromVersion, '2.7.0');
      assert.equal(result.ownerToVersion, '2.7.18');
      // The trial must restore the worktree's pom.xml afterward.
      const restoredPom = readFileSync(join(scratch, 'pom.xml'), 'utf8');
      assert.ok(restoredPom.includes('<version>2.7.0</version>'), 'pom.xml must be restored to its original content after the trial');
      console.log(`4. LIVE runOwnerDiscoveryTrial (real scratch checkout, real mvn dependency:tree): h2 2.7.0-owner -> resolves ${result.resolvedVulnerableVersion} at owner 2.7.18, worktree restored — PASS`);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  } else {
    console.log('4. no local pfe-app-test checkout found in this environment -- LIVE section skipped (not a failure).');
  }
}

console.log('owner-discovery-trial.spec.ts: ALL CHECKS PASS');
