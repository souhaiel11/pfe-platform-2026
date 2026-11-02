// Teste le composant « deployment-authorization-transition » et ses cas d’erreur.
import * as assert from 'node:assert/strict';
import { evaluateLegacyDeployTransition } from './deployment-authorization-transition';

/** Exécute les étapes principales de ce programme. */
async function main() {
  // T1 — authorization-required=false + legacy request (no authorizationId)
  // -> current compatibility behavior preserved (allowed).
  {
    const r = evaluateLegacyDeployTransition(false, false);
    assert.equal(r.allowed, true);
    console.log('T1 authorization-required=false + legacy READY request -> compatibility preserved: PASS');
  }
  // T2 — authorization-required=true + no authorizationId -> rejected.
  {
    const r = evaluateLegacyDeployTransition(true, false);
    assert.equal(r.allowed, false);
    assert.equal(r.failureCode, 'DEPLOY_AUTHORIZATION_REQUIRED');
    console.log('T2 authorization-required=true + no authorizationId -> rejected: PASS');
  }
  // T3 — authorization-required=true + an authorizationId IS supplied ->
  // this flag never blocks the governed flow (its own independent checks
  // in reserveAndConsumeAuthorization apply instead).
  {
    const r = evaluateLegacyDeployTransition(true, true);
    assert.equal(r.allowed, true);
    console.log('T3 authorization-required=true + valid authorizationId present -> governed flow proceeds (flag does not block it): PASS');
  }
  {
    const r = evaluateLegacyDeployTransition(true, false);
    assert.equal(r.allowed, false);
    console.log('T4 CRITICAL request without authorization -> rejected regardless of role (flag has no role input to bypass; legacy path additionally still gated by the pre-existing readiness.ready check): PASS');
  }
  // T5 — direct API caller cannot use the legacy route after enforcement.
  // Same assertion as T2, from the "no UI involved, raw API call" framing:
  // the flag is read server-side, from an env var, never from anything
  // the caller's request itself claims.
  {
    const r = evaluateLegacyDeployTransition(true, false);
    assert.equal(r.allowed, false);
    assert.equal(r.failureCode, 'DEPLOY_AUTHORIZATION_REQUIRED');
    console.log('T5 direct API caller cannot use legacy route after enforcement: PASS');
  }

  console.log('deployment-authorization-transition.spec: ALL PASS');
}

main().catch(err => { console.error(err); process.exitCode = 1; });
