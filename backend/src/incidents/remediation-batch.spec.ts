import * as assert from 'node:assert/strict';
import { buildPrValidationJobName, canRetryFixRequest, encodePrValidationContext, IncidentsService, isFullGitSha, prValidationIdentity, remediationBatchIdentity, resolveRemediationBatch } from './incidents.service';

const sonar = (id: string, extra: any = {}) => ({
  id, source: 'SONARQUBE', stage: 'sonar', remediationType: 'AUTO_FIX_ELIGIBLE',
  rule: 'java:S1068', file: `src/${id}.java`, line: 10, message: `Finding ${id}`, ...extra,
});

const deduped = resolveRemediationBatch([sonar('a'), sonar('b')], ['b', 'a', 'a']);
assert.deepEqual(deduped.findingIds, ['a', 'b']);
assert.equal(deduped.workflow, 'WF2');
assert.equal(remediationBatchIdentity('incident', ['b', 'a', 'a']), remediationBatchIdentity('incident', ['a', 'b']));
assert.throws(() => resolveRemediationBatch([sonar('a')], ['missing']), /appartiennent pas à cet incident/);
assert.throws(() => resolveRemediationBatch([sonar('a', { remediationType: 'DEVELOPER_ACTION_REQUIRED' })], ['a']), /correction automatisable/);
assert.throws(() => resolveRemediationBatch([sonar('a'), { ...sonar('b'), source: 'DOCKER', stage: 'docker' }], ['a', 'b']), /même stratégie/);
const retryable = { status: 'FIX_FAILED', retryEligible: true, attemptCount: 3,
  attempts: [{ attempt: 1, status: 'FIX_FAILED' }, { attempt: 2, status: 'FIX_FAILED' }, { attempt: 3, status: 'FIX_FAILED' }] };
assert.equal(canRetryFixRequest(retryable), true);
assert.equal(canRetryFixRequest({ ...retryable, status: 'FIX_STARTING' }), false);
assert.equal(canRetryFixRequest({ ...retryable, status: 'DISPATCHED' }), false);
assert.equal(canRetryFixRequest({ ...retryable, status: 'PR_CREATED' }), false);
assert.equal(canRetryFixRequest({ ...retryable, status: 'VALIDATING' }), false);
assert.equal(canRetryFixRequest({ ...retryable, attempts: [...retryable.attempts, { attempt: 4, status: 'DISPATCHED' }] }), false);
assert.equal(isFullGitSha('a'.repeat(40)), true);
assert.equal(isFullGitSha('a'.repeat(8)), false);
assert.equal(prValidationIdentity('p', 24, 'A'.repeat(40), 'b'), prValidationIdentity('p', 24, 'a'.repeat(40), 'b'));
assert.match(encodePrValidationContext({ validationRequestId: 'v' }), /^[A-Za-z0-9_-]+$/);

