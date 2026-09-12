import * as assert from 'node:assert/strict';
import { IncidentsService, buildPrValidationJobName } from './incidents.service';

// BRIQUE 3 (+ CLOSEOUT) — proves the saveValidation() wiring (not just the
// pure engine) end to end: (1) today's default behavior is unchanged when
// no baseline/candidate evidence is supplied; (2) the wiring genuinely
// combines HEAD proof with scanner evidence once both snapshots are supplied
// and correlated; UNPROVEN comparability makes introduced findings advisory;
// (3) the mandatory semantic separation between
// remediationResult and regressionResult; (4) CLOSEOUT PART 2/3/4: a
// baseline whose sourceCommitSha has drifted from the frozen fixRequest.
// baselineSha, or a candidate snapshot lacking an explicit completeness
// flag, must never be silently trusted (TEST C / TEST E).

const SHA = 'a'.repeat(40);
const OTHER_SHA = 'b'.repeat(40);

function makeFixture() {
  const incident: any = {
    id: 'incident-1', projectId: 'project-1', status: 'validating', prUrl: 'https://github.com/owner/repo/pull/7',
    jenkinsJobName: 'project-job',
    project: { id: 'project-1', githubRepo: 'owner/repo' },
    metadata: {
      sourceCommitSha: SHA,
      fixRequest: {
        status: 'PR_CREATED', requestId: 'req-1', batchId: 'batch-1', batchKey: 'batch-1',
        attemptCount: 1, prNumber: 7, prHeadSha: SHA, findingIds: ['a'], baselineSha: SHA,
      },
      prValidationRequest: { validationRequestId: 'validation-1', status: 'QUEUED', expectedPrHeadSha: SHA,
        headVerification: { mode: 'HEAD_ONLY', overall: 'PASS', failureClass: null,
          workspace: { exactShaVerified: true, checkoutSha: SHA },
          identity: { targetSha: SHA, validationRequestId: 'validation-1', requestId: 'req-1', batchId: 'batch-1', candidateAttempt: 1, repository: 'owner/repo' } } },
      enrichedData: {
        sonar: {
          issues: [
            { key: 'k1', rule: 'java:S4684', component: 'proj:src/Dto.java', line: 12, status: 'OPEN' },
            { key: 'k2', rule: 'java:S1234', component: 'proj:src/Other.java', line: 3, status: 'OPEN' },
          ],
          total: 2,
          collectedCount: 2,
          pageSize: 500,
          complete: true,
          snapshotError: null,
        },
      },
    },
  };
  const repo: any = {
    findOne: async () => incident,
    update: async (_id: string, patch: any) => Object.assign(incident, patch),
  };
  const service = new IncidentsService(repo, { findOne: async () => incident.project } as any, { emit: () => undefined } as any, { syncIncident: async () => undefined } as any, {} as any);
  return { incident, service };
}

function baseValidationContract(incident: any) {
  return {
    validationRequestId: 'validation-1', projectId: incident.projectId, fixRequestId: incident.metadata.fixRequest.requestId,
    batchId: incident.metadata.fixRequest.batchId, batchKey: incident.metadata.fixRequest.batchId, attemptCount: 1,
    repository: 'owner/repo', prNumber: 7, prValidationJob: buildPrValidationJobName('project-job', 7),
    expectedPrHeadSha: SHA, checkoutSha: SHA, ceTaskId: 'ce-1', analysisId: 'analysis-1', buildNumber: 1,
    jenkinsJob: 'project-job', jenkinsStatus: 'SUCCESS', sonarStatus: 'OK', correlationVerified: true, sonarCorrelationVerified: true,
    requiredStages: ['build', 'tests', 'sonar'].map(stage => ({ stage, required: true, status: 'PASSED' })),
    findingResults: [{ findingId: 'a', result: 'VALID', evidence: 'analysis-1' }],
  };
}

