// Teste le refus d'une vulnérabilité déjà corrigée sur la branche par défaut (scan antérieur à la fusion).
import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { declaredPomVersion, assertNotAlreadyFixedOnDefaultBranch } from './default-branch-version-check';

const start = readFileSync(join(__dirname, '__fixtures__/pom-start.xml'), 'utf8');
const merged = start.replace('<version>2.1.212</version>', '<version>2.2.220</version>')
  .replace('<artifactId>gson</artifactId><version>2.8.5</version>', '<artifactId>gson</artifactId><version>2.8.9</version>');
const h2 = { ruleOrCve: 'CVE-2022-45868', findingSnapshot: { component: 'com.h2database:h2', currentVersion: '2.1.212' } };
const gson = { ruleOrCve: 'CVE-2022-25647', findingSnapshot: { component: 'com.google.code.gson:gson', currentVersion: '2.8.5' } };
const lang3 = { ruleOrCve: 'CVE-2025-48924', findingSnapshot: { component: 'org.apache.commons:commons-lang3', currentVersion: '3.12.0' } };

assert.equal(declaredPomVersion(start, 'com.h2database:h2'), '2.1.212', 'multi-line dependency');
assert.equal(declaredPomVersion(start, 'com.google.code.gson:gson'), '2.8.5', 'single-line dependency');
assert.equal(declaredPomVersion(start, 'org.apache.commons:commons-lang3'), '3.12.0', 'property-managed version resolved');
assert.equal(declaredPomVersion(start, 'org.ow2.asm:asm'), null, 'transitive dependency is not declared');

assert.doesNotThrow(() => assertNotAlreadyFixedOnDefaultBranch(start, [h2, gson, lang3]), 'start state: nothing fixed');
assert.throws(() => assertNotAlreadyFixedOnDefaultBranch(merged, [h2, lang3]), (e: any) => {
  const r = e.getResponse();
  assert.equal(r.code, 'SECURITY_FINDING_ALREADY_FIXED_ON_DEFAULT_BRANCH');
  assert.match(r.message, /h2 \(CVE-2022-45868\) est déjà en 2\.2\.220 sur main/);
  assert.doesNotMatch(r.message, /commons-lang3/);
  return true;
});
assert.doesNotThrow(() => assertNotAlreadyFixedOnDefaultBranch(merged, [lang3]), 'unaffected selection still launches');
console.log('default-branch-version-check.spec.ts: ALL CHECKS PASS');
