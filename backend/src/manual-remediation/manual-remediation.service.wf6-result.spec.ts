// Execution-2060 follow-up — recordWf6Result(): persistence + idempotence,
// against the REAL execution 2060 payload (see this file's own inline
// copy, identical values to wf6-remediation-result.dto.spec.ts's own
// REAL_2060_PAYLOAD). Same hand-rolled in-memory fake repo as
// manual-remediation.service.spec.ts (this module's own established
// convention), so this exercises the REAL service method, not a mock of it.
import { strict as assert } from 'assert';
import { ManualRemediationService } from './manual-remediation.service';
import { ManualRemediationStatus, ScannerFindingStatus } from './manual-remediation.entity';

function makeService(seedTasks: any[] = []) {
  const rows: any[] = seedTasks.map(t => ({ ...t }));
  const repo: any = {
    count: async ({ where }: any) => rows.filter(r => r.projectId === where.projectId).length,
    find: async ({ where }: any) => rows.filter(r => Object.entries(where).every(([k, v]) => r[k] === v)),
    findOne: async ({ where }: any) => rows.find(r => Object.entries(where).every(([k, v]) => r[k] === v)) || null,
    create: (value: any) => ({ id: `task-${rows.length + 1}`, createdAt: new Date(), updatedAt: new Date(), ...value }),
    save: async (value: any) => { const index = rows.findIndex(r => r.id === value.id); if (index < 0) rows.push(value); else rows[index] = value; return value; },
    update: async () => {},
  };
  const incidents: any = { find: async () => [], findOne: async () => null };
  return { service: new ManualRemediationService(repo, incidents), rows };
}

const TASK_ID = 'c8fb2207-c8de-40af-acd4-1d2f96896715';
const PROJECT_ID = '3aa1c9b9-e114-40e4-884b-ebc7aa32e002';
const seedTask = () => ({
  id: TASK_ID, projectId: PROJECT_ID, incidentId: 'incident-1', findingId: 'a37e178f...',
  findingFingerprint: 'a37e178f7ce1805b0b1b0e8ac2d41d20333041c26b4e88490f8af4e9885b7cf2',
  source: 'TRIVY', ruleOrCve: 'CVE-2023-6378', title: 'logback: serialization vulnerability in logback receiver',
  severity: 'HIGH', remediationType: 'DEVELOPER_ACTION_REQUIRED', findingSnapshot: {},
  status: ManualRemediationStatus.TODO, scannerStatus: ScannerFindingStatus.DETECTED,
  completedByUserId: null, completedByDisplayName: null, completedAt: null, completionNote: null,
  lastSeenBuild: 5, verifiedBuild: null, verifiedAt: null, events: [],
  securityFindingRemediation: null,
});

// Identical values to wf6-remediation-result.dto.spec.ts's REAL_2060_PAYLOAD.
const REAL_2060_RESULT = {
  projectId: PROJECT_ID, findingTaskId: TASK_ID,
  status: 'CANDIDATE_READY', reason: 'DETERMINISTIC_CANDIDATE_READY',
  candidateIdentity: '71531d5009b160fbe4d9e41dfe65efc203b676312003ae01c0b8d9596f851d9a',
  evaluatedSha: '7ae0f954f99628b69ce9b42f42c1e2acc8568d99',
  branchName: 'security/fix/a37e178f7ce1-71531d5009b1',
  prUrl: 'https://github.com/souhaiel11/pfe-app-test/pull/37', prNumber: 37, executionId: '2060',
  patchEvidence: { provenanceKind: 'DIRECT_EXPLICIT', oldVersion: '1.2.11', targetVersion: '1.2.13', controllingFile: 'pom.xml', controllingElement: '<version>1.2.11</version>', controllingProperty: null },
  securityValidationEvidence: { status: 'TARGET_CVE_CLOSED', targetCve: 'CVE-2023-6378', mode: 'TRIVY_IMAGE_ARCHIVE', evaluatedSha: '7ae0f954f99628b69ce9b42f42c1e2acc8568d99', candidateContentSha256: 'f36d6ecdc90ca0f1964da7064b097b3f8450fea622ec8934b62bb31a26b370c6', artifactDigest: 'c07fc4cdb2ceb394ca5d4957a8f6c0fe3403fe54a93a8b33ff690eb32e255a39', reportDigest: 'a22af75e9d1dab868612ba3ec13cca5ac990616b18ef65dd39c7958b1c8c4b07', scannerVersion: 'Version: 0.72.0', targetCveMatchCount: 0, buildPassed: true, tests: 'SKIPPED' },
} as any;

