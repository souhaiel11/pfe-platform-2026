import * as assert from 'node:assert/strict';
import { IncidentsService, workflowFinding, buildPrValidationJobName } from './incidents.service';

// R69 — canonical finding ID normalization. Proven root cause: workflowFinding()
// is called on two genuinely different shapes (raw scanner findings, always
// carrying .id/.key; and its OWN already-canonicalized persisted output,
// which only carries .findingId) and its old id-resolution only understood
// the first, silently producing the literal string "undefined" for the
// second — exactly what broke WF2 execution 2023027's real corrective
// dispatch (FINDING_CORRELATION_MISMATCH at "Adapt Webhook Payload").
//
// Part 1 (cases A-F): workflowFinding() unit tests, synthetic shapes only.
// Part 2 (cases G-J + §6/§7): full correctAndRevalidate() offline
// simulation reusing the exact real PR #34 finding shape that produced the
// real failure, proving the dispatched payload is now correct end-to-end —
// still never touching PR #34, never calling WF2 for real (mocked fetch).

function main() {
  // ── CASE A — finding.findingId populated => use findingId ──────────────
  {
    const result = workflowFinding({ findingId: 'f-a', rule: 'x' });
    assert.equal(result.findingId, 'f-a');
  }

  // ── CASE B — findingId absent, id populated => use id ───────────────────
  {
    const result = workflowFinding({ id: 'f-b', rule: 'x' });
    assert.equal(result.findingId, 'f-b');
  }

  // ── CASE C — findingId/id absent, key populated => use key ──────────────
  {
    const result = workflowFinding({ key: 'f-c', rule: 'x' });
    assert.equal(result.findingId, 'f-c');
  }

  // ── CASE D — all absent => deterministic failure before dispatch ────────
  {
    assert.throws(() => workflowFinding({ rule: 'x' }), (err: any) => {
      assert.equal(err?.getStatus?.(), 400);
      const response = err?.getResponse?.();
      assert.equal(response?.code, 'FINDING_ID_MISSING');
      return true;
    });
  }

  // ── CASE E — findingId = "" => fall through, never accept empty string ──
  {
    // Falls through to id when findingId is empty.
    const result = workflowFinding({ findingId: '', id: 'f-e', rule: 'x' });
    assert.equal(result.findingId, 'f-e');
    // Empty everywhere => deterministic failure, never "".
    assert.throws(() => workflowFinding({ findingId: '', id: '', key: '' }), (err: any) => err?.getResponse?.()?.code === 'FINDING_ID_MISSING');
  }

  // ── CASE F — findingId = "undefined" => never accept the literal sentinel
  {
    // Exactly the real bug's shape: falls through to id/key, proving the fix.
    const result = workflowFinding({ findingId: 'undefined', id: 'f-f', rule: 'x' });
    assert.equal(result.findingId, 'f-f');
    // Sentinel with nothing legitimate behind it => deterministic failure.
    assert.throws(() => workflowFinding({ findingId: 'undefined' }), (err: any) => err?.getResponse?.()?.code === 'FINDING_ID_MISSING');
    assert.throws(() => workflowFinding({ findingId: 'null' }), (err: any) => err?.getResponse?.()?.code === 'FINDING_ID_MISSING');
  }

  // ── Every other output field is preserved unchanged ──────────────────────
  {
    const result = workflowFinding({ findingId: 'f-x', rule: 'java:S1', severity: 'HIGH', type: 'BUG', source: 'SONARQUBE', stage: 'sonar', file: 'A.java', line: 5, message: 'm', evidence: 'e', recommendation: 'r' });
    assert.deepEqual(result, {
      findingId: 'f-x', rule: 'java:S1', severity: 'HIGH', type: 'BUG', source: 'SONARQUBE', stage: 'sonar',
      file: 'A.java', line: 5, message: 'm', evidence: 'e', recommendation: 'r', remediationType: 'AUTO_FIX_ELIGIBLE',
    });
  }

  console.log('workflowFinding canonical ID resolution (cases A-F): PASS');
}

main();

// ══════════════════════════════════════════════════════════════════════
// Part 2 — full correctAndRevalidate() offline replay, exact real shape
// ══════════════════════════════════════════════════════════════════════

const REPO = 'souhaiel11/pfe-app-test';
const JOB = 'pfe-app-test';
const PR = 34;
const SHA = 'dc1aa978719ca40e6339e075cfe52a79875b2342';
const admin = { id: 'admin-1', role: 'admin' };

