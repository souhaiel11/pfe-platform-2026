// Teste le composant « publication-provenance » et ses cas d’erreur.
import * as assert from 'node:assert/strict';
import {
  deriveArtifactIdentitySource,
  evaluateArtifactPublication,
  publicationAllowsDeployment,
} from './publication-provenance';

// The real digests from the QA-DEF-11 investigation, so the table below is
// exercised against actual values rather than synthetic ones.
// ACR manifest digest of acrpfedevsecops/pfe-app-test:151 (§1.4).
const MANIFEST_151 = 'sha256:6dc3cdba69592a91a5a1569978bcfca74d4080597a769ab368ed585ba397bcf5';
// CONFIG digest printed by build #151's `docker build` (§1.5). Deliberately
// used below as a wrong-value case: a config digest is NOT comparable to a
// registry tag's manifest digest, and must never be accepted as a receipt.
const CONFIG_151 = 'sha256:12aba29ceacaf1411a272df99c5376cdc0dfd9baa98de2bcd2f2c1a0c9256777';
const OTHER_MANIFEST = `sha256:${'9'.repeat(64)}`;
const URL_151 = 'http://jenkins:8080/job/pfe-app-test/151/';

const ciBase = {
  channel: 'CI_CALLBACK' as const,
  registryConfirmedDigest: MANIFEST_151,
  resolvedBuildNumber: 151,
  reportedPushStatus: 'SUCCESS',
};
/** Prépare les données nécessaires à ce scénario. */
const receipt = (over: Partial<{ manifestDigest: string; buildNumber: number; jenkinsBuildUrl: string }> = {}) =>
  ({ manifestDigest: MANIFEST_151, buildNumber: 151, jenkinsBuildUrl: URL_151, ...over });

