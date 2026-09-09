import * as assert from 'node:assert/strict';
import {
  IncidentsService,
  jenkinsBuildMatchesPrValidation,
  decodeJenkinsValidationContext,
  canonicalGitRepo,
} from './incidents.service';

// R72B — deterministic SHA/context fallback correlation for a stale QUEUED
// validation whose persisted queueId matches no Jenkins build. Proven live on
// PR-24: the platform POSTed queue item 1496, Jenkins' multibranch machinery
// superseded it, and the WorkflowRun that actually ran carries queueId 1505.

const SHA = '29a12b5a77c8dfc279366f3f72461676708f4e49';
const OTHER_SHA = '5cf69aaed7a89953fc0eab882bf269b4509a36cc';
const VRID = '529fe4999887b1f3b9a4ab887689e6492f73b2710402b901f632298934f9fa78';
const REQUEST_CREATED_AT = '2026-09-01T13:09:02.419Z';
const REQUEST_TS = Date.parse(REQUEST_CREATED_AT);
const APP_REMOTE = 'https://github.com/souhaiel11/pfe-app-test.git';
const LIB_REMOTE = 'https://github.com/souhaiel11/pfe-devsecops-shared-library.git';

function contextParam(overrides: Record<string, unknown> = {}) {
  const context = { validationRequestId: VRID, expectedPrHeadSha: SHA, prNumber: 24, ...overrides };
  return {
    _class: 'hudson.model.ParametersAction',
    parameters: [
      { _class: 'hudson.model.BooleanParameterValue', name: 'JENKINS_HARD_GATE', value: false },
      {
        _class: 'hudson.model.StringParameterValue',
        name: 'PFE_VALIDATION_CONTEXT',
        value: Buffer.from(JSON.stringify(context)).toString('base64url'),
      },
    ],
  };
}
function gitBuildData(sha: string, remote: string) {
  return { _class: 'hudson.plugins.git.util.BuildData', lastBuiltRevision: { SHA1: sha }, remoteUrls: [remote] };
}
// A realistic PR-24 build #7: two BuildData actions (shared lib + app repo),
// the PFE_VALIDATION_CONTEXT parameter, UNSTABLE, started after the request.
function build(over: Record<string, unknown> = {}, contextOverrides: Record<string, unknown> = {}) {
  return {
    number: 7,
    queueId: 1505,
    building: false,
    result: 'UNSTABLE',
    timestamp: REQUEST_TS + 10_000,
    actions: [
      contextParam(contextOverrides),
      gitBuildData('eecfd7a09fbb1c8dc7d2bb7f4b0818b8b2cd5f76', LIB_REMOTE),
      gitBuildData(SHA, APP_REMOTE),
      {},
    ],
    ...over,
  };
}

const CRITERIA = {
  expectedPrHeadSha: SHA,
  validationRequestId: VRID,
  repository: 'souhaiel11/pfe-app-test',
  notBefore: REQUEST_TS,
};

function makeService() {
  const incident: any = {
    id: 'd1f5e9ce-f039-475d-9a50-41f217e6444b',
    projectId: '3aa1c9b9-e114-40e4-884b-ebc7aa32e002',
    status: 'failed',
    prUrl: 'https://github.com/souhaiel11/pfe-app-test/pull/24',
    metadata: {
      fixRequest: { status: 'PR_CREATED', requestId: '9b62e087', batchId: 'batch', attemptCount: 7, prNumber: 24, prHeadSha: '10e90dd5a0d21941dea1a544c3026d0955a029b1' },
      prValidationRequest: {
        validationRequestId: VRID, validationType: 'PR_VALIDATION', status: 'QUEUED',
        projectId: '3aa1c9b9-e114-40e4-884b-ebc7aa32e002', incidentId: 'd1f5e9ce-f039-475d-9a50-41f217e6444b',
        requestId: '9b62e087', batchId: 'batch', batchKey: 'batch', attemptCount: 7,
        repository: 'souhaiel11/pfe-app-test', prNumber: 24,
        prUrl: 'https://github.com/souhaiel11/pfe-app-test/pull/24',
        prHeadBranch: 'fix/pfe-x', expectedPrHeadSha: SHA,
        queueUrl: 'http://jenkins:8080/queue/item/1496/',
        prValidationJob: 'pfe-app-test-multibranch/job/PR-24',
        createdBy: 'admin-1', createdAt: REQUEST_CREATED_AT, updatedAt: REQUEST_CREATED_AT,
        retryAttempt: 0, previousAttempts: [],
      },
    },
  };
  const project: any = {
    id: '3aa1c9b9-e114-40e4-884b-ebc7aa32e002', githubRepo: 'souhaiel11/pfe-app-test',
    jenkinsUrl: 'http://jenkins', jenkinsToken: 'user:not-printed', jenkinsJobName: 'pfe-app-test',
    sonarqubeKey: 'pfe-app-test',
  };
  incident.project = project;
  const incidentRepo: any = {
    findOne: async () => incident,
    update: async (_id: string, patch: any) => Object.assign(incident, patch),
  };
  const repository: any = {
    manager: { transaction: async (fn: any) => fn({ getRepository: (e: any) => e?.name === 'Project' ? { findOne: async () => project } : incidentRepo }) },
    findOne: incidentRepo.findOne,
    update: incidentRepo.update,
  };
  const service = new IncidentsService(repository, { findOne: async () => project } as any, { emit: () => undefined } as any, { syncIncident: async () => undefined } as any, {} as any);
  return { service, incident, project };
}

