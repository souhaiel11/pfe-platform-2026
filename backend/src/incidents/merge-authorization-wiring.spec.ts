import * as assert from 'node:assert/strict';
import { IncidentsService, buildPrValidationJobName, remediationBatchIdentity } from './incidents.service';

// ÉTAPE 2 — câblage ADDITIF de computeMergeAuthorization dans saveValidation.
//
// Prouve deux choses :
//  1. saveValidation persiste désormais validation.mergeAuthorization (bloc
//     dérivé, lié au SHA exact), sur la forme réelle de la PR #25 :
//     2 findings VALID, corrélation OK, SHA match, stages complets, QG Sonar
//     ERROR, regression INCONCLUSIVE  ->  authorization === 'INCONCLUSIVE'
//     avec REGRESSION_UNVERIFIED, JAMAIS bloqué par le QG (advisory seul).
//  2. AUCUN comportement existant n'a bougé : validation.passed,
//     validation.validationStatus, validation.failureReasons et la
//     transition incident.status restent identiques à avant le câblage.
//
// Aucune vraie DB, aucun fetch. Repo en mémoire minimal (saveValidation
// n'utilise que repo.findOne / repo.update / gateway.emit).

const SHA = '8a315b0dd508eb9843bb3037fe2827f02f6faa78';
const REPO = 'souhaiel11/pfe-app-test';
const JOB = 'pfe-app-test';
const PR = 25;

function makeHarness() {
  const requestId = 'fixreq-1';
  const batchId = remediationBatchIdentity('incident-pr25', ['a', 'b']);
  const incident: any = {
    id: 'incident-pr25',
    projectId: 'project-1',
    status: 'validating',
    prUrl: `https://github.com/${REPO}/pull/${PR}`,
    jenkinsJobName: JOB,
    buildNumber: 140,
    project: { id: 'project-1', githubRepo: REPO },
    metadata: {
      enrichedData: { sonar: { issues: [{ id: 'a' }, { id: 'b' }] } },
      fixRequest: {
        status: 'PR_CREATED', requestId, batchId, batchKey: batchId, attemptCount: 1,
        findingId: 'a', findingIds: ['a', 'b'], prNumber: PR, prHeadSha: SHA, validationTargetSha: SHA,
      },
      prValidationRequest: { validationRequestId: 'vr-1', status: 'QUEUED', expectedPrHeadSha: SHA },
    },
  };
  const repo: any = {
    findOne: async () => incident,
    update: async (_id: string, patch: any) => Object.assign(incident, patch),
  };
  const service = new IncidentsService(
    repo, { findOne: async () => incident.project } as any,
    { emit: () => undefined } as any, { syncIncident: async () => undefined } as any,
    {} as any,
  );
  return { service, incident, requestId, batchId };
}

function validationPayload(over: any, findingResults: any[]) {
  const { batchId } = over;
  return {
    validationRequestId: 'vr-1', projectId: 'project-1', fixRequestId: over.requestId,
    batchId, batchKey: batchId, attemptCount: 1, repository: REPO, prNumber: PR,
    prValidationJob: buildPrValidationJobName(JOB, PR), jenkinsJob: JOB, buildNumber: 3,
    expectedPrHeadSha: SHA, checkoutSha: SHA, ceTaskId: 'ce-1', analysisId: 'analysis-1',
    correlationVerified: true, sonarCorrelationVerified: true,
    requiredStages: ['build', 'tests', 'sonar'].map(stage => ({ stage, required: true, status: 'PASSED' })),
    buildStageStatus: { build: 'SUCCESS', tests: 'SUCCESS', sonar: 'SUCCESS' },
    jenkinsStatus: 'SUCCESS', sonarStatus: 'ERROR',
    findingResults,
    ...over.payload,
  };
}

