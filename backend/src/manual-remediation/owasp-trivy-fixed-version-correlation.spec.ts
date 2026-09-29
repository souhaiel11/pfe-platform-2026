// OWASP Increment 3 — pure correlation logic tests (§8 of the increment
// instructions). Integration against real report #149 data (both scanner
// blocks, task snapshots, WF6 input contract) lives in
// owasp-trivy-fixed-version-correlation.integration.spec.ts.
import { strict as assert } from 'assert';
import {
  buildTrivyFixedVersionIndex, qualifyOwaspFixedVersionCorrelation, resolveOwaspFixedVersion,
  classifyFixedVersionFormat, parseFixedVersionCandidates,
} from './owasp-trivy-fixed-version-correlation';

const KEY = { cve: 'CVE-2023-6378', pkg: 'ch.qos.logback:logback-classic', installedVersion: '1.2.11' };

// 1. exact CVE + Maven coords + installedVersion + single Trivy FixedVersion -> enrichment PASS
{
  const index = buildTrivyFixedVersionIndex([{ id: KEY.cve, pkg: KEY.pkg, installedVersion: KEY.installedVersion, fixedVersion: '1.2.13' }]);
  const q = qualifyOwaspFixedVersionCorrelation(KEY, index);
  assert.equal(q.kind, 'SINGLE_EXACT');
  assert.equal((q as any).fixedVersion, '1.2.13');
  const resolved = resolveOwaspFixedVersion(null, null, q);
  assert.equal(resolved.fixedVersion, '1.2.13');
  assert.equal(resolved.fixedVersionSource, 'TRIVY_CORRELATED');
  assert.equal(resolved.fixedVersionEvidence.source, 'TRIVY');
  assert.equal(resolved.fixedVersionEvidence.match, 'CVE_MAVEN_INSTALLED_VERSION');
}
console.log('1. exact key + single Trivy FixedVersion -> enriched: PASS');

// 2. même CVE, autre artifact -> NO MATCH
{
  const index = buildTrivyFixedVersionIndex([{ id: KEY.cve, pkg: 'com.example:other', installedVersion: KEY.installedVersion, fixedVersion: '9.9.9' }]);
  const q = qualifyOwaspFixedVersionCorrelation(KEY, index);
  assert.equal(q.kind, 'NO_MATCH');
  assert.equal(resolveOwaspFixedVersion(null, null, q).fixedVersion, null);
}
console.log('2. same CVE, different artifact -> NO_MATCH: PASS');

// 3. même CVE + artifact, autre installedVersion -> NO MATCH
{
  const index = buildTrivyFixedVersionIndex([{ id: KEY.cve, pkg: KEY.pkg, installedVersion: '9.0.0', fixedVersion: '9.9.9' }]);
  const q = qualifyOwaspFixedVersionCorrelation(KEY, index);
  assert.equal(q.kind, 'NO_MATCH');
}
console.log('3. same CVE + artifact, different installedVersion -> NO_MATCH: PASS');

// 4. même clé, deux Trivy rows, même FixedVersion -> PASS
{
  const index = buildTrivyFixedVersionIndex([
    { id: KEY.cve, pkg: KEY.pkg, installedVersion: KEY.installedVersion, fixedVersion: '1.2.13' },
    { id: KEY.cve, pkg: KEY.pkg, installedVersion: KEY.installedVersion, fixedVersion: '1.2.13' },
  ]);
  const q = qualifyOwaspFixedVersionCorrelation(KEY, index);
  assert.equal(q.kind, 'SINGLE_EXACT');
  assert.equal((q as any).matchCount, 2);
  assert.equal((q as any).fixedVersion, '1.2.13');
}
console.log('4. two Trivy rows, same key, same FixedVersion -> PASS (matchCount=2): PASS');