async function main() {
  // (1) No candidate evidence supplied -- default, unchanged behavior (a
  // correlated baseline alone is not enough; the candidate snapshot is
  // still absent/incomplete).
  {
    const { incident, service } = makeFixture();
    const result: any = await service.saveValidation(incident.id, baseValidationContract(incident));
    assert.equal(result.validation.regression.result, 'INCONCLUSIVE', 'no candidate snapshot supplied -> INCONCLUSIVE');
    assert.equal(result.validation.validationStatus, 'VALIDATED', 'remediation verdict is unaffected by the absent regression evidence');
    assert.ok(result.validation.mergeAuthorization.technicalReasons.includes('REGRESSION_UNVERIFIED'));
  }

  // (2) Full, correlated evidence supplied, no new finding -> regression
  // CLEAN, and the mandatory semantic separation: remediationResult
  // VALIDATED AND regressionResult CLEAN are simultaneously true.
  {
    const { incident, service } = makeFixture();
    const contract = {
      ...baseValidationContract(incident),
      candidateSnapshotComplete: true,
      candidateFindingsSnapshot: [
        { key: 'pr-k2', rule: 'java:S1234', component: 'proj-pr-7:src/Other.java', line: 99, status: 'OPEN' }, // pre-existing, line moved
        // java:S4684 absent from the candidate: resolved by the approved fix.
      ],
    };
    const result: any = await service.saveValidation(incident.id, contract);
    assert.equal(result.validation.regression.result, 'CLEAN');
    assert.equal(result.validation.regression.resolvedCount, 1);
    assert.equal(result.validation.regression.preExistingCount, 1);
    assert.equal(result.validation.regression.introducedCount, 0);
    assert.equal(result.validation.regression.baselineSnapshotComplete, true);
    assert.equal(result.validation.regression.candidateSnapshotComplete, true);
    assert.equal(result.validation.validationStatus, 'VALIDATED', 'remediationResult VALIDATED');
    assert.equal(result.validation.regression.result, 'CLEAN', 'regressionResult CLEAN -- both true simultaneously, from two independent fields');
    assert.deepEqual(result.validation.mergeAuthorization.blockingReasons, []);
    assert.deepEqual(result.validation.mergeAuthorization.technicalReasons, []);
    // BRIQUE 4 — everything positively satisfied: MERGE_READY, with an exact authorizedSha.
    assert.equal(result.validation.mergeAuthorization.authorization, 'MERGE_READY');
    assert.equal(result.validation.mergeAuthorization.authorizedSha, SHA);
  }

  // (3) Raw scanner CHANGES_REQUIRED is retained, but cannot block the
  // combined verdict without comparability. Callback claims cannot enable it.
  {
    const { incident, service } = makeFixture();
    const contract = {
      ...baseValidationContract(incident),
      candidateSnapshotComplete: true,
      scannerComparability: 'PROVEN',
      candidateFindingsSnapshot: [
        { key: 'pr-k2', rule: 'java:S1234', component: 'proj-pr-7:src/Other.java', line: 3, status: 'OPEN' }, // pre-existing
        { key: 'pr-new', rule: 'java:S9999', component: 'proj-pr-7:src/NewBug.java', line: 5, status: 'OPEN' }, // genuinely new
      ],
    };
    const result: any = await service.saveValidation(incident.id, contract);
    assert.equal(result.validation.validationStatus, 'VALIDATED', 'remediationResult stays VALIDATED -- the approved findings are still all VALID');
    const combined = result.validation.regression;
    assert.equal(combined.contractVersion, 1);
    assert.equal(combined.headVerificationResult, 'PASS');
    assert.equal(combined.scannerComparability, 'UNPROVEN');
    assert.deepEqual(combined.evidenceIntegrity, { ok: true, reasons: [] });
    assert.equal(combined.result, 'CLEAN', 'HEAD PASS plus complete evidence; unproven scanner comparison is advisory');
    assert.equal(combined.scannerDiff.result, 'CHANGES_REQUIRED');
    assert.equal(combined.scannerDiff.blockingIntroducedFindings.length, 1);
    assert.deepEqual(combined.blockingCauses, []);
    assert.deepEqual(combined.blockingIntroducedFindings, []);
    assert.equal(combined.advisories.length, 1);
    assert.deepEqual(combined.advisories[0].findingRef, combined.scannerDiff.introducedFindings[0]);
    assert.deepEqual(combined.decisionReasons,
      ['HEAD_VERIFICATION_PASS', 'SCANNER_ADVISORY_ONLY_UNPROVEN_COMPARABILITY']);
    assert.equal(result.validation.regression.introducedCount, 1);
    assert.equal(result.validation.mergeAuthorization.regressionResult, combined.result);
    assert.deepEqual(result.validation.mergeAuthorization.blockingReasons, []);
    assert.deepEqual(result.validation.mergeAuthorization.advisories,
      combined.advisories.map(({ code, message }: any) => ({ code, message })));
    assert.equal(result.validation.mergeAuthorization.authorization, 'MERGE_READY');
    assert.equal(result.validation.mergeAuthorization.authorizedSha, SHA);
    assert.deepEqual(incident.metadata.validation.regression, combined, 'combined evidence actually persisted');
  }

  // TEST C — baseline finding snapshot belongs to a different SHA than the
  // frozen fixRequest.baselineSha (simulated drift: incident.metadata.
  // sourceCommitSha no longer matches). Expected INCONCLUSIVE, never CLEAN,
  // even though the candidate side is fully correlated and shows no new
  // finding.
  {
    const { incident, service } = makeFixture();
    incident.metadata.sourceCommitSha = OTHER_SHA; // drifted from fixRequest.baselineSha (SHA)
    const contract = {
      ...baseValidationContract(incident),
      candidateSnapshotComplete: true,
      candidateFindingsSnapshot: [{ key: 'pr-k2', rule: 'java:S1234', component: 'proj-pr-7:src/Other.java', line: 3, status: 'OPEN' }],
    };
    const result: any = await service.saveValidation(incident.id, contract);
    assert.equal(result.validation.regression.result, 'INCONCLUSIVE', 'TEST C: baseline SHA correlation drift -> INCONCLUSIVE');
    assert.notEqual(result.validation.regression.result, 'CLEAN');
    assert.equal(result.validation.regression.baselineSha, null, 'an uncorrelated baseline is never exposed as attributable');
    assert.equal(result.validation.regression.evidenceIntegrity.ok, false);
    assert.ok(result.validation.regression.evidenceIntegrity.reasons.includes('BASELINE_SHA_MISMATCH'));
  }

  // TEST E — candidate pagination incomplete: candidateFindingsSnapshot is
  // present (an array) but candidateSnapshotComplete is explicitly false
  // (or absent) -- must never be treated as complete merely because it is
  // an array.
  {
    const { incident, service } = makeFixture();
    const contract = {
      ...baseValidationContract(incident),
      candidateSnapshotComplete: false,
      candidateFindingsSnapshot: [{ key: 'pr-k2', rule: 'java:S1234', component: 'proj-pr-7:src/Other.java', line: 3, status: 'OPEN' }],
    };
    const result: any = await service.saveValidation(incident.id, contract);
    assert.equal(result.validation.regression.result, 'INCONCLUSIVE', 'TEST E: candidateSnapshotComplete=false -> INCONCLUSIVE despite a non-empty array');
    assert.notEqual(result.validation.regression.result, 'CLEAN');
    assert.deepEqual(result.validation.regression.evidenceIntegrity,
      { ok: false, reasons: ['CANDIDATE_SNAPSHOT_INCOMPLETE'] });
  }

  // Baseline completeness is explicit and length/total consistent; a partial
  // or legacy snapshot must fail closed even when its issues field is an array.
  for (const mutate of [
    (sonar: any) => { sonar.complete = false; },
    (sonar: any) => { sonar.collectedCount = 50; },
    (sonar: any) => { sonar.issues = sonar.issues.slice(0, 1); },
    (sonar: any) => { delete sonar.total; },
  ]) {
    const { incident, service } = makeFixture();
    mutate(incident.metadata.enrichedData.sonar);
    const result: any = await service.saveValidation(incident.id, {
      ...baseValidationContract(incident),
      candidateSnapshotComplete: true,
      candidateFindingsSnapshot: [],
    });
    assert.equal(result.validation.regression.result, 'INCONCLUSIVE', 'partial/missing baseline completeness metadata -> INCONCLUSIVE');
    assert.ok(result.validation.regression.decisionReasons.includes('EVIDENCE_INCOMPLETE'));
    assert.ok(result.validation.regression.evidenceIntegrity.reasons.includes('BASELINE_SNAPSHOT_INCOMPLETE'));
  }

  // An old incident with no explicit completeness contract is never upgraded
  // implicitly from Array.isArray(issues).
  {
    const { incident, service } = makeFixture();
    delete incident.metadata.enrichedData.sonar.total;
    delete incident.metadata.enrichedData.sonar.collectedCount;
    delete incident.metadata.enrichedData.sonar.complete;
    const result: any = await service.saveValidation(incident.id, {
      ...baseValidationContract(incident), candidateSnapshotComplete: true, candidateFindingsSnapshot: [],
    });
    assert.equal(result.validation.regression.result, 'INCONCLUSIVE', 'legacy baseline without completeness metadata -> INCONCLUSIVE');
  }

  // No persisted HEAD proof: complete scanner evidence alone cannot become CLEAN.
  {
    const { incident, service } = makeFixture();
    delete incident.metadata.prValidationRequest.headVerification;
    const result: any = await service.saveValidation(incident.id, {
      ...baseValidationContract(incident), candidateSnapshotComplete: true, candidateFindingsSnapshot: [],
    });
    assert.equal(result.validation.regression.scannerDiff.result, 'CLEAN');
    assert.equal(result.validation.regression.result, 'INCONCLUSIVE');
    assert.deepEqual(result.validation.regression.decisionReasons, ['HEAD_VERIFICATION_INCONCLUSIVE']);
    assert.equal(result.validation.mergeAuthorization.authorization, 'INCONCLUSIVE');
  }

  // Identity/non-PASS callback guards reject before persistence, unchanged.
  for (const mutate of [
    (incident: any, payload: any) => { payload.checkoutSha = OTHER_SHA; },
    (incident: any) => { incident.metadata.prValidationRequest.headVerification.overall = 'FAIL'; },
    (incident: any) => { incident.metadata.prValidationRequest.headVerification.identity.targetSha = OTHER_SHA; },
  ]) {
    const { incident, service } = makeFixture();
    const payload = { ...baseValidationContract(incident), candidateSnapshotComplete: true, candidateFindingsSnapshot: [] };
    mutate(incident, payload);
    const before = JSON.stringify(incident);
    await assert.rejects(() => service.saveValidation(incident.id, payload), /commit validé|preuve de vérification HEAD/);
    assert.equal(JSON.stringify(incident), before);
  }

  console.log('PR regression wiring (Brique 3 saveValidation integration): PASS');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