async function main() {
  // ── CASE 1 — forme PR #25 : 2 VALID, QG ERROR, regression INCONCLUSIVE ──
  {
    const { service, incident, requestId, batchId } = makeHarness();
    const res: any = await service.saveValidation('incident-pr25', validationPayload(
      { requestId, batchId },
      [
        { findingId: 'a', result: 'VALID', evidence: 'sonar exact-sha a: approved finding absent' },
        { findingId: 'b', result: 'VALID', evidence: 'sonar exact-sha b: approved finding absent' },
      ],
    ));

    // -- BRIQUE 4 : passed/incident.status/fixRequest.status ne dépendent plus
    // du QG Sonar global (seul le remède au batch approuvé compte) — un QG
    // ERROR causé par des findings historiques ne doit plus faire échouer une
    // remédiation par ailleurs propre. La régression reste séparément non
    // vérifiée ici (aucune preuve baseline/candidat fournie par ce fixture).
    assert.equal(res.validation.passed, true, 'BRIQUE 4: passed ne dépend plus du QG Sonar global');
    assert.equal(res.validation.validationStatus, 'VALIDATED', 'BRIQUE 4: validationStatus VALIDATED malgré QG ERROR');
    assert.deepEqual(res.validation.failureReasons, [], 'BRIQUE 4: QG ERROR seul n’est plus une raison d’échec');
    assert.equal(incident.status, 'completed', 'BRIQUE 4: transition completed malgré QG ERROR');
    assert.equal(incident.metadata.fixRequest.status, 'VALIDATED', 'BRIQUE 4: fixRequest VALIDATED malgré QG ERROR');

    // -- nouveau bloc additif --
    const ma = res.validation.mergeAuthorization;
    assert.ok(ma, 'validation.mergeAuthorization est persisté');
    assert.equal(ma.authorization, 'INCONCLUSIVE', 'CASE 1: batch prouvé mais régression non vérifiée => INCONCLUSIVE');
    assert.equal(ma.remediationResult, 'VALIDATED', 'CASE 1: remediationResult échoué tel quel sur mergeAuthorization');
    assert.equal(ma.regressionResult, 'INCONCLUSIVE', 'CASE 1: regressionResult échoué tel quel sur mergeAuthorization');
    assert.ok(ma.technicalReasons.includes('REGRESSION_UNVERIFIED'), 'CASE 1: raison = régression non vérifiée (technique, non bloquante)');
    assert.deepEqual(ma.blockingReasons, [], 'CASE 1: aucune raison bloquante — rien n’est un défaut prouvé');
    assert.ok(!ma.blockingReasons.includes('FINDING_INVALID'), 'CASE 1: aucun finding invalide');
    assert.ok(
      !ma.blockingReasons.some((r: string) => String(r).startsWith('SONAR'))
      && !ma.technicalReasons.some((r: string) => String(r).startsWith('SONAR')),
      'CASE 1: le QG Sonar global n’est PAS une raison bloquante ni technique pour le merge',
    );
    assert.ok(
      ma.advisories.some((a: any) => a.code === 'SONAR_QUALITY_GATE_ERROR'),
      'CASE 1: le QG Sonar global ressort en advisory uniquement',
    );
    assert.notEqual(ma.authorization, 'BLOCKED', 'CASE 1: un QG rouge seul ne bloque jamais le merge');
    assert.notEqual(ma.authorization, 'MERGE_READY', 'CASE 1: pas auto-certifiable tant que la régression est inconnue');
    assert.equal(ma.forSha, SHA, 'CASE 1: autorisation liée au SHA exact validé');
    assert.equal(ma.authorizedSha, null, 'CASE 1: authorizedSha reste null tant que ce n’est pas MERGE_READY');
    assert.ok(typeof ma.computedAt === 'string' && ma.computedAt.length > 0, 'CASE 1: computedAt renseigné');

    // le bloc dérivé n’a pas contaminé les champs plats
    assert.equal(res.validation.derived.pipelineHealth.sonarQualityGate, 'ERROR', 'pipelineHealth reflète le vrai QG');
    assert.ok(res.validation.derived.findings.every((f: any) => f.verdict === 'VALID'), 'verdicts per-finding inchangés');
  }

  // ── CASE 2 — tout au vert : passed=true / completed, MAIS merge non auto-ready
  //    (découplage : mergeAuthorization ≠ validation.passed) ──────────────
  {
    const { service, incident, requestId, batchId } = makeHarness();
    const res: any = await service.saveValidation('incident-pr25', validationPayload(
      { requestId, batchId, payload: { sonarStatus: 'OK' } },
      [
        { findingId: 'a', result: 'VALID', evidence: 'ok-a' },
        { findingId: 'b', result: 'VALID', evidence: 'ok-b' },
      ],
    ));
    assert.equal(res.validation.passed, true, 'CASE 2: comportement existant — passed true quand QG OK');
    assert.equal(res.validation.validationStatus, 'VALIDATED', 'CASE 2: validationStatus VALIDATED inchangé');
    assert.equal(incident.status, 'completed', 'CASE 2: transition completed inchangée');
    assert.equal(incident.metadata.fixRequest.status, 'VALIDATED', 'CASE 2: fixRequest VALIDATED inchangé');

    const ma = res.validation.mergeAuthorization;
    assert.equal(ma.authorization, 'INCONCLUSIVE', 'CASE 2: merge PAS auto-ready — régression non vérifiée (aucune preuve fournie)');
    assert.ok(ma.technicalReasons.includes('REGRESSION_UNVERIFIED'));
    assert.deepEqual(ma.blockingReasons, []);
    assert.deepEqual(ma.advisories, [], 'CASE 2: QG OK => aucun advisory');
    assert.notEqual(ma.authorization, 'MERGE_READY', 'CASE 2: passed=true n’entraîne PAS MERGE_READY (découplé)');
    assert.equal(ma.authorizedSha, null, 'CASE 2: pas MERGE_READY => authorizedSha null');
  }

  // ── CASE 3 — robustesse : verdicts per-finding INCONCLUSIVE, jamais de crash
  {
    const { service, incident, requestId, batchId } = makeHarness();
    const res: any = await service.saveValidation('incident-pr25', validationPayload(
      { requestId, batchId },
      [
        { findingId: 'a', result: 'INCONCLUSIVE', evidence: null },
        { findingId: 'b', result: 'INCONCLUSIVE', evidence: null },
      ],
    ));
    assert.equal(res.validation.passed, false, 'CASE 3: passed inchangé');
    assert.equal(res.validation.validationStatus, 'INCONCLUSIVE');
    assert.equal(incident.status, 'failed');
    const ma = res.validation.mergeAuthorization;
    assert.equal(ma.authorization, 'INCONCLUSIVE', 'CASE 3: pas de crash, verdict prudent');
    assert.ok(ma.technicalReasons.includes('REMEDIATION_INCONCLUSIVE'), 'CASE 3: raison remédiation inconclusive');
    assert.ok(ma.technicalReasons.includes('REGRESSION_UNVERIFIED'), 'CASE 3: + régression non vérifiée');
    assert.deepEqual(ma.blockingReasons, [], 'CASE 3: rien n’est un défaut prouvé, seulement de l’incertitude');
  }

  console.log('merge-authorization wiring (additive, lifecycle unchanged): PASS');
}

main().catch(err => { console.error(err); process.exit(1); });