const user = { id: 'admin-1', role: 'admin' };

async function main() {
  const originalFetch = globalThis.fetch;

  // ---- Pure predicate unit checks (deterministic, no network) ----

  // decode round-trips both base64url and base64
  assert.equal(decodeJenkinsValidationContext(Buffer.from(JSON.stringify({ validationRequestId: VRID })).toString('base64url')).validationRequestId, VRID);
  assert.equal(decodeJenkinsValidationContext(Buffer.from(JSON.stringify({ validationRequestId: VRID })).toString('base64')).validationRequestId, VRID);
  assert.equal(decodeJenkinsValidationContext('not-base64-@@@'), null);
  assert.equal(decodeJenkinsValidationContext(undefined), null);

  assert.equal(canonicalGitRepo(APP_REMOTE), 'souhaiel11/pfe-app-test');
  assert.equal(canonicalGitRepo('git@github.com:souhaiel11/pfe-app-test.git'), 'souhaiel11/pfe-app-test');

  // exact match — every fact lines up
  assert.equal(jenkinsBuildMatchesPrValidation(build(), CRITERIA), true, 'all facts aligned → match');

  // C — wrong SHA on the app repo → no match
  assert.equal(
    jenkinsBuildMatchesPrValidation(build({ actions: [contextParam(), gitBuildData(OTHER_SHA, APP_REMOTE)] }), CRITERIA),
    false, 'C: wrong checkout SHA → no correlation');

  // C' — expected SHA is present, but only on the shared-library remote, not the project repo
  assert.equal(
    jenkinsBuildMatchesPrValidation(build({ actions: [contextParam(), gitBuildData(SHA, LIB_REMOTE), gitBuildData('eecfd7a09fbb1c8dc7d2bb7f4b0818b8b2cd5f76', APP_REMOTE)] }), CRITERIA),
    false, "C': the SHA must be the checkout of the PROJECT repo, never the shared library");

  // D — same SHA but the PFE_VALIDATION_CONTEXT carries a different validationRequestId (different validation identity)
  assert.equal(
    jenkinsBuildMatchesPrValidation(build({}, { validationRequestId: 'some-other-vrid' }), CRITERIA),
    false, 'D: mismatched validation context identity → no correlation');

  // D' — context present but its expectedPrHeadSha disagrees with the build checkout
  assert.equal(
    jenkinsBuildMatchesPrValidation(build({}, { expectedPrHeadSha: OTHER_SHA }), CRITERIA),
    false, "D': context expectedPrHeadSha must agree");

  // no context param at all → not a governed build → no match
  assert.equal(
    jenkinsBuildMatchesPrValidation(build({ actions: [gitBuildData(SHA, APP_REMOTE)] }), CRITERIA),
    false, 'a build with no PFE_VALIDATION_CONTEXT is never a fallback candidate');

  // E — still building → no match
  assert.equal(jenkinsBuildMatchesPrValidation(build({ building: true, result: null }), CRITERIA), false, 'E: still building → no correlation');
  assert.equal(jenkinsBuildMatchesPrValidation(build({ result: null }), CRITERIA), false, 'no result yet → no correlation');

  // build predates the validation request → no match
  assert.equal(jenkinsBuildMatchesPrValidation(build({ timestamp: REQUEST_TS - 1 }), CRITERIA), false, 'a build older than the request cannot be its run');

  // unparseable request createdAt → fail closed
  assert.equal(jenkinsBuildMatchesPrValidation(build(), { ...CRITERIA, notBefore: NaN }), false, 'no verifiable request time → fail closed');

  // ---- Full-service scenarios ----
  try {
    // A — exact queueId match: the existing primary path is used unchanged,
    // the SHA/context fallback is NOT consulted (build carries a bare shape,
    // no actions — proving the primary path never needs them).
    {
      const { service, incident } = makeService();
      let calls = 0;
      globalThis.fetch = async (url: any) => {
        const value = String(url);
        calls++;
        if (value.includes('/job/PR-24/api/json')) {
          assert.ok(value.includes('actions%5B') || value.includes('actions['), 'reconcile requests the enriched tree in one call');
          return new Response(JSON.stringify({ builds: [{ number: 7, queueId: 1496, building: false, result: 'FAILURE', timestamp: REQUEST_TS + 5 }] }), { status: 200 });
        }
        throw new Error(`unexpected URL in A: ${value}`);
      };
      const res: any = await service.reconcilePrValidation(incident.id, user);
      assert.equal(res.reconciled, true);
      assert.equal(incident.metadata.prValidationRequest.status, 'FAILED');
      assert.equal(incident.metadata.prValidationRequest.failureCode, 'JENKINS_PIPELINE_FAILED');
      assert.equal(incident.metadata.prValidationRequest.jenkinsBuildNumber, 7);
      assert.equal(incident.metadata.prValidationRequest.correlationMethod, 'QUEUE_ID', 'A: queueId match → primary correlation');
      assert.equal(incident.metadata.prValidationRequest.submittedQueueId, 1496);
      assert.equal(incident.metadata.prValidationRequest.matchedBuildQueueId, 1496);
      assert.equal(calls, 1, 'A: no console fetch for a FAILURE build, single API call');
    }

    // G — queueId absent AND no fallback candidate → STILL_QUEUED, no write.
    {
      const { service, incident } = makeService();
      globalThis.fetch = async (url: any) => {
        const value = String(url);
        if (value.includes('/job/PR-24/api/json')) return new Response(JSON.stringify({ builds: [] }), { status: 200 });
        throw new Error(`unexpected URL in G: ${value}`);
      };
      const res: any = await service.reconcilePrValidation(incident.id, user);
      assert.equal(res.reconciled, false);
      assert.equal(res.reason, 'STILL_QUEUED');
      assert.equal(incident.metadata.prValidationRequest.status, 'QUEUED', 'G: no write when nothing correlates');
    }

    // C (service) — queueId mismatch + a terminal build for the WRONG SHA → no reconciliation.
    {
      const { service, incident } = makeService();
      globalThis.fetch = async (url: any) => {
        const value = String(url);
        if (value.includes('/job/PR-24/api/json')) {
          return new Response(JSON.stringify({ builds: [build({ queueId: 1505, actions: [contextParam(), gitBuildData(OTHER_SHA, APP_REMOTE)] })] }), { status: 200 });
        }
        throw new Error(`unexpected URL in C: ${value}`);
      };
      const res: any = await service.reconcilePrValidation(incident.id, user);
      assert.equal(res.reconciled, false);
      assert.equal(res.reason, 'STILL_QUEUED');
      assert.equal(incident.metadata.prValidationRequest.status, 'QUEUED', 'C: wrong-SHA build is never reconciled');
    }

    // E (service) — queueId mismatch + the only SHA/context match is still building → no write.
    {
      const { service, incident } = makeService();
      globalThis.fetch = async (url: any) => {
        const value = String(url);
        if (value.includes('/job/PR-24/api/json')) return new Response(JSON.stringify({ builds: [build({ queueId: 1505, building: true, result: null })] }), { status: 200 });
        throw new Error(`unexpected URL in E: ${value}`);
      };
      const res: any = await service.reconcilePrValidation(incident.id, user);
      assert.equal(res.reconciled, false);
      assert.equal(res.reason, 'STILL_QUEUED', 'E: a still-building candidate is not terminal, so it is not a candidate at all');
      assert.equal(incident.metadata.prValidationRequest.status, 'QUEUED');
    }

    // F (service) — two builds each satisfy every correlation fact → CORRELATION_AMBIGUOUS, no write.
    {
      const { service, incident } = makeService();
      globalThis.fetch = async (url: any) => {
        const value = String(url);
        if (value.includes('/job/PR-24/api/json')) {
          return new Response(JSON.stringify({ builds: [
            build({ number: 7, queueId: 1505 }),
            build({ number: 8, queueId: 1540, result: 'FAILURE' }),
          ] }), { status: 200 });
        }
        throw new Error(`unexpected URL in F: ${value}`);
      };
      const res: any = await service.reconcilePrValidation(incident.id, user);
      assert.equal(res.reconciled, false);
      assert.equal(res.reason, 'CORRELATION_AMBIGUOUS');
      assert.deepEqual(res.candidateBuildNumbers.sort(), [7, 8]);
      assert.equal(incident.metadata.prValidationRequest.status, 'QUEUED', 'F: ambiguity fails closed — never picks one');
    }

    // B + H + I + J + K — THE R72A case: queueId 1496 matches no build, but
    // build #7 (queueId 1505, UNSTABLE, exact SHA, exact context) correlates by
    // fallback and reconciles with the EXISTING UNSTABLE terminal semantics.
    {
      const { service, incident } = makeService();
      let triggers = 0;
      let consoleFetched = false;
      globalThis.fetch = async (url: any, init?: RequestInit) => {
        const value = String(url);
        if (value.includes('/buildWithParameters') || value.includes('/build?')) { triggers++; throw new Error('reconciliation must never trigger a Jenkins build'); }
        if (value.includes('/webhook/') || value.includes(':5678')) { triggers++; throw new Error('reconciliation must never trigger WF1/WF3'); }
        if (value.includes('/job/PR-24/api/json')) {
          return new Response(JSON.stringify({ builds: [
            build({ number: 6, queueId: 1475, timestamp: REQUEST_TS - 3_600_000 }, { validationRequestId: 'older-lineage-vrid' }),
            build({ number: 7, queueId: 1505 }),
          ] }), { status: 200 });
        }
        if (value.includes('/7/consoleText')) {
          consoleFetched = true;
          return new Response('[INFO] ANALYSIS SUCCESSFUL\n[INFO] More about the report processing at http://sonarqube:9000/api/ce/task?id=1570d491-94cf-48aa-a219-d7d64792c46b\n', { status: 200 });
        }
        throw new Error(`unexpected URL in B/H: ${value}`);
      };
      const before = { ...incident.metadata.prValidationRequest };
      const res: any = await service.reconcilePrValidation(incident.id, user);
      const after = incident.metadata.prValidationRequest;

      assert.equal(res.reconciled, true, 'B: fallback correlates build #7');
      // H — existing UNSTABLE + ceTaskId-in-console semantics, unchanged
      assert.equal(after.status, 'FAILED');
      assert.equal(after.failureCode, 'PR_VALIDATION_EVIDENCE_INCONCLUSIVE');
      assert.match(after.failureSummary, /Sonar exact-SHA a bien abouti/);
      assert.equal(after.jenkinsBuildNumber, 7);
      assert.equal(after.jenkinsBuildResult, 'UNSTABLE');
      assert.equal(consoleFetched, true, 'H: the UNSTABLE console check still runs');
      // fixRequest untouched
      assert.equal(incident.metadata.fixRequest.status, 'PR_CREATED', 'reconciliation never marks VALIDATED / never touches fixRequest');
      // identity + history preserved
      assert.equal(after.validationRequestId, before.validationRequestId);
      assert.equal(after.expectedPrHeadSha, SHA, 'expected SHA never rewritten');
      assert.deepEqual(after.previousAttempts, before.previousAttempts);
      assert.equal(after.retryAttempt, before.retryAttempt);
      // I — forensic queue evidence: submitted 1496 preserved, matched build's own queueId recorded
      assert.equal(after.correlationMethod, 'FALLBACK_SHA_CONTEXT');
      assert.equal(after.submittedQueueId, 1496, 'I: original submitted queueId preserved, not rewritten to 1505');
      assert.equal(after.matchedBuildQueueId, 1505, 'I: the build actually run is recorded distinctly');
      assert.equal(after.queueUrl, 'http://jenkins:8080/queue/item/1496/', 'I: original queueUrl left intact');
      // J / K — no build, no workflow triggered
      assert.equal(triggers, 0, 'J/K: no Jenkins build and no WF1/WF3 triggered by reconciliation');
    }

    // D (service) — a terminal build with the exact SHA but for a DIFFERENT PR
    // job's validation identity (different validationRequestId in context) → no reconcile.
    {
      const { service, incident } = makeService();
      globalThis.fetch = async (url: any) => {
        const value = String(url);
        if (value.includes('/job/PR-24/api/json')) {
          return new Response(JSON.stringify({ builds: [build({ queueId: 1505 }, { validationRequestId: 'a-different-validation-request' })] }), { status: 200 });
        }
        throw new Error(`unexpected URL in D: ${value}`);
      };
      const res: any = await service.reconcilePrValidation(incident.id, user);
      assert.equal(res.reconciled, false);
      assert.equal(res.reason, 'STILL_QUEUED', 'D: a build for another validation identity is never reconciled here');
      assert.equal(incident.metadata.prValidationRequest.status, 'QUEUED');
    }

    // SUCCESS via fallback — still fails closed exactly like the primary path.
    {
      const { service, incident } = makeService();
      globalThis.fetch = async (url: any) => {
        const value = String(url);
        if (value.includes('/job/PR-24/api/json')) return new Response(JSON.stringify({ builds: [build({ queueId: 1505, result: 'SUCCESS' })] }), { status: 200 });
        throw new Error(`unexpected URL in SUCCESS-fallback: ${value}`);
      };
      await assert.rejects(() => service.reconcilePrValidation(incident.id, user), /SUCCESS sans callback/);
      assert.equal(incident.metadata.prValidationRequest.status, 'QUEUED', 'a SUCCESS build is never auto-reconciled, fallback or not');
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
  console.log('reconcile SHA/context fallback (R72B): PASS');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
