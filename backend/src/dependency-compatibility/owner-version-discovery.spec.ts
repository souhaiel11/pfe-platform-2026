// Teste le composant « owner-version-discovery » et ses cas d’erreur.
import { strict as assert } from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseVersionsFromMetadataXml, classifyOwnerVersions, resolveLocalRepositoryPath, discoverOwnerVersionCandidates } from './owner-version-discovery';

const FIXTURES = join(__dirname, 'fixtures');
const realMetadataXml = readFileSync(join(FIXTURES, 'spring-boot-starter-parent.maven-metadata-central.xml'), 'utf8');

// 1. Parses every real <version> entry from the real metadata file.
{
  const versions = parseVersionsFromMetadataXml(realMetadataXml);
  assert.ok(versions.length > 250, `expected the real metadata's full version list, got ${versions.length}`);
  assert.ok(versions.includes('2.7.0'));
  assert.ok(versions.includes('2.7.18'));
  assert.ok(versions.includes('3.1.5'));
  assert.ok(versions.includes('4.2.0-M2'));
}
console.log('1. parseVersionsFromMetadataXml extracts the real, full published version list: PASS');

// 2. classifyOwnerVersions on the REAL Spring Boot parent history from 2.7.0:
//    same-major candidates are bounded, ascending, minimal-safe-change-first;
//    cross-major (3.x/4.x) is evidence-only, never in sameMajorCandidates.
{
  const versions = parseVersionsFromMetadataXml(realMetadataXml);
  const { latestOverall, sameMajorCandidates, crossMajorEvidence } = classifyOwnerVersions('2.7.0', versions);
  assert.ok(sameMajorCandidates.every(c => c.policy.state === 'SAFE_SAME_LINE' || c.policy.state === 'SAFE_SAME_MAJOR'));
  assert.ok(sameMajorCandidates.every(c => c.version.startsWith('2.7.') || c.version.startsWith('2.')), 'same-major must never include a 3.x/4.x candidate');
  assert.ok(crossMajorEvidence.every(c => c.policy.state === 'CROSS_MAJOR'));
  assert.ok(sameMajorCandidates.length <= 5, 'bounded, never the whole history');
  assert.ok(crossMajorEvidence.length <= 2, 'bounded, never the whole history');
  // Ceiling-first (descending): the real 2.7.18 patch ceiling must be
  // candidate #1, never trimmed away by the bound.
  assert.equal(sameMajorCandidates[0]?.version, '2.7.18');
  for (let i = 1; i < sameMajorCandidates.length; i++) {
    assert.notEqual(require('./maven-qualifier-comparator').compareMavenVersions(sameMajorCandidates[i].version, sameMajorCandidates[i - 1].version), 1);
  }
  assert.equal(latestOverall?.version, '4.2.0-M2', 'the real metadata\'s own highest published version, kept as evidence only');
}
console.log('2. classifyOwnerVersions on the real Spring Boot parent history (2.7.0 -> 2.7.x same-major, 3.x/4.x evidence-only): PASS');

// 3. Same-major candidates cap respects an explicit smaller bound.
{
  const versions = parseVersionsFromMetadataXml(realMetadataXml);
  const { sameMajorCandidates } = classifyOwnerVersions('2.7.0', versions, { maxSameMajorCandidates: 2 });
  assert.equal(sameMajorCandidates.length, 2);
}
console.log('3. maxSameMajorCandidates bound is honored: PASS');

// 4. A version list containing only unparseable/non-upgrade entries yields
//    empty same-major/cross-major sets, never a guess.
{
  const { sameMajorCandidates, crossMajorEvidence, latestOverall } = classifyOwnerVersions('2.7.0', ['2.7.0', 'not-a-version', '1.0.0']);
  assert.equal(sameMajorCandidates.length, 0);
  assert.equal(crossMajorEvidence.length, 0);
  assert.equal(latestOverall, null);
}
console.log('4. no real upgrade candidate anywhere -> nothing fabricated: PASS');

// 5. Empty/garbage raw version list is handled without throwing.
{
  const result = classifyOwnerVersions('2.7.0', []);
  assert.equal(result.sameMajorCandidates.length, 0);
  assert.equal(result.latestOverall, null);
}
console.log('5. empty raw version list -> empty result, no throw: PASS');

// ── LIVE (real mvn, real local repository) ──────────────────────────────
// Only runs when a real Maven installation is present (this environment's
// own /usr/bin/mvn) -- skips cleanly otherwise rather than failing a
// developer machine that lacks Maven.
{
  const repoRoot = resolveLocalRepositoryPath(process.cwd());
  if (repoRoot) {
    console.log(`6. resolveLocalRepositoryPath (real mvn help:evaluate): ${repoRoot} — PASS`);
    const result = discoverOwnerVersionCandidates({
      groupId: 'org.springframework.boot', artifactId: 'spring-boot-starter-parent', currentVersion: '2.7.0', cwd: process.cwd(),
    });
    assert.equal(result.status, 'DISCOVERED', JSON.stringify(result.evidence));
    assert.ok(result.sameMajorCandidates.some(c => c.version === '2.7.18'), 'real repository metadata must surface the real 2.7.18 same-major ceiling');
    assert.ok(result.crossMajorEvidence.length > 0);
    console.log(`7. LIVE discoverOwnerVersionCandidates(spring-boot-starter-parent, 2.7.0): sameMajor=[${result.sameMajorCandidates.map(c => c.version).join(', ')}] crossMajorEvidence=[${result.crossMajorEvidence.map(c => c.version).join(', ')}] — PASS`);
  } else {
    console.log('6/7. no local Maven repository resolvable in this environment -- LIVE section skipped (not a failure).');
  }
}

console.log('owner-version-discovery.spec.ts: ALL CHECKS PASS');
