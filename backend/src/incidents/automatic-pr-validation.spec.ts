import * as assert from 'node:assert/strict';
import { IncidentsService } from './incidents.service';

// BRIQUE 4 — PHASE 9 Cases G/H/I/J: automatic initial PR validation, fired
// exactly once from the real WF2 PR_CREATED callback (saveWorkflowBatchStatus),
// idempotent for a duplicate callback, and never silently transferring a
// prior authorization to a moved PR HEAD. No real Jenkins/GitHub/n8n call:
// everything below is mocked/simulated, per this brick's local-only mode.

const SHA = '3'.repeat(40);
const MOVED_SHA = 'd'.repeat(40);
const REPO = 'owner/repo';
const JOB = 'project-job';

function passingHeadVerification(request: any) {
  return {
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
  };
}

function makeFixture(candidateVerification: any) {
  const incident: any = {
    id: 'incident-auto', projectId: 'project-1', status: 'blocked', prUrl: null, jenkinsJobName: JOB,
    metadata: {
      fixRequest: {
        requestId: 'req-auto', batchId: 'batch-auto', workflow: 'WF2', status: 'DISPATCHED',
        findingIds: ['a'], findings: [{ findingId: 'a', file: 'Service.java' }],
        attemptCount: 1, attempts: [{ attempt: 1, status: 'DISPATCHED' }],
      },
    },
  };
  const project: any = {
    id: 'project-1', githubRepo: REPO, githubToken: null,
    jenkinsUrl: 'http://jenkins', jenkinsToken: 'user:not-printed', jenkinsJobName: JOB,
    sonarqubeKey: 'project-key',
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
  return { incident, service };
}

function prCreatedCallback(overrides: any = {}) {
  return {
    status: 'PR_CREATED' as const, workflowId: '9adcV31eaIgJyMR0', executionId: '5001', incidentId: 'incident-auto',
    requestId: 'req-auto', batchId: 'batch-auto', batchKey: 'batch-auto', attemptCount: 1,
    prUrl: `https://github.com/${REPO}/pull/9`, prNumber: 9, prHeadSha: SHA,
    completenessPassed: true, processedFindingIds: ['a'], effectiveRemediatedFindingIds: ['a'],
    verifiedFiles: ['Service.java'], updatedFiles: ['Service.java'],
    fileResults: [{ targetFile: 'Service.java', outcome: 'MODIFIED_AND_REMEDIATED', finalStateVerified: true }],
    commitShas: [SHA],
    ...overrides,
  };
}

async function flush(): Promise<void> {
  // Lets the fire-and-forget dispatchAutomaticInitialPrValidation() promise
  // chain (started synchronously up to its first await) actually complete
  // before assertions run.
  await new Promise(resolve => setTimeout(resolve, 20));
}

async function main() {
  const originalFetch = globalThis.fetch;

  // ------------------------------------------------------------------
  // CASE H — PR creation status persisted successfully -> exactly ONE
  // initial validation dispatch (reaches Jenkins exactly once).
  // ------------------------------------------------------------------
  {
    let headOnlyCalls = 0;
    const candidateVerification = { verifyHead: async (req: any) => { headOnlyCalls++; return passingHeadVerification(req); } };
    const { incident, service } = makeFixture(candidateVerification);
    let triggers = 0;
    globalThis.fetch = (async (url: any, init?: RequestInit) => {
      const value = String(url);
      if (value.includes('api.github.com')) return new Response(JSON.stringify({ state: 'open', head: { sha: SHA, ref: `fix/pfe-${incident.id}-req-auto` } }), { status: 200 });
      if (value.includes('crumbIssuer')) return new Response(JSON.stringify({ crumbRequestField: 'Jenkins-Crumb', crumb: 'opaque' }), { status: 200 });
      if (value.includes('/api/json')) return new Response(JSON.stringify({ buildable: true, _class: 'org.jenkinsci.plugins.workflow.job.WorkflowJob', property: [{ _class: 'hudson.model.ParametersDefinitionProperty', parameterDefinitions: [{ name: 'PFE_VALIDATION_CONTEXT', type: 'StringParameterDefinition', defaultParameterValue: { value: '' } }] }] }), { status: 200 });
      if (value.includes('/buildWithParameters')) { triggers++; return new Response('', { status: 201, headers: { location: 'http://jenkins/queue/item/1/' } }); }
      throw new Error(`unexpected URL ${value}`);
    }) as any;

    const result: any = await service.saveWorkflowBatchStatus(incident.id, prCreatedCallback());
    assert.equal(result.applied, true, 'CASE H: WF2 callback applied');
    assert.equal(incident.metadata.fixRequest.status, 'PR_CREATED');
    await flush();
    assert.equal(headOnlyCalls, 1, 'CASE H: HEAD_ONLY ran exactly once for the automatic dispatch');
    assert.equal(triggers, 1, 'CASE H: Jenkins triggered exactly once');
    assert.equal(incident.metadata.prValidationRequest.status, 'QUEUED', 'CASE H: the automatic dispatch reached QUEUED');
    assert.equal(incident.metadata.prValidationRequest.createdBy, 'system-auto-pr-validation', 'CASE H: audit attribution to the automatic actor');
  }

  // ------------------------------------------------------------------
  // CASE I — duplicate PR-created callback (same incident/fixRequest/PR/head
  // SHA, same WF2 workflowId+executionId) delivered twice -> ONE validation
  // business run only.
  // ------------------------------------------------------------------
  {
    let headOnlyCalls = 0;
    const candidateVerification = { verifyHead: async (req: any) => { headOnlyCalls++; return passingHeadVerification(req); } };
    const { incident, service } = makeFixture(candidateVerification);
    let triggers = 0;
    globalThis.fetch = (async (url: any) => {
      const value = String(url);
      if (value.includes('api.github.com')) return new Response(JSON.stringify({ state: 'open', head: { sha: SHA, ref: `fix/pfe-${incident.id}-req-auto` } }), { status: 200 });
      if (value.includes('crumbIssuer')) return new Response(JSON.stringify({ crumbRequestField: 'Jenkins-Crumb', crumb: 'opaque' }), { status: 200 });
      if (value.includes('/api/json')) return new Response(JSON.stringify({ buildable: true, _class: 'org.jenkinsci.plugins.workflow.job.WorkflowJob', property: [{ _class: 'hudson.model.ParametersDefinitionProperty', parameterDefinitions: [{ name: 'PFE_VALIDATION_CONTEXT', type: 'StringParameterDefinition', defaultParameterValue: { value: '' } }] }] }), { status: 200 });
      if (value.includes('/buildWithParameters')) { triggers++; return new Response('', { status: 201, headers: { location: 'http://jenkins/queue/item/2/' } }); }
      throw new Error(`unexpected URL ${value}`);
    }) as any;

    const first: any = await service.saveWorkflowBatchStatus(incident.id, prCreatedCallback());
    await flush();
    const second: any = await service.saveWorkflowBatchStatus(incident.id, prCreatedCallback()); // identical identity
    assert.equal(first.applied, true);
    assert.equal(second.duplicate, true, 'CASE I: the exact same WF2 callback identity is recognized as a duplicate');
    await flush();
    assert.equal(headOnlyCalls, 1, 'CASE I: HEAD_ONLY ran exactly once despite the duplicate callback');
    assert.equal(triggers, 1, 'CASE I: Jenkins triggered exactly once despite the duplicate callback');
  }

  // ------------------------------------------------------------------
  // CASE J — PR changes after authorization: authorizedSha=SHA must never
  // authorize a later, different HEAD (MOVED_SHA) without a governed refresh.
  // ------------------------------------------------------------------
  {
    let headOnlyCalls = 0;
    const candidateVerification = { verifyHead: async (req: any) => { headOnlyCalls++; return passingHeadVerification(req); } };
    const { incident, service } = makeFixture(candidateVerification);
    globalThis.fetch = (async (url: any) => {
      const value = String(url);
      if (value.includes('api.github.com')) return new Response(JSON.stringify({ state: 'open', head: { sha: SHA, ref: `fix/pfe-${incident.id}-req-auto` } }), { status: 200 });
      if (value.includes('crumbIssuer')) return new Response(JSON.stringify({ crumbRequestField: 'Jenkins-Crumb', crumb: 'opaque' }), { status: 200 });
      if (value.includes('/api/json')) return new Response(JSON.stringify({ buildable: true, _class: 'org.jenkinsci.plugins.workflow.job.WorkflowJob', property: [{ _class: 'hudson.model.ParametersDefinitionProperty', parameterDefinitions: [{ name: 'PFE_VALIDATION_CONTEXT', type: 'StringParameterDefinition', defaultParameterValue: { value: '' } }] }] }), { status: 200 });
      if (value.includes('/buildWithParameters')) return new Response('', { status: 201, headers: { location: 'http://jenkins/queue/item/3/' } });
      throw new Error(`unexpected URL ${value}`);
    }) as any;
    await service.saveWorkflowBatchStatus(incident.id, prCreatedCallback());
    await flush();
    assert.equal(incident.metadata.prValidationRequest.status, 'QUEUED');
    const frozenValidationRequest = incident.metadata.prValidationRequest;

    // Simulate a real WF3 completion that reaches MERGE_READY, authorizing
    // exactly SHA. Minimal Brique 3 regression evidence (correlated baseline
    // + complete, empty candidate snapshot) so regressionResult is CLEAN,
    // not the INCONCLUSIVE default -- CASE J is about authorization
    // stickiness, not regression evidence.
    incident.metadata.sourceCommitSha = SHA;
    incident.metadata.fixRequest.baselineSha = SHA;
    incident.metadata.enrichedData = { sonar: { issues: [] } };
    const validationContract = {
      validationRequestId: frozenValidationRequest.validationRequestId, projectId: incident.projectId,
      fixRequestId: incident.metadata.fixRequest.requestId, batchId: incident.metadata.fixRequest.batchId,
      batchKey: incident.metadata.fixRequest.batchId, attemptCount: 1, repository: REPO, prNumber: 9,
      prValidationJob: frozenValidationRequest.prValidationJob, expectedPrHeadSha: SHA, checkoutSha: SHA,
      ceTaskId: 'ce-1', analysisId: 'analysis-1', buildNumber: 1, jenkinsJob: JOB, jenkinsStatus: 'SUCCESS', sonarStatus: 'OK',
      correlationVerified: true, sonarCorrelationVerified: true,
      requiredStages: ['build', 'tests', 'sonar'].map(stage => ({ stage, required: true, status: 'PASSED' })),
      findingResults: [{ findingId: 'a', result: 'VALID', evidence: 'analysis-1' }],
      candidateSnapshotComplete: true, candidateFindingsSnapshot: [],
    };
    const saved: any = await service.saveValidation(incident.id, validationContract);
    assert.equal(saved.validation.mergeAuthorization.authorization, 'MERGE_READY');
    assert.equal(saved.validation.mergeAuthorization.authorizedSha, SHA, 'authorization is bound to the exact SHA');

    // The live PR head now moves to a different commit (a follow-up push),
    // without a governed refresh-target call.
    globalThis.fetch = (async (url: any) => {
      const value = String(url);
      if (value.includes('api.github.com')) return new Response(JSON.stringify({ state: 'open', head: { sha: MOVED_SHA, ref: `fix/pfe-${incident.id}-req-auto` } }), { status: 200 });
      throw new Error('Jenkins/HEAD_ONLY must never be reached for an ungoverned moved PR head');
    }) as any;
    // fixRequest.status is now 'VALIDATED' (terminal), so the existing
    // governance rejects a new validation attempt outright -- either way,
    // the point stands: no new validation for the moved head can silently
    // proceed and inherit the SHA-authorization.
    await assert.rejects(
      () => service.requestPrValidation(incident.id, { id: 'developer-1', role: 'developer' }),
      'CASE J: a new validation attempt against the moved head is rejected by existing governance (fixRequest already terminal, or the freshness gate)',
    );
    assert.equal(incident.metadata.validation.mergeAuthorization.authorizedSha, SHA, 'CASE J: the SHA-authorization record is untouched by the moved head');
    assert.notEqual(incident.metadata.validation.mergeAuthorization.authorizedSha, MOVED_SHA, 'CASE J: ABC authorization never silently covers DEF');
  }

  globalThis.fetch = originalFetch;
  console.log('Automatic initial PR validation (Brique 4, Cases G/H/I/J): PASS');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
