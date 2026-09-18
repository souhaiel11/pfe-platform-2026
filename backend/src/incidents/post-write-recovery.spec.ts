import * as assert from 'node:assert/strict';
import { createHash } from 'crypto';
import { ServiceUnavailableException } from '@nestjs/common';
import { IncidentsService } from './incidents.service';
import { computeRecoveryCandidateDigest, PostWriteRecoveryInput, validatePostWriteRecoveryEvidence } from './post-write-recovery';

const HEAD = '9'.repeat(40), BASE = '6'.repeat(40), BLOB = '7'.repeat(40), COMMIT = '8'.repeat(40);
const CONTENT = 'class Candidate {}\n';
const CONTENT_SHA = createHash('sha256').update(CONTENT).digest('hex');
const INCIDENT = 'incident-recovery', REQUEST = 'request-recovery', BATCH = 'batch-recovery';
const BRANCH = `fix/pfe-${INCIDENT}-${REQUEST}`;

function input(): PostWriteRecoveryInput {
  const files: any[] = [{ path: 'src/Candidate.java', operation: 'CREATE', originalBlobSha: null, contentSha256: CONTENT_SHA }];
  return {
    fixRequestId: REQUEST, sourceAttempt: 4, sourceExecutionId: '2020', batchId: BATCH,
    candidateDigest: computeRecoveryCandidateDigest(BASE, files), expectedBranch: BRANCH, expectedHeadSha: HEAD, prNumber: 33,
    evidence: {
      candidateId: `${BATCH}-attempt-4`, candidateBaseSha: BASE, targetBranchName: BRANCH, files,
      receipts: [{ targetFile: 'src/Candidate.java', fileOperation: 'CREATE', oldSha: null, newSha: BLOB,
        contentSha256: CONTENT_SHA, commitSha: COMMIT, approvedFindingIds: ['finding-1'], processedFindingIds: ['finding-1'],
        candidateAcceptedFindingIds: ['finding-1'], candidateStateVerified: true, updateApplied: true,
        outcome: 'CANDIDATE_ACCEPTABLE_FOR_SCANNER_VALIDATION' }],
      validation: { compileMain: 'PASS', compileTests: 'PASS', fullTest: 'PASS', review: 'PASS',
        noDefectCount: 1, provenDefectCount: 0, verificationRequiredCount: 0, writeGuardOk: true },
    },
  };
}

function fixture() {
  const incident: any = { id: INCIDENT, projectId: 'project-1', status: 'blocked', prUrl: null, jenkinsJobName: 'job',
    metadata: { defaultBranch: 'main', fixRequest: { requestId: REQUEST, batchId: BATCH, workflow: 'WF2', status: 'FIX_FAILED',
      findingIds: ['finding-1'], findings: [{ findingId: 'finding-1', file: 'src/Candidate.java' }], attemptCount: 5,
      retryEligible: true, attempts: [
        { attempt: 4, status: 'FIX_FAILED', workflowExecutionId: '2020', failureNode: 'Validate Batch Completeness' },
        { attempt: 5, status: 'FIX_FAILED', workflowExecutionId: '2021', failureNode: 'Generic Candidate Preflight' },
      ], workflowEvents: [] } } };
  const project: any = { id: 'project-1', githubRepo: 'owner/repo', githubToken: null, jenkinsUrl: 'http://jenkins', jenkinsJobName: 'job' };
  incident.project = project;
  const incidentRepo: any = { findOne: async () => incident, update: async (_id: string, patch: any) => Object.assign(incident, patch) };
  const projectRepo: any = { findOne: async () => project };
  const repository: any = { findOne: incidentRepo.findOne, update: incidentRepo.update, manager: { transaction: async (fn: any) =>
    fn({ getRepository: (entity: any) => entity?.name === 'Project' ? projectRepo : incidentRepo }) } };
  const service: any = new IncidentsService(repository, projectRepo, { emit: () => undefined } as any,
    { syncIncident: async () => undefined } as any, {} as any);
  service.hasActiveWf2Execution = async () => false;
  let validationDispatches = 0; let validationTarget: string | null = null;
  service.dispatchAutomaticInitialPrValidation = async () => { validationDispatches++; validationTarget = incident.metadata.fixRequest.prHeadSha; };
  return { incident, service, dispatches: () => validationDispatches, target: () => validationTarget };
}