// Exact real PR #34 fixRequest.findings shape (the shape that produced the
// real FINDING_CORRELATION_MISMATCH at execution 2023027) — this is
// fixture data for this test only; nothing PR34-specific lives in
// incidents.service.ts itself.
const REAL_FINDING_IDS = ['b8db9c11-ddf9-4a23-9bf3-1d2ff15a59ef', 'f11d4686-a7ba-4c0c-abbb-a12998c57220'];
const REAL_FINDINGS = [
  { file: 'src/main/java/com/pfe/devsecops/controller/TaskController.java', line: 34, rule: 'java:S4684', type: 'VULNERABILITY', stage: 'sonar', source: 'SONARQUBE', message: 'Replace this persistent entity with a simple POJO or DTO object.', evidence: 'b8db9c11-ddf9-4a23-9bf3-1d2ff15a59ef', findingId: 'b8db9c11-ddf9-4a23-9bf3-1d2ff15a59ef', recommendation: null, remediationType: 'AUTO_FIX_ELIGIBLE' },
  { file: 'src/main/java/com/pfe/devsecops/controller/TaskController.java', line: 39, rule: 'java:S4684', type: 'VULNERABILITY', stage: 'sonar', source: 'SONARQUBE', message: 'Replace this persistent entity with a simple POJO or DTO object.', evidence: 'f11d4686-a7ba-4c0c-abbb-a12998c57220', findingId: 'f11d4686-a7ba-4c0c-abbb-a12998c57220', recommendation: null, remediationType: 'AUTO_FIX_ELIGIBLE' },
];

function makeFixture(overrides: { findings?: any[]; findingIds?: string[] } = {}) {
  const incidentId = 'incident-pr34';
  const requestId = 'req-r67';
  const batchId = 'batch-r67';
  const expectedBranch = `fix/pfe-${incidentId}-${requestId}`;
  const fixRequest: any = {
    status: 'VALIDATED', requestId, batchId, batchKey: batchId, attemptCount: 2,
    findingId: REAL_FINDING_IDS[0], findingIds: overrides.findingIds ?? REAL_FINDING_IDS,
    findings: overrides.findings ?? REAL_FINDINGS,
    prNumber: PR, prHeadSha: SHA, validationTargetSha: null, baselineSha: 'b'.repeat(40),
  };
  const validation: any = {
    checkoutSha: SHA,
    findingResults: [{ findingId: REAL_FINDING_IDS[0], result: 'VALID', evidence: 'e1' }, { findingId: REAL_FINDING_IDS[1], result: 'VALID', evidence: 'e2' }],
    regression: { candidateSha: SHA, blockingIntroducedFindings: [] },
    defaultValueSemantics: {
      verdict: 'PROVEN_DEFECT', evaluatedSha: SHA,
      evidence: [{
        sourceType: 'Task', sourceField: 'status', sourceDefault: 'TaskStatus.TODO',
        candidateType: 'TaskDTO', candidateField: 'status', candidateDefault: null,
        baselineAbsentBehavior: 'Field kept at its declared initializer: TaskStatus.TODO',
        candidateAbsentBehavior: 'Field kept at the language default (no initializer), unconditionally propagated',
        mappingPath: 'updateTask(TaskDTO): existing.setStatus(parseStatus(updatedTask.getStatus()));',
      }],
    },
    mergeAuthorization: {
      authorization: 'BLOCKED', remediationResult: 'VALIDATED', regressionResult: 'CLEAN', headVerificationResult: 'PASS',
      blockingReasons: ['DEFAULT_VALUE_SEMANTICS_REGRESSION'], technicalReasons: [], advisories: [],
      authorizedSha: null, correctiveActionAllowed: true, computedAt: '2026-09-19T10:12:58.602Z', forSha: SHA,
    },
  };
  const incident: any = {
    id: incidentId, projectId: 'project-1', status: 'completed', prUrl: `https://github.com/${REPO}/pull/${PR}`,
    jenkinsJobName: JOB, buildNumber: 147,
    metadata: { fixRequest, validation },
  };
  const project: any = { id: 'project-1', githubRepo: REPO, githubToken: null, jenkinsUrl: 'http://jenkins', jenkinsToken: 'user:x', jenkinsJobName: JOB, sonarqubeKey: 'key' };
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
  const service = new IncidentsService(repository, projectRepo, { emit: () => undefined } as any, { syncIncident: async () => undefined } as any, {} as any);
  return { incident, project, service, incidentId, requestId, batchId, expectedBranch };
}

let capturedWf2Payload: any = null;
function mockGithubAndWf2(expectedBranch: string) {
  capturedWf2Payload = null;
  return (async (url: any, init?: any) => {
    const value = String(url);
    if (value.includes('/pulls/')) {
      return new Response(JSON.stringify({ state: 'open', head: { sha: SHA, ref: expectedBranch } }), { status: 200 });
    }
    if (value.includes('webhook') || value.includes('/wf2') || value.includes('n8n')) {
      capturedWf2Payload = JSON.parse(String(init?.body || '{}'));
      return new Response('{}', { status: 200 });
    }
    throw new Error('unexpected URL ' + value);
  }) as any;
}

