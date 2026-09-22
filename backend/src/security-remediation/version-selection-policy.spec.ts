import * as assert from 'node:assert/strict';
import { compareVersions, parseVersion, selectEligibleTargetVersion } from './version-selection-policy';

// ── parseVersion ────────────────────────────────────────────────────────
{
  assert.deepEqual(parseVersion('9.0.63'), { raw: '9.0.63', numericSegments: [9, 0, 63], qualifier: '' });
  assert.deepEqual(parseVersion('4.1.86.Final'), { raw: '4.1.86.Final', numericSegments: [4, 1, 86], qualifier: '.Final' });
  assert.equal(parseVersion('not-a-version'), null, 'no leading digit -> unparseable, never guessed');
  assert.equal(parseVersion(''), null);
  assert.equal(parseVersion(null), null);
}
console.log('version-selection-policy parseVersion: PASS');

// ── compareVersions ─────────────────────────────────────────────────────
{
  assert.ok(compareVersions(parseVersion('9.0.99')!, parseVersion('9.0.63')!) > 0);
  assert.ok(compareVersions(parseVersion('9.0.63')!, parseVersion('9.0.99')!) < 0);
  assert.equal(compareVersions(parseVersion('9.0.63')!, parseVersion('9.0.63')!), 0);
  assert.ok(compareVersions(parseVersion('9.2')!, parseVersion('9.10')!) < 0, '9.2 < 9.10 numerically, never a lexical "9.2" > "9.10" string-compare bug');
}
console.log('version-selection-policy compareVersions: PASS');

// ============================================================================
// Section 5 worked examples, verbatim from the task.
// ============================================================================

// 9.0.63 + [9.0.99, 10.1.35] -> 9.0.99
{
  const result = selectEligibleTargetVersion('9.0.63', ['9.0.99', '10.1.35']);
  assert.equal(result.eligibleTargetVersion, '9.0.99');
  assert.equal(result.reason, 'SELECTED');
}
console.log('version-selection-policy: 9.0.63 + [9.0.99, 10.1.35] -> 9.0.99: PASS');

// 9.0.63 + [10.1.35, 11.0.3] -> null / CROSS_MAJOR_ONLY
{
  const result = selectEligibleTargetVersion('9.0.63', ['10.1.35', '11.0.3']);
  assert.equal(result.eligibleTargetVersion, null);
  assert.equal(result.reason, 'CROSS_MAJOR_ONLY');
}
console.log('version-selection-policy: 9.0.63 + [10.1.35, 11.0.3] -> null/CROSS_MAJOR_ONLY: PASS');

// ============================================================================
// L. multiple fixed versions -> lowest safe same-major selected. REAL
// persisted example: pfe-app-test, CVE-2023-6378, ch.qos.logback:logback-
// classic, installed 1.2.11 (matches the real pom.xml's literal <version>),
// fixedVersion "1.3.12, 1.4.12, 1.2.13" (all technically major=1 -- logback's
// own versioning quirk, not a test artifact).
// ============================================================================
{
  const result = selectEligibleTargetVersion('1.2.11', ['1.3.12', '1.4.12', '1.2.13']);
  assert.equal(result.eligibleTargetVersion, '1.2.13', 'L: the LOWEST same-major candidate (1.2.13), not the first-listed (1.3.12) nor the highest (1.4.12)');
  assert.equal(result.reason, 'SELECTED');
}
console.log('version-selection-policy L) REAL multi-fixed-version fixture -> lowest same-major (1.2.13): PASS');

// ── G/H/I: missing/malformed inputs fail closed ─────────────────────────
{
  assert.equal(selectEligibleTargetVersion('9.0.63', []).reason, 'NO_FIXED_VERSIONS', 'H: no fixed versions -> not eligible');
  assert.equal(selectEligibleTargetVersion(null, ['9.0.99']).reason, 'INSTALLED_VERSION_UNPARSEABLE', 'G: missing installed version -> not eligible');
  assert.equal(selectEligibleTargetVersion('not-a-version', ['9.0.99']).reason, 'INSTALLED_VERSION_UNPARSEABLE', 'I: malformed installed version -> fail closed, never guessed');
  assert.equal(selectEligibleTargetVersion('9.0.63', ['also-not-a-version']).reason, 'NO_PARSEABLE_FIXED_VERSION', 'I: malformed fixed version -> fail closed');
  assert.equal(selectEligibleTargetVersion('9.0.63', ['9.0.10']).reason, 'NO_SAME_MAJOR_CANDIDATE', 'a same-major candidate that is NOT greater than installed is correctly excluded');
}
console.log('version-selection-policy G/H/I) missing/malformed inputs fail closed: PASS');

console.log('version-selection-policy.spec.ts: ALL CHECKS PASS');
