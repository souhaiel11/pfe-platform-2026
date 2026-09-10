import * as assert from 'node:assert/strict';
import { IncidentsService, buildPrValidationJobName, remediationBatchIdentity } from './incidents.service';
import { evaluateReadiness } from '../common/governance';

// BRIQUE 4 — PHASE 9 Cases A-D/F/K + the PR #25 semantic acceptance scenario.
// Case E (verifier unavailable) and Cases G/H/I/J (VALIDATING, automatic
// initial validation, idempotency, PR-changed-after-authorization) are
// covered in pr-validation-head-verification.spec.ts and
// automatic-pr-validation.spec.ts respectively. Case L (Brique 1/2/3
// regression) is the full existing suite re-run alongside this file.

const SHA = '8a315b0dd508eb9843bb3037fe2827f02f6faa78';
const REPO = 'souhaiel11/pfe-app-test';
const JOB = 'pfe-app-test';
const PR = 25;

function makeHarness(overrides: { baselineIssues?: any[] } = {}) {
  const requestId = 'fixreq-1';
  const batchId = remediationBatchIdentity('incident-pr25', ['a', 'b']);
  const historicalIssues = Array.from({ length: 14 }, (_, i) => ({
    key: `hist-${i}`, rule: `java:S${1000 + i}`, component: `${JOB}:src/main/java/com/pfe/devsecops/Other${i}.java`, line: 1, status: 'OPEN',
  }));
  const s4684 = [
    { key: 's4684-a', rule: 'java:S4684', component: `${JOB}:src/main/java/com/pfe/devsecops/dto/TaskDTO.java`, line: 12, status: 'OPEN' },
    { key: 's4684-b', rule: 'java:S4684', component: `${JOB}:src/main/java/com/pfe/devsecops/dto/TaskController.java`, line: 34, status: 'OPEN' },
  ];
  const incident: any = {
    id: 'incident-pr25', projectId: 'project-1', status: 'validating',
    prUrl: `https://github.com/${REPO}/pull/${PR}`,
    jenkinsJobName: JOB, buildNumber: 140,
    project: { id: 'project-1', githubRepo: REPO },
    metadata: {
      sourceCommitSha: SHA,
      enrichedData: { sonar: {
        issues: overrides.baselineIssues ?? [...historicalIssues, ...s4684],
        total: (overrides.baselineIssues ?? [...historicalIssues, ...s4684]).length,
        collectedCount: (overrides.baselineIssues ?? [...historicalIssues, ...s4684]).length,
        pageSize: 500,
        complete: true,
        snapshotError: null,
      } },
      fixRequest: {
        status: 'PR_CREATED', requestId, batchId, batchKey: batchId, attemptCount: 1,
        findingId: 'a', findingIds: ['a', 'b'], prNumber: PR, prHeadSha: SHA, validationTargetSha: SHA,
        baselineSha: SHA,
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

function baseValidationPayload(over: any, findingResults: any[], candidateFindingsSnapshot: any[]) {
  const { batchId } = over;
  return {
    validationRequestId: 'vr-1', projectId: 'project-1', fixRequestId: over.requestId,
    batchId, batchKey: batchId, attemptCount: 1, repository: REPO, prNumber: PR,
    prValidationJob: buildPrValidationJobName(JOB, PR), jenkinsJob: JOB, buildNumber: 3,
    expectedPrHeadSha: SHA, checkoutSha: SHA, ceTaskId: 'ce-1', analysisId: 'analysis-1',
    correlationVerified: true, sonarCorrelationVerified: true,
    requiredStages: ['build', 'tests', 'sonar'].map(stage => ({ stage, required: true, status: 'PASSED' })),
    jenkinsStatus: 'SUCCESS', sonarStatus: 'ERROR', // global Sonar QG remains ERROR throughout -- must never flip the outcome
    findingResults,
    candidateSnapshotComplete: true, candidateFindingsSnapshot,
  };
}

async function main() {
  // ══════════════════════════════════════════════════════════════════
  // PR #25 SEMANTIC ACCEPTANCE — the critical regression test.
  // ══════════════════════════════════════════════════════════════════
  {
    const { service, incident, requestId, batchId } = makeHarness();
    // Candidate: the 2 approved S4684 findings are CLOSED/FIXED; the 14
    // historical findings remain, at different lines (irrelevant to identity).
    const candidateFindingsSnapshot = Array.from({ length: 14 }, (_, i) => ({
      key: `pr-hist-${i}`, rule: `java:S${1000 + i}`, component: `${JOB}-pr-25:src/main/java/com/pfe/devsecops/Other${i}.java`, line: 99, status: 'OPEN',
    }));
    const res: any = await service.saveValidation('incident-pr25', baseValidationPayload(
      { requestId, batchId },
      [
        { findingId: 'a', result: 'VALID', evidence: 'sonar exact-sha a: approved finding absent' },
        { findingId: 'b', result: 'VALID', evidence: 'sonar exact-sha b: approved finding absent' },
      ],
      candidateFindingsSnapshot,
    ));

    const v = res.validation;
    assert.equal(v.validationStatus, 'VALIDATED', 'PR#25: remediationResult VALIDATED (2/2 approved findings VALID)');
    assert.equal(v.regression.result, 'CLEAN', 'PR#25: regressionResult CLEAN');
    assert.equal(v.regression.resolvedCount, 2, 'PR#25: both S4684 resolved');
    assert.equal(v.regression.preExistingCount, 14, 'PR#25: 14 historical findings remain, pre-existing');
    assert.equal(v.regression.introducedCount, 0, 'PR#25: no new finding');
    assert.equal(v.sonarStatus, 'ERROR', 'PR#25: global Sonar Quality Gate remains ERROR, visible and unmodified');

    const ma = v.mergeAuthorization;
    assert.equal(ma.authorization, 'MERGE_READY', 'PR#25: mergeAuthorization MERGE_READY despite global QG ERROR');
    assert.equal(ma.authorizedSha, SHA, 'PR#25: authorizedSha == the exact validated SHA');
    assert.equal(ma.remediationResult, 'VALIDATED');
    assert.equal(ma.regressionResult, 'CLEAN');
    assert.deepEqual(ma.blockingReasons, []);
    assert.deepEqual(ma.technicalReasons, []);
    assert.ok(ma.advisories.some((a: any) => a.code === 'SONAR_QUALITY_GATE_ERROR'), 'PR#25: global QG surfaces only as an advisory');

    // CASE K — deployment separation: MERGE_READY + global QG ERROR must
    // still mean deploymentReady=false. governance.ts/evaluateReadiness is
    // untouched and independently still gates on sonarStatus==='OK'.
    const readiness = evaluateReadiness({
      currentBuild: incident.buildNumber, validatedBuild: incident.buildNumber,
      validationPassed: v.passed, correlationVerified: v.correlationVerified,
      sonarRequired: true, sonarCorrelationVerified: true, sonarStatus: v.sonarStatus,
      unresolvedBlockingCount: 0, fixRequestStatus: incident.metadata.fixRequest.status,
      stages: [{ stage: 'build', status: 'PASSED' }, { stage: 'tests', status: 'PASSED' }, { stage: 'sonar', status: 'PASSED' }],
    });
    assert.equal(readiness.ready, false, 'CASE K: deploymentReady is false — MERGE_READY != DEPLOY_READY');
    assert.equal(readiness.status, 'NOT_READY');
    assert.ok(readiness.blockingReasons.some(r => r.includes('Quality Gate')), 'CASE K: the real reason is visible — the global Sonar QG');

    // incident.status / fixRequest.status are consistent with the merge
    // authorization (both reflect a genuinely successful remediation).
    assert.equal(incident.status, 'completed');
    assert.equal(incident.metadata.fixRequest.status, 'VALIDATED');
  }

  // ------------------------------------------------------------------
  // CASE B — approved finding INVALID => remediationResult INVALID,
  // mergeAuthorization BLOCKED.
  // ------------------------------------------------------------------
  {
    const { service, requestId, batchId } = makeHarness();
    const res: any = await service.saveValidation('incident-pr25', baseValidationPayload(
      { requestId, batchId },
      [
        { findingId: 'a', result: 'INVALID', evidence: 'sonar exact-sha a: issue still open' },
        { findingId: 'b', result: 'VALID', evidence: 'sonar exact-sha b: approved finding absent' },
      ],
      [],
    ));
    assert.equal(res.validation.validationStatus, 'INVALID', 'CASE B: remediationResult INVALID');
    assert.equal(res.validation.mergeAuthorization.authorization, 'BLOCKED', 'CASE B: mergeAuthorization BLOCKED');
    assert.ok(res.validation.mergeAuthorization.blockingReasons.includes('FINDING_INVALID'));
    assert.equal(res.validation.mergeAuthorization.authorizedSha, null);
  }

  // ------------------------------------------------------------------
  // CASE C — new regression (regressionResult=CHANGES_REQUIRED) =>
  // mergeAuthorization BLOCKED, even though remediation is VALIDATED.
  // ------------------------------------------------------------------
  {
    const { service, requestId, batchId } = makeHarness();
    const res: any = await service.saveValidation('incident-pr25', baseValidationPayload(
      { requestId, batchId },
      [
        { findingId: 'a', result: 'VALID', evidence: 'a absent' },
        { findingId: 'b', result: 'VALID', evidence: 'b absent' },
      ],
      [{ key: 'pr-new', rule: 'java:S9999', component: `${JOB}-pr-25:src/main/java/com/pfe/devsecops/NewBug.java`, line: 5, status: 'OPEN' }],
    ));
    assert.equal(res.validation.validationStatus, 'VALIDATED', 'CASE C: remediationResult VALIDATED (target findings are fine)');
    assert.equal(res.validation.regression.result, 'CHANGES_REQUIRED', 'CASE C: a genuinely new finding was introduced');
    assert.equal(res.validation.mergeAuthorization.authorization, 'BLOCKED', 'CASE C: mergeAuthorization BLOCKED by the new regression');
    assert.ok(res.validation.mergeAuthorization.blockingReasons.includes('REGRESSION_CHANGES_REQUIRED'));
    assert.equal(res.validation.mergeAuthorization.authorizedSha, null);
  }

  // ------------------------------------------------------------------
  // CASE D — candidate evidence ambiguous (regressionResult=INCONCLUSIVE)
  // => mergeAuthorization INCONCLUSIVE, never BLOCKED, never MERGE_READY.
  // ------------------------------------------------------------------
  {
    // Baseline collision: two occurrences of the same (rule, path) with
    // different messages; candidate has one with a THIRD, unrelated message
    // -- insufficient evidence to pair confidently => ambiguous => INCONCLUSIVE.
    const collisionBaseline = [
      { key: 'dup-a', rule: 'java:S1', component: `${JOB}:src/Dup.java`, line: 1, message: 'first', status: 'OPEN' },
      { key: 'dup-b', rule: 'java:S1', component: `${JOB}:src/Dup.java`, line: 2, message: 'second', status: 'OPEN' },
    ];
    const { service, requestId, batchId } = makeHarness({ baselineIssues: collisionBaseline });
    const res: any = await service.saveValidation('incident-pr25', baseValidationPayload(
      { requestId, batchId },
      [
        { findingId: 'a', result: 'VALID', evidence: 'a absent' },
        { findingId: 'b', result: 'VALID', evidence: 'b absent' },
      ],
      [{ key: 'dup-c', rule: 'java:S1', component: `${JOB}-pr-25:src/Dup.java`, line: 50, message: 'third', status: 'OPEN' }],
    ));
    assert.equal(res.validation.regression.result, 'INCONCLUSIVE', 'CASE D: ambiguous collision evidence');
    assert.ok(res.validation.regression.ambiguousCount > 0);
    assert.equal(res.validation.mergeAuthorization.authorization, 'INCONCLUSIVE', 'CASE D: mergeAuthorization INCONCLUSIVE');
    assert.deepEqual(res.validation.mergeAuthorization.blockingReasons, [], 'CASE D: never fabricated as a proven defect');
    assert.ok(res.validation.mergeAuthorization.technicalReasons.includes('REGRESSION_UNVERIFIED'));
    assert.equal(res.validation.mergeAuthorization.authorizedSha, null);
  }

  // ------------------------------------------------------------------
  // CASE F — exact correlation/SHA not verified (WF3 reports
  // correlationVerified=false, even though the raw SHAs match syntactically)
  // => INCONCLUSIVE, never MERGE_READY, never BLOCKED.
  // ------------------------------------------------------------------
  {
    const { service, requestId, batchId } = makeHarness();
    const payload = {
      ...baseValidationPayload({ requestId, batchId }, [
        { findingId: 'a', result: 'VALID', evidence: 'a absent' },
        { findingId: 'b', result: 'VALID', evidence: 'b absent' },
      ], []),
      correlationVerified: false, // WF3 itself could not prove the correlation
    };
    const res: any = await service.saveValidation('incident-pr25', payload);
    assert.notEqual(res.validation.mergeAuthorization.authorization, 'MERGE_READY', 'CASE F: never MERGE_READY without verified correlation');
    assert.notEqual(res.validation.mergeAuthorization.authorization, 'BLOCKED', 'CASE F: unverified correlation is uncertain, not a proven defect');
    assert.equal(res.validation.mergeAuthorization.authorization, 'INCONCLUSIVE');
    assert.ok(res.validation.mergeAuthorization.technicalReasons.includes('SHA_MISMATCH'));
    assert.equal(res.validation.mergeAuthorization.authorizedSha, null);
  }

  console.log('Merge authorization acceptance (Brique 4, PR#25 + Cases B/C/D/K): PASS');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
