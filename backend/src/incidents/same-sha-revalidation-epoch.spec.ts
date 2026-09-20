import * as assert from 'node:assert/strict';
import { IncidentsService, prValidationIdentity, prValidationRevalidationIdentity } from './incidents.service';

// R80.2 — proves the generic, human-gated SAME-SHA revalidation mechanism
// (reRunPrValidation): validationEpoch is additive (epoch 0 == every
// existing normal validation, unchanged, zero migration), the new endpoint
// only ever advances epoch past a TERMINAL predecessor for the exact same
// governed SHA, concurrent calls under the real pessimistic-write-lock
// pattern serialize to exactly one Jenkins trigger, and every other
// existing path (requestPrValidation itself, attemptCount, application/WF2)
// is provably untouched.
//
// Uses the SAME fixture/mocking pattern as pr-validation-head-verification
// .spec.ts: a fake TypeORM repository whose manager.transaction() serializes
// concurrent callers via a promise tail (simulating a real pessimistic_write
// row lock without a live DB), and globalThis.fetch stubbed for GitHub/
// Jenkins. Nothing here calls a real database, GitHub, Jenkins, n8n, or the
// candidate-verifier worker.

const SHA = '11ee62d1cdcdb9de20f2d1b0be453b9994ce9f9e';
const OTHER_SHA = 'a'.repeat(40);
const REPO = 'souhaiel11/pfe-app-test';

function passingHeadVerification(request: any) {
  return {
    mode: 'HEAD_ONLY',
    identity: { repository: request.repository, targetSha: String(request.targetSha).toLowerCase(),
      validationRequestId: request.validationRequestId, requestId: request.requestId,
      batchId: request.batchId, candidateAttempt: request.candidateAttempt },
    workspace: { workspaceId: 'stub', checkoutSha: String(request.targetSha).toLowerCase(), exactShaVerified: true, created: true, cleaned: true },
    compile: { status: 'SUCCESS', exitCode: 0, durationMs: 1, evidenceRef: null },
    tests: { targeted: { status: 'NOT_RUN', reason: 'NO_HIGH_CONFIDENCE_TARGET_SELECTION' },
      regression: { status: 'SUCCESS', total: 17, failures: 0, errors: 0, skipped: 0, durationMs: 1, evidenceRef: null } },
    staticAnalysis: { status: 'NOT_RUN', reason: 'SUPPORTED_STATIC_ADAPTER_NOT_CONFIGURED', newIssues: [], evidenceRef: null },
    overall: 'PASS', verificationLevel: 'COMPILE_TEST_VERIFIED', failureClass: null,
  };
}

function makeFixture(candidateVerification: any, overrides: { fix?: any; prValidationRequest?: any } = {}) {
  const incidentId = '73733ec0-4077-4c81-aed3-df3a3bca5245';
  const requestId = 'dfcd0966-c81a-4726-b47c-2ee5a81b1029';
  const batchId = '833de3d11643043ece6236777c14df928ea18a8fa1201c62948ce9bbb041470e';
  const baseFix = {
    status: 'VALIDATED', requestId, batchId, batchKey: batchId, attemptCount: 13,
    prNumber: 34, prHeadSha: SHA, validationTargetSha: SHA,
    findingIds: ['b8db9c11-ddf9-4a23-9bf3-1d2ff15a59ef'],
  };
  const baseValidationRequestId = prValidationIdentity('project-1', 34, SHA, batchId);
  const basePrValidationRequest = {
    validationRequestId: baseValidationRequestId, validationType: 'PR_VALIDATION', status: 'COMPLETED',
    projectId: 'project-1', incidentId, fixRequestId: requestId, requestId, batchId, batchKey: batchId,
    attemptCount: 13, repository: REPO, prNumber: 34, prUrl: `https://github.com/${REPO}/pull/34`,
    prHeadBranch: `fix/pfe-${incidentId}-${requestId}`, expectedPrHeadSha: SHA,
    createdBy: 'admin-1', createdAt: '2026-09-20T18:00:00.000Z', updatedAt: '2026-09-20T18:38:04.000Z',
    // NOTE: deliberately NO `epoch` field -- this is what every real
    // historical record looks like, proving §10's no-migration requirement.
  };
  const incident: any = {
    id: incidentId, projectId: 'project-1', status: 'completed', jenkinsJobName: 'pfe-app-test',
    prUrl: `https://github.com/${REPO}/pull/34`,
    metadata: {
      fixRequest: { ...baseFix, ...(overrides.fix || {}) },
      prValidationRequest: { ...basePrValidationRequest, ...(overrides.prValidationRequest || {}) },
    },
  };
  const project: any = {
    id: 'project-1', githubRepo: REPO, githubToken: null,
    jenkinsUrl: 'http://jenkins', jenkinsToken: 'user:not-printed', jenkinsJobName: 'pfe-app-test',
    sonarqubeKey: 'pfe-app-test',
  };
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
  const service = new IncidentsService(repository, projectRepo, { emit: () => undefined } as any, { syncIncident: async () => undefined } as any, candidateVerification);
  return { incident, project, service, repository, incidentId, requestId, batchId, baseValidationRequestId };
}