// 5. même clé, deux FixedVersion différentes -> AMBIGUOUS / no enrichment
{
  const index = buildTrivyFixedVersionIndex([
    { id: KEY.cve, pkg: KEY.pkg, installedVersion: KEY.installedVersion, fixedVersion: '1.2.13' },
    { id: KEY.cve, pkg: KEY.pkg, installedVersion: KEY.installedVersion, fixedVersion: '1.2.14' },
  ]);
  const q = qualifyOwaspFixedVersionCorrelation(KEY, index);
  assert.equal(q.kind, 'AMBIGUOUS');
  assert.deepEqual([...(q as any).distinctValues].sort(), ['1.2.13', '1.2.14']);
  assert.equal(resolveOwaspFixedVersion(null, null, q).fixedVersion, null, 'never picks arbitrarily between ambiguous candidates');
}
console.log('5. two Trivy rows, same key, different FixedVersion -> AMBIGUOUS, no enrichment: PASS');

// 6. FixedVersion vide -> no enrichment
{
  const index = buildTrivyFixedVersionIndex([{ id: KEY.cve, pkg: KEY.pkg, installedVersion: KEY.installedVersion, fixedVersion: '' }]);
  const q = qualifyOwaspFixedVersionCorrelation(KEY, index);
  assert.equal(q.kind, 'NO_TARGET');
  assert.equal(resolveOwaspFixedVersion(null, null, q).fixedVersion, null);
}
console.log('6. empty FixedVersion -> NO_TARGET, no enrichment: PASS');

// 7. FixedVersion multiple/non supportée -> no enrichment (never picks "the first")
{
  const index = buildTrivyFixedVersionIndex([{ id: KEY.cve, pkg: KEY.pkg, installedVersion: KEY.installedVersion, fixedVersion: '1.3.12, 1.4.12, 1.2.13' }]);
  const q = qualifyOwaspFixedVersionCorrelation(KEY, index);
  assert.equal(q.kind, 'UNSUPPORTED_FORMAT');
  assert.equal((q as any).format, 'MULTIPLE_CANDIDATES');
  assert.equal(resolveOwaspFixedVersion(null, null, q).fixedVersion, null);

  const rangeIndex = buildTrivyFixedVersionIndex([{ id: KEY.cve, pkg: KEY.pkg, installedVersion: KEY.installedVersion, fixedVersion: '[1.2.0]' }]);
  const rangeQ = qualifyOwaspFixedVersionCorrelation(KEY, rangeIndex);
  assert.equal(rangeQ.kind, 'UNSUPPORTED_FORMAT');
  assert.equal((rangeQ as any).format, 'RANGE_OR_UNSUPPORTED');
}
console.log('7. multi-value / range FixedVersion -> UNSUPPORTED_FORMAT, no enrichment, never "first": PASS');

// 10. native OWASP fixedVersion non vide -> ne pas écraser (order 1 beats a proven correlation)
{
  const index = buildTrivyFixedVersionIndex([{ id: KEY.cve, pkg: KEY.pkg, installedVersion: KEY.installedVersion, fixedVersion: '1.2.13' }]);
  const q = qualifyOwaspFixedVersionCorrelation(KEY, index);
  const resolved = resolveOwaspFixedVersion('7.0.0-hypothetical-native', null, q);
  assert.equal(resolved.fixedVersion, '7.0.0-hypothetical-native');
  assert.equal(resolved.fixedVersionSource, null, 'a native value is never tagged as Trivy-correlated');
}
console.log('10. native OWASP fixedVersion present -> never overwritten by a correlation: PASS');

// Order 2: an existing persisted value (native OR previously correlated) is
// never recomputed/flipped by a fresh (possibly different) correlation pass.
{
  const index = buildTrivyFixedVersionIndex([{ id: KEY.cve, pkg: KEY.pkg, installedVersion: KEY.installedVersion, fixedVersion: '1.2.99' }]);
  const q = qualifyOwaspFixedVersionCorrelation(KEY, index);

  const keptNative = resolveOwaspFixedVersion(null, { fixedVersion: '1.2.13' }, q);
  assert.equal(keptNative.fixedVersion, '1.2.13');
  assert.equal(keptNative.fixedVersionSource, null);

  const keptCorrelated = resolveOwaspFixedVersion(null, { fixedVersion: '1.2.13', fixedVersionSource: 'TRIVY_CORRELATED', fixedVersionEvidence: { source: 'TRIVY', match: 'CVE_MAVEN_INSTALLED_VERSION', trivyFixedVersionRaw: '1.2.13', trivyMatchCount: 1 } }, q);
  assert.equal(keptCorrelated.fixedVersion, '1.2.13');
  assert.equal(keptCorrelated.fixedVersionSource, 'TRIVY_CORRELATED', 'provenance preserved across re-syncs');
  assert.equal(keptCorrelated.fixedVersionEvidence.trivyFixedVersionRaw, '1.2.13');
}
console.log('order 2: existing persisted value (native or correlated) is never flipped by a fresh correlation: PASS');

