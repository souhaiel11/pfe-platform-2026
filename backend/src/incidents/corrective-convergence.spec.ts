import * as assert from 'node:assert/strict';
import { IncidentsService, buildPrValidationJobName } from './incidents.service';

// BRIQUE 5 — PHASE 13 Cases A/B/C/D/E(ineligibility)/F/G/H/I/J: the governed
// causal corrective convergence lifecycle on the SAME PR. Case L (Brique
// 1-4 regression) is the full existing suite re-run alongside this file.

const BASE = 'b'.repeat(40);
const SHA1 = '1'.repeat(40);
const SHA2 = '2'.repeat(40);
const REPO = 'owner/repo';
const JOB = 'project-job';
const PR = 25;

function makeFixture() {
  const incident: any = {
    id: 'incident-conv', projectId: 'project-1', status: 'validating',
    prUrl: `https://github.com/${REPO}/pull/${PR}`, jenkinsJobName: JOB, buildNumber: 140,
    metadata: {
      sourceCommitSha: BASE,
      enrichedData: { sonar: { issues: [
        { key: 'a-i', rule: 'java:S4684', component: `${JOB}:src/A.java`, line: 1, status: 'OPEN' },
        { key: 'b-i', rule: 'java:S4684', component: `${JOB}:src/B.java`, line: 1, status: 'OPEN' },
      ] } },
      fixRequest: {
        status: 'PR_CREATED', requestId: 'req-conv', batchId: 'batch-conv', batchKey: 'batch-conv',
        attemptCount: 1, findingId: 'a', findingIds: ['a', 'b'],
        findings: [{ findingId: 'a', file: 'src/A.java' }, { findingId: 'b', file: 'src/B.java' }],
        prNumber: PR, prHeadSha: SHA1, baselineSha: BASE,
        attempts: [{ attempt: 1, status: 'DISPATCHED' }],
      },
      prValidationRequest: { validationRequestId: 'vr-1', status: 'QUEUED', expectedPrHeadSha: SHA1, prValidationJob: buildPrValidationJobName(JOB, PR) },
    },
  };
  const project: any = { id: 'project-1', githubRepo: REPO, githubToken: null, jenkinsUrl: 'http://jenkins', jenkinsToken: 'user:x', jenkinsJobName: JOB, sonarqubeKey: 'key' };
  incident.project = project;
  const incidentRepo: any = { findOne: async () => incident, update: async (_id: string, patch: any) => Object.assign(incident, patch) };
  const projectRepo: any = { findOne: async () => project };
  let tail = Promise.resolve();
  const repository: any = {
    manager: { transaction: async (fn: any) => {
      const previous = tail; let release!: () => void;
      tail = new Promise<void>(resolve => { release = resolve; });
      await previous;
      try { return await fn({ getRepository: (entity: any) => entity?.name === 'Project' ? projectRepo : incidentRepo }); }
      finally { release(); }
    } },
    findOne: incidentRepo.findOne, update: incidentRepo.update,
  };
  const service = new IncidentsService(repository, projectRepo, { emit: () => undefined } as any, { syncIncident: async () => undefined } as any, {} as any);
  return { incident, project, service };
}

function validationPayload(sha: string, findingResults: any[], candidateFindingsSnapshot: any[]) {
  return {
    validationRequestId: 'vr-1', projectId: 'project-1', fixRequestId: 'req-conv',
    batchId: 'batch-conv', batchKey: 'batch-conv', attemptCount: 1, repository: REPO, prNumber: PR,
    prValidationJob: buildPrValidationJobName(JOB, PR), jenkinsJob: JOB, buildNumber: 3,
    expectedPrHeadSha: sha, checkoutSha: sha, ceTaskId: 'ce-1', analysisId: 'analysis-1',
    correlationVerified: true, sonarCorrelationVerified: true,
    requiredStages: ['build', 'tests', 'sonar'].map(stage => ({ stage, required: true, status: 'PASSED' })),
    jenkinsStatus: 'SUCCESS', sonarStatus: 'OK',
    findingResults, candidateSnapshotComplete: true, candidateFindingsSnapshot,
  };
}

function mockGithubAndWf2(incident: any, headSha: string, wf2Calls: { count: number }) {
  return (async (url: any) => {
    const value = String(url);
    if (value.includes('api.github.com')) {
      return new Response(JSON.stringify({ state: 'open', head: { sha: headSha, ref: `fix/pfe-${incident.id}-req-conv` } }), { status: 200 });
    }
    if (value.includes('webhook') || value.includes('n8n')) { wf2Calls.count++; return new Response('{}', { status: 200 }); }
    throw new Error(`unexpected URL ${value}`);
  }) as any;
}