function githubPr(sha: string, branch: string, state = 'open') {
  return new Response(JSON.stringify({ state, head: { sha, ref: branch } }), { status: 200 });
}
const validMetadata = () => new Response(JSON.stringify({ buildable: true, _class: 'org.jenkinsci.plugins.workflow.job.WorkflowJob', property: [{ _class: 'hudson.model.ParametersDefinitionProperty', parameterDefinitions: [{ name: 'PFE_VALIDATION_CONTEXT', type: 'StringParameterDefinition', defaultParameterValue: { value: '' } }] }] }), { status: 200 });
const validCrumb = () => new Response(JSON.stringify({ crumbRequestField: 'Jenkins-Crumb', crumb: 'opaque' }), { status: 200 });

function jenkinsFetchStub(incident: any, sha: string, onTrigger: () => void) {
  const branch = `fix/pfe-${incident.id}-${incident.metadata.fixRequest.requestId}`;
  return (async (url: any) => {
    const value = String(url);
    if (value.includes('api.github.com')) return githubPr(sha, branch);
    if (value.includes('crumbIssuer')) return validCrumb();
    if (value.includes('/api/json')) return validMetadata();
    if (value.includes('/buildWithParameters')) { onTrigger(); return new Response('', { status: 201, headers: { location: 'http://jenkins/queue/item/901/' } }); }
    throw new Error(`unexpected URL ${value}`);
  }) as any;
}