// Maven identity is mandatory: no pkg / no installedVersion / non-Maven pkg shape -> NO_MATCH, never a guess.
{
  const index = buildTrivyFixedVersionIndex([{ id: KEY.cve, pkg: KEY.pkg, installedVersion: KEY.installedVersion, fixedVersion: '1.2.13' }]);
  assert.equal(qualifyOwaspFixedVersionCorrelation({ cve: KEY.cve, pkg: '', installedVersion: KEY.installedVersion }, index).kind, 'NO_MATCH');
  assert.equal(qualifyOwaspFixedVersionCorrelation({ cve: KEY.cve, pkg: KEY.pkg, installedVersion: '' }, index).kind, 'NO_MATCH');
  assert.equal(qualifyOwaspFixedVersionCorrelation({ cve: KEY.cve, pkg: 'not-a-maven-coordinate', installedVersion: KEY.installedVersion }, index).kind, 'NO_MATCH');
  // A Trivy row with no usable Maven identity is simply never indexed at all.
  const badIndex = buildTrivyFixedVersionIndex([{ id: KEY.cve, pkg: 'no-colon-here', installedVersion: KEY.installedVersion, fixedVersion: '1.2.13' }]);
  assert.equal(badIndex.size, 0);
}
console.log('Maven identity mandatory on both sides -> fail closed, never a guess: PASS');

// CVE matching is trim/case-normalized only; Maven coordinates are never case-folded.
{
  const index = buildTrivyFixedVersionIndex([{ id: '  cve-2023-6378 ', pkg: KEY.pkg, installedVersion: KEY.installedVersion, fixedVersion: '1.2.13' }]);
  assert.equal(qualifyOwaspFixedVersionCorrelation(KEY, index).kind, 'SINGLE_EXACT');
  const caseIndex = buildTrivyFixedVersionIndex([{ id: KEY.cve, pkg: 'CH.QOS.LOGBACK:LOGBACK-CLASSIC', installedVersion: KEY.installedVersion, fixedVersion: '1.2.13' }]);
  assert.equal(qualifyOwaspFixedVersionCorrelation(KEY, caseIndex).kind, 'NO_MATCH', 'Maven pkg case is never folded');
}
console.log('CVE trim/case-normalized, Maven pkg never case-folded: PASS');

assert.deepEqual(parseFixedVersionCandidates('1.3.12, 1.4.12, 1.2.13'), ['1.3.12', '1.4.12', '1.2.13']);
assert.deepEqual(parseFixedVersionCandidates(''), []);
assert.equal(classifyFixedVersionFormat(''), 'EMPTY');
assert.equal(classifyFixedVersionFormat('1.2.13'), 'SINGLE_EXACT_VERSION');
assert.equal(classifyFixedVersionFormat('1.2.13, 1.3.0'), 'MULTIPLE_CANDIDATES');
assert.equal(classifyFixedVersionFormat('[1.2.0]'), 'RANGE_OR_UNSUPPORTED');
assert.equal(classifyFixedVersionFormat('[1.2,2.0)'), 'MULTIPLE_CANDIDATES', 'a comma inside a range is still fail-closed, just via the multi-value path');
console.log('parseFixedVersionCandidates / classifyFixedVersionFormat unit checks: PASS');

console.log('owasp-trivy-fixed-version-correlation.spec.ts: ALL CHECKS PASS');
