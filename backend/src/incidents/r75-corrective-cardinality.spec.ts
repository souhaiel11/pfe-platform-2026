import * as assert from 'node:assert/strict';
import { IncidentsService } from './incidents.service';

// R75 — corrective cardinality invariant, backend acceptance side. Proves
// saveWorkflowBatchStatus accepts a corrective completion identified by the
// SAME canonical corrective-issue identity WF2 (R74/R75) now uses, and that
// the legacy 1:1 TARGET_FINDING_INVALID shape (a cause that already names
// its own historical finding) still requires that exact historical id --
// this is the regression caught live by workflow-attempt-identity.spec.ts.

const BATCH_ID = '833de3d11643043ece6236777c14df928ea18a8fa1201c62948ce9bbb041470e';
const SHA1 = 'a'.repeat(40);
const SHA2 = 'b'.repeat(40);
const REPO = 'owner/repo';

function fixture(blockingCauses: any[], findingIds: string[]) {
  const incident: any = {
    id: 'i', projectId: 'p', status: 'blocked', buildNumber: 1,
    prUrl: `https://github.com/${REPO}/pull/34`,
    metadata: {
      enrichedData: { sonar: { issues: [] } },
      fixRequest: {
        status: 'DISPATCHED', workflow: 'WF2', requestId: 'req', batchId: BATCH_ID, batchKey: BATCH_ID,
        attemptCount: 1, findingIds, findings: findingIds.map(id => ({ findingId: id, file: 'src/Legacy.java' })),
        prNumber: 34, workflowId: 'u3eeMwTuhCsetfcS',
        attempts: [{ attempt: 1, status: 'DISPATCHED', corrective: true, expectedWorkflowId: 'u3eeMwTuhCsetfcS' }],
        correctiveDispatch: { attempt: 1, correctiveContext: { blockingCauses } },
      },
    },
  };
  const project: any = { id: 'p', githubRepo: REPO };
  incident.project = project;
  const repo: any = { findOne: async () => incident, update: async (_id: string, patch: any) => Object.assign(incident, patch) };
  const projects: any = { findOne: async () => project };
  repo.manager = { transaction: async (fn: any) => fn({ getRepository: (e: any) => e?.name === 'Project' ? projects : repo }) };
  const service = new IncidentsService(repo, projects, { emit: () => undefined } as any, {} as any, {} as any);
  // Never let the automatic PR-validation side effect leave this unit harness.
  (service as any).dispatchAutomaticInitialPrValidation = async () => undefined;
  return { incident, service };
}

function callback(overrides: any = {}) {
  return {
    incidentId: 'i', requestId: 'req', batchId: BATCH_ID, batchKey: BATCH_ID, attemptCount: 1,
    status: 'PR_CREATED', workflowId: 'u3eeMwTuhCsetfcS', executionId: 'exec-1',
    prUrl: `https://github.com/${REPO}/pull/34`, prNumber: 34, prHeadSha: SHA2,
    completenessPassed: true, ...overrides,
  };
}