async function main2() {
  const originalFetch = globalThis.fetch;
  const originalWorkflowId = process.env.N8N_WF2_ID;
  process.env.N8N_WF2_ID = 'u3eeMwTuhCsetfcS';
  try {
    // ── §6 — replay the exact execution 2027 payload shape ────────────────
    {
      const { service, incident, expectedBranch } = makeFixture({});
      globalThis.fetch = mockGithubAndWf2(expectedBranch);
      const res: any = await service.correctAndRevalidate(incident.id, admin);
      assert.equal(res.success, true);
      assert.equal(res.status, 'DISPATCHED');
      assert.ok(capturedWf2Payload, 'WF2 dispatch must have occurred');

      const finding = capturedWf2Payload.finding;
      const findings = capturedWf2Payload.findings;
      const findingIds = capturedWf2Payload.findingIds;
      assert.deepEqual(findingIds, REAL_FINDING_IDS, 'EXECUTION_2027_PAYLOAD_REPLAY: findingIds[]');
      assert.deepEqual(findings.map((f: any) => f.findingId), REAL_FINDING_IDS, 'EXECUTION_2027_PAYLOAD_REPLAY: findings[].findingId');
      assert.equal(finding.findingId, REAL_FINDING_IDS[0]);
      // The literal bug this fix closes: no "undefined" anywhere.
      const serialized = JSON.stringify(capturedWf2Payload);
      assert.ok(!serialized.includes('"findingId":"undefined"'), 'no literal "undefined" findingId anywhere in the dispatched payload');
      console.log('EXECUTION_2027_PAYLOAD_REPLAY: PASS');
      console.log('CORRELATION: PASS');

      // ── §7 — R68 corrective context must survive intact ─────────────────
      assert.equal(capturedWf2Payload.correctiveAttempt, true);
      assert.equal(capturedWf2Payload.repository, REPO);
      const causes = capturedWf2Payload.correctiveContext.blockingCauses;
      assert.equal(causes.length, 1);
      assert.equal(causes[0].type, 'DEFAULT_VALUE_SEMANTICS_DEFECT');
      assert.equal(causes[0].sourceType, 'Task');
      assert.equal(causes[0].candidateType, 'TaskDTO');
      assert.ok(causes[0].behavioralInvariant);
      console.log('R68_CAUSE_PRESERVED: PASS');
    }

    // ── CASE G — two findings with valid persisted findingId => correlation PASS
    // (already proven above; re-affirm attemptCount/lineage explicitly)
    {
      const { service, incident, expectedBranch } = makeFixture({});
      globalThis.fetch = mockGithubAndWf2(expectedBranch);
      const res: any = await service.correctAndRevalidate(incident.id, admin);
      assert.equal(res.attemptCount, 3);
      assert.equal(res.requestId, 'req-r67');
      assert.equal(res.batchId, 'batch-r67');
      console.log('CASE G (valid persisted findingId -> correlation PASS): PASS');
    }

    // ── CASE H — mixed legacy shapes (one already-canonical, one raw) stay
    // deterministic and correct ──────────────────────────────────────────
    {
      const mixedFindings = [
        { findingId: REAL_FINDING_IDS[0], rule: 'java:S4684' },
        { id: REAL_FINDING_IDS[1], rule: 'java:S4684' }, // raw shape mixed in
      ];
      const { service, incident, expectedBranch } = makeFixture({ findings: mixedFindings });
      globalThis.fetch = mockGithubAndWf2(expectedBranch);
      const res: any = await service.correctAndRevalidate(incident.id, admin);
      assert.equal(res.success, true);
      assert.deepEqual(capturedWf2Payload.findings.map((f: any) => f.findingId).sort(), [...REAL_FINDING_IDS].sort());
      console.log('CASE H (mixed legacy shapes -> deterministic canonical IDs): PASS');
    }

    // ── CASE I — a correlation break (findingIds diverges from findings[])
    // must be rejected BEFORE dispatch, and recorded as a governed failure,
    // never a dangling FIX_STARTING state ────────────────────────────────
    {
      const brokenFindings = [{ findingId: 'a'.repeat(8) + '-0000-0000-0000-000000000000', rule: 'java:S4684' }];
      const { service, incident, expectedBranch } = makeFixture({ findings: brokenFindings });
      globalThis.fetch = mockGithubAndWf2(expectedBranch);
      await assert.rejects(() => service.correctAndRevalidate(incident.id, admin));
      assert.equal(incident.metadata.fixRequest.status, 'FIX_FAILED', 'must be recorded as FIX_FAILED, never left dangling at FIX_STARTING');
      assert.equal(incident.metadata.fixRequest.retryEligible, true);
      assert.equal(capturedWf2Payload, null, 'WF2 must never be dispatched when correlation is broken');
      console.log('CASE I (broken correlation -> rejected pre-dispatch, governed failure recorded): PASS');
    }

    // ── CASE J — the R68 corrective payload shape (already exercised above,
    // reaffirmed as its own named case per §8) ───────────────────────────
    {
      const { service, incident, expectedBranch } = makeFixture({});
      globalThis.fetch = mockGithubAndWf2(expectedBranch);
      await service.correctAndRevalidate(incident.id, admin);
      assert.equal(capturedWf2Payload.correctiveContext.blockingCauses[0].type, 'DEFAULT_VALUE_SEMANTICS_DEFECT');
      console.log('CASE J (R68 corrective payload -> cause preserved): PASS');
    }

    console.log('finding-id-normalization (R69): PASS');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWorkflowId === undefined) delete process.env.N8N_WF2_ID; else process.env.N8N_WF2_ID = originalWorkflowId;
  }
}

main2().catch(err => { console.error(err); process.exitCode = 1; });