// Double soumission équivalente : une seule transaction crée la demande et
// une seule invocation future est dispatchée. Aucun service externe réel.
const incident: any = {
  id: 'incident-1', projectId: 'project-1', project: { id: 'project-1', githubRepo: 'owner/repo' },
  status: 'blocked', prUrl: null, buildNumber: 136, metadata: { enrichedData: { sonar: { issues: [sonar('a'), sonar('b')] } } },
};
let lockedFindOptions: any;
const transactionalRepo = {
  findOne: async (options: any) => { lockedFindOptions = options; return incident; },
  update: async (_id: string, patch: any) => Object.assign(incident, patch),
};
const project = { id: 'project-1', githubRepo: 'owner/repo' };
const transactionalProjectRepo = { findOne: async () => project };
const repository: any = {
  manager: { transaction: async (fn: any) => fn({ getRepository: (entity: any) => entity?.name === 'Project' ? transactionalProjectRepo : transactionalRepo }) },
  findOne: async () => incident,
  update: transactionalRepo.update,
};
async function main() {
  let dispatches = 0;
  const payloads: any[] = [];
  const originalFetch = globalThis.fetch;
  const originalWorkflowId = process.env.N8N_WF2_ID;
  process.env.N8N_WF2_ID = '9adcV31eaIgJyMR0';
  globalThis.fetch = async (_url: any, options: any) => { dispatches++; payloads.push(JSON.parse(options.body)); return new Response('{}', { status: 200 }); };
  try {
  const service = new IncidentsService(repository, transactionalProjectRepo as any, { emit: () => undefined } as any, { syncIncident: async () => undefined } as any, {} as any);
  const user = { id: 'developer-1', role: 'developer' };
  const first: any = await service.approveFix(incident.id, user, { findingIds: ['b', 'a', 'a'] });
  assert.equal(first.duplicate, false);
  await assert.rejects(
    () => service.approveFix(incident.id, user, { findingIds: ['a', 'b'] }),
    /Une demande de correction existe déjà.*Réessayer la correction/,
  );
  assert.equal(dispatches, 1);
  assert.equal(lockedFindOptions.lock.mode, 'pessimistic_write');
  assert.equal(lockedFindOptions.relations, undefined, 'locked incident query must not join project');
  assert.equal(payloads[0].buildNumber, 136);
  assert.equal(payloads[0].batchKey, first.batchId);
  assert.equal(payloads[0].batchId, first.batchId);
  assert.deepEqual(payloads[0].findingIds, ['a', 'b']);
  assert.equal(payloads[0].findings.length, 2);
  assert.deepEqual(incident.metadata.fixRequest.findingIds, ['a', 'b']);
  incident.prUrl = 'https://github.com/owner/repo/pull/7';
  incident.buildNumber = 136;
  incident.jenkinsJobName = 'project-job';
  incident.metadata.fixRequest.prNumber = 7;
  incident.metadata.fixRequest.prHeadSha = 'a'.repeat(40);
  incident.metadata.prValidationRequest = {
    validationRequestId: 'validation-1', status: 'QUEUED', expectedPrHeadSha: 'a'.repeat(40),
  };
  const validationContract = {
    validationRequestId: 'validation-1', projectId: 'project-1', fixRequestId: first.requestId,
    batchId: first.batchId, batchKey: first.batchId, attemptCount: 1, repository: 'owner/repo', prNumber: 7,
    prValidationJob: buildPrValidationJobName('project-job', 7), expectedPrHeadSha: 'a'.repeat(40), checkoutSha: 'a'.repeat(40),
    ceTaskId: 'ce-1', analysisId: 'analysis-1', buildNumber: 1, jenkinsJob: 'project-job', jenkinsStatus: 'SUCCESS', sonarStatus: 'OK',
    correlationVerified: true, sonarCorrelationVerified: true,
    requiredStages: ['build','tests','sonar'].map(stage => ({ stage, required: true, status: 'PASSED' })),
  };
  await assert.rejects(() => service.saveValidation(incident.id, {
    ...validationContract, findingResults: [{ findingId: 'a', result: 'VALID', evidence: 'analysis-a' }],
  }), /exactement un résultat/);
  const validated: any = await service.saveValidation(incident.id, {
    ...validationContract,
    findingResults: [{ findingId: 'a', result: 'VALID', evidence: 'analysis-a' }, { findingId: 'b', result: 'VALID', evidence: 'analysis-b' }],
  });
  assert.equal(validated.validation.validationStatus, 'VALIDATED');
  assert.equal(validated.validation.findingResults.length, 2);

  // Un échec de dispatch conserve le batch logique. Une nouvelle autorisation
  // humaine réutilise requestId/batchId, incrémente la tentative et dispatch
  // exactement une fois.
  const retryIncident: any = {
    id: 'incident-retry', projectId: 'project-1', status: 'blocked', prUrl: null, buildNumber: 136,
    metadata: { enrichedData: { sonar: { issues: [sonar('a'), sonar('b')] } } },
  };
  const retryIncidentRepo: any = {
    findOne: async () => retryIncident,
    update: async (_id: string, patch: any) => Object.assign(retryIncident, patch),
  };
  const retryRepository: any = {
    manager: { transaction: async (fn: any) => fn({ getRepository: (entity: any) => entity?.name === 'Project' ? transactionalProjectRepo : retryIncidentRepo }) },
    findOne: async () => retryIncident,
    update: retryIncidentRepo.update,
  };
  const retryService = new IncidentsService(retryRepository, transactionalProjectRepo as any, { emit: () => undefined } as any, { syncIncident: async () => undefined } as any, {} as any);
  globalThis.fetch = async () => { throw new Error('simulated dispatch failure'); };
  await assert.rejects(() => retryService.approveFix(retryIncident.id, user, { findingIds: ['a', 'b'] }), /correction n’a pas pu démarrer/);
  const failedRequestId = retryIncident.metadata.fixRequest.requestId;
  const failedBatchId = retryIncident.metadata.fixRequest.batchId;
  assert.equal(retryIncident.metadata.fixRequest.status, 'FIX_FAILED');
  assert.equal(retryIncident.metadata.fixRequest.attemptCount, 1);
  let retryDispatches = 0;
  globalThis.fetch = async () => { retryDispatches++; return new Response('{}', { status: 200 }); };
  await assert.rejects(
    () => retryService.approveFix(retryIncident.id, user, { findingIds: ['a'] }),
    /Une demande de correction existe déjà.*Réessayer la correction/,
  );
  assert.equal(retryDispatches, 0);
  retryIncident.prUrl = 'https://github.com/owner/repo/pull/24';
  retryIncident.metadata.fixRequest.branchName = 'fix/existing-logical-batch';
  const retried: any = await retryService.retryFix(retryIncident.id, user);
  assert.equal(retried.duplicate, false);
  assert.equal(retried.requestId, failedRequestId);
  assert.equal(retried.batchId, failedBatchId);
  assert.equal(retried.attemptCount, 2);
  assert.equal(retryIncident.metadata.fixRequest.status, 'DISPATCHED');
  assert.equal(retryIncident.metadata.fixRequest.attempts.length, 2);
  assert.equal(retryDispatches, 1);
  await assert.rejects(
    () => retryService.approveFix(retryIncident.id, user, { findingIds: ['a', 'b'] }),
    /Pull Request existe déjà/,
  );
  assert.equal(retryDispatches, 1);

  // Deux autorisations concurrentes après FIX_FAILED sont sérialisées par le
  // verrou : une seule devient une tentative de dispatch.
  const concurrentIncident: any = {
    id: 'incident-concurrent', projectId: 'project-1', status: 'blocked', prUrl: null, buildNumber: 136,
    metadata: { enrichedData: { sonar: { issues: [sonar('a'), sonar('b')] } }, fixRequest: {
      requestId: 'request-concurrent', batchId: remediationBatchIdentity('incident-concurrent', ['a', 'b']),
      status: 'FIX_FAILED', workflow: 'WF2', retryEligible: true, findingId: 'a', findingIds: ['a', 'b'], attemptCount: 1,
      attempts: [{ attempt: 1, status: 'FIX_FAILED' }],
    } },
  };
  const concurrentIncidentRepo: any = {
    findOne: async () => concurrentIncident,
    update: async (_id: string, patch: any) => Object.assign(concurrentIncident, patch),
  };
  let transactionTail = Promise.resolve();
  const concurrentRepository: any = {
    manager: { transaction: async (fn: any) => {
      const previous = transactionTail;
      let release!: () => void;
      transactionTail = new Promise<void>(resolve => { release = resolve; });
      await previous;
      try { return await fn({ getRepository: (entity: any) => entity?.name === 'Project' ? transactionalProjectRepo : concurrentIncidentRepo }); }
      finally { release(); }
    } },
    findOne: async () => concurrentIncident,
    update: concurrentIncidentRepo.update,
  };
  const concurrentService = new IncidentsService(concurrentRepository, transactionalProjectRepo as any, { emit: () => undefined } as any, { syncIncident: async () => undefined } as any, {} as any);
  let concurrentDispatches = 0;
  globalThis.fetch = async () => { concurrentDispatches++; return new Response('{}', { status: 200 }); };
  const concurrentResults = await Promise.allSettled([
    concurrentService.retryFix(concurrentIncident.id, user),
    concurrentService.retryFix(concurrentIncident.id, user),
  ]);
  assert.equal(concurrentDispatches, 1);
  assert.equal(concurrentResults.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(concurrentResults.filter(result => result.status === 'rejected').length, 1);

  // Le callback asynchrone WF2 est corrélé, idempotent et fail-closed.
  const callbackIncident: any = {
    id: 'incident-callback', projectId: 'project-1', status: 'blocked', prUrl: null, metadata: { fixRequest: {
      requestId: 'request-callback', batchId: 'batch-callback', workflow: 'WF2', status: 'DISPATCHED',
      findingIds: ['a', 'b'], attemptCount: 1, attempts: [{ attempt: 1, expectedWorkflowId: '9adcV31eaIgJyMR0', status: 'DISPATCHED' }],
    } },
  };
  const callbackRepo: any = {
    findOne: async () => callbackIncident,
    update: async (_id: string, patch: any) => Object.assign(callbackIncident, patch),
  };
  const callbackRepository: any = {
    manager: { transaction: async (fn: any) => fn({ getRepository: () => callbackRepo }) },
    findOne: async () => callbackIncident,
    update: callbackRepo.update,
  };
  const callbackService = new IncidentsService(callbackRepository, transactionalProjectRepo as any, { emit: () => undefined } as any, { syncIncident: async () => undefined } as any, {} as any);
  const failure = {
    status: 'FAILED' as const, workflowId: '9adcV31eaIgJyMR0', executionId: '1887',
    incidentId: callbackIncident.id, requestId: 'request-callback', batchId: 'batch-callback', batchKey: 'batch-callback',
    attemptCount: 1, failureCode: 'WF2_EXECUTION_ERROR', failureSummary: 'workflow execution error', failureNode: 'Create Branch1',
  };
  const failed: any = await callbackService.saveWorkflowBatchStatus(callbackIncident.id, failure);
  assert.equal(failed.applied, true);
  assert.equal(callbackIncident.metadata.fixRequest.status, 'FIX_FAILED');
  assert.equal(callbackIncident.metadata.fixRequest.attemptCount, 1);
  assert.equal(callbackIncident.metadata.fixRequest.workflowEvents.length, 1);
  assert.equal(callbackIncident.metadata.fixRequest.retryEligible, true);
  const duplicateFailure: any = await callbackService.saveWorkflowBatchStatus(callbackIncident.id, failure);
  assert.equal(duplicateFailure.duplicate, true);
  assert.equal(callbackIncident.metadata.fixRequest.workflowEvents.length, 1);
  await assert.rejects(() => callbackService.saveWorkflowBatchStatus(callbackIncident.id, { ...failure, requestId: 'wrong' }), /ne correspond pas/);
  await assert.rejects(() => callbackService.saveWorkflowBatchStatus(callbackIncident.id, { ...failure, batchId: 'wrong', batchKey: 'wrong' }), /ne correspond pas/);
  await assert.rejects(() => callbackService.saveWorkflowBatchStatus(callbackIncident.id, { ...failure, attemptCount: 2 }), /ne correspond pas/);
  await assert.rejects(() => callbackService.saveWorkflowBatchStatus(callbackIncident.id, { ...failure, attemptCount: null as any }), /ne correspond pas/);
  await assert.rejects(() => callbackService.saveWorkflowBatchStatus(callbackIncident.id, { ...failure, workflowId: 'wrong' }), /ne correspond pas/);

  // Une PR corrélée progresse vers PR_CREATED. Une erreur tardive ne peut
  // ensuite pas dégrader cet état plus récent.
  callbackIncident.metadata.fixRequest = {
    requestId: 'request-success', batchId: 'batch-success', workflow: 'WF2', status: 'DISPATCHED',
    findingIds: ['a', 'b'], findings: [{ findingId: 'a', file: 'TaskService.java' }, { findingId: 'b', file: 'SecurityConfig.java' }],
    attemptCount: 2, attempts: [{ attempt: 2, expectedWorkflowId: '9adcV31eaIgJyMR0', status: 'DISPATCHED' }],
  };
  const attemptTwoFailure: any = { ...failure, executionId: '2000', requestId: 'request-success',
    batchId: 'batch-success', batchKey: 'batch-success' };
  await assert.rejects(() => callbackService.saveWorkflowBatchStatus(callbackIncident.id,
    { ...attemptTwoFailure, attemptCount: 1 }), /ne correspond pas/);
  await assert.rejects(() => callbackService.saveWorkflowBatchStatus(callbackIncident.id,
    { ...attemptTwoFailure, attemptCount: 3 }), /ne correspond pas/);
  await assert.rejects(() => callbackService.saveWorkflowBatchStatus(callbackIncident.id,
    { ...attemptTwoFailure, attemptCount: null }), /ne correspond pas/);
  const acceptedAttemptTwo: any = await callbackService.saveWorkflowBatchStatus(callbackIncident.id,
    { ...attemptTwoFailure, attemptCount: 2, failureNode: 'Prepare Batch Context' });
  assert.equal(acceptedAttemptTwo.applied, true);
  assert.equal(callbackIncident.metadata.fixRequest.status, 'FIX_FAILED');
  assert.equal(callbackIncident.metadata.fixRequest.attempts[0].workflowExecutionId, '2000');
  callbackIncident.metadata.fixRequest = {
    requestId: 'request-success', batchId: 'batch-success', workflow: 'WF2', status: 'DISPATCHED',
    findingIds: ['a', 'b'], findings: [{ findingId: 'a', file: 'TaskService.java' }, { findingId: 'b', file: 'SecurityConfig.java' }],
    attemptCount: 2, attempts: [{ attempt: 2, expectedWorkflowId: '9adcV31eaIgJyMR0', status: 'DISPATCHED' }],
  };
  const successBase: any = {
    status: 'PR_CREATED', workflowId: '9adcV31eaIgJyMR0', executionId: '2000', incidentId: callbackIncident.id,
    requestId: 'request-success', batchId: 'batch-success', batchKey: 'batch-success', attemptCount: 2,
    prUrl: 'https://github.com/owner/repo/pull/24', prNumber: 24, prHeadSha: '3333333333333333333333333333333333333333',
  };
  await assert.rejects(() => callbackService.saveWorkflowBatchStatus(callbackIncident.id, {
    ...successBase, completenessPassed: true, processedFindingIds: ['a', 'b'],
    effectiveRemediatedFindingIds: ['a'], verifiedFiles: ['TaskService.java'], updatedFiles: ['TaskService.java'],
    fileResults: [{ targetFile: 'TaskService.java', outcome: 'MODIFIED_AND_REMEDIATED', finalStateVerified: true }],
    commitShas: ['1111111111111111111111111111111111111111'],
  }), /ne couvre pas exactement/);
  const success: any = await callbackService.saveWorkflowBatchStatus(callbackIncident.id, {
    ...successBase, completenessPassed: true,
    processedFindingIds: ['b', 'a'], updatedFiles: ['SecurityConfig.java', 'TaskService.java'],
    effectiveRemediatedFindingIds: ['b', 'a'], verifiedFiles: ['SecurityConfig.java', 'TaskService.java'],
    fileResults: [
      { targetFile: 'TaskService.java', outcome: 'MODIFIED_AND_REMEDIATED', finalStateVerified: true },
      { targetFile: 'SecurityConfig.java', outcome: 'ALREADY_REMEDIATED', finalStateVerified: true },
    ],
    // Un fichier déjà correctement résolu n’exige aucun nouveau commit.
    commitShas: ['1111111111111111111111111111111111111111'],
    prHeadSha: '3333333333333333333333333333333333333333',
  });
  assert.equal(success.applied, true);
  assert.equal(callbackIncident.metadata.fixRequest.status, 'PR_CREATED');
  assert.equal(callbackIncident.prUrl, 'https://github.com/owner/repo/pull/24');
  const stale: any = await callbackService.saveWorkflowBatchStatus(callbackIncident.id, {
    status: 'FAILED', workflowId: '9adcV31eaIgJyMR0', executionId: '2000', incidentId: callbackIncident.id,
    requestId: 'request-success', batchId: 'batch-success', batchKey: 'batch-success', attemptCount: 2,
    failureSummary: 'late failure',
  });
  assert.equal(stale.stale, true);
  assert.equal(callbackIncident.metadata.fixRequest.status, 'PR_CREATED');
  const reconciledIncomplete: any = await callbackService.saveWorkflowBatchStatus(callbackIncident.id, {
    status: 'FAILED', workflowId: '9adcV31eaIgJyMR0', executionId: '2000', incidentId: callbackIncident.id,
    requestId: 'request-success', batchId: 'batch-success', batchKey: 'batch-success', attemptCount: 2,
    reconciliation: true, failureCode: 'WF2_BATCH_INCOMPLETE',
    failureSummary: '1 correction appliquée sur 2', failureNode: 'Validate Batch Completeness',
  });
  assert.equal(reconciledIncomplete.applied, true);
  assert.equal(callbackIncident.metadata.fixRequest.status, 'FIX_FAILED');
  assert.equal(callbackIncident.metadata.fixRequest.retryEligible, true);

  // R19.3C neutral candidate evidence supports supplemental planned files
  // without claiming that the scanner finding is resolved before WF3.
  callbackIncident.status = 'blocked';
  callbackIncident.prUrl = null;
  callbackIncident.metadata.fixRequest = {
    requestId: 'request-candidate', batchId: 'batch-candidate', workflow: 'WF2', status: 'DISPATCHED',
    findingIds: ['a'], findings: [{ findingId: 'a', file: 'ThingController.java' }],
    attemptCount: 3, attempts: [{ attempt: 3, expectedWorkflowId: '9adcV31eaIgJyMR0', status: 'DISPATCHED' }],
  };
  const candidatePayload: any = {
    status: 'PR_CREATED', workflowId: '9adcV31eaIgJyMR0', executionId: '2001', incidentId: callbackIncident.id,
    requestId: 'request-candidate', batchId: 'batch-candidate', batchKey: 'batch-candidate', attemptCount: 3,
    completenessPassed: true, processedFindingIds: ['a'], candidateAcceptedFindingIds: ['a'],
    plannedFiles: ['ThingController.java', 'ThingRequest.java'],
    candidateVerifiedFiles: ['ThingController.java', 'ThingRequest.java'],
    updatedFiles: ['ThingController.java', 'ThingRequest.java'],
    fileResults: [
      { targetFile: 'ThingController.java', outcome: 'CANDIDATE_ACCEPTABLE_FOR_SCANNER_VALIDATION', candidateStateVerified: true },
      { targetFile: 'ThingRequest.java', outcome: 'CANDIDATE_ACCEPTABLE_FOR_SCANNER_VALIDATION', candidateStateVerified: true },
    ],
    commitShas: ['4444444444444444444444444444444444444444'],
    prUrl: 'https://github.com/owner/repo/pull/25', prNumber: 25,
    prHeadSha: '5555555555555555555555555555555555555555',
  };
  await assert.rejects(() => callbackService.saveWorkflowBatchStatus(callbackIncident.id, {
    ...candidatePayload,
    candidateVerifiedFiles: ['ThingController.java'],
    updatedFiles: ['ThingController.java'],
    fileResults: [candidatePayload.fileResults[0]],
  }), /ne couvre pas exactement/);
  await assert.rejects(() => callbackService.saveWorkflowBatchStatus(callbackIncident.id, {
    ...candidatePayload, prHeadSha: 'not-a-sha',
  }), /ne couvre pas exactement/);
  // The first R19.3C staged draft predates the optional plannedFiles evidence.
  // Its three-field neutral contract remains accepted and complete because the
  // verified-file set must still exactly match the per-file results.
  const { plannedFiles: _optionalPlannedFiles, ...stagedCandidatePayload } = candidatePayload;
  const candidateSuccess: any = await callbackService.saveWorkflowBatchStatus(callbackIncident.id, stagedCandidatePayload);
  assert.equal(candidateSuccess.applied, true);
  assert.deepEqual(callbackIncident.metadata.fixRequest.candidateAcceptedFindingIds, ['a']);
  assert.deepEqual(callbackIncident.metadata.fixRequest.effectiveRemediatedFindingIds, []);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWorkflowId === undefined) delete process.env.N8N_WF2_ID; else process.env.N8N_WF2_ID = originalWorkflowId;
  }

  console.log('remediation batch contract: PASS');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
