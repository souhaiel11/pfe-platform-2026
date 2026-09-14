// R76 -- proves saveWorkflowBatchStatus persists a bounded, sanitized
// candidate-verification evidence summary on a FAILED callback, without
// touching any other existing field or behavior, and that it degrades
// safely (never throws) when the summary is absent/malformed/oversized.
//
// No live n8n execution, network or business action.
import * as assert from 'node:assert/strict';
import { IncidentsService, sanitizeVerificationEvidence } from './incidents.service';

function makeCallbackHarness() {
  const incident: any = {
    id: 'incident-verif-callback', projectId: 'project-1', status: 'blocked', prUrl: null, metadata: { fixRequest: {
      requestId: 'request-verif', batchId: 'batch-verif', workflow: 'WF2', status: 'DISPATCHED',
      findingIds: ['a', 'b'], attemptCount: 1, attempts: [{ attempt: 1, expectedWorkflowId: '9adcV31eaIgJyMR0', status: 'DISPATCHED' }],
    } },
  };
  const repo: any = { findOne: async () => incident, update: async (_id: string, patch: any) => Object.assign(incident, patch) };
  const repository: any = { manager: { transaction: async (fn: any) => fn({ getRepository: () => repo }) }, findOne: async () => incident, update: repo.update };
  const service = new IncidentsService(repository, {} as any, { emit: () => undefined } as any, { syncIncident: async () => undefined } as any, {} as any);
  const base = {
    status: 'FAILED' as const, workflowId: '9adcV31eaIgJyMR0', executionId: '1992',
    incidentId: incident.id, requestId: 'request-verif', batchId: 'batch-verif', batchKey: 'batch-verif',
    attemptCount: 1, failureCode: 'CANDIDATE_VERIFICATION_VERIFICATION_NOT_PASS',
    failureSummary: 'Candidate verification did not pass: VERIFICATION_NOT_PASS', failureNode: 'Call Write Guard',
  };
  return { incident, service, base };
}