/** Exécute les étapes principales de ce programme. */
function main() {
  // ── §6.1 — CI_CALLBACK attribution table ──────────────────────────
  {
    // No receipt at all = the tag-151 shape. "We were not shown a push" is
    // not "a push we trust".
    const r = evaluateArtifactPublication({ ...ciBase, pushReceipt: null });
    assert.equal(r.publicationSource, 'UNKNOWN');
    assert.equal(r.failureCode, 'PUSH_RECEIPT_MISSING');
    console.log('T1 no push receipt -> UNKNOWN/PUSH_RECEIPT_MISSING: PASS');
  }
  {
    const r = evaluateArtifactPublication({ ...ciBase, pushReceipt: receipt({ manifestDigest: OTHER_MANIFEST }) });
    assert.equal(r.publicationSource, 'UNKNOWN');
    assert.equal(r.failureCode, 'PUSH_RECEIPT_DIGEST_MISMATCH');
    console.log('T2 receipt digest != registry-confirmed digest -> UNKNOWN/PUSH_RECEIPT_DIGEST_MISMATCH: PASS');
  }
  {
    // §1.5's methodological trap, enforced: the digest `docker build`
    // prints is the CONFIG digest. It is a real sha256 and it really does
    // belong to this image — and it is still not an admissible receipt,
    // because it is not what a registry tag resolves to. Accepting it would
    // let a build that never pushed appear to have pushed.
    const r = evaluateArtifactPublication({ ...ciBase, pushReceipt: receipt({ manifestDigest: CONFIG_151 }) });
    assert.equal(r.publicationSource, 'UNKNOWN');
    assert.equal(r.failureCode, 'PUSH_RECEIPT_DIGEST_MISMATCH');
    console.log('T3 config digest offered as a push receipt -> UNKNOWN (not comparable to a manifest digest): PASS');
  }
  {
    const r = evaluateArtifactPublication({ ...ciBase, pushReceipt: receipt({ buildNumber: 150 }) });
    assert.equal(r.publicationSource, 'UNKNOWN');
    assert.equal(r.failureCode, 'PUSH_RECEIPT_BUILD_MISMATCH');
    console.log('T4 receipt from another build -> UNKNOWN/PUSH_RECEIPT_BUILD_MISMATCH: PASS');
  }
  {
    // The exact production contradiction of §1.9: a receipt claiming a push
    // for a build whose own telemetry says NOT_ATTEMPTED. The receipt loses.
    const r = evaluateArtifactPublication({ ...ciBase, reportedPushStatus: 'NOT_ATTEMPTED', pushReceipt: receipt() });
    assert.equal(r.publicationSource, 'UNKNOWN');
    assert.equal(r.failureCode, 'PIPELINE_DID_NOT_PUBLISH');
    console.log('T5 valid-looking receipt but push_status=NOT_ATTEMPTED -> UNKNOWN/PIPELINE_DID_NOT_PUBLISH: PASS');
  }
  {
    // WF1 is known to hardcode 'UNKNOWN' into this field for some builds
    // (common/phase-diagnostics.ts) — so "not SUCCESS" must mean
    // "not proven", never "probably fine".
    for (const status of ['UNKNOWN', 'FAILURE', '', null]) {
      const r = evaluateArtifactPublication({ ...ciBase, reportedPushStatus: status as any, pushReceipt: receipt() });
      assert.equal(r.publicationSource, 'UNKNOWN', `status=${status}`);
      assert.equal(r.failureCode, 'PIPELINE_DID_NOT_PUBLISH');
    }
    console.log('T6 push_status UNKNOWN/FAILURE/empty/absent -> UNKNOWN (only SUCCESS proves): PASS');
  }
  {
    const r = evaluateArtifactPublication({ ...ciBase, registryConfirmedDigest: null, pushReceipt: receipt() });
    assert.equal(r.publicationSource, 'UNKNOWN');
    assert.equal(r.failureCode, 'PUSH_RECEIPT_DIGEST_UNCONFIRMED');
    console.log('T7 registry confirms no digest -> UNKNOWN/PUSH_RECEIPT_DIGEST_UNCONFIRMED: PASS');
  }
  {
    const malformed = evaluateArtifactPublication({ ...ciBase, pushReceipt: receipt({ manifestDigest: 'sha256:nope' }) });
    assert.equal(malformed.failureCode, 'PUSH_RECEIPT_MALFORMED');
    const noUrl = evaluateArtifactPublication({ ...ciBase, pushReceipt: receipt({ jenkinsBuildUrl: '' }) });
    assert.equal(noUrl.failureCode, 'PUSH_RECEIPT_MALFORMED');
    assert.equal(noUrl.publicationSource, 'UNKNOWN');
    console.log('T8 malformed digest / no re-readable build URL -> UNKNOWN/PUSH_RECEIPT_MALFORMED: PASS');
  }
  {
    // The ONLY path to the strongest status: complete receipt, digest
    // confirmed by the registry, right build, pipeline's own push_status
    // SUCCESS.
    const r = evaluateArtifactPublication({ ...ciBase, pushReceipt: receipt() });
    assert.equal(r.publicationSource, 'PIPELINE_VERIFIED');
    assert.equal(r.failureCode, null);
    assert.equal(r.receipt.claimedManifestDigest, MANIFEST_151);
    assert.equal(r.receipt.registryConfirmedDigest, MANIFEST_151);
    assert.equal(r.receipt.reportedPushStatus, 'SUCCESS');
    assert.match(r.evidence, /docker push du build #151/);
    console.log('T9 complete cross-checked receipt + push_status=SUCCESS -> PIPELINE_VERIFIED: PASS');
  }

  // ── §6.1/§6.2 — the entry point confers nothing ───────────────────
  {
    // A receipt that WOULD prove PIPELINE_VERIFIED on the CI channel must
    // not do so on the manual channel. This is the inverse of the defect,
    // where the route alone decided the value.
    const r = evaluateArtifactPublication({ ...ciBase, channel: 'MANUAL_ADMIN', attestedByUserId: 'admin-1', pushReceipt: receipt() });
    assert.equal(r.publicationSource, 'MANUAL_ATTESTED');
    assert.notEqual(r.publicationSource, 'PIPELINE_VERIFIED');
    assert.match(r.evidence, /ne peut JAMAIS conférer PIPELINE_VERIFIED/);
    console.log('T10 MANUAL_ADMIN + otherwise-perfect receipt -> MANUAL_ATTESTED, never PIPELINE_VERIFIED: PASS');
  }
  {
    const r = evaluateArtifactPublication({ ...ciBase, channel: 'MANUAL_ADMIN', attestedByUserId: null, pushReceipt: null });
    assert.equal(r.publicationSource, 'UNKNOWN');
    assert.equal(r.failureCode, 'PUBLICATION_ATTESTATION_MISSING');
    console.log('T11 MANUAL_ADMIN with nobody on record -> UNKNOWN, NOT auto-promoted to a manual status: PASS');
  }
  {
    const r = evaluateArtifactPublication({ ...ciBase, channel: 'MANUAL_ADMIN', attestedByUserId: 'admin-1', pushReceipt: null });
    assert.equal(r.publicationSource, 'MANUAL_ATTESTED');
    assert.equal(r.receipt.attestedByUserId, 'admin-1');
    console.log('T12 MANUAL_ADMIN with a named attester -> MANUAL_ATTESTED (identity is the proof): PASS');
  }

  // ── Claim A is independent of claim C ─────────────────────────────
  {
    assert.equal(deriveArtifactIdentitySource(true), 'PIPELINE_BUILT');
    assert.equal(deriveArtifactIdentitySource(false), 'UNKNOWN');
    // The tag-151 pair: both statements true at once.
    const publication = evaluateArtifactPublication({ ...ciBase, reportedPushStatus: 'NOT_ATTEMPTED', pushReceipt: null });
    assert.equal(deriveArtifactIdentitySource(true), 'PIPELINE_BUILT');
    assert.equal(publication.publicationSource, 'UNKNOWN');
    console.log('T13 identity PIPELINE_BUILT and publication UNKNOWN coexist (the tag-151 truth): PASS');
  }

  // ── §6.3 — what may satisfy a deployment gate, fail-closed ────────
  {
    assert.equal(publicationAllowsDeployment('PIPELINE_VERIFIED'), true);
    assert.equal(publicationAllowsDeployment('MANUAL_ATTESTED'), true);
    assert.equal(publicationAllowsDeployment('UNKNOWN'), false);
    assert.equal(publicationAllowsDeployment(null), false);
    assert.equal(publicationAllowsDeployment(undefined), false);
    // A value from a vocabulary this build doesn't know is refused, not
    // guessed at — including anything that merely looks reassuring.
    assert.equal(publicationAllowsDeployment('JENKINS_PIPELINE' as any), false);
    assert.equal(publicationAllowsDeployment('VERIFIED' as any), false);
    console.log('T14 deployment allow-list is positive-only: UNKNOWN/null/undefined/unrecognised all refused: PASS');
  }

  console.log('publication-provenance.spec: ALL PASS');
}

main();
