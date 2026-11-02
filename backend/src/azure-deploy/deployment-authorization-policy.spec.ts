// Teste le composant « deployment-authorization-policy » et ses cas d’erreur.
import * as assert from 'node:assert/strict';
import { evaluateAuthorizationRequest, CRITICAL_OVERRIDE_CONFIRMATION_PHRASE } from './deployment-authorization-policy';

/** Exécute les étapes principales de ce programme. */
async function main() {
  // P1 READY + developer + NORMAL -> created
  {
    const r = evaluateAuthorizationRequest('READY', { mode: 'NORMAL', requestedByRole: 'developer' });
    assert.equal(r.ok, true);
    console.log('P1 READY + developer + NORMAL -> authorization created: PASS');
  }
  // P2 CONDITIONAL + developer + correct acknowledgement -> created
  {
    const r = evaluateAuthorizationRequest('CONDITIONAL', {
      mode: 'CONDITIONAL_EXCEPTION', requestedByRole: 'developer',
      reason: 'ZAP warning accepted, non-blocking per policy', acknowledgements: { conditionalRiskAccepted: true },
    });
    assert.equal(r.ok, true);
    console.log('P2 CONDITIONAL + developer + correct acknowledgement -> created: PASS');
  }
  // P3 CRITICAL + developer -> denied
  {
    const r = evaluateAuthorizationRequest('CRITICAL_RISK', {
      mode: 'CRITICAL_OVERRIDE', requestedByRole: 'developer', reason: 'need to ship now, risk accepted',
      acknowledgements: { criticalRiskAccepted: true, securityControlsMayHaveFailed: true, deploymentMayExposeKnownRisk: true },
      confirmationPhrase: CRITICAL_OVERRIDE_CONFIRMATION_PHRASE,
    });
    assert.equal(r.ok, false);
    assert.equal(r.failureCode, 'DEPLOY_AUTHORIZATION_ROLE_FORBIDDEN');
    console.log('P3 CRITICAL + developer -> denied: PASS');
  }
  // P4 CRITICAL + admin + missing phrase -> denied
  {
    const r = evaluateAuthorizationRequest('CRITICAL_RISK', {
      mode: 'CRITICAL_OVERRIDE', requestedByRole: 'admin', reason: 'need to ship now, risk accepted',
      acknowledgements: { criticalRiskAccepted: true, securityControlsMayHaveFailed: true, deploymentMayExposeKnownRisk: true },
      confirmationPhrase: 'oops wrong phrase',
    });
    assert.equal(r.ok, false);
    assert.equal(r.failureCode, 'DEPLOY_AUTHORIZATION_PHRASE_MISMATCH');
    console.log('P4 CRITICAL + admin + missing phrase -> denied: PASS');
  }
  // P5 CRITICAL + admin + missing acknowledgement -> denied
  {
    const r = evaluateAuthorizationRequest('CRITICAL_RISK', {
      mode: 'CRITICAL_OVERRIDE', requestedByRole: 'admin', reason: 'need to ship now, risk accepted',
      acknowledgements: { criticalRiskAccepted: true, securityControlsMayHaveFailed: true }, // deploymentMayExposeKnownRisk missing
      confirmationPhrase: CRITICAL_OVERRIDE_CONFIRMATION_PHRASE,
    });
    assert.equal(r.ok, false);
    assert.equal(r.failureCode, 'DEPLOY_AUTHORIZATION_ACKNOWLEDGEMENT_MISSING');
    console.log('P5 CRITICAL + admin + missing acknowledgement -> denied: PASS');
  }
  // P6 CRITICAL + admin + complete acknowledgements -> created
  {
    const r = evaluateAuthorizationRequest('CRITICAL_RISK', {
      mode: 'CRITICAL_OVERRIDE', requestedByRole: 'admin', reason: 'need to ship now, risk accepted',
      acknowledgements: { criticalRiskAccepted: true, securityControlsMayHaveFailed: true, deploymentMayExposeKnownRisk: true },
      confirmationPhrase: CRITICAL_OVERRIDE_CONFIRMATION_PHRASE,
    });
    assert.equal(r.ok, true);
    console.log('P6 CRITICAL + admin + complete acknowledgements -> created: PASS');
  }
  // P7 TECHNICALLY_IMPOSSIBLE + admin -> denied
  {
    const r = evaluateAuthorizationRequest('TECHNICALLY_IMPOSSIBLE', {
      mode: 'CRITICAL_OVERRIDE', requestedByRole: 'admin', reason: 'need to ship now, risk accepted',
      acknowledgements: { criticalRiskAccepted: true, securityControlsMayHaveFailed: true, deploymentMayExposeKnownRisk: true },
      confirmationPhrase: CRITICAL_OVERRIDE_CONFIRMATION_PHRASE,
    });
    assert.equal(r.ok, false);
    assert.equal(r.failureCode, 'DEPLOY_TECHNICALLY_IMPOSSIBLE_NO_OVERRIDE');
    console.log('P7 TECHNICALLY_IMPOSSIBLE + admin -> denied: PASS');
  }
  // P8 viewer -> denied (for every mode, including the one that would
  // otherwise be satisfied by its own role requirement)
  {
    const r1 = evaluateAuthorizationRequest('READY', { mode: 'NORMAL', requestedByRole: 'viewer' });
    const r2 = evaluateAuthorizationRequest('CRITICAL_RISK', {
      mode: 'CRITICAL_OVERRIDE', requestedByRole: 'viewer', reason: 'need to ship now, risk accepted',
      acknowledgements: { criticalRiskAccepted: true, securityControlsMayHaveFailed: true, deploymentMayExposeKnownRisk: true },
      confirmationPhrase: CRITICAL_OVERRIDE_CONFIRMATION_PHRASE,
    });
    assert.equal(r1.ok, false);
    assert.equal(r1.failureCode, 'DEPLOY_AUTHORIZATION_ROLE_FORBIDDEN');
    assert.equal(r2.ok, false);
    assert.equal(r2.failureCode, 'DEPLOY_AUTHORIZATION_ROLE_FORBIDDEN');
    console.log('P8 viewer -> denied (every mode): PASS');
  }

  console.log('deployment-authorization-policy.spec: ALL PASS');
}

main().catch(err => { console.error(err); process.exitCode = 1; });
