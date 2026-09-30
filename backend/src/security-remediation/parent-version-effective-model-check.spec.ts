import * as assert from 'node:assert/strict';
import { verifyParentUpgradeEffectiveVersions } from './parent-version-effective-model-check';

const REAL_TREE_FRAGMENT = [
  'com.example:pfe-app-test:jar:1.0.0',
  '+- com.fasterxml.jackson.core:jackson-databind:jar:2.13.5:compile',
  '+- org.apache.tomcat.embed:tomcat-embed-core:jar:9.0.83:compile',
  '\\- org.springframework.security:spring-security-config:jar:5.7.11:compile',
].join('\n');

// A. every affected dependency resolves to exactly the version V1.8 expected -> PASS.
{
  const result = verifyParentUpgradeEffectiveVersions(REAL_TREE_FRAGMENT, [
    { package: 'com.fasterxml.jackson.core:jackson-databind', expectedVersion: '2.13.5' },
    { package: 'org.apache.tomcat.embed:tomcat-embed-core', expectedVersion: '9.0.83' },
    { package: 'org.springframework.security:spring-security-config', expectedVersion: '5.7.11' },
  ]);
  assert.equal(result.ok, true, `A: ${JSON.stringify(result)}`);
}
console.log('parent-version-effective-model-check A) every affected dependency resolves to the expected version: PASS');

// B. one dependency resolved to a DIFFERENT version than V1.8 expected (e.g.
// a closer dependencyManagement entry pinned it) -> fail closed, named.
{
  const result = verifyParentUpgradeEffectiveVersions(REAL_TREE_FRAGMENT, [
    { package: 'com.fasterxml.jackson.core:jackson-databind', expectedVersion: '2.99.0' },
  ]);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, 'DEPENDENCY_VERSION_MISMATCH');
}
console.log('parent-version-effective-model-check B) dependency resolved to a different version -> fail closed: PASS');

// C. a dependency V1.8 expects to be present/affected is entirely ABSENT
// from the real candidate tree -- never inferred as "must be fine".
{
  const result = verifyParentUpgradeEffectiveVersions(REAL_TREE_FRAGMENT, [
    { package: 'com.nonexistent:never-there', expectedVersion: '1.0.0' },
  ]);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, 'DEPENDENCY_NOT_PRESENT_IN_CANDIDATE_TREE');
}
console.log('parent-version-effective-model-check C) expected dependency absent from candidate tree -> fail closed: PASS');

// D. empty/malformed dependency tree -> fail closed, never silently passes.
{
  const result = verifyParentUpgradeEffectiveVersions('not a dependency tree at all', [
    { package: 'com.fasterxml.jackson.core:jackson-databind', expectedVersion: '2.13.5' },
  ]);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, 'EMPTY_OR_MALFORMED_DEPENDENCY_TREE');
}
console.log('parent-version-effective-model-check D) malformed/empty dependency tree -> fail closed: PASS');

console.log('parent-version-effective-model-check.spec.ts: ALL CHECKS PASS');