async function main() {
  // 1. The real execution 2060 payload, replayed verbatim -> fully persisted.
  {
    const { service, rows } = makeService([seedTask()]);
    const saved = await service.recordWf6Result(REAL_2060_RESULT);
    assert.equal(saved.securityFindingRemediation.status, 'CANDIDATE_READY');
    assert.equal(saved.securityFindingRemediation.prUrl, REAL_2060_RESULT.prUrl);
    assert.equal(saved.securityFindingRemediation.prNumber, 37);
    assert.deepEqual(saved.securityFindingRemediation.securityValidationEvidence, REAL_2060_RESULT.securityValidationEvidence);
    assert.deepEqual(saved.securityFindingRemediation.patchEvidence, REAL_2060_RESULT.patchEvidence);
    assert.equal(saved.securityFindingRemediation.attemptCount, 1);
    assert.equal(saved.securityFindingRemediation.attempts.length, 1);
    // Manual tracking fields are completely untouched by this method.
    assert.equal(saved.status, ManualRemediationStatus.TODO);
    assert.equal(saved.scannerStatus, ScannerFindingStatus.DETECTED);
    assert.equal(rows[0].securityFindingRemediation.status, 'CANDIDATE_READY', 'actually persisted, not just returned');
  }
  console.log('recordWf6Result) real execution 2060 payload replayed verbatim -> fully persisted, manual tracking fields untouched: PASS');

  // 2. Older/minimal shape (no securityValidationEvidence/patchEvidence at
  // all) -> accepted, does not crash, those fields simply absent.
  {
    const { service } = makeService([seedTask()]);
    const saved = await service.recordWf6Result({ projectId: PROJECT_ID, findingTaskId: TASK_ID, status: 'GROUNDING_FAILED', reason: 'GROUNDING_FAILED:WARMUP_TIMEOUT' } as any);
    assert.equal(saved.securityFindingRemediation.status, 'GROUNDING_FAILED');
    assert.equal(saved.securityFindingRemediation.securityValidationEvidence, null);
    assert.equal(saved.securityFindingRemediation.patchEvidence, null);
    assert.equal(saved.securityFindingRemediation.prUrl, null);
  }
  console.log('recordWf6Result) minimal/older-shaped payload (no evidence fields) -> accepted without crashing: PASS');

  // 3. Idempotence -- a SECOND callback for the SAME finding (WF6's own
  // requestId is deterministic per finding, so this is the NORMAL case for
  // a retry, not an edge case): overwrites the top-level snapshot with the
  // latest result, but keeps history in `attempts`, never rejects.
  {
    const { service } = makeService([seedTask()]);
    await service.recordWf6Result({ projectId: PROJECT_ID, findingTaskId: TASK_ID, status: 'GROUNDING_FAILED', reason: 'GROUNDING_FAILED:WARMUP_TIMEOUT' } as any);
    const second = await service.recordWf6Result(REAL_2060_RESULT);
    assert.equal(second.securityFindingRemediation.status, 'CANDIDATE_READY', 'the LATEST attempt always wins at the top level');
    assert.equal(second.securityFindingRemediation.attemptCount, 2);
    assert.equal(second.securityFindingRemediation.attempts.length, 2, 'no history lost across a repeat callback');
    assert.equal(second.securityFindingRemediation.attempts[0].status, 'GROUNDING_FAILED');
    assert.equal(second.securityFindingRemediation.attempts[1].status, 'CANDIDATE_READY');
  }
  console.log('recordWf6Result) second callback for the same finding -> overwrites the current snapshot, keeps full attempt history: PASS');

  // 3b. A later callback that does NOT repeat prUrl/prNumber (e.g. a
  // distinct, unrelated failed re-evaluation) never erases an earlier
  // real PR link.
  {
    const { service } = makeService([seedTask()]);
    await service.recordWf6Result(REAL_2060_RESULT);
    const later = await service.recordWf6Result({ projectId: PROJECT_ID, findingTaskId: TASK_ID, status: 'GROUNDING_FAILED', reason: 'GROUNDING_FAILED:WARMUP_NETWORK_FAILURE' } as any);
    assert.equal(later.securityFindingRemediation.prUrl, REAL_2060_RESULT.prUrl, 'an earlier real PR link must survive a later non-PR-reaching callback');
    assert.equal(later.securityFindingRemediation.prNumber, 37);
  }
  console.log('recordWf6Result) a later callback without prUrl/prNumber never erases an earlier real PR link: PASS');

  // 4. Ownership: wrong projectId for a real findingTaskId -> rejected,
  // never silently persisted against the wrong task.
  {
    const { service, rows } = makeService([seedTask()]);
    await assert.rejects(() => service.recordWf6Result({ ...REAL_2060_RESULT, projectId: 'some-other-project' }), /ne correspond pas au projet/);
    assert.equal(rows[0].securityFindingRemediation, null, 'rejected callback must not have written anything');
  }
  console.log('recordWf6Result) mismatched projectId -> rejected, nothing persisted: PASS');

  // 5. Unknown findingTaskId -> rejected.
  {
    const { service } = makeService([]);
    await assert.rejects(() => service.recordWf6Result(REAL_2060_RESULT), /introuvable/);
  }
  console.log('recordWf6Result) unknown findingTaskId -> rejected: PASS');

  console.log('manual-remediation.service.wf6-result.spec.ts: ALL CHECKS PASS');
}

main().catch(err => { console.error(err); process.exitCode = 1; });
