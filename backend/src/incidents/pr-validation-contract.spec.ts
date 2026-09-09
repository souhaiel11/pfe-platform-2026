import * as assert from 'node:assert/strict';
import { IncidentsService, buildPrValidationJobName } from './incidents.service';

// BRIQUE 2 — this suite exercises requestPrValidation() end to end, which now
// gates every Jenkins trigger on a HEAD_ONLY exact-SHA verification. A stub
// that always reports the exact requested SHA as a real, fully-passing
// candidate keeps every pre-existing Jenkins-side assertion in this file
// meaningful (it was never about HEAD_ONLY); the dedicated HEAD_ONLY
// lifecycle matrix lives in pr-validation-head-verification.spec.ts.
const passingCandidateVerification: any = {
  verifyHead: async (request: any) => ({
    mode: 'HEAD_ONLY',
    identity: { repository: request.repository, targetSha: String(request.targetSha).toLowerCase(),
      validationRequestId: request.validationRequestId, requestId: request.requestId,
      batchId: request.batchId, candidateAttempt: request.candidateAttempt },
    workspace: { workspaceId: 'stub', checkoutSha: String(request.targetSha).toLowerCase(), exactShaVerified: true, created: true, cleaned: true },
    compile: { status: 'SUCCESS', exitCode: 0, durationMs: 1, evidenceRef: null },
    tests: { targeted: { status: 'NOT_RUN', reason: 'NO_HIGH_CONFIDENCE_TARGET_SELECTION' },
      regression: { status: 'SUCCESS', total: 1, failures: 0, errors: 0, skipped: 0, durationMs: 1, evidenceRef: null } },
    staticAnalysis: { status: 'NOT_RUN', reason: 'SUPPORTED_STATIC_ADAPTER_NOT_CONFIGURED', newIssues: [], evidenceRef: null },
    overall: 'PASS', verificationLevel: 'COMPILE_TEST_VERIFIED', failureClass: null,
  }),
};

function decodePrValidationContext(body: unknown): any {
  const form = new URLSearchParams(String(body));
  const encoded = form.get('PFE_VALIDATION_CONTEXT');
  assert.ok(encoded, 'PFE_VALIDATION_CONTEXT parameter must be present in the Jenkins trigger body');
  return JSON.parse(Buffer.from(String(encoded), 'base64url').toString('utf8'));
}

const sha = '10e90dd5a0d21941dea1a544c3026d0955a029b1';
const incident: any = {
  id: 'd1f5e9ce-f039-475d-9a50-41f217e6444b', projectId: '3aa1c9b9-e114-40e4-884b-ebc7aa32e002', status: 'fix_generated',
  jenkinsJobName: 'pfe-app-test',
  prUrl: 'https://github.com/souhaiel11/pfe-app-test/pull/24', metadata: { fixRequest: {
    status: 'PR_CREATED', requestId: '9b62e087-02a8-409d-bfb1-a951629a8814', batchId: '6396353230fd100bf80c3417271c70cb7808273ebd6500571a46c2a4505af431',
    attemptCount: 7, prNumber: 24, prHeadSha: sha, findingIds: ['a', 'b'],
  } },
};
const project: any = {
  id: '3aa1c9b9-e114-40e4-884b-ebc7aa32e002', githubRepo: 'souhaiel11/pfe-app-test', githubToken: null,
  jenkinsUrl: 'http://jenkins', jenkinsToken: 'user:not-printed', jenkinsJobName: 'pfe-app-test',
  sonarqubeKey: 'pfe-app-test',
};
incident.project = project;
const incidentRepo: any = {
  findOne: async () => incident,
  update: async (_id: string, patch: any) => Object.assign(incident, patch),
};
const projectRepo: any = { findOne: async () => project };
let tail = Promise.resolve();
const repository: any = {
  manager: { transaction: async (fn: any) => {
    const previous = tail;
    let release!: () => void;
    tail = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try { return await fn({ getRepository: (entity: any) => entity?.name === 'Project' ? projectRepo : incidentRepo }); }
    finally { release(); }
  } },
  findOne: incidentRepo.findOne,
  update: incidentRepo.update,
};

