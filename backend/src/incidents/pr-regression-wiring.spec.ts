import * as assert from 'node:assert/strict';
import { IncidentsService, buildPrValidationJobName } from './incidents.service';

// BRIQUE 3 (+ CLOSEOUT) — proves the saveValidation() wiring (not just the
// pure engine) end to end: (1) today's default behavior is unchanged when
// no baseline/candidate evidence is supplied; (2) the wiring genuinely
// activates and reaches CLEAN/CHANGES_REQUIRED once both are supplied and
// correlated; (3) the mandatory semantic separation between
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
      prValidationRequest: { validationRequestId: 'validation-1', status: 'QUEUED', expectedPrHeadSha: SHA },
      enrichedData: {
        sonar: {
          issues: [
            { key: 'k1', rule: 'java:S4684', component: 'proj:src/Dto.java', line: 12, status: 'OPEN' },
            { key: 'k2', rule: 'java:S1234', component: 'proj:src/Other.java', line: 3, status: 'OPEN' },
          ],
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
    assert.ok(result.validation.mergeAuthorization.blockingReasons.includes('REGRESSION_UNVERIFIED'));
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
    assert.ok(!result.validation.mergeAuthorization.blockingReasons.includes('REGRESSION_UNVERIFIED'));
    assert.ok(!result.validation.mergeAuthorization.blockingReasons.includes('REGRESSION_CHANGES_REQUIRED'));
  }

  // (3) The exact scenario from the Brique 3 mandate: approved findings all
  // VALID (remediationResult VALIDATED) but the PR introduces a new finding
  // -> regressionResult CHANGES_REQUIRED. Both are simultaneously true.
  {
    const { incident, service } = makeFixture();
    const contract = {
      ...baseValidationContract(incident),
      candidateSnapshotComplete: true,
      candidateFindingsSnapshot: [
        { key: 'pr-k2', rule: 'java:S1234', component: 'proj-pr-7:src/Other.java', line: 3, status: 'OPEN' }, // pre-existing
        { key: 'pr-new', rule: 'java:S9999', component: 'proj-pr-7:src/NewBug.java', line: 5, status: 'OPEN' }, // genuinely new
      ],
    };
    const result: any = await service.saveValidation(incident.id, contract);
    assert.equal(result.validation.validationStatus, 'VALIDATED', 'remediationResult stays VALIDATED -- the approved findings are still all VALID');
    assert.equal(result.validation.regression.result, 'CHANGES_REQUIRED', 'regressionResult independently reflects the newly introduced finding');
    assert.equal(result.validation.regression.introducedCount, 1);
    assert.equal(result.validation.regression.blockingIntroducedFindings.length, 1, 'the conservative production policy treats every introduced finding as blocking (Phase 6 design gap, documented)');
    assert.ok(result.validation.mergeAuthorization.blockingReasons.includes('REGRESSION_CHANGES_REQUIRED'));
    assert.equal(result.validation.mergeAuthorization.authorization, 'BLOCKED', 'a real regression blocks merge authorization even though remediation itself is VALIDATED');
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
  }

  console.log('PR regression wiring (Brique 3 saveValidation integration): PASS');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
