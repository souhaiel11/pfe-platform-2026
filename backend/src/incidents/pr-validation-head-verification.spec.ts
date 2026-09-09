import * as assert from 'node:assert/strict';
import { IncidentsService } from './incidents.service';

// BRIQUE 2 — proves the exact-SHA HEAD_ONLY verifier (Brique 1) is wired into
// requestPrValidation()/saveValidation() as governed, correlated evidence,
// never as an independent "latest branch" check and never as authorization
// to write. Covers PHASE 11 Cases A-H (Case I -- the Brique 1 regression
// suite itself -- is re-run unmodified alongside this file, see the Brique 2
// closeout report). Real, read-only PR #25 data (repository souhaiel11/
// pfe-app-test, head 8a315b0dd508eb9843bb3037fe2827f02f6faa78) is used as
// static fixture data only -- nothing here calls GitHub, Jenkins, n8n, or the
// real candidate-verifier worker.

const PR25_SHA = '8a315b0dd508eb9843bb3037fe2827f02f6faa78';
const PR25_REPO = 'souhaiel11/pfe-app-test';

function passingHeadVerification(request: any) {
  return {
    mode: 'HEAD_ONLY',
    identity: { repository: request.repository, targetSha: String(request.targetSha).toLowerCase(),
      validationRequestId: request.validationRequestId, requestId: request.requestId,
      batchId: request.batchId, candidateAttempt: request.candidateAttempt },
    workspace: { workspaceId: 'stub', checkoutSha: String(request.targetSha).toLowerCase(), exactShaVerified: true, created: true, cleaned: true },
    compile: { status: 'SUCCESS', exitCode: 0, durationMs: 1, evidenceRef: null },
    tests: { targeted: { status: 'NOT_RUN', reason: 'NO_HIGH_CONFIDENCE_TARGET_SELECTION' },
      regression: { status: 'SUCCESS', total: 22, failures: 0, errors: 0, skipped: 0, durationMs: 1, evidenceRef: null } },
    staticAnalysis: { status: 'NOT_RUN', reason: 'SUPPORTED_STATIC_ADAPTER_NOT_CONFIGURED', newIssues: [], evidenceRef: null },
    overall: 'PASS', verificationLevel: 'COMPILE_TEST_VERIFIED', failureClass: null,
  };
}

function shaUnavailableHeadVerification(request: any) {
  return {
    mode: 'HEAD_ONLY',
    identity: { repository: request.repository, targetSha: String(request.targetSha).toLowerCase(),
      validationRequestId: request.validationRequestId, requestId: request.requestId,
      batchId: request.batchId, candidateAttempt: request.candidateAttempt },
    workspace: { workspaceId: 'stub', checkoutSha: null, exactShaVerified: false, created: false, cleaned: false },
    compile: { status: 'NOT_RUN', exitCode: null, durationMs: null, evidenceRef: null },
    tests: { targeted: { status: 'NOT_RUN', reason: 'NO_HIGH_CONFIDENCE_TARGET_SELECTION' },
      regression: { status: 'NOT_RUN', total: null, failures: null, errors: null, skipped: null, durationMs: null, evidenceRef: null } },
    staticAnalysis: { status: 'NOT_RUN', reason: 'SUPPORTED_STATIC_ADAPTER_NOT_CONFIGURED', newIssues: [], evidenceRef: null },
    overall: 'INCONCLUSIVE', verificationLevel: 'COMPILE_TEST_VERIFIED', failureClass: 'SHA_UNAVAILABLE',
  };
}

// Same failureClass as SHA_UNAVAILABLE (Brique 1's real contract: a checked-
// out workspace whose HEAD doesn't match the requested SHA collapses to
// SHA_UNAVAILABLE too, proven in candidate-verifier/src/head-verification.spec.ts)
// but with a distinct, non-null checkoutSha to represent "checked out the
// wrong commit" rather than "the commit doesn't exist at all".
function mismatchHeadVerification(request: any, wrongSha: string) {
  return {
    ...shaUnavailableHeadVerification(request),
    workspace: { workspaceId: 'stub', checkoutSha: wrongSha, exactShaVerified: false, created: true, cleaned: true },
  };
}