async function main() {
  const service = new IncidentsService(repository, projectRepo, { emit: () => undefined } as any, { syncIncident: async () => undefined } as any, passingCandidateVerification);
  const originalFetch = globalThis.fetch;
  let triggers = 0;
  let lastTriggerContext: any = null;
  globalThis.fetch = async (url: any, init?: RequestInit) => {
    const value = String(url);
    if (value.includes('api.github.com')) {
      assert.equal(new Headers(init?.headers).has('authorization'), false, 'public PR lookup must not fabricate authentication');
      return new Response(JSON.stringify({ state: 'open', head: { sha, ref: `fix/pfe-${incident.id}-${incident.metadata.fixRequest.requestId}` } }), { status: 200 });
    }
    if (value.includes('crumbIssuer')) return new Response(JSON.stringify({ crumbRequestField: 'Jenkins-Crumb', crumb: 'opaque' }), { status: 200 });
    if (value.includes('/api/json')) return new Response(JSON.stringify({ buildable: true, _class: 'org.jenkinsci.plugins.workflow.job.WorkflowJob', property: [{ _class: 'hudson.model.ParametersDefinitionProperty', parameterDefinitions: [{ name: 'PFE_VALIDATION_CONTEXT', type: 'StringParameterDefinition', defaultParameterValue: { value: '' } }] }] }), { status: 200 });
    if (value.includes('/buildWithParameters')) { triggers++; lastTriggerContext = decodePrValidationContext(init?.body); return new Response('', { status: 201, headers: { location: 'http://jenkins/queue/item/42/' } }); }
    throw new Error(`unexpected URL ${value}`);
  };
  try {
    const user = { id: 'developer-1', role: 'developer' };
    const results = await Promise.all([service.requestPrValidation(incident.id, user), service.requestPrValidation(incident.id, user)]);
    assert.equal(triggers, 1);
    assert.equal(results.filter((result: any) => result.duplicate).length, 1);
    assert.equal(incident.metadata.prValidationRequest.status, 'QUEUED');
    assert.equal(incident.metadata.prValidationRequest.expectedPrHeadSha, sha);
    assert.equal(incident.metadata.prValidationRequest.batchKey, incident.metadata.fixRequest.batchId, 'historical missing batchKey must derive from canonical batchId');
    assert.equal(incident.metadata.prValidationRequest.repository, 'souhaiel11/pfe-app-test');
    const realValidationRequestId = incident.metadata.prValidationRequest.validationRequestId;

    // R45 — le contexte envoyé à Jenkins porte les clés Sonar déterministes
    // (isolation du projet principal), jamais dérivées/devinées côté Jenkins.
    assert.equal(lastTriggerContext.baseSonarProjectKey, 'pfe-app-test');
    assert.equal(lastTriggerContext.validationSonarProjectKey, 'pfe-app-test-pr-24', 'validation project key is deterministic: <base>-pr-<prNumber>');

    // R45 — sans sonarqubeKey configuré sur le projet, la validation PR échoue
    // explicitement (fail closed) plutôt que de déclencher Jenkins sans clé Sonar.
    incident.metadata.prValidationRequest = null;
    const originalSonarqubeKey = project.sonarqubeKey;
    project.sonarqubeKey = null;
    let triggeredWithoutSonarKey = false;
    globalThis.fetch = async (url: any) => {
      const value = String(url);
      if (value.includes('api.github.com')) return new Response(JSON.stringify({ state: 'open', head: { sha, ref: `fix/pfe-${incident.id}-${incident.metadata.fixRequest.requestId}` } }), { status: 200 });
      triggeredWithoutSonarKey = true;
      throw new Error('Jenkins must not be reached without a configured sonarqubeKey');
    };
    await assert.rejects(() => service.requestPrValidation(incident.id, user), /SonarQube/);
    assert.equal(triggeredWithoutSonarKey, false, 'Jenkins is never reached when sonarqubeKey is missing');
    project.sonarqubeKey = originalSonarqubeKey;

    incident.metadata.prValidationRequest = null;
    globalThis.fetch = async (url: any) => {
      if (String(url).includes('api.github.com')) return new Response(JSON.stringify({ state: 'open', head: { sha: 'b'.repeat(40), ref: `fix/pfe-${incident.id}-${incident.metadata.fixRequest.requestId}` } }), { status: 200 });
      triggers++;
      throw new Error('Jenkins must not be reached');
    };
    await assert.rejects(() => service.requestPrValidation(incident.id, user), /Pull Request a changé/);
    assert.equal(triggers, 1);

    // R28 — un échec de transport Jenkins (FAILED) doit rester réessayable
    // explicitement, sur la même identité logique, avec l'historique préservé.
    incident.metadata.prValidationRequest = {
      validationRequestId: realValidationRequestId, validationType: 'PR_VALIDATION', status: 'FAILED',
      projectId: incident.projectId, incidentId: incident.id, fixRequestId: incident.metadata.fixRequest.requestId,
      requestId: incident.metadata.fixRequest.requestId, batchId: incident.metadata.fixRequest.batchId,
      batchKey: incident.metadata.fixRequest.batchId, attemptCount: 7, repository: 'souhaiel11/pfe-app-test',
      prNumber: 24, prUrl: incident.prUrl, prHeadBranch: `fix/pfe-${incident.id}-${incident.metadata.fixRequest.requestId}`,
      expectedPrHeadSha: sha, createdBy: 'developer-1', createdAt: 't0', updatedAt: 't0',
      failureCode: 'JENKINS_TRIGGER_FAILED', failureSummary: 'Le build PR n’a pas pu être mis en file.', failedAt: 't0',
    };
    const priorFailed = incident.metadata.prValidationRequest;
    triggers = 0;
    globalThis.fetch = async (url: any, init?: RequestInit) => {
      const value = String(url);
      if (value.includes('api.github.com')) {
        assert.equal(new Headers(init?.headers).has('authorization'), false);
        return new Response(JSON.stringify({ state: 'open', head: { sha, ref: `fix/pfe-${incident.id}-${incident.metadata.fixRequest.requestId}` } }), { status: 200 });
      }
      if (value.includes('crumbIssuer')) return new Response(JSON.stringify({ crumbRequestField: 'Jenkins-Crumb', crumb: 'opaque' }), { status: 200 });
      if (value.includes('/api/json')) return new Response(JSON.stringify({ buildable: true, _class: 'org.jenkinsci.plugins.workflow.job.WorkflowJob', property: [{ _class: 'hudson.model.ParametersDefinitionProperty', parameterDefinitions: [{ name: 'PFE_VALIDATION_CONTEXT', type: 'StringParameterDefinition', defaultParameterValue: { value: '' } }] }] }), { status: 200 });
      if (value.includes('/buildWithParameters')) { triggers++; return new Response('', { status: 201, headers: { location: 'http://jenkins/queue/item/43/' } }); }
      throw new Error(`unexpected URL ${value}`);
    };
    const retryResult: any = await service.requestPrValidation(incident.id, user);
    assert.equal(triggers, 1, 'explicit retry after FAILED must reach Jenkins exactly once');
    assert.equal(retryResult.duplicate, false, 'a FAILED->retry transition is not a duplicate');
    assert.equal(incident.metadata.prValidationRequest.status, 'QUEUED');
    assert.equal(incident.metadata.prValidationRequest.validationRequestId, realValidationRequestId, 'retry preserves the same logical identity');
    assert.equal(incident.metadata.prValidationRequest.retryAttempt, 1);
    assert.equal(incident.metadata.prValidationRequest.previousAttempts.length, 1);
    assert.equal(incident.metadata.prValidationRequest.previousAttempts[0], priorFailed, 'prior FAILED attempt history preserved verbatim');

    // R28 concurrency — two explicit retries fired at once against a FAILED
    // state (same logical identity) must yield exactly one Jenkins trigger
    // and one duplicate response, thanks to the pessimistic_write lock.
    incident.metadata.prValidationRequest = { ...priorFailed, retryAttempt: 1, previousAttempts: [priorFailed] };
    triggers = 0;
    const concurrent = await Promise.all([
      service.requestPrValidation(incident.id, user),
      service.requestPrValidation(incident.id, user),
    ]);
    assert.equal(triggers, 1, 'at most one Jenkins trigger for two concurrent retry clicks');
    assert.equal(concurrent.filter((r: any) => r.duplicate).length, 1, 'exactly one of the two concurrent clicks must observe a duplicate');

    // R42A — reconciliation of a stale QUEUED validation whose exact Jenkins
    // build already went terminal without ever sending a callback (proven by
    // real PR-24 build #1: a Shared Library CPS crash right after checkout).
    const queuedWithHistory = {
      validationRequestId: realValidationRequestId, validationType: 'PR_VALIDATION', status: 'QUEUED',
      projectId: incident.projectId, incidentId: incident.id, requestId: incident.metadata.fixRequest.requestId,
      batchId: incident.metadata.fixRequest.batchId, batchKey: incident.metadata.fixRequest.batchId,
      attemptCount: 7, repository: 'souhaiel11/pfe-app-test', prNumber: 24, prUrl: incident.prUrl,
      prHeadBranch: `fix/pfe-${incident.id}-${incident.metadata.fixRequest.requestId}`, expectedPrHeadSha: sha,
      queueUrl: 'http://jenkins:8080/queue/item/1261/', prValidationJob: 'pfe-app-test-multibranch/job/PR-24',
      createdBy: 'developer-1', createdAt: 't0', updatedAt: 't0', retryAttempt: 1, previousAttempts: [priorFailed],
    };

    // R42A-TEST A: queue item's build not found among recent builds (queueId
    // 1261 unmatched) -- genuinely still queued/unresolved, no write.
    incident.metadata.prValidationRequest = { ...queuedWithHistory };
    globalThis.fetch = async (url: any) => {
      const value = String(url);
      if (value.includes('/job/PR-24/api/json')) return new Response(JSON.stringify({ builds: [] }), { status: 200 });
      throw new Error(`unexpected URL in reconcile test A: ${url}`);
    };
    const stillQueued: any = await service.reconcilePrValidation(incident.id, user);
    assert.equal(stillQueued.reconciled, false);
    assert.equal(stillQueued.reason, 'STILL_QUEUED');
    assert.equal(incident.metadata.prValidationRequest.status, 'QUEUED', 'no DB write when the build has not started yet');

    // R42A-TEST B: matching build found by queueId but still building -- no write yet.
    globalThis.fetch = async (url: any) => {
      const value = String(url);
      if (value.includes('/job/PR-24/api/json')) return new Response(JSON.stringify({ builds: [{ number: 1, queueId: 1261, building: true, result: null }] }), { status: 200 });
      throw new Error(`unexpected URL in reconcile test B: ${value}`);
    };
    const stillRunning: any = await service.reconcilePrValidation(incident.id, user);
    assert.equal(stillRunning.reconciled, false);
    assert.equal(stillRunning.reason, 'STILL_RUNNING');
    assert.equal(incident.metadata.prValidationRequest.status, 'QUEUED', 'no DB write while the build is still executing');

    // R42A-TEST C: matching build (by queueId, not the ephemeral queue endpoint --
    // proven necessary: the real queue/item/1261 had already 404'd by the time
    // reconciliation ran) terminal FAILURE, no callback ever received -- reconciles
    // to FAILED/JENKINS_PIPELINE_FAILED, preserves prior history, never touches fixRequest.
    globalThis.fetch = async (url: any) => {
      const value = String(url);
      if (value.includes('/job/PR-24/api/json')) return new Response(JSON.stringify({ builds: [{ number: 1, queueId: 1261, building: false, result: 'FAILURE' }] }), { status: 200 });
      throw new Error(`unexpected URL in reconcile test C: ${value}`);
    };
    const fixRequestStatusBefore = incident.metadata.fixRequest.status;
    const reconcileResult: any = await service.reconcilePrValidation(incident.id, user);
    assert.equal(reconcileResult.reconciled, true);
    assert.equal(incident.metadata.prValidationRequest.status, 'FAILED');
    assert.equal(incident.metadata.prValidationRequest.failureCode, 'JENKINS_PIPELINE_FAILED');
    assert.equal(incident.metadata.prValidationRequest.jenkinsBuildNumber, 1);
    assert.equal(incident.metadata.prValidationRequest.validationRequestId, realValidationRequestId, 'reconciliation preserves the same logical identity');
    assert.equal(incident.metadata.prValidationRequest.previousAttempts.length, 1, 'prior attempt history untouched by reconciliation');
    assert.equal(incident.metadata.prValidationRequest.previousAttempts[0].failureCode, 'JENKINS_TRIGGER_FAILED', 'original attempt-1 evidence preserved verbatim');
    assert.equal(incident.metadata.fixRequest.status, fixRequestStatusBefore, 'reconciliation never touches fixRequest.status (stays PR_CREATED)');

    // R42A-TEST D: a genuinely reconciled FAILED state is retry-eligible again,
    // same governance as any other FAILED -> retryAttempt increments, identity preserved.
    globalThis.fetch = async (url: any, init?: RequestInit) => {
      const value = String(url);
      if (value.includes('api.github.com')) return new Response(JSON.stringify({ state: 'open', head: { sha, ref: `fix/pfe-${incident.id}-${incident.metadata.fixRequest.requestId}` } }), { status: 200 });
      if (value.includes('crumbIssuer')) return new Response(JSON.stringify({ crumbRequestField: 'Jenkins-Crumb', crumb: 'opaque' }), { status: 200 });
      if (value.includes('/api/json')) return new Response(JSON.stringify({ buildable: true, _class: 'org.jenkinsci.plugins.workflow.job.WorkflowJob', property: [{ _class: 'hudson.model.ParametersDefinitionProperty', parameterDefinitions: [{ name: 'PFE_VALIDATION_CONTEXT', type: 'StringParameterDefinition', defaultParameterValue: { value: '' } }] }] }), { status: 200 });
      if (value.includes('/buildWithParameters')) { triggers++; return new Response('', { status: 201, headers: { location: 'http://jenkins/queue/item/44/' } }); }
      throw new Error(`unexpected URL in reconcile test D: ${value}`);
    };
    triggers = 0;
    const retryAfterReconcile: any = await service.requestPrValidation(incident.id, user);
    assert.equal(triggers, 1, 'retry after reconciliation reaches Jenkins exactly once');
    assert.equal(retryAfterReconcile.duplicate, false);
    assert.equal(incident.metadata.prValidationRequest.retryAttempt, 2, 'second retry attempt correctly incremented');
    assert.equal(incident.metadata.prValidationRequest.previousAttempts.length, 2, 'both prior attempts (original FAILED + reconciled FAILED) preserved');

    // R42A-TEST E: fail-closed refusal to auto-reconcile a SUCCESS build with no callback.
    incident.metadata.prValidationRequest = { ...queuedWithHistory, status: 'QUEUED' };
    globalThis.fetch = async (url: any) => {
      const value = String(url);
      if (value.includes('/job/PR-24/api/json')) return new Response(JSON.stringify({ builds: [{ number: 1, queueId: 1261, building: false, result: 'SUCCESS' }] }), { status: 200 });
      throw new Error(`unexpected URL in reconcile test E: ${value}`);
    };
    await assert.rejects(() => service.reconcilePrValidation(incident.id, user), /SUCCESS sans callback/);
    assert.equal(incident.metadata.prValidationRequest.status, 'QUEUED', 'a SUCCESS build is never auto-reconciled to VALIDATED');

    // R47-TEST F — UNSTABLE must NOT be mislabeled as "no callback sent"
    // (JENKINS_PIPELINE_FAILED): the Shared Library wraps scanner stages in
    // catchError(buildResult:'UNSTABLE'), so an UNSTABLE build always still
    // reaches its terminal report/callback step. Proven directly against real
    // PR-24 build #2: its callback DID reach n8n (WF1 execution 1894), which
    // rejected the contract fail-closed on missing ceTaskId/analysisId because
    // SonarQube Community Edition cannot produce native PR analysis evidence.
    const unstableWithHistory = { ...queuedWithHistory, status: 'QUEUED', queueUrl: 'http://jenkins:8080/queue/item/1899/', retryAttempt: 2, previousAttempts: [priorFailed, { ...priorFailed, failureCode: 'JENKINS_PIPELINE_FAILED' }] };
    incident.metadata.prValidationRequest = unstableWithHistory;
    const fixRequestStatusBeforeUnstable = incident.metadata.fixRequest.status;
    globalThis.fetch = async (url: any) => {
      const value = String(url);
      if (value.includes('/job/PR-24/api/json')) return new Response(JSON.stringify({ builds: [{ number: 2, queueId: 1899, building: false, result: 'UNSTABLE' }] }), { status: 200 });
      // R49 -- build #2's real console log never printed a ceTaskId: native
      // PR analysis failed outright under Community Edition, before Sonar
      // ever got far enough to submit a report.
      if (value.includes('/2/consoleText')) return new Response('SonarQube: PR analysis... Developer Edition or above is required', { status: 200 });
      throw new Error(`unexpected URL in reconcile test F: ${value}`);
    };
    const unstableReconcile: any = await service.reconcilePrValidation(incident.id, user);
    assert.equal(unstableReconcile.reconciled, true);
    assert.equal(incident.metadata.prValidationRequest.status, 'FAILED');
    assert.equal(incident.metadata.prValidationRequest.failureCode, 'SONAR_PR_ANALYSIS_UNSUPPORTED', 'UNSTABLE with no ceTaskId in the console log gets the truthful "unsupported" code');
    assert.notEqual(incident.metadata.prValidationRequest.failureCode, 'JENKINS_PIPELINE_FAILED');
    assert.ok(!/avant l.{1,2}envoi du callback/.test(incident.metadata.prValidationRequest.failureSummary), 'must not claim the callback was never sent -- it was, and WF1 rejected it');
    assert.match(incident.metadata.prValidationRequest.failureSummary, /Community/);
    assert.equal(incident.metadata.prValidationRequest.jenkinsBuildNumber, 2);
    assert.equal(incident.metadata.prValidationRequest.jenkinsBuildResult, 'UNSTABLE');
    assert.equal(incident.metadata.prValidationRequest.expectedPrHeadSha, sha, 'expected SHA is never rewritten by reconciliation');
    assert.equal(incident.metadata.fixRequest.status, fixRequestStatusBeforeUnstable, 'reconciliation never touches fixRequest.status (stays PR_CREATED)');

    // R49-TEST G — UNSTABLE with a real ceTaskId in the Jenkins console log
    // (Sonar exact-SHA analysis actually completed, proven live on real PR-24
    // build #3) must NOT reuse SONAR_PR_ANALYSIS_UNSUPPORTED -- that would now
    // be false. It gets the distinct, truthful PR_VALIDATION_EVIDENCE_INCONCLUSIVE
    // code instead, without fabricating a WF1/WF3/analysisId verdict this
    // Jenkins-only endpoint cannot itself verify.
    const evidenceInconclusiveState = { ...queuedWithHistory, status: 'QUEUED', queueUrl: 'http://jenkins:8080/queue/item/1369/', retryAttempt: 3, previousAttempts: [priorFailed] };
    incident.metadata.prValidationRequest = evidenceInconclusiveState;
    const fixRequestStatusBeforeEvidence = incident.metadata.fixRequest.status;
    globalThis.fetch = async (url: any) => {
      const value = String(url);
      if (value.includes('/job/PR-24/api/json')) return new Response(JSON.stringify({ builds: [{ number: 3, queueId: 1369, building: false, result: 'UNSTABLE' }] }), { status: 200 });
      if (value.includes('/3/consoleText')) return new Response('[INFO] More about the report processing at http://sonarqube:9000/api/ce/task?id=d223940b-af8f-4d73-aaa0-05fff5308b28', { status: 200 });
      throw new Error(`unexpected URL in reconcile test G: ${value}`);
    };
    const evidenceInconclusiveReconcile: any = await service.reconcilePrValidation(incident.id, user);
    assert.equal(evidenceInconclusiveReconcile.reconciled, true);
    assert.equal(incident.metadata.prValidationRequest.status, 'FAILED');
    assert.equal(incident.metadata.prValidationRequest.failureCode, 'PR_VALIDATION_EVIDENCE_INCONCLUSIVE');
    assert.notEqual(incident.metadata.prValidationRequest.failureCode, 'SONAR_PR_ANALYSIS_UNSUPPORTED', 'must not claim Sonar was unsupported when it actually succeeded');
    assert.notEqual(incident.metadata.prValidationRequest.failureCode, 'JENKINS_PIPELINE_FAILED');
    assert.match(incident.metadata.prValidationRequest.failureSummary, /Sonar exact-SHA a bien abouti/);
    assert.equal(incident.metadata.prValidationRequest.jenkinsBuildNumber, 3);
    assert.equal(incident.metadata.prValidationRequest.jenkinsBuildResult, 'UNSTABLE');
    assert.equal(incident.metadata.prValidationRequest.expectedPrHeadSha, sha);
    assert.equal(incident.metadata.fixRequest.status, fixRequestStatusBeforeEvidence, 'reconciliation never touches fixRequest.status (stays PR_CREATED)');
    assert.equal(incident.metadata.fixRequest.status, 'PR_CREATED');

    // R49 — saveValidation()'s PR-job correlation must use the SAME canonical
    // builder as requestPrValidation() (proven live: build #3's real callback
    // used the canonical `.../job/PR-24` form issued at request time and was
    // wrongly 409'd by a second, independently-written `/PR-${n}` formula).
    const r49ValidationRequestId = 'r49-job-format-test-vrid';
    const resetR49State = () => {
      incident.metadata.prValidationRequest = { validationRequestId: r49ValidationRequestId, status: 'QUEUED', expectedPrHeadSha: sha };
      incident.metadata.fixRequest = { ...incident.metadata.fixRequest, status: 'PR_CREATED' };
    };
    const r49Payload = (overrides: any = {}) => ({
      projectId: incident.projectId,
      fixRequestId: incident.metadata.fixRequest.requestId,
      validationRequestId: r49ValidationRequestId,
      batchId: incident.metadata.fixRequest.batchId,
      batchKey: incident.metadata.fixRequest.batchId,
      attemptCount: incident.metadata.fixRequest.attemptCount,
      repository: 'souhaiel11/pfe-app-test',
      prNumber: 24,
      buildNumber: 3,
      jenkinsJob: 'pfe-app-test',
      prValidationJob: buildPrValidationJobName('pfe-app-test', 24),
      expectedPrHeadSha: sha,
      checkoutSha: sha,
      analysisId: '8917f2c2-93fa-4dad-917a-9c8e5967de74',
      ceTaskId: 'd223940b-af8f-4d73-aaa0-05fff5308b28',
      jenkinsStatus: 'UNSTABLE',
      sonarStatus: 'ERROR',
      requiredStages: ['build', 'tests', 'sonar'].map(stage => ({ stage, required: true, status: 'FAILED' })),
      correlationVerified: false,
      sonarCorrelationVerified: false,
      findingResults: [{ findingId: 'a', result: 'INCONCLUSIVE', evidence: 'x' }, { findingId: 'b', result: 'INCONCLUSIVE', evidence: 'x' }],
      ...overrides,
    });

    // R49-TEST A — the canonical value actually issued/propagated end-to-end is accepted.
    resetR49State();
    assert.equal(buildPrValidationJobName('pfe-app-test', 24), 'pfe-app-test-multibranch/job/PR-24');
    const r49Accepted: any = await service.saveValidation(incident.id, r49Payload());
    assert.ok(r49Accepted, 'canonical .../job/PR-24 format is accepted, not 409-rejected');
    assert.equal(incident.metadata.prValidationRequest.status, 'FAILED', 'reached the terminal write (job check did not block it) -- FAILED here because jenkinsStatus=UNSTABLE and correlationVerified=false, unrelated to job correlation (BRIQUE 4: sonarStatus alone no longer affects this)');
    assert.equal(incident.metadata.validation.validationStatus, 'INCONCLUSIVE');

    // R49-TEST B — the old, non-canonical format (missing /job/) is rejected.
    resetR49State();
    await assert.rejects(
      () => service.saveValidation(incident.id, r49Payload({ prValidationJob: 'pfe-app-test-multibranch/PR-24' })),
      /job PR attendu/,
      'the pre-fix format without /job/ must still be rejected -- proves this is not just relaxed to accept anything',
    );
    assert.equal(incident.metadata.prValidationRequest.status, 'QUEUED', 'no write on a rejected job format');

    // R49-TEST C — canonical builder for a DIFFERENT PR number is rejected.
    resetR49State();
    await assert.rejects(
      () => service.saveValidation(incident.id, r49Payload({ prValidationJob: buildPrValidationJobName('pfe-app-test', 25) })),
      /job PR attendu/,
      'a well-formed job string for the wrong PR number must still be rejected',
    );

    // R49-TEST D — canonical builder for a DIFFERENT Jenkins job is rejected.
    resetR49State();
    await assert.rejects(
      () => service.saveValidation(incident.id, r49Payload({ prValidationJob: buildPrValidationJobName('other-job', 24) })),
      /job PR attendu/,
      'a well-formed job string for the wrong base Jenkins job must still be rejected',
    );

    // R49-TEST E — a correct canonical job format does NOT bypass the other
    // correlation gates (SHA equality here): the job fix must not weaken them.
    resetR49State();
    await assert.rejects(
      () => service.saveValidation(incident.id, r49Payload({ checkoutSha: 'b'.repeat(40) })),
      /HEAD attendu/,
      'correct job format combined with a SHA mismatch must still fail closed on the SHA gate',
    );
    assert.equal(incident.metadata.prValidationRequest.status, 'QUEUED', 'no write on a rejected SHA correlation');

    // R65 — governed PR-head refresh. Proven live on real PR-24: a genuine
    // approved follow-up remediation commit (S125 fix, R63) on the SAME
    // PR/branch was rejected by requestPrValidation() with 409 "La Pull
    // Request a changé" because fixRequest.prHeadSha is frozen provenance
    // (R64). refresh-target lets a human explicitly accept the new HEAD as
    // the governed validation baseline without ever touching prHeadSha.
    const r65OriginalSha = sha;
    const r65NewSha = '5cf69aaed7a89953fc0eab882bf269b4509a36cc';
    const r65EvenNewerSha = 'c'.repeat(40);
    const r65Branch = `fix/pfe-${incident.id}-9b62e087-02a8-409d-bfb1-a951629a8814`;
    const resetR65Fix = (overrides: any = {}) => {
      incident.metadata = {
        ...incident.metadata,
        fixRequest: {
          status: 'PR_CREATED', requestId: '9b62e087-02a8-409d-bfb1-a951629a8814',
          batchId: '6396353230fd100bf80c3417271c70cb7808273ebd6500571a46c2a4505af431',
          attemptCount: 7, prNumber: 24, prHeadSha: r65OriginalSha, findingIds: ['a', 'b'],
          ...overrides,
        },
        prValidationRequest: null,
      };
    };
    const githubPull = (headSha: string, opts: { state?: string; ref?: string; base?: string } = {}) => ({
      state: opts.state ?? 'open',
      head: { sha: headSha, ref: opts.ref ?? r65Branch },
      base: { ref: opts.base ?? 'main' },
    });
    const mockGithubOnly = (pull: any) => async (url: any) => {
      if (String(url).includes('api.github.com')) {
        assert.ok(String(url).includes('souhaiel11/pfe-app-test'), 'refresh-target must query the project-scoped repository (H: correlation is structural, not user-suppliable)');
        return new Response(JSON.stringify(pull), { status: 200 });
      }
      throw new Error(`unexpected URL in R65 test: ${url}`);
    };

    // R65-TEST A — unchanged PR (stored target == live HEAD): validation allowed.
    resetR65Fix();
    globalThis.fetch = async (url: any, init?: RequestInit) => {
      const value = String(url);
      if (value.includes('api.github.com')) return new Response(JSON.stringify(githubPull(r65OriginalSha)), { status: 200 });
      if (value.includes('crumbIssuer')) return new Response(JSON.stringify({ crumbRequestField: 'Jenkins-Crumb', crumb: 'opaque' }), { status: 200 });
      if (value.includes('/api/json')) return new Response(JSON.stringify({ buildable: true, _class: 'org.jenkinsci.plugins.workflow.job.WorkflowJob', property: [{ _class: 'hudson.model.ParametersDefinitionProperty', parameterDefinitions: [{ name: 'PFE_VALIDATION_CONTEXT', type: 'StringParameterDefinition', defaultParameterValue: { value: '' } }] }] }), { status: 200 });
      if (value.includes('/buildWithParameters')) { triggers++; return new Response('', { status: 201, headers: { location: 'http://jenkins/queue/item/9001/' } }); }
      throw new Error(`unexpected URL in R65-TEST A: ${value}`);
    };
    triggers = 0;
    const r65A: any = await service.requestPrValidation(incident.id, user);
    assert.equal(r65A.duplicate, false, 'unchanged PR head must be accepted without a refresh');
    assert.equal(triggers, 1);
    assert.equal(incident.metadata.prValidationRequest.expectedPrHeadSha, r65OriginalSha);

    // R65-TEST B — changed PR without refresh: 409, Jenkins not called.
    resetR65Fix();
    globalThis.fetch = mockGithubOnly(githubPull(r65NewSha));
    triggers = 0;
    await assert.rejects(() => service.requestPrValidation(incident.id, user), /Pull Request a changé/);
    assert.equal(triggers, 0, 'Jenkins must never be reached when the PR head diverges from the governed target');
    assert.equal(incident.metadata.prValidationRequest, null, 'no prValidationRequest written on a rejected freshness check');

    // R65-TEST C — explicit refresh, same PR/branch, new SHA: target updated, provenance preserved.
    resetR65Fix();
    globalThis.fetch = mockGithubOnly(githubPull(r65NewSha));
    const r65C: any = await service.refreshPrValidationTarget(incident.id, user);
    assert.equal(r65C.success, true);
    assert.equal(r65C.changed, true);
    assert.equal(r65C.validationTargetSha, r65NewSha);
    assert.equal(incident.metadata.fixRequest.validationTargetSha, r65NewSha);
    assert.equal(incident.metadata.fixRequest.prHeadSha, r65OriginalSha, 'L: original remediation SHA must remain preserved, never overwritten');
    assert.equal(incident.metadata.fixRequest.validationTargetHistory.length, 1);
    assert.equal(incident.metadata.fixRequest.validationTargetHistory[0].from, r65OriginalSha);
    assert.equal(incident.metadata.fixRequest.validationTargetHistory[0].to, r65NewSha);
    assert.equal(incident.metadata.fixRequest.validationTargetHistory[0].event, 'PR_VALIDATION_TARGET_REFRESHED');
    assert.equal(incident.metadata.fixRequest.validationTargetHistory[0].refreshedBy, user.id);

    // R65-TEST D — validation after refresh: allowed, expectedPrHeadSha snapshots the NEW SHA.
    globalThis.fetch = async (url: any) => {
      const value = String(url);
      if (value.includes('api.github.com')) return new Response(JSON.stringify(githubPull(r65NewSha)), { status: 200 });
      if (value.includes('crumbIssuer')) return new Response(JSON.stringify({ crumbRequestField: 'Jenkins-Crumb', crumb: 'opaque' }), { status: 200 });
      if (value.includes('/api/json')) return new Response(JSON.stringify({ buildable: true, _class: 'org.jenkinsci.plugins.workflow.job.WorkflowJob', property: [{ _class: 'hudson.model.ParametersDefinitionProperty', parameterDefinitions: [{ name: 'PFE_VALIDATION_CONTEXT', type: 'StringParameterDefinition', defaultParameterValue: { value: '' } }] }] }), { status: 200 });
      if (value.includes('/buildWithParameters')) { triggers++; return new Response('', { status: 201, headers: { location: 'http://jenkins/queue/item/9002/' } }); }
      throw new Error(`unexpected URL in R65-TEST D: ${value}`);
    };
    triggers = 0;
    const r65D: any = await service.requestPrValidation(incident.id, user);
    assert.equal(r65D.duplicate, false);
    assert.equal(triggers, 1);
    assert.equal(incident.metadata.prValidationRequest.expectedPrHeadSha, r65NewSha, 'validation attempt snapshots the governed target, not the original provenance SHA');
    assert.equal(incident.metadata.prValidationRequest.retryAttempt, 0, 'N: a brand-new SHA identity starts its own lineage, unaffected by refresh-target itself');
    const r65DExpectedSha = incident.metadata.prValidationRequest.expectedPrHeadSha;

    // R65-TEST E — PR changes again after refresh (no second refresh yet): 409.
    globalThis.fetch = mockGithubOnly(githubPull(r65EvenNewerSha));
    triggers = 0;
    await assert.rejects(() => service.requestPrValidation(incident.id, user), /Pull Request a changé/);
    assert.equal(triggers, 0);
    assert.equal(incident.metadata.prValidationRequest.expectedPrHeadSha, r65DExpectedSha, 'M: the already-created validation attempt is immutable, never rewritten by a later drift/refresh');

    // R65-TEST F — PR closed: refresh rejected.
    resetR65Fix();
    globalThis.fetch = mockGithubOnly(githubPull(r65NewSha, { state: 'closed' }));
    await assert.rejects(() => service.refreshPrValidationTarget(incident.id, user), /ne correspond plus/);
    assert.equal(incident.metadata.fixRequest.validationTargetSha, undefined, 'no target change on a rejected refresh');

    // R65-TEST G — branch changed: refresh rejected.
    resetR65Fix();
    globalThis.fetch = mockGithubOnly(githubPull(r65NewSha, { ref: 'some-other-branch' }));
    await assert.rejects(() => service.refreshPrValidationTarget(incident.id, user), /ne correspond plus/);
    assert.equal(incident.metadata.fixRequest.validationTargetSha, undefined);

    // R65-TEST I — repeated refresh with the same SHA: idempotent, no duplicate audit entry.
    resetR65Fix();
    globalThis.fetch = mockGithubOnly(githubPull(r65NewSha));
    const r65I1: any = await service.refreshPrValidationTarget(incident.id, user);
    assert.equal(r65I1.changed, true);
    assert.equal(incident.metadata.fixRequest.validationTargetHistory.length, 1);
    const r65I2: any = await service.refreshPrValidationTarget(incident.id, user);
    assert.equal(r65I2.changed, false, 'I: repeating the same target must be a no-op');
    assert.equal(r65I2.validationTargetSha, r65NewSha);
    assert.equal(incident.metadata.fixRequest.validationTargetHistory.length, 1, 'no duplicate audit entry on an idempotent refresh');

    // R65-TEST J/K — refresh never triggers Jenkins/WF1/WF3 (mockGithubOnly
    // throws on any URL other than api.github.com, so any accidental call to
    // Jenkins or an n8n workflow endpoint would already have failed the
    // tests above; this asserts the explicit trigger counter too).
    resetR65Fix();
    triggers = 0;
    globalThis.fetch = mockGithubOnly(githubPull(r65NewSha));
    await service.refreshPrValidationTarget(incident.id, user);
    assert.equal(triggers, 0, 'J/K: refresh-target must never trigger Jenkins/WF1/WF3');

    // R65-TEST A (idempotency variant already covered above via I). Final
    // sanity: original provenance survives every refresh in this whole block.
    assert.equal(incident.metadata.fixRequest.prHeadSha, r65OriginalSha);
  } finally {
    globalThis.fetch = originalFetch;
  }
  console.log('PR validation contract: PASS');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
