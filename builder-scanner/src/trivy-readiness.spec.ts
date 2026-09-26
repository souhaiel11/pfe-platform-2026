/** V1.7 Phase B — Trivy DB bootstrap contract: unit tests for the
 * readiness check, using the SAME command-injection fault-test seam
 * convention as the rest of this codebase (a synthetic `trivy --version`
 * string in place of the real binary, so this test is deterministic and
 * needs no real Trivy installation). */
import * as assert from 'assert';
import { checkTrivyCacheReadiness } from './trivy-readiness';

const REAL_SAMPLE_OUTPUT = (vulnUpdatedAt: string, vulnNextUpdate: string, javaUpdatedAt: string, javaNextUpdate: string) => `Version: 0.72.0
Vulnerability DB:
  Version: 2
  UpdatedAt: ${vulnUpdatedAt}
  NextUpdate: ${vulnNextUpdate}
  DownloadedAt: 2026-09-25 23:43:13.37653788 +0000 UTC
Java DB:
  Version: 1
  UpdatedAt: ${javaUpdatedAt}
  NextUpdate: ${javaNextUpdate}
  DownloadedAt: 2026-09-26 00:17:05.634458518 +0000 UTC
`;

const NO_DB_OUTPUT = `Version: 0.72.0\n`;

const now = new Date();
const hoursAgo = (h: number) => new Date(now.getTime() - h * 60 * 60 * 1000).toISOString();
const hoursFromNow = (h: number) => new Date(now.getTime() + h * 60 * 60 * 1000).toISOString();

// 1. Both DBs present and fresh -> ready.
{
  const r = checkTrivyCacheReadiness(undefined, () => REAL_SAMPLE_OUTPUT(hoursAgo(1), hoursFromNow(23), hoursAgo(1), hoursFromNow(71)));
  assert.equal(r.ready, true, r.reason ?? '');
  assert.equal(r.vulnDb.present, true); assert.equal(r.vulnDb.stale, false);
  assert.equal(r.javaDb.present, true); assert.equal(r.javaDb.stale, false);
}

// 2. Neither DB present (the real fresh-runtime symptom reproduced this
// phase: no cache at all) -> NOT ready, fails closed, never silently passes.
{
  const r = checkTrivyCacheReadiness(undefined, () => NO_DB_OUTPUT);
  assert.equal(r.ready, false);
  assert.equal(r.vulnDb.present, false);
  assert.equal(r.javaDb.present, false);
  assert.match(r.reason!, /vulnerability DB missing/);
  assert.match(r.reason!, /Java DB missing/);
}

// 3. Vuln DB present but past its explicit staleness policy (>2 days old)
// -> NOT ready, even though the file technically exists.
{
  const r = checkTrivyCacheReadiness(undefined, () => REAL_SAMPLE_OUTPUT(hoursAgo(72), hoursAgo(48), hoursAgo(1), hoursFromNow(71)));
  assert.equal(r.ready, false);
  assert.equal(r.vulnDb.present, true);
  assert.equal(r.vulnDb.stale, true);
  assert.match(r.reason!, /vulnerability DB stale/);
}

// 4. Java DB present but past its explicit staleness policy (>4 days old)
// -> NOT ready.
{
  const r = checkTrivyCacheReadiness(undefined, () => REAL_SAMPLE_OUTPUT(hoursAgo(1), hoursFromNow(23), hoursAgo(120), hoursAgo(48)));
  assert.equal(r.ready, false);
  assert.equal(r.javaDb.stale, true);
  assert.match(r.reason!, /Java DB stale/);
}

// 5. trivy itself unavailable/erroring (e.g. not installed, or the
// readiness probe fails for any reason) -> NOT ready, never throws past
// this function -- the caller (server.ts) always gets a structured status.
{
  const r = checkTrivyCacheReadiness(undefined, () => { throw new Error('spawn trivy ENOENT'); });
  assert.equal(r.ready, false);
  assert.match(r.reason!, /trivy --version failed/);
}

// 6. Partial bootstrap -- the exact real-world shape the bootstrap-
// timeout-split phase addresses: the vuln DB step succeeded (its own
// section is present and fresh) but the Java DB step timed out before
// trivy ever wrote a Java DB section at all -> still NOT ready. A slow/
// incomplete Java DB must never look "good enough" next to a fully-present
// vuln DB.
{
  const PARTIAL_OUTPUT = (vulnUpdatedAt: string, vulnNextUpdate: string) => `Version: 0.72.0
Vulnerability DB:
  Version: 2
  UpdatedAt: ${vulnUpdatedAt}
  NextUpdate: ${vulnNextUpdate}
  DownloadedAt: 2026-09-25 23:43:13.37653788 +0000 UTC
`;
  const r = checkTrivyCacheReadiness(undefined, () => PARTIAL_OUTPUT(hoursAgo(1), hoursFromNow(23)));
  assert.equal(r.ready, false);
  assert.equal(r.vulnDb.present, true);
  assert.equal(r.vulnDb.stale, false);
  assert.equal(r.javaDb.present, false);
  assert.match(r.reason!, /Java DB missing/);
  assert.doesNotMatch(r.reason!, /vulnerability DB/);
}

console.log('trivy-readiness: PASS (fresh/missing/stale-vuln/stale-java/unavailable/partial-bootstrap, all fail closed except the fully-fresh case)');
