// Teste le composant « candidate-existence-checker » et ses cas d’erreur.
import { strict as assert } from 'assert';
import { existsSync } from 'fs';
import { MavenDependencyGetExistenceChecker } from './candidate-existence-checker';

const REAL_PROJECT_DIR = '/home/souhaiel/pfe-2026/pfe-app-test';
if (!existsSync(`${REAL_PROJECT_DIR}/pom.xml`)) {
  console.log('candidate-existence-checker.spec.ts: SKIPPED (real pfe-app-test checkout not present on this machine)');
  process.exit(0);
}

const checker = new MavenDependencyGetExistenceChecker(REAL_PROJECT_DIR, 60000, false);

// 1. Real, already-cached artifact (a direct dependency of the real
// project) -- must resolve AVAILABLE without needing live network.
{
  const result = checker.check('org.yaml', 'snakeyaml', '1.29');
  assert.equal(result.status, 'AVAILABLE');
  assert.equal(result.coordinate, 'org.yaml:snakeyaml:1.29');
}
console.log('1. real, already-cached artifact -> AVAILABLE: PASS');

// 2. The REAL secure target for CVE-2022-25857 (1.29 -> 1.31) -- proves this
// checker can confirm a genuinely proposed remediation candidate exists
// before it's ever allowed to reach sandbox validation.
{
  const result = checker.check('org.yaml', 'snakeyaml', '1.31');
  assert.equal(result.status, 'AVAILABLE', `expected the real CVE-2022-25857 target 1.31 to exist: ${result.detail}`);
}
console.log('2. real CVE-2022-25857 target (snakeyaml 1.31) -> AVAILABLE: PASS');

// 3. A version that genuinely does not exist -> UNAVAILABLE, never invented as available.
{
  const result = checker.check('org.yaml', 'snakeyaml', '99.99.99-does-not-exist');
  assert.equal(result.status, 'UNAVAILABLE');
  assert.ok(!/username|password|token/i.test(result.detail), 'detail must never leak credential-shaped text');
}
console.log('3. nonexistent version -> UNAVAILABLE: PASS');

// 4. Offline mode against an artifact never previously cached -> UNKNOWN_REPOSITORY_ACCESS, never fabricated either way.
{
  const offlineChecker = new MavenDependencyGetExistenceChecker(REAL_PROJECT_DIR, 30000, true);
  const result = offlineChecker.check('org.yaml', 'snakeyaml', '1.33.99-never-cached-offline-probe');
  assert.equal(result.status, 'UNKNOWN_REPOSITORY_ACCESS', `offline + never-cached must never resolve to AVAILABLE or UNAVAILABLE: ${result.detail}`);
}
console.log('4. offline mode, never-cached artifact -> UNKNOWN_REPOSITORY_ACCESS (never guessed): PASS');

console.log('candidate-existence-checker.spec.ts: ALL CHECKS PASS');