function makeFixture(candidateVerification: any, opts: { sha?: string; repo?: string } = {}) {
  const sha = opts.sha || PR25_SHA;
  const repo = opts.repo || PR25_REPO;
  const incident: any = {
    id: '65e35d1b-212f-4153-bd63-fba6e8eebc2c', projectId: '3aa1c9b9-e114-40e4-884b-ebc7aa32e002', status: 'fix_generated',
    jenkinsJobName: 'pfe-app-test',
    prUrl: `https://github.com/${repo}/pull/25`, metadata: { fixRequest: {
      status: 'PR_CREATED', requestId: 'f1af3192-40f0-4400-869a-3854246d7a11', batchId: '9c190dbec8d6f3d17b2b7e961e329bdc122e00ed18f88586b85bdca7a8d1c49d',
      attemptCount: 16, prNumber: 25, prHeadSha: sha, findingIds: ['b8db9c11-ddf9-4a23-9bf3-1d2ff15a59ef'],
    } },
  };
  const project: any = {
    id: '3aa1c9b9-e114-40e4-884b-ebc7aa32e002', githubRepo: repo, githubToken: null,
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
  return { incident, project, service, repository };
}

function githubOpenPr(sha: string, incident: any) {
  return new Response(JSON.stringify({ state: 'open', head: { sha, ref: `fix/pfe-${incident.id}-${incident.metadata.fixRequest.requestId}` } }), { status: 200 });
}
const validMetadata = () => new Response(JSON.stringify({ buildable: true, _class: 'org.jenkinsci.plugins.workflow.job.WorkflowJob', property: [{ _class: 'hudson.model.ParametersDefinitionProperty', parameterDefinitions: [{ name: 'PFE_VALIDATION_CONTEXT', type: 'StringParameterDefinition', defaultParameterValue: { value: '' } }] }] }), { status: 200 });
const validCrumb = () => new Response(JSON.stringify({ crumbRequestField: 'Jenkins-Crumb', crumb: 'opaque' }), { status: 200 });

function decodePrValidationContext(body: unknown): any {
  const form = new URLSearchParams(String(body));
  const encoded = form.get('PFE_VALIDATION_CONTEXT');
  assert.ok(encoded, 'PFE_VALIDATION_CONTEXT parameter must be present in the Jenkins trigger body');
  return JSON.parse(Buffer.from(String(encoded), 'base64url').toString('utf8'));
}

async function main() {
  const originalFetch = globalThis.fetch;
  const user = { id: 'admin-1', role: 'admin' };

  // ------------------------------------------------------------------
  // CASE A — canonical success: validationTargetSha == HEAD_ONLY targetSha
  // == HEAD_ONLY checkoutSha == Jenkins expectedPrHeadSha, end to end through
  // saveValidation()'s final backend correlation.
  // ------------------------------------------------------------------
  {
    let headOnlyCalls = 0;
    const candidateVerification = { verifyHead: async (req: any) => { headOnlyCalls++; return passingHeadVerification(req); } };
    const { incident, service } = makeFixture(candidateVerification);
    let triggers = 0;
    let lastContext: any = null;
    globalThis.fetch = (async (url: any, init?: RequestInit) => {
      const value = String(url);
      if (value.includes('api.github.com')) return githubOpenPr(PR25_SHA, incident);
      if (value.includes('crumbIssuer')) return validCrumb();
      if (value.includes('/api/json')) return validMetadata();
      if (value.includes('/buildWithParameters')) { triggers++; lastContext = decodePrValidationContext(init?.body); return new Response('', { status: 201, headers: { location: 'http://jenkins/queue/item/900/' } }); }
      throw new Error(`unexpected URL ${value}`);
    }) as any;
    const result: any = await service.requestPrValidation(incident.id, user);
    assert.equal(result.duplicate, false);
    assert.equal(headOnlyCalls, 1, 'HEAD_ONLY runs exactly once for a fresh request');
    assert.equal(triggers, 1, 'Jenkins is triggered exactly once after HEAD_ONLY PASS');
    assert.equal(incident.metadata.prValidationRequest.status, 'QUEUED');
    assert.equal(incident.metadata.prValidationRequest.headVerification.overall, 'PASS');
    assert.equal(incident.metadata.prValidationRequest.headVerification.workspace.checkoutSha, PR25_SHA, 'HEAD_ONLY checkoutSha == PR25_SHA');
    assert.equal(incident.metadata.prValidationRequest.headVerification.identity.targetSha, PR25_SHA, 'HEAD_ONLY targetSha == PR25_SHA');
    assert.equal(incident.metadata.prValidationRequest.expectedPrHeadSha, PR25_SHA, 'backend validationTargetSha == PR25_SHA');
    // Jenkins contract: the SAME frozen SHA is what Jenkins received.
    assert.equal(lastContext.expectedPrHeadSha, PR25_SHA, 'Jenkins receives the same frozen validationTargetSha');

    // Final backend correlation on WF3 callback: saveValidation() must accept
    // a validation whose checkoutSha/expectedPrHeadSha AND persisted
    // headVerification all agree on PR25_SHA.
    const validationContract = {
      validationRequestId: incident.metadata.prValidationRequest.validationRequestId, projectId: incident.projectId,
      fixRequestId: incident.metadata.fixRequest.requestId, batchId: incident.metadata.fixRequest.batchId,
      batchKey: incident.metadata.fixRequest.batchId, attemptCount: 16, repository: PR25_REPO, prNumber: 25,
      prValidationJob: incident.metadata.prValidationRequest.prValidationJob, expectedPrHeadSha: PR25_SHA, checkoutSha: PR25_SHA,
      ceTaskId: 'ce-1', analysisId: 'analysis-1', buildNumber: 1, jenkinsJob: 'pfe-app-test', jenkinsStatus: 'SUCCESS', sonarStatus: 'OK',
      correlationVerified: true, sonarCorrelationVerified: true,
      requiredStages: ['build', 'tests', 'sonar'].map(stage => ({ stage, required: true, status: 'PASSED' })),
      findingResults: [{ findingId: 'b8db9c11-ddf9-4a23-9bf3-1d2ff15a59ef', result: 'VALID', evidence: 'analysis-1' }],
    };
    const saved: any = await service.saveValidation(incident.id, validationContract);
    assert.equal(saved.validation.validationStatus, 'VALIDATED', 'CASE A: canonical identity chain validates end to end');
  }

  // ------------------------------------------------------------------
  // CASE B — HEAD_ONLY SHA_UNAVAILABLE
  // ------------------------------------------------------------------
  {
    const candidateVerification = { verifyHead: async (req: any) => shaUnavailableHeadVerification(req) };
    const { incident, service } = makeFixture(candidateVerification);
    let triggers = 0;
    globalThis.fetch = (async (url: any) => {
      const value = String(url);
      if (value.includes('api.github.com')) return githubOpenPr(PR25_SHA, incident);
      triggers++;
      throw new Error('Jenkins must never be reached when HEAD_ONLY is SHA_UNAVAILABLE');
    }) as any;
    await assert.rejects(() => service.requestPrValidation(incident.id, user), /vérification HEAD/);
    assert.equal(triggers, 0, 'CASE B: Jenkins never triggered');
    assert.equal(incident.metadata.prValidationRequest.status, 'FAILED');
    assert.equal(incident.metadata.prValidationRequest.failureCode, 'HEAD_VERIFICATION_NOT_PASS');
    assert.equal(incident.metadata.prValidationRequest.headVerification.overall, 'INCONCLUSIVE');
    assert.equal(incident.metadata.prValidationRequest.headVerification.failureClass, 'SHA_UNAVAILABLE');
    assert.equal(incident.metadata.prValidationRequest.headVerification.workspace.checkoutSha, null);
    assert.equal(incident.metadata.prValidationRequest.result, 'INCONCLUSIVE', 'BRIQUE 4: SHA_UNAVAILABLE -> INCONCLUSIVE, not BLOCKED');
  }

  // ------------------------------------------------------------------
  // CASE C — HEAD_ONLY checkout mismatch (targetSha=PR25_SHA, checkoutSha=a
  // different real-looking SHA). Also proves the backend does not trust a
  // bare boolean: even a misbehaving stub that dishonestly reports
  // overall:'PASS' while echoing a mismatched checkoutSha is rejected.
  // ------------------------------------------------------------------
  {
    const wrongSha = 'f'.repeat(40);
    const candidateVerification = { verifyHead: async (req: any) => mismatchHeadVerification(req, wrongSha) };
    const { incident, service } = makeFixture(candidateVerification);
    let triggers = 0;
    globalThis.fetch = (async (url: any) => {
      const value = String(url);
      if (value.includes('api.github.com')) return githubOpenPr(PR25_SHA, incident);
      triggers++;
      throw new Error('Jenkins must never be reached on a HEAD_ONLY checkout mismatch');
    }) as any;
    await assert.rejects(() => service.requestPrValidation(incident.id, user), /vérification HEAD/);
    assert.equal(triggers, 0, 'CASE C: Jenkins never triggered');
    assert.equal(incident.metadata.prValidationRequest.status, 'FAILED');
    assert.notEqual(incident.metadata.prValidationRequest.headVerification.workspace.checkoutSha, PR25_SHA);
    assert.equal(incident.metadata.prValidationRequest.result, 'INCONCLUSIVE', 'BRIQUE 4: checkout mismatch -> INCONCLUSIVE, not BLOCKED (uncertain correlation, not a proven candidate defect)');

    // Defense in depth: a dishonest sub-service claiming PASS with a
    // mismatched checkoutSha must still be rejected, never trusted blindly.
    const dishonest = { verifyHead: async (req: any) => ({ ...passingHeadVerification(req), workspace: { ...passingHeadVerification(req).workspace, checkoutSha: wrongSha } }) };
    const { incident: incident2, service: service2 } = makeFixture(dishonest);
    globalThis.fetch = (async (url: any) => {
      const value = String(url);
      if (value.includes('api.github.com')) return githubOpenPr(PR25_SHA, incident2);
      throw new Error('Jenkins must never be reached when checkoutSha disagrees with targetSha, even under a claimed PASS');
    }) as any;
    await assert.rejects(() => service2.requestPrValidation(incident2.id, user), /vérification HEAD/);
    assert.equal(incident2.metadata.prValidationRequest.status, 'FAILED', 'a claimed PASS with mismatched checkoutSha is never trusted as a bare boolean');
  }

  // ------------------------------------------------------------------
  // BRIQUE 4 — HEAD_ONLY overall='FAIL' (the exact candidate commit itself
  // does not compile / fails its own regression suite): a PROVEN defect,
  // never an infrastructure problem. Distinct from Cases B/C/D, which are
  // all uncertain evidence -> INCONCLUSIVE.
  // ------------------------------------------------------------------
  {
    const candidateVerification = { verifyHead: async (req: any) => ({
      ...passingHeadVerification(req), overall: 'FAIL', compile: { status: 'SUCCESS', exitCode: 0, durationMs: 1, evidenceRef: null },
      tests: { targeted: { status: 'NOT_RUN', reason: 'NO_HIGH_CONFIDENCE_TARGET_SELECTION' },
        regression: { status: 'FAILED', total: 5, failures: 2, errors: 0, skipped: 0, durationMs: 1, evidenceRef: null } },
    }) };
    const { incident, service } = makeFixture(candidateVerification);
    let triggers = 0;
    globalThis.fetch = (async (url: any) => {
      const value = String(url);
      if (value.includes('api.github.com')) return githubOpenPr(PR25_SHA, incident);
      triggers++;
      throw new Error('Jenkins must never be reached when the candidate itself proven fails its own tests');
    }) as any;
    await assert.rejects(() => service.requestPrValidation(incident.id, user), /vérification HEAD/);
    assert.equal(triggers, 0, 'a proven candidate defect never reaches Jenkins either');
    assert.equal(incident.metadata.prValidationRequest.status, 'FAILED');
    assert.equal(incident.metadata.prValidationRequest.failureCode, 'CANDIDATE_TEST_FAILURE');
    assert.equal(incident.metadata.prValidationRequest.result, 'INVALID', 'a proven compile/test failure is INVALID (BLOCKED-worthy), not INCONCLUSIVE');
  }

  // ------------------------------------------------------------------
  // CASE D — worker unavailable (transport failure / thrown error)
  // ------------------------------------------------------------------
  {
    const candidateVerification = { verifyHead: async () => { throw new Error('ECONNREFUSED candidate-verifier:4100'); } };
    const { incident, service } = makeFixture(candidateVerification);
    let triggers = 0;
    let remediationDispatches = 0;
    globalThis.fetch = (async (url: any) => {
      const value = String(url);
      if (value.includes('api.github.com')) return githubOpenPr(PR25_SHA, incident);
      if (value.includes('/webhook/')) { remediationDispatches++; return new Response('{}', { status: 200 }); }
      triggers++;
      throw new Error('Jenkins must never be reached when the HEAD_ONLY worker is unavailable');
    }) as any;
    await assert.rejects(() => service.requestPrValidation(incident.id, user), /vérification HEAD/);
    assert.equal(triggers, 0, 'CASE D: Jenkins never triggered');
    assert.equal(remediationDispatches, 0, 'CASE D: no automatic source-code correction request');
    assert.equal(incident.metadata.prValidationRequest.status, 'FAILED');
    assert.equal(incident.metadata.prValidationRequest.failureCode, 'HEAD_VERIFICATION_NOT_PASS');
    assert.equal(incident.metadata.prValidationRequest.headVerification, null, 'no fake evidence is fabricated for a transport failure');
    // BRIQUE 4 CASE E — a verifier-unavailable failure is INCONCLUSIVE, never BLOCKED.
    assert.equal(incident.metadata.prValidationRequest.result, 'INCONCLUSIVE', 'BRIQUE 4: verifier unavailable -> INCONCLUSIVE, not BLOCKED');

    // No automatic retry: calling requestPrValidation a second time with the
    // SAME still-unavailable worker must fail again by an explicit human
    // action, never loop on its own -- proven by simply not looping here and
    // observing a single FAILED->FAILED transition is possible on retry.
    await assert.rejects(() => service.requestPrValidation(incident.id, user), /vérification HEAD/);
    assert.equal(triggers, 0, 'CASE D: a second explicit call still never reaches Jenkins, and nothing retried automatically in between');
  }

  // ------------------------------------------------------------------
  // CASE E — Jenkins/WF3 checkout mismatch at final callback (HEAD_ONLY
  // itself passed for PR25_SHA, but the reported build/Sonar evidence
  // disagrees on the checked-out commit).
  // ------------------------------------------------------------------
  {
    const candidateVerification = { verifyHead: async (req: any) => passingHeadVerification(req) };
    const { incident, service } = makeFixture(candidateVerification);
    globalThis.fetch = (async (url: any, init?: RequestInit) => {
      const value = String(url);
      if (value.includes('api.github.com')) return githubOpenPr(PR25_SHA, incident);
      if (value.includes('crumbIssuer')) return validCrumb();
      if (value.includes('/api/json')) return validMetadata();
      if (value.includes('/buildWithParameters')) return new Response('', { status: 201, headers: { location: 'http://jenkins/queue/item/901/' } });
      throw new Error(`unexpected URL ${value}`);
    }) as any;
    await service.requestPrValidation(incident.id, user);
    assert.equal(incident.metadata.prValidationRequest.headVerification.overall, 'PASS');
    const driftedSha = 'e'.repeat(40);
    const validationContract = {
      validationRequestId: incident.metadata.prValidationRequest.validationRequestId, projectId: incident.projectId,
      fixRequestId: incident.metadata.fixRequest.requestId, batchId: incident.metadata.fixRequest.batchId,
      batchKey: incident.metadata.fixRequest.batchId, attemptCount: 16, repository: PR25_REPO, prNumber: 25,
      prValidationJob: incident.metadata.prValidationRequest.prValidationJob,
      expectedPrHeadSha: PR25_SHA, checkoutSha: driftedSha, // Jenkins actually built a different commit
      ceTaskId: 'ce-1', analysisId: 'analysis-1', buildNumber: 1, jenkinsJob: 'pfe-app-test', jenkinsStatus: 'SUCCESS', sonarStatus: 'OK',
      correlationVerified: true, sonarCorrelationVerified: true,
      requiredStages: ['build', 'tests', 'sonar'].map(stage => ({ stage, required: true, status: 'PASSED' })),
      findingResults: [{ findingId: 'b8db9c11-ddf9-4a23-9bf3-1d2ff15a59ef', result: 'VALID', evidence: 'analysis-1' }],
    };
    await assert.rejects(() => service.saveValidation(incident.id, validationContract), /HEAD attendu/, 'CASE E: Jenkins checkout mismatch is rejected, never VALIDATED');
  }

  // ------------------------------------------------------------------
  // CASE F — correlation mismatch: correct SHA, but the persisted
  // headVerification evidence belongs to a different requestId. Simulates a
  // reused/misattributed evidence record; must never satisfy this validation.
  // ------------------------------------------------------------------
  {
    const candidateVerification = { verifyHead: async (req: any) => passingHeadVerification(req) };
    const { incident, service } = makeFixture(candidateVerification);
    globalThis.fetch = (async (url: any) => {
      const value = String(url);
      if (value.includes('api.github.com')) return githubOpenPr(PR25_SHA, incident);
      if (value.includes('crumbIssuer')) return validCrumb();
      if (value.includes('/api/json')) return validMetadata();
      if (value.includes('/buildWithParameters')) return new Response('', { status: 201, headers: { location: 'http://jenkins/queue/item/902/' } });
      throw new Error(`unexpected URL ${value}`);
    }) as any;
    await service.requestPrValidation(incident.id, user);
    // Tamper the persisted evidence's identity to simulate evidence that was
    // actually computed for a different fixRequest/batch -- correct SHA,
    // wrong everything else.
    incident.metadata.prValidationRequest.headVerification.identity.requestId = 'a-completely-different-request-id';
    const validationContract = {
      validationRequestId: incident.metadata.prValidationRequest.validationRequestId, projectId: incident.projectId,
      fixRequestId: incident.metadata.fixRequest.requestId, batchId: incident.metadata.fixRequest.batchId,
      batchKey: incident.metadata.fixRequest.batchId, attemptCount: 16, repository: PR25_REPO, prNumber: 25,
      prValidationJob: incident.metadata.prValidationRequest.prValidationJob, expectedPrHeadSha: PR25_SHA, checkoutSha: PR25_SHA,
      ceTaskId: 'ce-1', analysisId: 'analysis-1', buildNumber: 1, jenkinsJob: 'pfe-app-test', jenkinsStatus: 'SUCCESS', sonarStatus: 'OK',
      correlationVerified: true, sonarCorrelationVerified: true,
      requiredStages: ['build', 'tests', 'sonar'].map(stage => ({ stage, required: true, status: 'PASSED' })),
      findingResults: [{ findingId: 'b8db9c11-ddf9-4a23-9bf3-1d2ff15a59ef', result: 'VALID', evidence: 'analysis-1' }],
    };
    await assert.rejects(() => service.saveValidation(incident.id, validationContract), /identité de validation attendue/, 'CASE F: mismatched correlation identity is rejected despite the correct SHA');
  }

  // ------------------------------------------------------------------
  // CASE G — duplicate validation request: same identity, already in flight.
  // Exactly one HEAD_ONLY run and one Jenkins trigger must occur.
  // ------------------------------------------------------------------
  {
    let headOnlyCalls = 0;
    const candidateVerification = { verifyHead: async (req: any) => { headOnlyCalls++; return passingHeadVerification(req); } };
    const { incident, service } = makeFixture(candidateVerification);
    let triggers = 0;
    globalThis.fetch = (async (url: any) => {
      const value = String(url);
      if (value.includes('api.github.com')) return githubOpenPr(PR25_SHA, incident);
      if (value.includes('crumbIssuer')) return validCrumb();
      if (value.includes('/api/json')) return validMetadata();
      if (value.includes('/buildWithParameters')) { triggers++; return new Response('', { status: 201, headers: { location: 'http://jenkins/queue/item/903/' } }); }
      throw new Error(`unexpected URL ${value}`);
    }) as any;
    const results = await Promise.all([service.requestPrValidation(incident.id, user), service.requestPrValidation(incident.id, user)]);
    assert.equal(headOnlyCalls, 1, 'CASE G: HEAD_ONLY runs exactly once despite the concurrent duplicate request');
    assert.equal(triggers, 1, 'CASE G: Jenkins is triggered exactly once');
    assert.equal(results.filter((r: any) => r.duplicate).length, 1, 'CASE G: exactly one of the two calls is recognized as a duplicate');
  }

  // ------------------------------------------------------------------
  // CASE H — PR HEAD changes after a validation attempt was frozen: the old
  // evidence tied to PR25_SHA must never silently validate a later commit.
  // ------------------------------------------------------------------
  {
    const candidateVerification = { verifyHead: async (req: any) => passingHeadVerification(req) };
    const { incident, service } = makeFixture(candidateVerification);
    globalThis.fetch = (async (url: any) => {
      const value = String(url);
      if (value.includes('api.github.com')) return githubOpenPr(PR25_SHA, incident);
      if (value.includes('crumbIssuer')) return validCrumb();
      if (value.includes('/api/json')) return validMetadata();
      if (value.includes('/buildWithParameters')) return new Response('', { status: 201, headers: { location: 'http://jenkins/queue/item/904/' } });
      throw new Error(`unexpected URL ${value}`);
    }) as any;
    await service.requestPrValidation(incident.id, user);
    const frozenRecord = incident.metadata.prValidationRequest;
    assert.equal(frozenRecord.expectedPrHeadSha, PR25_SHA);

    // Live PR head moves to a follow-up commit without a governed
    // refresh-target call -- the existing freshness gate must reject a new
    // validation attempt against the moved head, leaving the abc-tied
    // evidence exactly as it was.
    const movedSha = 'd'.repeat(40);
    globalThis.fetch = (async (url: any) => {
      const value = String(url);
      if (value.includes('api.github.com')) return githubOpenPr(movedSha, incident);
      throw new Error('Jenkins/HEAD_ONLY must never be reached for an ungoverned moved PR head');
    }) as any;
    await assert.rejects(() => service.requestPrValidation(incident.id, user), /Pull Request a changé/);
    assert.deepEqual(incident.metadata.prValidationRequest, frozenRecord, 'CASE H: old evidence tied to PR25_SHA is untouched; the moved head requires a governed refresh, never silent reuse');
  }

  globalThis.fetch = originalFetch;
  console.log('PR validation HEAD_ONLY lifecycle (Brique 2, Cases A-H): PASS');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
