import * as assert from 'node:assert/strict';
import { computeSecurityCommitMessage, computeSecurityPrBody, computeSecurityPrTitle } from './security-remediation-git-metadata';
import { computeSecurityBatchCommitMessage, computeSecurityBatchPrBody, computeSecurityBatchPrTitle } from './security-remediation-batch-git-metadata';

const LOGBACK_INPUT = {
  cveId: 'CVE-2023-6378', package: 'ch.qos.logback:logback-classic', installedVersion: '1.2.11', targetVersion: '1.2.13',
  source: 'TRIVY', provenanceKind: 'DIRECT_EXPLICIT', evaluatedSha: '7ae0f954f99628b69ce9b42f42c1e2acc8568d99',
  candidateIdentity: '71531d5009b160fbe4d9e41dfe65efc203b676312003ae01c0b8d9596f851d9a',
};
const JACKSON_INPUT = {
  cveId: 'CVE-2020-36518', package: 'com.fasterxml.jackson.core:jackson-databind', installedVersion: '2.13.3', targetVersion: '2.13.5',
  source: 'TRIVY', provenanceKind: 'DIRECT_EXPLICIT', evaluatedSha: '7ae0f954f99628b69ce9b42f42c1e2acc8568d99',
  candidateIdentity: '71531d5009b160fbe4d9e41dfe65efc203b676312003ae01c0b8d9596f851d9a',
};

// A. N=1 -- byte-identical to the singular functions (non-regression: a
// singleton batch's PR text must match what execution 2060/PR #37 produced).
{
  assert.equal(computeSecurityBatchCommitMessage([LOGBACK_INPUT]), computeSecurityCommitMessage(LOGBACK_INPUT));
  assert.equal(computeSecurityBatchPrTitle([LOGBACK_INPUT]), computeSecurityPrTitle(LOGBACK_INPUT));
  assert.equal(computeSecurityBatchPrBody([LOGBACK_INPUT], LOGBACK_INPUT.candidateIdentity), computeSecurityPrBody(LOGBACK_INPUT));
}
console.log('security-remediation-batch-git-metadata A) N=1 -> byte-identical to the singular commit/title/body functions: PASS');

// B. N=2 -- both CVEs named, real values present, advisory/package/version
// per row, never "fixed" language (same §10 discipline as the singular body).
{
  const msg = computeSecurityBatchCommitMessage([LOGBACK_INPUT, JACKSON_INPUT]);
  assert.match(msg, /2 dependency versions/);
  const body = computeSecurityBatchPrBody([LOGBACK_INPUT, JACKSON_INPUT], 'batchidentity123');
  assert.match(body, /CVE-2023-6378/);
  assert.match(body, /CVE-2020-36518/);
  assert.match(body, /logback-classic/);
  assert.match(body, /jackson-databind/);
  assert.match(body, /1\.2\.11/);
  assert.match(body, /1\.2\.13/);
  assert.match(body, /2\.13\.3/);
  assert.match(body, /2\.13\.5/);
  assert.match(body, /not confirmation that the vulnerabilities are resolved/, 'B: carries the explicit honesty disclaimer, never a bare "fixed" claim');
  assert.match(body, /batchidentity123/);
}
console.log('security-remediation-batch-git-metadata B) N=2 -> both CVEs named with correct package/version pairs, never claims "fixed": PASS');

console.log('security-remediation-batch-git-metadata.spec.ts: ALL CHECKS PASS');
