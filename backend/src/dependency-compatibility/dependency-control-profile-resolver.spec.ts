// Teste le composant « dependency-control-profile-resolver » et ses cas d’erreur.
import { strict as assert } from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';
import { resolveDependencyControlProfile } from './dependency-control-profile-resolver';

const FIXTURES = join(__dirname, '../security-remediation/fixtures');
const pomXmlText = readFileSync(join(FIXTURES, 'pfe-app-test.pom.xml'), 'utf8');
const dependencyTreeText = readFileSync(join(FIXTURES, 'pfe-app-test.dependency-tree.txt'), 'utf8');
const common = { pomXmlText, dependencyTreeText, controllingFilePath: 'pom.xml', groundedSha: 'c0c21af'.padEnd(40, '0') };

// CASE 1 — SnakeYAML: real, known DIRECT_EXPLICIT remediation (CVE-2022-25857, 1.29 -> 1.31).
{
  const profile = resolveDependencyControlProfile({ ...common, package: 'org.yaml:snakeyaml', installedVersion: '1.29' });
  assert.equal(profile.versionControl, 'DIRECT_EXPLICIT');
  assert.equal(profile.dependencyKind, 'DIRECT');
  assert.equal(profile.declarationPom, 'pom.xml');
  assert.equal(profile.managementOwner, null);
  assert.equal(profile.javaVersion, '11');
  assert.equal(profile.springBootVersion, '2.7.0');
  assert.ok(profile.evidence.some(e => e.includes('snakeyaml')));
}
console.log('CASE 1 (SnakeYAML DIRECT_EXPLICIT): PASS');

// Spring Security core — DIRECT_EXPLICIT override, even though it's a Spring
// artifact that spring-boot-starter-parent would otherwise manage.
{
  const profile = resolveDependencyControlProfile({ ...common, package: 'org.springframework.security:spring-security-core', installedVersion: '5.6.4' });
  assert.equal(profile.versionControl, 'DIRECT_EXPLICIT', 'an explicit local <version> always wins, even for a Spring artifact');
}
console.log('spring-security-core DIRECT_EXPLICIT override (not BOM-attributed): PASS');

// CASE 2 — spring-boot-starter-web: a REAL depth-0 dependency declared in
// pfe-app-test's own <dependencies> with NO explicit <version> at all --
// its version is resolved entirely from the Spring Boot parent's own
// (transitively imported) dependency management. Must NOT be classified as
// something directly patchable, and must be attributed to the parent, never
// silently treated as if pfe-app-test pinned it itself.
{
  const profile = resolveDependencyControlProfile({ ...common, package: 'org.springframework.boot:spring-boot-starter-web', installedVersion: '2.7.0' });
  assert.notEqual(profile.versionControl, 'DIRECT_EXPLICIT', 'must never propose patching a parent-managed starter directly');
  assert.notEqual(profile.versionControl, 'PROPERTY');
  assert.equal(profile.versionControl, 'PARENT', 'pfe-app-test has no local <dependencyManagement>/imported BOM -- ownership traces to the spring-boot-starter-parent');
  assert.equal(profile.parentGroupId, 'org.springframework.boot');
  assert.equal(profile.parentArtifactId, 'spring-boot-starter-parent');
  assert.equal(profile.parentVersion, '2.7.0');
  assert.equal(profile.managementOwner, 'org.springframework.boot:spring-boot-starter-parent');
  assert.equal(profile.springBootVersion, '2.7.0');
}
console.log('CASE 2 (spring-boot-starter-web PARENT-managed, never direct): PASS');

// spring-core / spring-web -- real NESTED transitive dependencies (pulled in
// BY spring-security-core / spring-boot-starter-web respectively, depth >=
// 1 in dependency:tree). Per Phase 2 CASE E: never propose an arbitrary
// direct override, always TRANSITIVE_MANAGED -> MANUAL_REVIEW.
for (const pkg of ['org.springframework:spring-core', 'org.springframework:spring-web']) {
  const profile = resolveDependencyControlProfile({ ...common, package: pkg, installedVersion: '5.3.20' });
  assert.equal(profile.versionControl, 'TRANSITIVE_MANAGED', `${pkg} is nested under another dependency in the real tree, never a depth-0 entry`);
  assert.equal(profile.dependencyKind, 'TRANSITIVE');
}
console.log('spring-core/spring-web TRANSITIVE_MANAGED (real nested tree entries, CASE E): PASS');

console.log('dependency-control-profile-resolver.spec.ts: ALL CHECKS PASS');
