// Increment 1 (WF6 multi-CVE wiring) — evaluateBatch()/resolveAndEvaluateBatch().
// Mirrors security-remediation.controller.spec.ts's own fake-resolver/
// fake-client convention exactly, extended to N findings.
import * as assert from 'node:assert/strict';
import { SecurityRemediationController } from './security-remediation.controller';

function fakeResolverFor(resolutionsByTaskId: Record<string, any>) {
  const capturedArgs: any[][] = [];
  const resolver: any = { resolve: async (...args: any[]) => { capturedArgs.push(args); return resolutionsByTaskId[args[1]]; } };
  return { resolver, getCapturedArgs: () => capturedArgs };
}

function fakeCandidateVerification(singularResult: any, batchResult: any) {
  let capturedSingularInput: any = null, capturedBatchInput: any = null;
  const client: any = {
    evaluateSecurityRemediation: async (input: any) => { capturedSingularInput = input; return singularResult; },
    evaluateSecurityRemediationBatch: async (input: any) => { capturedBatchInput = input; return batchResult; },
  };
  return { client, getCapturedSingularInput: () => capturedSingularInput, getCapturedBatchInput: () => capturedBatchInput };
}

const fakeManualRemediation: any = { recordWf6Result: async () => { throw new Error('not exercised'); }, recordWf6BatchResult: async () => { throw new Error('not exercised'); } };

const REPO = 'souhaiel11/pfe-app-test';
const SHA = 'a81be45709aba07da50d44206d073c2eb55892b5';
const RESOLUTION_A = { ok: true, repository: REPO, candidateBaseSha: SHA, cveId: 'CVE-2023-6378', title: 'logback', finding: { findingIdentity: 'fp-a'.padEnd(64, '0'), source: 'TRIVY', package: 'ch.qos.logback:logback-classic', expectedInstalledVersion: '1.2.11', fixedVersion: '1.2.13' } };
const RESOLUTION_B = { ok: true, repository: REPO, candidateBaseSha: SHA, cveId: 'CVE-2020-36518', title: 'jackson', finding: { findingIdentity: 'fp-b'.padEnd(64, '0'), source: 'TRIVY', package: 'com.fasterxml.jackson.core:jackson-databind', expectedInstalledVersion: '2.13.3', fixedVersion: '2.13.5' } };

const DECISION_A = { findingIdentity: RESOLUTION_A.finding.findingIdentity, evaluatedSha: SHA, provenance: { kind: 'DIRECT_EXPLICIT', package: RESOLUTION_A.finding.package, installedVersion: '1.2.11' }, selectedTargetVersion: '1.2.13' };
const CANDIDATE_IDENTITY_A = 'a'.repeat(64);