async function main() {
  // --- D. FAIL returns bounded verificationEvidence, persisted on the attempt AND top-level ---
  {
    const { incident, service, base } = makeCallbackHarness();
    const verificationEvidence = {
      overall: 'FAIL', failureClass: 'CANDIDATE_COMPILE_FAILURE',
      compile: { status: 'FAILED', exitCode: 1, evidenceTail: 'error: incompatible types' },
      tests: { regressionStatus: 'NOT_RUN', evidenceTail: null },
      staticAnalysis: { status: 'NOT_RUN' },
    };
    await service.saveWorkflowBatchStatus(incident.id, { ...base, verificationEvidence });
    assert.deepEqual(incident.metadata.fixRequest.verificationEvidence, verificationEvidence);
    assert.deepEqual(incident.metadata.fixRequest.attempts[0].verificationEvidence, verificationEvidence);
    console.log('verification-evidence-persistence D: PASS');
  }

  // --- E. INCONCLUSIVE also persists bounded evidence, same shape/path ---
  {
    const { incident, service, base } = makeCallbackHarness();
    const verificationEvidence = {
      overall: 'INCONCLUSIVE', failureClass: 'BUILD_TYPE_UNSUPPORTED',
      compile: { status: 'NOT_RUN', exitCode: null, evidenceTail: null },
      tests: { regressionStatus: 'NOT_RUN', evidenceTail: null },
      staticAnalysis: { status: 'NOT_RUN' },
    };
    await service.saveWorkflowBatchStatus(incident.id, { ...base, verificationEvidence });
    assert.equal(incident.metadata.fixRequest.verificationEvidence.overall, 'INCONCLUSIVE');
    console.log('verification-evidence-persistence E: PASS');
  }

  // --- F/G. compile/test evidence tails re-capped and re-redacted server-side, never trusting WF2 blindly ---
  {
    const { incident, service, base } = makeCallbackHarness();
    await service.saveWorkflowBatchStatus(incident.id, { ...base, verificationEvidence: {
      overall: 'FAIL', failureClass: 'CANDIDATE_COMPILE_FAILURE',
      compile: { status: 'FAILED', exitCode: 1, evidenceTail: 'x'.repeat(5000) },
      tests: { regressionStatus: 'FAILED', evidenceTail: 'token=abc123-should-never-survive' },
      staticAnalysis: { status: 'NOT_RUN' },
    } });
    const persisted = incident.metadata.fixRequest.verificationEvidence;
    assert.equal(persisted.compile.evidenceTail.length, 500, 'server must re-cap even an oversized evidence tail');
    assert.doesNotMatch(persisted.tests.evidenceTail, /abc123-should-never-survive/, 'server must re-redact secrets even if WF2 already tried to');
    assert.match(persisted.tests.evidenceTail, /token=\[REDACTED\]/);
    console.log('verification-evidence-persistence F/G: PASS');
  }

  // --- H. missing/malformed verificationEvidence never crashes, degrades to null ---
  {
    const { incident, service, base } = makeCallbackHarness();
    const result: any = await service.saveWorkflowBatchStatus(incident.id, base); // no verificationEvidence field at all
    assert.equal(result.applied, true);
    assert.equal(incident.metadata.fixRequest.verificationEvidence, null);
    assert.equal(incident.metadata.fixRequest.attempts[0].verificationEvidence, null);
  }
  {
    const { incident, service, base } = makeCallbackHarness();
    await service.saveWorkflowBatchStatus(incident.id, { ...base, verificationEvidence: 'not-an-object' });
    assert.equal(incident.metadata.fixRequest.verificationEvidence, null, 'malformed evidence must degrade to null, never throw');
  }
  {
    const result = sanitizeVerificationEvidence(undefined);
    assert.equal(result, null);
    const garbage = sanitizeVerificationEvidence({ overall: 'NOT_A_REAL_VALUE', compile: { status: 'ALSO_FAKE' } });
    assert.deepEqual(garbage, { overall: null, failureClass: null,
      compile: { status: null, exitCode: null, evidenceTail: null },
      tests: { regressionStatus: null, evidenceTail: null }, staticAnalysis: { status: null } });
    console.log('verification-evidence-persistence H: PASS');
  }

  // --- J. existing failureCode/failureNode/failureSummary/workflowExecutionId remain intact ---
  {
    const { incident, service, base } = makeCallbackHarness();
    await service.saveWorkflowBatchStatus(incident.id, { ...base, verificationEvidence: { overall: 'FAIL' } });
    const fix = incident.metadata.fixRequest;
    assert.equal(fix.lastErrorCode, 'CANDIDATE_VERIFICATION_VERIFICATION_NOT_PASS');
    assert.equal(fix.lastError, 'Candidate verification did not pass: VERIFICATION_NOT_PASS');
    assert.equal(fix.failedNode, 'Call Write Guard');
    assert.equal(fix.workflowExecutionId, '1992');
    assert.equal(fix.attempts[0].failureCode, 'CANDIDATE_VERIFICATION_VERIFICATION_NOT_PASS');
    assert.equal(fix.attempts[0].failureNode, 'Call Write Guard');
    console.log('verification-evidence-persistence J: PASS');
  }

  // --- K. historical PR_CREATED callback path (no evidence field involved at all) is unaffected ---
  {
    const { incident, service } = makeCallbackHarness();
    incident.prUrl = null;
    await assert.rejects(
      () => service.saveWorkflowBatchStatus(incident.id, {
        status: 'PR_CREATED', workflowId: '9adcV31eaIgJyMR0', executionId: '1993',
        incidentId: incident.id, requestId: 'request-verif', batchId: 'batch-verif', batchKey: 'batch-verif',
        attemptCount: 1,
      } as any),
      /ne couvre pas exactement/,
      'PR_CREATED path (unrelated to verification evidence) keeps its own existing completeness contract, unaffected',
    );
    assert.equal(incident.metadata.fixRequest.status, 'DISPATCHED', 'a rejected PR_CREATED callback must not have mutated status');
  }

  console.log('verification-evidence-persistence contract (D,E,F,G,H,J,K): PASS');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
