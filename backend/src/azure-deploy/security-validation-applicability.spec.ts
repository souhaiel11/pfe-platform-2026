// Teste le composant « security-validation-applicability » et ses cas d’erreur.
import * as assert from 'node:assert/strict';
import { evaluateSecurityValidationApplicability } from './security-validation-applicability';
import { extractSecurityValidationEvidence } from './build-identity';

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);

/** Exécute les étapes principales de ce programme. */
async function main() {
  {
    // S1 — artifact commit == validated checkoutSha -> applicable
    const validation = extractSecurityValidationEvidence({ validationStatus: 'VALIDATED', passed: true, checkoutSha: SHA_A, buildNumber: 6, expectedPrHeadSha: SHA_A });
    const r = evaluateSecurityValidationApplicability(SHA_A, validation);
    assert.equal(r.applicability, 'APPLICABLE');
    console.log('S1 artifact commit == validated checkoutSha -> applicable: PASS');
  }
  {
    // S2 — validation exists for a different fix-PR SHA -> NOT_APPLICABLE
    const validation = extractSecurityValidationEvidence({ validationStatus: 'VALIDATED', passed: true, checkoutSha: SHA_B, buildNumber: 6, expectedPrHeadSha: SHA_B });
    const r = evaluateSecurityValidationApplicability(SHA_A, validation);
    assert.equal(r.applicability, 'NOT_APPLICABLE');
    console.log('S2 validation exists for different fix-PR SHA -> NOT_APPLICABLE: PASS');
  }
  {
    // S3 — validation absent -> MISSING
    const validation = extractSecurityValidationEvidence(undefined);
    const r = evaluateSecurityValidationApplicability(SHA_A, validation);
    assert.equal(r.applicability, 'MISSING');
    console.log('S3 validation absent -> MISSING: PASS');
  }
  {
    // S4 — validation failed for the exact artifact SHA -> FAILED
    const validation = extractSecurityValidationEvidence({ validationStatus: 'REJECTED', passed: false, checkoutSha: SHA_A, buildNumber: 6, expectedPrHeadSha: SHA_A });
    const r = evaluateSecurityValidationApplicability(SHA_A, validation);
    assert.equal(r.applicability, 'FAILED');
    console.log('S4 validation failed for exact artifact SHA -> FAILED: PASS');
  }
  {
    // S5 — real #147 shape: sourceCommitSha (artifact's own commit) !=
    // validation.checkoutSha (fix-PR branch). Must NOT be a false
    // mismatch -- it's NOT_APPLICABLE, and the original artifact's
    // identity/provenance are completely unaffected.
    const REAL_SOURCE_COMMIT = '6ed56ff791acbf3e111431285bef7b30c8076084';
    const REAL_VALIDATION_CHECKOUT = '11ee62d1cdcdb9de20f2d1b0be453b9994ce9f9e';
    const validation = extractSecurityValidationEvidence({ validationStatus: 'VALIDATED', passed: true, checkoutSha: REAL_VALIDATION_CHECKOUT, buildNumber: 6, expectedPrHeadSha: REAL_VALIDATION_CHECKOUT });
    const r = evaluateSecurityValidationApplicability(REAL_SOURCE_COMMIT, validation);
    assert.equal(r.applicability, 'NOT_APPLICABLE');
    assert.ok(!r.reason.toLowerCase().includes('mismatch'), 'reason text must never use mismatch vocabulary for this case');
    console.log('S5 #147 real-shaped fixture: source build != fix validation SHA -> no false mismatch, NOT_APPLICABLE: PASS');
  }
  {
    // S6 -- #150: no validation at all -> MISSING, which governance.ts
    // treats as a risk signal (CRITICAL_RISK), never TECHNICALLY_IMPOSSIBLE.
    // (Full governance classification is exercised end-to-end in
    // governance-decision.spec.ts's BUILD_150_FIXTURE; this test is
    // scoped to the applicability layer alone.)
    const validation = extractSecurityValidationEvidence(undefined);
    const r = evaluateSecurityValidationApplicability('7ae0f954f99628b69ce9b42f42c1e2acc8568d99', validation);
    assert.equal(r.applicability, 'MISSING');
    console.log('S6 #150 no validation -> MISSING (governance classifies CRITICAL_RISK, not technically impossible, elsewhere): PASS');
  }

  console.log('security-validation-applicability.spec: ALL PASS');
}

main().catch(err => { console.error(err); process.exitCode = 1; });