async function main() {
  // Case 1: canonical corrective issue (no cause.findingId) -> synthetic
  // candidateId identity. Backend must accept it WITHOUT requiring the 2
  // historical findingIds, and WITHOUT requiring the write to land on the
  // historical finding's file.
  {
    const cause = { type: 'DEFAULT_VALUE_SEMANTICS_DEFECT', candidateType: 'TaskDTO' };
    const candidateId = `${BATCH_ID}:issue-0`;
    const { incident, service } = fixture([cause], ['hist-a', 'hist-b']);
    const result: any = await service.saveWorkflowBatchStatus('i', callback({
      candidateAcceptedFindingIds: [candidateId],
      candidateVerifiedFiles: ['src/main/java/com/pfe/devsecops/dto/TaskDTO.java'],
      plannedFiles: ['src/main/java/com/pfe/devsecops/dto/TaskDTO.java'],
      fileResults: [{ targetFile: 'src/main/java/com/pfe/devsecops/dto/TaskDTO.java', candidateStateVerified: true, outcome: 'CANDIDATE_ACCEPTABLE_FOR_SCANNER_VALIDATION' }],
    }));
    assert.equal(result.applied, true, 'BACKEND_ACCEPTS_1_CANONICAL_CORRECTIVE_ISSUE');
    assert.equal(incident.metadata.fixRequest.status, 'PR_CREATED');
    console.log('N8N_EXPECTED_IDENTITY =', candidateId);
    console.log('BACKEND_EXPECTED_IDENTITY =', candidateId);
    console.log('BACKEND_ACCEPTS_1_CANONICAL_CORRECTIVE_ISSUE = YES');
    console.log('BACKEND_DOES_NOT_REQUIRE_2_HISTORICAL_FINDINGS = YES');
  }

  // Case 1b (negative control): the SAME batch, but reporting the 2
  // historical finding ids instead of the canonical candidateId, must be
  // REJECTED -- proving the fix is real, not a check that was already loose.
  {
    const cause = { type: 'DEFAULT_VALUE_SEMANTICS_DEFECT', candidateType: 'TaskDTO' };
    const { incident, service } = fixture([cause], ['hist-a', 'hist-b']);
    await assert.rejects(() => service.saveWorkflowBatchStatus('i', callback({
      candidateAcceptedFindingIds: ['hist-a', 'hist-b'],
      candidateVerifiedFiles: ['src/main/java/com/pfe/devsecops/dto/TaskDTO.java'],
      plannedFiles: ['src/main/java/com/pfe/devsecops/dto/TaskDTO.java'],
      fileResults: [{ targetFile: 'src/main/java/com/pfe/devsecops/dto/TaskDTO.java', candidateStateVerified: true, outcome: 'CANDIDATE_ACCEPTABLE_FOR_SCANNER_VALIDATION' }],
    })), /ne couvre pas exactement/);
    assert.notEqual(incident.metadata.fixRequest.status, 'PR_CREATED', 'rejected callback must not mutate status');
    console.log('NEGATIVE_CONTROL_HISTORICAL_IDS_REJECTED = YES');
  }

  // Case 2: legacy 1:1 corrective cause (TARGET_FINDING_INVALID, carries its
  // own findingId) -- must STILL require that exact historical identity.
  {
    const cause = { type: 'TARGET_FINDING_INVALID', findingId: 'hist-a' };
    const { incident, service } = fixture([cause], ['hist-a']);
    const result: any = await service.saveWorkflowBatchStatus('i', callback({
      candidateAcceptedFindingIds: ['hist-a'],
      candidateVerifiedFiles: ['src/Legacy.java'], plannedFiles: ['src/Legacy.java'],
      fileResults: [{ targetFile: 'src/Legacy.java', candidateStateVerified: true, outcome: 'CANDIDATE_ACCEPTABLE_FOR_SCANNER_VALIDATION' }],
    }));
    assert.equal(result.applied, true);
    assert.equal(incident.metadata.fixRequest.status, 'PR_CREATED');
    console.log('LEGACY_1_TO_1_CORRECTIVE_FLOW_PRESERVED = YES');
  }

  // Case 2b (negative control): the legacy 1:1 cause must NOT accept a
  // synthetic candidateId in place of its own findingId.
  {
    const cause = { type: 'TARGET_FINDING_INVALID', findingId: 'hist-a' };
    const { service } = fixture([cause], ['hist-a']);
    await assert.rejects(() => service.saveWorkflowBatchStatus('i', callback({
      candidateAcceptedFindingIds: [`${BATCH_ID}:issue-0`],
      candidateVerifiedFiles: ['src/Legacy.java'], plannedFiles: ['src/Legacy.java'],
      fileResults: [{ targetFile: 'src/Legacy.java', candidateStateVerified: true, outcome: 'CANDIDATE_ACCEPTABLE_FOR_SCANNER_VALIDATION' }],
    })), /ne couvre pas exactement/);
    console.log('LEGACY_FLOW_REJECTS_SYNTHETIC_ID = YES');
  }

  console.log('R75 corrective cardinality (backend acceptance, Cases 1/1b/2/2b): PASS');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