function remote(overrides: any = {}) {
  globalThis.fetch = (async (url: any) => {
    const value = String(url);
    if (value.includes('/git/ref/heads/')) return new Response(JSON.stringify({ object: { sha: overrides.branchHead || HEAD } }), { status: 200 });
    if (value.includes('/pulls/')) return new Response(JSON.stringify({ state: overrides.prState || 'open', html_url: 'https://github.com/owner/repo/pull/33',
      head: { sha: overrides.prHead || HEAD, ref: overrides.headRef || BRANCH, repo: { full_name: 'owner/repo' } },
      base: { ref: overrides.baseRef || 'main', repo: { full_name: 'owner/repo' } } }), { status: 200 });
    if (value.includes('/contents/')) return new Response(JSON.stringify({ sha: overrides.blob || BLOB,
      encoding: 'base64', content: Buffer.from(overrides.content ?? CONTENT).toString('base64') }), { status: 200 });
    throw new Error(`unexpected URL ${value}`);
  }) as any;
}

async function code(promise: Promise<any>, expected: string) {
  await assert.rejects(promise, (error: any) => {
    assert.equal(error?.response?.code, expected);
    return true;
  });
}

async function main() {
  const originalFetch = globalThis.fetch;
  const originalWorkflowId = process.env.N8N_WF2_ID;
  process.env.N8N_WF2_ID = 'u3eeMwTuhCsetfcS';
  const admin = { id: 'admin-1', role: 'admin' };
  try {
    // 1, 17-21: happy path, immutable attempts/count, exact validation target, no merge.
    {
      const { incident, service, dispatches, target } = fixture(); remote(); const before = JSON.stringify(incident.metadata.fixRequest.attempts);
      const result = await service.recoverPostWrite(INCIDENT, input(), admin); await new Promise(r => setTimeout(r, 0));
      assert.equal(result.status, 'PR_CREATED'); assert.equal(result.recoveredExistingPr, true);
      assert.equal(incident.status, 'fix_generated'); assert.equal(incident.metadata.fixRequest.status, 'PR_CREATED');
      assert.equal(incident.metadata.fixRequest.attemptCount, 5); assert.equal(JSON.stringify(incident.metadata.fixRequest.attempts), before);
      assert.equal(incident.metadata.fixRequest.attempts[0].status, 'FIX_FAILED'); assert.equal(incident.metadata.fixRequest.attempts[1].status, 'FIX_FAILED');
      assert.equal(incident.metadata.fixRequest.postWriteRecovery.status, 'COMPLETED'); assert.equal(target(), HEAD); assert.equal(dispatches(), 1);
      assert.equal(incident.metadata.fixRequest.mergeAuthorization, undefined);
      const duplicate = await service.recoverPostWrite(INCIDENT, input(), admin);
      assert.equal(duplicate.duplicate, true); assert.equal(dispatches(), 1);
      const changed = input(); changed.expectedHeadSha = 'a'.repeat(40);
      await code(service.recoverPostWrite(INCIDENT, changed, admin), 'POST_WRITE_RECOVERY_CONFLICT');
    }
    // 2 source attempt missing.
    { const { incident, service } = fixture(); incident.metadata.fixRequest.attempts.shift(); remote(); await code(service.recoverPostWrite(INCIDENT, input(), admin), 'POST_WRITE_RECOVERY_SOURCE_ATTEMPT_MISSING'); }
    // 3 source execution mismatch.
    { const { service } = fixture(); remote(); const x = input(); x.sourceExecutionId = 'wrong'; await code(service.recoverPostWrite(INCIDENT, x, admin), 'POST_WRITE_RECOVERY_SOURCE_EXECUTION_MISMATCH'); }
    // 4 pre-write failure.
    { const { incident, service } = fixture(); incident.metadata.fixRequest.attempts[0].failureNode = 'Generic Candidate Preflight'; remote(); await code(service.recoverPostWrite(INCIDENT, input(), admin), 'POST_WRITE_RECOVERY_NOT_POST_WRITE_FAILURE'); }
    // 5 branch head mismatch.
    { const { service } = fixture(); remote({ branchHead: 'a'.repeat(40) }); await code(service.recoverPostWrite(INCIDENT, input(), admin), 'POST_WRITE_RECOVERY_BRANCH_HEAD_MISMATCH'); }
    // 6 candidate digest mismatch.
    { const { service } = fixture(); remote(); const x = input(); x.candidateDigest = 'a'.repeat(64); await code(service.recoverPostWrite(INCIDENT, x, admin), 'POST_WRITE_RECOVERY_CANDIDATE_DIGEST_MISMATCH'); }
    // 7 blob mismatch.
    { const { service } = fixture(); remote({ blob: 'a'.repeat(40) }); await code(service.recoverPostWrite(INCIDENT, input(), admin), 'POST_WRITE_RECOVERY_BLOB_SHA_MISMATCH'); }
    // 8 content mismatch.
    { const { service } = fixture(); remote({ content: 'different' }); await code(service.recoverPostWrite(INCIDENT, input(), admin), 'POST_WRITE_RECOVERY_CONTENT_SHA_MISMATCH'); }
    // 9-12 PR identity checks.
    for (const variation of [{ prState: 'closed' }, { headRef: 'other' }, { baseRef: 'develop' }, { prHead: 'a'.repeat(40) }]) {
      const { service } = fixture(); remote(variation); await code(service.recoverPostWrite(INCIDENT, input(), admin), 'POST_WRITE_RECOVERY_PR_MISMATCH');
    }
    // 13 fixRequest must be FIX_FAILED.
    { const { incident, service } = fixture(); incident.metadata.fixRequest.status = 'DISPATCHED'; remote(); await code(service.recoverPostWrite(INCIDENT, input(), admin), 'POST_WRITE_RECOVERY_FIX_NOT_FAILED'); }
    // 14 active WF2 execution.
    { const { service } = fixture(); service.hasActiveWf2Execution = async () => true; remote(); await code(service.recoverPostWrite(INCIDENT, input(), admin), 'POST_WRITE_RECOVERY_ACTIVE_WF2_EXECUTION'); }

    { const { service } = fixture(); service.hasActiveWf2Execution = async () => { throw new ServiceUnavailableException({ code: 'POST_WRITE_RECOVERY_ACTIVE_EXECUTION_UNVERIFIED' }); }; remote(); await code(service.recoverPostWrite(INCIDENT, input(), admin), 'POST_WRITE_RECOVERY_ACTIVE_EXECUTION_UNVERIFIED'); }

    // Execution-2020 exact evidence fixture: six exact receipts and digest.
    const exact: any = input();
    exact.fixRequestId = '72ddba06-2f94-462c-a806-cb3053636d74'; exact.batchId = '82ed71a860de1d8a58836b27de5d7bcf0e9f8c4f056996066d386c55c07f3c28';
    exact.expectedBranch = 'fix/pfe-6edab0c8-64df-4bb7-ba9c-7dff9cbcd4f3-72ddba06-2f94-462c-a806-cb3053636d74';
    exact.expectedHeadSha = '9690613ecc5e87b33663ee8f82eea4f94d67bbfe'; exact.sourceAttempt = 4; exact.sourceExecutionId = '2020';
    exact.candidateDigest = 'b51f63e1abfbe037f247ccbb37448433a39a638e56a9b39f94c7d5d85208a32c'; exact.evidence.candidateBaseSha = '6ed56ff791acbf3e111431285bef7b30c8076084'; exact.evidence.targetBranchName = exact.expectedBranch;
    const rows = [
      ['src/main/java/com/pfe/devsecops/controller/TaskController.java','MODIFY','81619b128f913dd5fe36e3f02a88b0c2e1453e36','ad164931054432c5d0cb80bd2ea99194ea09fa85b89001d70eb3455346d30dee','24a17ceae6a4d49c2b9cfa868922d3e47db0a975','c04ec8b69fd0fe97ce29eda9e97b7c61fb14d141'],
      ['src/main/java/com/pfe/devsecops/service/TaskService.java','MODIFY','9309b455f7d09b50ec039d1cf18bd068d1b21ef7','922a5745bb11ff445973c8ddcc494a79722de538a166aa9fd94dd7304ea13ba7','2fcfa0e0b10169aa51a66157d3581d5a6a3e6c38','97c45acc0291fa92ca427fafd0b6475e7a22926d'],
      ['src/main/java/com/pfe/devsecops/dto/TaskDTO.java','CREATE',null,'968e261cb41507b37aea4496482d8e88c94fd58ecbd3147973a4192e2f480b6e','77ff6bb10f942e6b2c5e8b1e34e9cae2f226494b','e5fa678182fcd8264dd95d81777ec02d69c5797b'],
      ['src/main/java/com/pfe/devsecops/dto/TaskCreateDTO.java','CREATE',null,'afa1f7884166665a559e91201a752bcc228040526fda9cd233a31411e40b7684','155b92ae5bedcbe682faf0ca5d78471d55608330','3cd7db1f818f2fc7b1a0d52960bb7fd66cd3e903'],
      ['src/main/java/com/pfe/devsecops/dto/TaskUpdateDTO.java','CREATE',null,'11c0bbcc6fb075dc844587882f245dbc66a410885f1d42903f73bcd2d951f5ad','7bd80b0a32484b1ef1a97e2414f755b90313b6e5','43d2e07dc3ff2f2f1e1975cdf5d666eb94f784b9'],
      ['src/main/java/com/pfe/devsecops/dto/TaskStatusDTO.java','CREATE',null,'05f0f034a8e1b1bb4375305db003ae782e9d8b1fac5707a1e59b21c8f52931e7','f8d577a8bae13bf1888d66770af324341719016f','9690613ecc5e87b33663ee8f82eea4f94d67bbfe'],
    ];
    exact.evidence.files = rows.map(r => ({ path:r[0], operation:r[1], originalBlobSha:r[2], contentSha256:r[3] }));
    exact.evidence.receipts = rows.map(r => ({ targetFile:r[0], fileOperation:r[1], oldSha:r[2], contentSha256:r[3], newSha:r[4], commitSha:r[5],
      approvedFindingIds:['f11d4686-a7ba-4c0c-abbb-a12998c57220'], processedFindingIds:['f11d4686-a7ba-4c0c-abbb-a12998c57220'],
      candidateAcceptedFindingIds:['f11d4686-a7ba-4c0c-abbb-a12998c57220'], candidateStateVerified:true, updateApplied:true,
      outcome:'CANDIDATE_ACCEPTABLE_FOR_SCANNER_VALIDATION' }));
    exact.evidence.validation.noDefectCount = 20;
    assert.equal(computeRecoveryCandidateDigest(exact.evidence.candidateBaseSha, exact.evidence.files), exact.candidateDigest);
    const verified = validatePostWriteRecoveryEvidence(exact, ['f11d4686-a7ba-4c0c-abbb-a12998c57220']);
    assert.equal(verified.fileResults.length, 6); assert.equal(verified.commitShas.includes(exact.expectedHeadSha), true);
    {
      const { incident, service, target } = fixture();
      incident.id = '6edab0c8-64df-4bb7-ba9c-7dff9cbcd4f3';
      incident.metadata.fixRequest.requestId = exact.fixRequestId;
      incident.metadata.fixRequest.batchId = exact.batchId;
      incident.metadata.fixRequest.findingIds = ['f11d4686-a7ba-4c0c-abbb-a12998c57220'];
      incident.metadata.fixRequest.findings = [{ findingId: 'f11d4686-a7ba-4c0c-abbb-a12998c57220', file: rows[0][0] }];
      service.githubBranchHead = async () => exact.expectedHeadSha;
      service.githubPullRequest = async () => ({ state: 'open', html_url: 'https://github.com/owner/repo/pull/33',
        head: { sha: exact.expectedHeadSha, ref: exact.expectedBranch, repo: { full_name: 'owner/repo' } },
        base: { ref: 'main', repo: { full_name: 'owner/repo' } } });
      service.verifyRecoveryRemoteFiles = async () => undefined; // exact remote equality is independently covered above by mismatch cases
      const before = JSON.stringify(incident.metadata.fixRequest.attempts);
      const recovered = await service.recoverPostWrite(incident.id, exact, admin); await new Promise(r => setTimeout(r, 0));
      assert.equal(recovered.status, 'PR_CREATED'); assert.equal(incident.metadata.fixRequest.attemptCount, 5);
      assert.equal(JSON.stringify(incident.metadata.fixRequest.attempts), before);
      assert.equal(incident.metadata.fixRequest.attempts[0].status, 'FIX_FAILED');
      assert.equal(incident.metadata.fixRequest.attempts[1].status, 'FIX_FAILED');
      assert.equal(incident.metadata.fixRequest.postWriteRecovery.status, 'COMPLETED'); assert.equal(target(), exact.expectedHeadSha);
    }
    console.log('Governed post-write recovery matrix + execution-2020 fixture: PASS');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWorkflowId === undefined) delete process.env.N8N_WF2_ID; else process.env.N8N_WF2_ID = originalWorkflowId;
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
