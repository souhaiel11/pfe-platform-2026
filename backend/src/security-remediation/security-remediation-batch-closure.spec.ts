import * as assert from 'node:assert/strict';
import { deriveBatchClosureVerdict, deriveCveClosureStatus, allVulnerabilityIds } from './security-remediation-batch-closure';
import { SecurityArtifactScan } from './security-artifact-scan';

// ============================================================================
// A. All target CVEs closed -> global CANDIDATE_READY-eligible verdict.
// ============================================================================
{
  const verdict = deriveBatchClosureVerdict(
    ['CVE-2023-6378', 'CVE-2020-36518'],
    ['CVE-2023-6378', 'CVE-2020-36518', 'CVE-UNRELATED-0001'], // baseline: both present, plus noise
    ['CVE-UNRELATED-0001'], // candidate: both targets gone, noise remains (irrelevant)
  );
  assert.equal(verdict.allClosed, true);
  assert.deepEqual(verdict.perCve, [{ cveId: 'CVE-2023-6378', status: 'CLOSED' }, { cveId: 'CVE-2020-36518', status: 'CLOSED' }]);
}
console.log('security-remediation-batch-closure A) all target CVEs closed -> allClosed=true, per-CVE CLOSED: PASS');

// ============================================================================
// B. ★ One CVE closed, one still open at scan -> tout-ou-rien: global
// verdict is NOT all-closed, but the per-CVE detail names exactly which
// one blocked the batch.
// ============================================================================
{
  const verdict = deriveBatchClosureVerdict(
    ['CVE-2023-6378', 'CVE-2020-36518'],
    ['CVE-2023-6378', 'CVE-2020-36518'],
    ['CVE-2020-36518'], // the version bump for this one was insufficient
  );
  assert.equal(verdict.allClosed, false);
  const byId = new Map(verdict.perCve.map(v => [v.cveId, v.status]));
  assert.equal(byId.get('CVE-2023-6378'), 'CLOSED');
  assert.equal(byId.get('CVE-2020-36518'), 'STILL_OPEN', 'B: the one that stayed open is named, not lumped into a generic failure');
}
console.log('security-remediation-batch-closure B) one CVE closed, one still open -> allClosed=false, exact CVE named: PASS');

// ============================================================================
// C. A target CVE never observed in the baseline scan at all -> NOT_OBSERVED,
// never silently reported CLOSED (never claim more than was proven).
// ============================================================================
{
  assert.equal(deriveCveClosureStatus('CVE-NEVER-SEEN', new Set(), new Set()), 'NOT_OBSERVED');
  assert.equal(deriveCveClosureStatus('CVE-NEVER-SEEN', new Set(['CVE-OTHER']), new Set()), 'NOT_OBSERVED');
}
console.log('security-remediation-batch-closure C) target CVE absent from baseline -> NOT_OBSERVED, never a false CLOSED claim: PASS');

// ============================================================================
// D. Still present in candidate scan even though also absent from
// baseline (shouldn't normally happen, but the function must not claim
// CLOSED) -> STILL_OPEN wins over NOT_OBSERVED.
// ============================================================================
{
  assert.equal(deriveCveClosureStatus('CVE-X', new Set(), new Set(['CVE-X'])), 'STILL_OPEN');
}
console.log('security-remediation-batch-closure D) present in candidate scan -> STILL_OPEN regardless of baseline: PASS');

// ============================================================================
// E. allVulnerabilityIds() — real Trivy-shaped report extraction, fail-closed.
// ============================================================================
{
  const scan: SecurityArtifactScan = {
    mode: 'TRIVY_IMAGE_ARCHIVE', sourceDigest: 'a'.repeat(64), artifactDigest: 'b'.repeat(64), reportDigest: 'c'.repeat(64),
    buildPassed: true, scannerVersion: 'unit-fixture',
    report: {
      SchemaVersion: 2, ArtifactType: 'container_image',
      Results: [
        { Target: 'app.jar', Vulnerabilities: [{ VulnerabilityID: 'CVE-2023-6378' }, { VulnerabilityID: 'CVE-2020-36518' }] },
        { Target: 'app.jar (extra)', Vulnerabilities: [{ VulnerabilityID: 'CVE-2023-6378' }] }, // duplicate across Results -> set collapses it
      ],
    },
  };
  const ids = allVulnerabilityIds(scan);
  assert.deepEqual([...ids].sort(), ['CVE-2020-36518', 'CVE-2023-6378']);

  assert.throws(() => allVulnerabilityIds({ ...scan, buildPassed: false }), /INCOMPLETE_SECURITY_SCAN/);
  assert.throws(() => allVulnerabilityIds({ ...scan, report: { ...scan.report, SchemaVersion: 1 } }), /INCOMPLETE_SECURITY_SCAN/);
  assert.throws(() => allVulnerabilityIds({ ...scan, report: { ...scan.report, Results: [{ Target: 'x', Vulnerabilities: [null] }] } }), /MALFORMED_SECURITY_SCAN/);
}
console.log('security-remediation-batch-closure E) allVulnerabilityIds() extracts real Trivy report shape, fail-closed on malformed input: PASS');

console.log('security-remediation-batch-closure.spec.ts: ALL CHECKS PASS');