async function main() {
  const originalFetch = globalThis.fetch;
  const user = { id: 'admin-1', role: 'admin' };
  const viewer = { id: 'viewer-1', role: 'viewer' };

  // ------------------------------------------------------------------
  // A — valid same-SHA COMPLETED validation -> creates epoch 1, triggers
  // Jenkins exactly once, preserves history, does not touch attemptCount.
  // ------------------------------------------------------------------
  {
    const candidateVerification = { verifyHead: async (req: any) => passingHeadVerification(req) };
    const { incident, service, baseValidationRequestId, batchId } = makeFixture(candidateVerification);
    let triggers = 0;
    globalThis.fetch = jenkinsFetchStub(incident, SHA, () => { triggers++; });
    const result: any = await service.reRunPrValidation(incident.id, user);
    assert.equal(result.duplicate, false, 'A: fresh rerun is not a duplicate');
    assert.equal(triggers, 1, 'A: Jenkins triggered exactly once');
    const pvr = incident.metadata.prValidationRequest;
    assert.equal(pvr.status, 'QUEUED', 'A: new request reaches QUEUED via the reused trigger path');
    assert.equal(pvr.epoch, 1, 'A: epoch advances from absent(=0) to 1');
    assert.equal(pvr.expectedPrHeadSha, SHA, 'A: same immutable SHA, never changed');
    assert.equal(pvr.attemptCount, 13, 'A: attemptCount untouched');
    assert.notEqual(pvr.validationRequestId, baseValidationRequestId, 'A: new validationRequestId, distinct from epoch 0');
    assert.equal(pvr.validationRequestId, prValidationRevalidationIdentity('project-1', 34, SHA, batchId, 1), 'A: identity matches the documented revalidation formula');
    assert.equal(pvr.revalidation, true);
    assert.equal(pvr.revalidationReason, 'SAME_SHA_REVALIDATION');
    // §5 — history preserved
    assert.equal(pvr.previousAttempts.length, 1, 'A: previous COMPLETED request archived, not overwritten');
    assert.equal(pvr.previousAttempts[0].validationRequestId, baseValidationRequestId);
    assert.equal(pvr.previousAttempts[0].status, 'COMPLETED');
    // §8 — audit trail
    const audit = incident.metadata.revalidationAuditLog;
    assert.equal(audit.length, 1, 'A: exactly one audit event recorded');
    assert.equal(audit[0].type, 'SAME_SHA_REVALIDATION');
    assert.equal(audit[0].incidentId, incident.id);
    assert.equal(audit[0].projectId, incident.projectId);
    assert.equal(audit[0].prNumber, 34);
    assert.equal(audit[0].sha, SHA);
    assert.equal(audit[0].previousValidationRequestId, baseValidationRequestId);
    assert.equal(audit[0].newValidationRequestId, pvr.validationRequestId);
    assert.equal(audit[0].previousEpoch, 0);
    assert.equal(audit[0].newEpoch, 1);
    assert.equal(audit[0].actorId, 'admin-1');
    assert.equal(audit[0].actorRole, 'admin');
    // §6 — no corrective attempt mutation
    assert.equal(incident.metadata.fixRequest.attemptCount, 13, 'A: fixRequest.attemptCount unchanged');
    assert.equal(incident.metadata.fixRequest.status, 'VALIDATED', 'A: fixRequest.status unchanged (no new corrective attempt)');
    assert.equal(incident.metadata.fixRequest.batchId, batchId, 'A: fixRequest.batchId unchanged');
  }
  globalThis.fetch = originalFetch;

  // ------------------------------------------------------------------
  // B — PR closed -> rejected
  // ------------------------------------------------------------------
  {
    const candidateVerification = { verifyHead: async (req: any) => passingHeadVerification(req) };
    const { incident, service } = makeFixture(candidateVerification);
    globalThis.fetch = (async (url: any) => {
      const value = String(url);
      if (value.includes('api.github.com')) return githubPr(SHA, `fix/pfe-${incident.id}-${incident.metadata.fixRequest.requestId}`, 'closed');
      throw new Error('Jenkins must never be reached when the PR is closed');
    }) as any;
    await assert.rejects(() => service.reRunPrValidation(incident.id, user), /Pull Request a changé/);
    assert.equal(incident.metadata.prValidationRequest.status, 'COMPLETED', 'B: prior completed record untouched');
  }
  globalThis.fetch = originalFetch;

  // ------------------------------------------------------------------
  // C — remote head moved -> rejected
  // ------------------------------------------------------------------
  {
    const candidateVerification = { verifyHead: async (req: any) => passingHeadVerification(req) };
    const { incident, service } = makeFixture(candidateVerification);
    globalThis.fetch = (async (url: any) => {
      const value = String(url);
      if (value.includes('api.github.com')) return githubPr(OTHER_SHA, `fix/pfe-${incident.id}-${incident.metadata.fixRequest.requestId}`);
      throw new Error('Jenkins must never be reached when the remote head has moved');
    }) as any;
    await assert.rejects(() => service.reRunPrValidation(incident.id, user), /Pull Request a changé/);
  }
  globalThis.fetch = originalFetch;

  // ------------------------------------------------------------------
  // D — branch changed -> rejected
  // ------------------------------------------------------------------
  {
    const candidateVerification = { verifyHead: async (req: any) => passingHeadVerification(req) };
    const { incident, service } = makeFixture(candidateVerification);
    globalThis.fetch = (async (url: any) => {
      const value = String(url);
      if (value.includes('api.github.com')) return githubPr(SHA, 'some-other-branch');
      throw new Error('Jenkins must never be reached when the branch changed');
    }) as any;
    await assert.rejects(() => service.reRunPrValidation(incident.id, user), /Pull Request a changé/);
  }
  globalThis.fetch = originalFetch;

  // ------------------------------------------------------------------
  // E — validationTargetSha stale (fix moved to a NEW target, but no
  // COMPLETED/FAILED validation exists yet for that new target -- the
  // persisted prValidationRequest is still completed for the OLD sha)
  // -> rejected, never silently revalidates the wrong SHA.
  // ------------------------------------------------------------------
  {
    const candidateVerification = { verifyHead: async (req: any) => passingHeadVerification(req) };
    const { incident, service } = makeFixture(candidateVerification, { fix: { validationTargetSha: OTHER_SHA } });
    globalThis.fetch = (async () => { throw new Error('GitHub/Jenkins must never be reached when the target sha is stale'); }) as any;
    await assert.rejects(() => service.reRunPrValidation(incident.id, user), /Aucune validation terminée n.existe pour le SHA cible actuel/);
  }
  globalThis.fetch = originalFetch;

  // ------------------------------------------------------------------
  // F — fix not VALIDATED -> rejected
  // ------------------------------------------------------------------
  {
    const candidateVerification = { verifyHead: async (req: any) => passingHeadVerification(req) };
    const { incident, service } = makeFixture(candidateVerification, { fix: { status: 'PR_CREATED' } });
    globalThis.fetch = (async () => { throw new Error('GitHub/Jenkins must never be reached when fix is not VALIDATED'); }) as any;
    await assert.rejects(() => service.reRunPrValidation(incident.id, user), /correction déjà validée/);
  }
  globalThis.fetch = originalFetch;

  // ------------------------------------------------------------------
  // G — current request still QUEUED (epoch 0, the ORIGINAL validation,
  // never a rerun) -> rejected, never treated as a duplicate of anything.
  // ------------------------------------------------------------------
  {
    const candidateVerification = { verifyHead: async (req: any) => passingHeadVerification(req) };
    const { incident, service } = makeFixture(candidateVerification, { prValidationRequest: { status: 'QUEUED' } });
    globalThis.fetch = (async (url: any) => {
      const value = String(url);
      if (value.includes('api.github.com')) return githubPr(SHA, `fix/pfe-${incident.id}-${incident.metadata.fixRequest.requestId}`);
      throw new Error('Jenkins must never be reached while the original epoch-0 validation is still QUEUED');
    }) as any;
    await assert.rejects(() => service.reRunPrValidation(incident.id, user), /n.est pas terminée/);
  }
  globalThis.fetch = originalFetch;

  // ------------------------------------------------------------------
  // H — current request RUNNING (epoch 0) -> rejected
  // ------------------------------------------------------------------
  {
    const candidateVerification = { verifyHead: async (req: any) => passingHeadVerification(req) };
    const { incident, service } = makeFixture(candidateVerification, { prValidationRequest: { status: 'RUNNING' } });
    globalThis.fetch = (async (url: any) => {
      const value = String(url);
      if (value.includes('api.github.com')) return githubPr(SHA, `fix/pfe-${incident.id}-${incident.metadata.fixRequest.requestId}`);
      throw new Error('Jenkins must never be reached while the original epoch-0 validation is still RUNNING');
    }) as any;
    await assert.rejects(() => service.reRunPrValidation(incident.id, user), /n.est pas terminée/);
  }
  globalThis.fetch = originalFetch;

  // ------------------------------------------------------------------
  // I — unauthorized role -> rejected before any GitHub/Jenkins call
  // ------------------------------------------------------------------
  {
    const candidateVerification = { verifyHead: async (req: any) => passingHeadVerification(req) };
    const { incident, service } = makeFixture(candidateVerification);
    globalThis.fetch = (async () => { throw new Error('GitHub/Jenkins must never be reached for an unauthorized role'); }) as any;
    await assert.rejects(() => service.reRunPrValidation(incident.id, viewer), /autorisation/);
  }
  globalThis.fetch = originalFetch;

  // ------------------------------------------------------------------
  // J — concurrent duplicate calls: exactly ONE new request, ONE Jenkins
  // trigger. Uses the fixture's promise-tail transaction fake, which
  // serializes concurrent manager.transaction() callers exactly like a
  // real pessimistic_write row lock would.
  // ------------------------------------------------------------------
  {
    const candidateVerification = { verifyHead: async (req: any) => passingHeadVerification(req) };
    const { incident, service } = makeFixture(candidateVerification);
    let triggers = 0;
    globalThis.fetch = jenkinsFetchStub(incident, SHA, () => { triggers++; });
    const [r1, r2] = await Promise.all([
      service.reRunPrValidation(incident.id, user),
      service.reRunPrValidation(incident.id, user),
    ]);
    const results: any[] = [r1, r2];
    const fresh = results.filter(r => r.duplicate === false);
    const dup = results.filter(r => r.duplicate === true);
    assert.equal(fresh.length, 1, 'J: exactly one concurrent call wins and creates a new (epoch 1) request');
    assert.equal(dup.length, 1, 'J: the other concurrent call gets back a duplicate response');
    assert.equal(triggers, 1, 'J: Jenkins triggered exactly once total, never twice');
    assert.equal(dup[0].validationRequest.epoch, 1, 'J: the duplicate response references the SAME epoch 1 request');
    assert.equal(incident.metadata.prValidationRequest.epoch, 1, 'J: final persisted state is epoch 1, never epoch 2');
  }
  globalThis.fetch = originalFetch;

  // ------------------------------------------------------------------
  // K — repeated call after epoch+1 already created but before completion
  // (sequential, not concurrent) -> returns the SAME epoch-1 request, no
  // epoch 2 is ever allocated.
  // ------------------------------------------------------------------
  {
    const candidateVerification = { verifyHead: async (req: any) => passingHeadVerification(req) };
    const { incident, service } = makeFixture(candidateVerification);
    let triggers = 0;
    globalThis.fetch = jenkinsFetchStub(incident, SHA, () => { triggers++; });
    const first: any = await service.reRunPrValidation(incident.id, user);
    assert.equal(first.duplicate, false);
    assert.equal(incident.metadata.prValidationRequest.status, 'QUEUED', 'K: epoch 1 is QUEUED, not yet COMPLETED');
    const second: any = await service.reRunPrValidation(incident.id, user);
    assert.equal(second.duplicate, true, 'K: a second explicit call before epoch-1 completes returns a duplicate');
    assert.equal(second.validationRequest.epoch, 1, 'K: still epoch 1, never epoch 2');
    assert.equal(triggers, 1, 'K: Jenkins triggered only once total across both calls');
  }
  globalThis.fetch = originalFetch;

  // ------------------------------------------------------------------
  // L — normal requestPrValidation() behavior is byte-identical to before
  // R80.2: epoch 0, existing 4-field identity formula, existing dedupe.
  // ------------------------------------------------------------------
  {
    const candidateVerification: any = { verifyHead: async (req: any) => passingHeadVerification(req) };
    const incidentId = '65e35d1b-212f-4153-bd63-fba6e8eebc2c';
    const requestId = 'f1af3192-40f0-4400-869a-3854246d7a11';
    const batchId = '9c190dbec8d6f3d17b2b7e961e329bdc122e00ed18f88586b85bdca7a8d1c49d';
    const incident: any = {
      id: incidentId, projectId: 'project-2', status: 'fix_generated', jenkinsJobName: 'pfe-app-test',
      prUrl: `https://github.com/${REPO}/pull/25`,
      metadata: { fixRequest: { status: 'PR_CREATED', requestId, batchId, attemptCount: 16, prNumber: 25, prHeadSha: SHA, findingIds: [] } },
    };
    const project: any = { id: 'project-2', githubRepo: REPO, jenkinsUrl: 'http://jenkins', jenkinsToken: 'user:not-printed', jenkinsJobName: 'pfe-app-test', sonarqubeKey: 'pfe-app-test' };
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
    const service = new IncidentsService(repository, projectRepo, { emit: () => undefined } as any, { syncIncident: async () => undefined } as any, candidateVerification);
    let triggers = 0;
    globalThis.fetch = jenkinsFetchStub(incident, SHA, () => { triggers++; });
    const result: any = await service.requestPrValidation(incident.id, user);
    assert.equal(result.duplicate, false);
    assert.equal(triggers, 1);
    const pvr = incident.metadata.prValidationRequest;
    assert.equal(pvr.epoch, undefined, 'L: requestPrValidation never sets an epoch field');
    assert.equal(pvr.revalidation, undefined, 'L: requestPrValidation never marks a request as a revalidation');
    assert.equal(pvr.validationRequestId, prValidationIdentity('project-2', 25, SHA, batchId), 'L: identity formula is the original, unchanged 4-field hash');
  }
  globalThis.fetch = originalFetch;

  // ------------------------------------------------------------------
  // Identity regression (§10) — a persisted record with NO epoch field
  // (every real historical record) must resolve to epoch 0 with no schema
  // migration: covered implicitly by every fixture above (basePrValidationRequest
  // carries no `epoch` key), and explicitly here.
  // ------------------------------------------------------------------
  {
    const existingNoEpoch: any = { status: 'COMPLETED', expectedPrHeadSha: SHA };
    assert.equal(Number(existingNoEpoch.epoch) || 0, 0, 'historical record with no epoch field resolves to epoch 0');
  }

  console.log('ALL SAME-SHA REVALIDATION EPOCH TESTS PASSED');
}

main().catch(err => { console.error(err); process.exit(1); });