async function main() {
  // 1. Malicious/extra body fields never override trusted evidence -- same
  // L/M/N discipline as the singular endpoint, extended to a batch.
  {
    const { resolver } = fakeResolverFor({ 'task-a': RESOLUTION_A, 'task-b': RESOLUTION_B });
    const { client, getCapturedBatchInput } = fakeCandidateVerification(null, { status: 'CANDIDATE_READY', decisions: [], candidateIdentity: null, findings: [] });
    const controller = new SecurityRemediationController(resolver, client, fakeManualRemediation);
    const maliciousBody: any = {
      projectId: 'project-1', findingTaskIds: ['task-a', 'task-b'],
      findings: [{ package: 'com.evil:malicious', targetVersion: '99.99.99' }], repository: 'evil/repo', candidateBaseSha: 'f'.repeat(40),
    };
    await controller.evaluateBatch(maliciousBody);
    const input = getCapturedBatchInput();
    assert.equal(input.repository, REPO, 'repository comes from the TRUSTED resolution, never the request body');
    assert.equal(input.candidateBaseSha, SHA);
    assert.equal(input.findings.length, 2);
    assert.equal(input.findings[0].package, RESOLUTION_A.finding.package, 'each finding\'s package is the resolver\'s trusted value, never the malicious body');
    assert.equal(input.findings[1].package, RESOLUTION_B.finding.package);
  }
  console.log('security-remediation.controller.batch) malicious/extra body fields never override trusted per-finding evidence: PASS');

  // 2. Deterministic requestId -- same findingTaskIds set (any order) -> same requestId.
  {
    const { resolver } = fakeResolverFor({ 'task-a': RESOLUTION_A, 'task-b': RESOLUTION_B });
    const { client, getCapturedBatchInput } = fakeCandidateVerification(null, { status: 'NOT_ELIGIBLE', decisions: [], candidateIdentity: null, findings: [] });
    const controller = new SecurityRemediationController(resolver, client, fakeManualRemediation);
    await controller.evaluateBatch({ projectId: 'p', findingTaskIds: ['task-a', 'task-b'] } as any);
    const first = getCapturedBatchInput().requestId;
    await controller.evaluateBatch({ projectId: 'p', findingTaskIds: ['task-b', 'task-a'] } as any);
    const second = getCapturedBatchInput().requestId;
    assert.equal(first, second, 'requestId depends on the SET of findingTaskIds, not caller array order');
  }
  console.log('security-remediation.controller.batch) deterministic requestId regardless of findingTaskIds order: PASS');

  // 3. Inconsistent repository/candidateBaseSha across findings -> REJECTED,
  // named, the worker is NEVER called.
  {
    const inconsistentB = { ...RESOLUTION_B, repository: 'someone-else/other-repo' };
    const { resolver } = fakeResolverFor({ 'task-a': RESOLUTION_A, 'task-b': inconsistentB });
    let workerCalled = false;
    const client: any = { evaluateSecurityRemediationBatch: async () => { workerCalled = true; return {}; } };
    const controller = new SecurityRemediationController(resolver, client, fakeManualRemediation);
    const result = await controller.evaluateBatch({ projectId: 'p', findingTaskIds: ['task-a', 'task-b'] } as any);
    assert.equal(result.status, 'REJECTED');
    assert.equal((result as any).reason, 'INCONSISTENT_BATCH_CONTEXT');
    assert.match((result as any).detail, /task-b/);
    assert.equal(workerCalled, false, 'the worker must never be called for an inconsistent batch');
  }
  console.log('security-remediation.controller.batch) inconsistent repository/candidateBaseSha across findings -> REJECTED before reaching the worker: PASS');

  // 4. A finding with no advisory id -> REJECTED, named.
  {
    const noCve = { ...RESOLUTION_B, cveId: null };
    const { resolver } = fakeResolverFor({ 'task-a': RESOLUTION_A, 'task-b': noCve });
    const client: any = { evaluateSecurityRemediationBatch: async () => { throw new Error('must not be called'); } };
    const controller = new SecurityRemediationController(resolver, client, fakeManualRemediation);
    const result = await controller.evaluateBatch({ projectId: 'p', findingTaskIds: ['task-a', 'task-b'] } as any);
    assert.equal(result.status, 'REJECTED');
    assert.equal((result as any).reason, 'MISSING_CVE_IDENTITY');
    assert.match((result as any).detail, /task-b/);
  }
  console.log('security-remediation.controller.batch) finding with no advisory id -> REJECTED, named: PASS');

  // 5. One finding fails resolution -> the WHOLE batch is rejected, not
  // partially evaluated with only the successful ones.
  {
    const { resolver } = fakeResolverFor({ 'task-a': RESOLUTION_A, 'task-b': { ok: false, reason: 'UNKNOWN_FINDING', detail: 'no such task' } });
    const client: any = { evaluateSecurityRemediationBatch: async () => { throw new Error('must not be called'); } };
    const controller = new SecurityRemediationController(resolver, client, fakeManualRemediation);
    const result = await controller.evaluateBatch({ projectId: 'p', findingTaskIds: ['task-a', 'task-b'] } as any);
    assert.equal(result.status, 'REJECTED');
    assert.equal((result as any).reason, 'UNKNOWN_FINDING');
  }
  console.log('security-remediation.controller.batch) one finding fails resolution -> whole batch REJECTED, never partial: PASS');

  // 6. ★ N=1 non-regression AT THE CONTROLLER LAYER: a singleton batch's
  // branchName/commitMessage/prTitle/prBody must be BYTE-IDENTICAL to what
  // /evaluate itself produces for that exact same finding.
  {
    const singularReady = { status: 'CANDIDATE_READY', decision: DECISION_A, candidateIdentity: CANDIDATE_IDENTITY_A, candidateManifest: null, guardResult: null };
    const batchReady = { status: 'CANDIDATE_READY', decisions: [DECISION_A], candidateIdentity: CANDIDATE_IDENTITY_A, candidateManifest: null, guardResult: null, findings: [{ status: 'CLOSED' }] };
    const { resolver: singularResolver } = fakeResolverFor({ 'task-a': RESOLUTION_A });
    const { resolver: batchResolver } = fakeResolverFor({ 'task-a': RESOLUTION_A });
    const { client: singularClient } = fakeCandidateVerification(singularReady, batchReady);
    const singularController = new SecurityRemediationController(singularResolver, singularClient, fakeManualRemediation);
    const batchController = new SecurityRemediationController(batchResolver, singularClient, fakeManualRemediation);

    const singularOut: any = await singularController.evaluate({ projectId: 'p', findingTaskId: 'task-a' } as any);
    const batchOut: any = await batchController.evaluateBatch({ projectId: 'p', findingTaskIds: ['task-a'] } as any);

    assert.equal(batchOut.branchName, singularOut.branchName, 'N=1 branchName must be byte-identical to /evaluate');
    assert.equal(batchOut.commitMessage, singularOut.commitMessage, 'N=1 commitMessage must be byte-identical to /evaluate');
    assert.equal(batchOut.prTitle, singularOut.prTitle);
    assert.equal(batchOut.prBody, singularOut.prBody, 'N=1 prBody must be byte-identical to /evaluate');
  }
  console.log('security-remediation.controller.batch) ★ N=1 branchName/commitMessage/prTitle/prBody byte-identical to /evaluate at the controller layer: PASS');

  // 7. ★ WF6's own UNCHANGED "Trusted Candidate" node (one of the ~45 git
  // nodes this increment must not touch) reads body.repository (top-level)
  // and body.decision.evaluatedSha (SINGULAR, not the plural `decisions`
  // array) -- caught by reading that real node's code before writing any
  // graph diff. Both must be present on a CANDIDATE_READY batch response.
  {
    const batchReady = { status: 'CANDIDATE_READY', decisions: [DECISION_A], candidateIdentity: CANDIDATE_IDENTITY_A, candidateManifest: { files: [{ path: 'pom.xml' }] }, guardResult: null, findings: [{ status: 'CLOSED' }] };
    const { resolver } = fakeResolverFor({ 'task-a': RESOLUTION_A });
    const { client } = fakeCandidateVerification(null, batchReady);
    const controller = new SecurityRemediationController(resolver, client, fakeManualRemediation);
    const out: any = await controller.evaluateBatch({ projectId: 'p', findingTaskIds: ['task-a'] } as any);
    assert.equal(out.repository, REPO, 'top-level "repository" must be present -- Trusted Candidate reads it directly, not nested under candidateManifest');
    assert.ok(out.decision, 'top-level "decision" (singular) must be present -- Trusted Candidate does not know about the plural "decisions" array');
    assert.equal(out.decision.evaluatedSha, SHA, 'decision.evaluatedSha specifically, the ONE field Trusted Candidate actually reads');
  }
  console.log('security-remediation.controller.batch) ★ top-level repository + singular decision alias present (WF6\'s unchanged Trusted Candidate node contract): PASS');

  console.log('security-remediation.controller.batch.spec.ts: ALL CHECKS PASS');
}

main().catch(err => { console.error(err); process.exitCode = 1; });