const admin = { id: 'admin-1', role: 'admin' };

async function main() {
  const originalFetch = globalThis.fetch;

  // ══════════════════════════════════════════════════════════════════
  // CASE A + E(ineligibility) + G — full lifecycle: SHA1 BLOCKED (new
  // regression X) -> authorized correction -> SHA2 targets VALID, X gone,
  // no new regression -> MERGE_READY.
  // ══════════════════════════════════════════════════════════════════
  {
    const { incident, service } = makeFixture();

    // SHA1: both targets VALID, but a new finding X was introduced.
    globalThis.fetch = mockGithubAndWf2(incident, SHA1, { count: 0 });
    const v1: any = await service.saveValidation(incident.id, validationPayload(SHA1,
      [{ findingId: 'a', result: 'VALID', evidence: 'a absent' }, { findingId: 'b', result: 'VALID', evidence: 'b absent' }],
      [{ key: 'x', rule: 'java:S9999', component: `${JOB}-pr-25:src/X.java`, line: 1, status: 'OPEN' }],
    ));
    assert.equal(v1.validation.regression.result, 'CHANGES_REQUIRED');
    assert.equal(v1.validation.mergeAuthorization.authorization, 'BLOCKED', 'CASE A: BLOCKED by new regression');
    assert.equal(v1.validation.mergeAuthorization.correctiveActionAllowed, true, 'CASE A: correctiveActionAllowed=true for a proven-defect BLOCKED');

    // CASE E (ineligibility check, positive control): the extracted causal
    // context must carry the proven cause, never invented.
    const wf2Calls = { count: 0 };
    globalThis.fetch = mockGithubAndWf2(incident, SHA1, wf2Calls);
    const authorized: any = await service.correctAndRevalidate(incident.id, admin);
    assert.equal(authorized.duplicate, false);
    assert.equal(wf2Calls.count, 1, 'CASE A: exactly one WF2 corrective dispatch');
    assert.equal(authorized.correctiveContext.blockingCauses.length, 1);
    assert.equal(authorized.correctiveContext.blockingCauses[0].type, 'NEW_BLOCKING_FINDING');
    assert.equal(authorized.correctiveContext.blockingCauses[0].rule, 'java:S9999');
    assert.equal(authorized.correctiveContext.previousValidatedSha, SHA1);

    // Lineage preserved: SAME incident/request/batch/PR, findingIds untouched.
    assert.equal(incident.metadata.fixRequest.requestId, 'req-conv');
    assert.equal(incident.metadata.fixRequest.batchId, 'batch-conv');
    assert.deepEqual(incident.metadata.fixRequest.findingIds, ['a', 'b'], 'CASE A: original approved batch is immutable');
    assert.equal(incident.metadata.fixRequest.prNumber, PR);
    assert.equal(incident.metadata.fixRequest.baselineSha, BASE, 'CASE E: originalBaselineSha never changes');
    assert.equal(incident.metadata.fixRequest.attemptCount, 2, 'attempt incremented');
    assert.equal(incident.metadata.fixRequest.status, 'DISPATCHED');
    assert.equal(incident.prUrl, `https://github.com/${REPO}/pull/${PR}`, 'CASE D: same PR URL, never a second PR');

    // Simulate WF2's corrective callback landing the SAME PR with a NEW head.
    incident.metadata.prValidationRequest = { validationRequestId: 'vr-2', status: 'QUEUED', expectedPrHeadSha: SHA2, prValidationJob: buildPrValidationJobName(JOB, PR) };

    // SHA2: X is gone, both targets re-verified VALID, no new regression -> MERGE_READY.
    const v2: any = await service.saveValidation(incident.id, {
      ...validationPayload(SHA2,
        [{ findingId: 'a', result: 'VALID', evidence: 'a absent on SHA2' }, { findingId: 'b', result: 'VALID', evidence: 'b absent on SHA2' }],
        [],
      ),
      validationRequestId: 'vr-2', attemptCount: 2,
    });
    assert.equal(v2.validation.regression.result, 'CLEAN', 'CASE G: X removed, no new regression');
    assert.equal(v2.validation.mergeAuthorization.authorization, 'MERGE_READY', 'CASE G: successful convergence');
    assert.equal(v2.validation.mergeAuthorization.authorizedSha, SHA2, 'CASE G: authorizedSha == SHA2');
  }

  // ══════════════════════════════════════════════════════════════════
  // CASE B — double-click authorization: exactly ONE WF2 corrective dispatch.
  // ══════════════════════════════════════════════════════════════════
  {
    const { incident, service } = makeFixture();
    globalThis.fetch = mockGithubAndWf2(incident, SHA1, { count: 0 });
    await service.saveValidation(incident.id, validationPayload(SHA1,
      [{ findingId: 'a', result: 'VALID', evidence: 'a' }, { findingId: 'b', result: 'INVALID', evidence: 'still open' }],
      [],
    ));
    assert.equal(incident.metadata.validation.mergeAuthorization.authorization, 'BLOCKED');

    const wf2Calls = { count: 0 };
    globalThis.fetch = mockGithubAndWf2(incident, SHA1, wf2Calls);
    const [r1, r2] = await Promise.all([
      service.correctAndRevalidate(incident.id, admin),
      service.correctAndRevalidate(incident.id, admin),
    ]);
    assert.equal(wf2Calls.count, 1, 'CASE B: exactly one WF2 corrective dispatch despite the double-click');
    const duplicates = [r1, r2].filter((r: any) => r.duplicate);
    assert.equal(duplicates.length, 1, 'CASE B: exactly one of the two concurrent calls is recognized as a duplicate');
  }

  // ══════════════════════════════════════════════════════════════════
  // CASE C — INCONCLUSIVE infrastructure failure: correctiveActionAllowed
  // false, "Corriger et revalider" unavailable, correctAndRevalidate rejects.
  // ══════════════════════════════════════════════════════════════════
  {
    const { incident, service } = makeFixture();
    globalThis.fetch = mockGithubAndWf2(incident, SHA1, { count: 0 });
    // correlationVerified:false -> INCONCLUSIVE (uncertain evidence, never a proven defect).
    const v: any = await service.saveValidation(incident.id, { ...validationPayload(SHA1,
      [{ findingId: 'a', result: 'VALID', evidence: 'a' }, { findingId: 'b', result: 'VALID', evidence: 'b' }], []),
      correlationVerified: false });
    assert.equal(v.validation.mergeAuthorization.authorization, 'INCONCLUSIVE');
    assert.equal(v.validation.mergeAuthorization.correctiveActionAllowed, false, 'CASE C: correctiveActionAllowed=false for INCONCLUSIVE');
    await assert.rejects(() => service.correctAndRevalidate(incident.id, admin), /bloquée par un défaut prouvé/);
    assert.equal(incident.metadata.fixRequest.attemptCount, 1, 'CASE C: no attempt was authorized');
  }

  // ══════════════════════════════════════════════════════════════════
  // CASE F — original target revalidation: A/B VALID on SHA1; correction
  // produces SHA2 where A becomes INVALID (accidentally reintroduced) ->
  // BLOCKED, never reusing SHA1's A=VALID.
  // ══════════════════════════════════════════════════════════════════
  {
    const { incident, service } = makeFixture();
    globalThis.fetch = mockGithubAndWf2(incident, SHA1, { count: 0 });
    await service.saveValidation(incident.id, validationPayload(SHA1,
      [{ findingId: 'a', result: 'VALID', evidence: 'a absent' }, { findingId: 'b', result: 'VALID', evidence: 'b absent' }],
      [{ key: 'x', rule: 'java:S9999', component: `${JOB}-pr-25:src/X.java`, line: 1, status: 'OPEN' }],
    ));
    assert.equal(incident.metadata.validation.mergeAuthorization.authorization, 'BLOCKED');
    globalThis.fetch = mockGithubAndWf2(incident, SHA1, { count: 0 });
    await service.correctAndRevalidate(incident.id, admin);
    incident.metadata.prValidationRequest = { validationRequestId: 'vr-2', status: 'QUEUED', expectedPrHeadSha: SHA2, prValidationJob: buildPrValidationJobName(JOB, PR) };
    const v2: any = await service.saveValidation(incident.id, {
      ...validationPayload(SHA2,
        [{ findingId: 'a', result: 'INVALID', evidence: 'a reintroduced on SHA2' }, { findingId: 'b', result: 'VALID', evidence: 'b absent' }],
        [],
      ),
      validationRequestId: 'vr-2', attemptCount: 2,
    });
    assert.equal(v2.validation.validationStatus, 'INVALID', 'CASE F: A is INVALID on SHA2, never reused as VALID from SHA1');
    assert.equal(v2.validation.mergeAuthorization.authorization, 'BLOCKED');
    assert.ok(v2.validation.mergeAuthorization.blockingReasons.includes('FINDING_INVALID'));
  }

  // ══════════════════════════════════════════════════════════════════
  // CASE H — second regression on the corrective attempt itself: BLOCKED
  // again, and NO automatic attempt 3 (a human must explicitly re-authorize).
  // ══════════════════════════════════════════════════════════════════
  {
    const { incident, service } = makeFixture();
    globalThis.fetch = mockGithubAndWf2(incident, SHA1, { count: 0 });
    await service.saveValidation(incident.id, validationPayload(SHA1,
      [{ findingId: 'a', result: 'VALID', evidence: 'a' }, { findingId: 'b', result: 'VALID', evidence: 'b' }],
      [{ key: 'x', rule: 'java:S9999', component: `${JOB}-pr-25:src/X.java`, line: 1, status: 'OPEN' }],
    ));
    globalThis.fetch = mockGithubAndWf2(incident, SHA1, { count: 0 });
    await service.correctAndRevalidate(incident.id, admin);
    incident.metadata.prValidationRequest = { validationRequestId: 'vr-2', status: 'QUEUED', expectedPrHeadSha: SHA2, prValidationJob: buildPrValidationJobName(JOB, PR) };
    const v2: any = await service.saveValidation(incident.id, {
      ...validationPayload(SHA2,
        [{ findingId: 'a', result: 'VALID', evidence: 'a' }, { findingId: 'b', result: 'VALID', evidence: 'b' }],
        [{ key: 'y', rule: 'java:S8888', component: `${JOB}-pr-25:src/Y.java`, line: 1, status: 'OPEN' }],
      ),
      validationRequestId: 'vr-2', attemptCount: 2,
    });
    assert.equal(v2.validation.regression.result, 'CHANGES_REQUIRED', 'CASE H: Y is a second regression');
    assert.equal(v2.validation.mergeAuthorization.authorization, 'BLOCKED');
    assert.equal(incident.metadata.fixRequest.attemptCount, 2, 'CASE H: no automatic attempt 3 was dispatched');
  }

  // ══════════════════════════════════════════════════════════════════
  // CASE I — PR changed externally before correction was authorized: fail
  // closed, no force overwrite, no automatic new PR.
  // ══════════════════════════════════════════════════════════════════
  {
    const { incident, service } = makeFixture();
    globalThis.fetch = mockGithubAndWf2(incident, SHA1, { count: 0 });
    await service.saveValidation(incident.id, validationPayload(SHA1,
      [{ findingId: 'a', result: 'INVALID', evidence: 'still open' }, { findingId: 'b', result: 'VALID', evidence: 'b' }],
      [],
    ));
    assert.equal(incident.metadata.validation.mergeAuthorization.authorization, 'BLOCKED');
    // The live PR head has moved to an unrelated, ungoverned commit.
    const driftedSha = 'd'.repeat(40);
    const wf2Calls = { count: 0 };
    globalThis.fetch = mockGithubAndWf2(incident, driftedSha, wf2Calls);
    await assert.rejects(() => service.correctAndRevalidate(incident.id, admin), /a changé depuis le blocage/);
    assert.equal(wf2Calls.count, 0, 'CASE I: WF2 never dispatched');
    assert.equal(incident.metadata.fixRequest.attemptCount, 1, 'CASE I: no attempt authorized');
  }

  // ══════════════════════════════════════════════════════════════════
  // CASE J — expected PR closed: no new PR, deterministic failure.
  // ══════════════════════════════════════════════════════════════════
  {
    const { incident, service } = makeFixture();
    globalThis.fetch = mockGithubAndWf2(incident, SHA1, { count: 0 });
    await service.saveValidation(incident.id, validationPayload(SHA1,
      [{ findingId: 'a', result: 'INVALID', evidence: 'still open' }, { findingId: 'b', result: 'VALID', evidence: 'b' }],
      [],
    ));
    const wf2Calls = { count: 0 };
    globalThis.fetch = (async (url: any) => {
      const value = String(url);
      if (value.includes('api.github.com')) return new Response(JSON.stringify({ state: 'closed', head: { sha: SHA1, ref: `fix/pfe-${incident.id}-req-conv` } }), { status: 200 });
      wf2Calls.count++; return new Response('{}', { status: 200 });
    }) as any;
    await assert.rejects(() => service.correctAndRevalidate(incident.id, admin), /n’est plus ouverte/);
    assert.equal(wf2Calls.count, 0, 'CASE J: WF2 never dispatched, no replacement PR created');
    assert.equal(incident.metadata.fixRequest.attemptCount, 1);
  }

  globalThis.fetch = originalFetch;
  console.log('Corrective convergence lifecycle (Brique 5, Cases A-D/F-J): PASS');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
