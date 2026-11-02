// Teste le composant « security-remediation.controller.batch » et ses cas d’erreur.
import * as assert from 'node:assert/strict';
import { SecurityRemediationController } from './security-remediation.controller';

/** Simule les dépendances nécessaires au scénario. */
function fakeResolverFor(resolutionsByTaskId: Record<string, any>) {
  const capturedArgs: any[][] = [];
  const resolver: any = {
  /** Retrouve les données fiables correspondant à la demande. */
  resolve: async (...args: any[]) => { capturedArgs.push(args); return resolutionsByTaskId[args[1]]; } };
  return { resolver,
  /** Simule la lecture des données demandées par le composant. */
  getCapturedArgs: () => capturedArgs };
}

/** Simule les dépendances nécessaires au scénario. */
function fakeCandidateVerification(singularResult: any, batchResult: any) {
  let capturedSingularInput: any = null, capturedBatchInput: any = null;
  const client: any = {
    /** Prépare les données nécessaires à ce scénario. */
    evaluateSecurityRemediation: async (input: any) => { capturedSingularInput = input; return singularResult; },
    /** Prépare les données nécessaires à ce scénario. */
    evaluateSecurityRemediationBatch: async (input: any) => { capturedBatchInput = input; return batchResult; },
  };
  return { client,
  /** Simule la lecture des données demandées par le composant. */
  getCapturedSingularInput: () => capturedSingularInput,
  /** Simule la lecture des données demandées par le composant. */
  getCapturedBatchInput: () => capturedBatchInput };
}

const fakeManualRemediation: any = {
/** Vérifie WF6 cible Ownership dans ce scénario de test. */
verifyWf6TargetOwnership: async () => {},
/** Simule l’échec attendu par ce scénario. */
recordWf6Result: async () => { throw new Error('not exercised'); },
/** Simule l’échec attendu par ce scénario. */
recordWf6BatchResult: async () => { throw new Error('not exercised'); } };

const REPO = 'souhaiel11/pfe-app-test';
const SHA = 'a81be45709aba07da50d44206d073c2eb55892b5';
const RESOLUTION_A = { ok: true, repository: REPO, candidateBaseSha: SHA, cveId: 'CVE-2023-6378', title: 'logback', finding: { findingIdentity: 'a'.repeat(64), source: 'TRIVY', package: 'ch.qos.logback:logback-classic', expectedInstalledVersion: '1.2.11', fixedVersion: '1.2.13' } };
const RESOLUTION_B = { ok: true, repository: REPO, candidateBaseSha: SHA, cveId: 'CVE-2020-36518', title: 'jackson', finding: { findingIdentity: 'b'.repeat(64), source: 'TRIVY', package: 'com.fasterxml.jackson.core:jackson-databind', expectedInstalledVersion: '2.13.3', fixedVersion: '2.13.5' } };

const DECISION_A = { findingIdentity: RESOLUTION_A.finding.findingIdentity, evaluatedSha: SHA, provenance: { kind: 'DIRECT_EXPLICIT', package: RESOLUTION_A.finding.package, installedVersion: '1.2.11' }, selectedTargetVersion: '1.2.13' };
const CANDIDATE_IDENTITY_A = 'a'.repeat(64);

/** Exécute les étapes principales de ce programme. */
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
    const client: any = {
    /** Prépare les données nécessaires à ce scénario. */
    evaluateSecurityRemediationBatch: async () => { workerCalled = true; return {}; } };
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
    const client: any = {
    /** Simule l’échec attendu par ce scénario. */
    evaluateSecurityRemediationBatch: async () => { throw new Error('must not be called'); } };
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
    const client: any = {
    /** Simule l’échec attendu par ce scénario. */
    evaluateSecurityRemediationBatch: async () => { throw new Error('must not be called'); } };
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

  // 8. revalidateBatch() -- matching identity -> WRITE_AUTHORIZED, with the
  // SAME git-authoring metadata (branchName/commitMessage/...) computed the
  // same way evaluateBatch()'s CANDIDATE_READY path does.
  {
    const batchReady = { status: 'CANDIDATE_READY', decisions: [DECISION_A], candidateIdentity: CANDIDATE_IDENTITY_A, candidateManifest: { files: [{ path: 'pom.xml' }] }, guardResult: null, findings: [{ status: 'CLOSED' }] };
    const { resolver } = fakeResolverFor({ 'task-a': RESOLUTION_A });
    const { client } = fakeCandidateVerification(null, batchReady);
    const controller = new SecurityRemediationController(resolver, client, fakeManualRemediation);
    const out: any = await controller.revalidateBatch({ projectId: 'p', findingTaskIds: ['task-a'], expectedCandidateIdentity: CANDIDATE_IDENTITY_A } as any);
    assert.equal(out.status, 'WRITE_AUTHORIZED');
    assert.ok(out.branchName, 'WRITE_AUTHORIZED must carry branchName -- the exact gap this increment fixes (the batch wrapper previously nulled it for anything but CANDIDATE_READY)');
    assert.ok(out.commitMessage && out.prTitle && out.prBody);
  }
  console.log('security-remediation.controller.batch) revalidateBatch(): matching identity -> WRITE_AUTHORIZED, branch/commit/PR metadata present: PASS');

  // 9. revalidateBatch() -- mismatched identity -> CANDIDATE_DRIFTED, no write.
  {
    const batchReady = { status: 'CANDIDATE_READY', decisions: [DECISION_A], candidateIdentity: CANDIDATE_IDENTITY_A, candidateManifest: { files: [{ path: 'pom.xml' }] }, guardResult: null, findings: [{ status: 'CLOSED' }] };
    const { resolver } = fakeResolverFor({ 'task-a': RESOLUTION_A });
    const { client } = fakeCandidateVerification(null, batchReady);
    const controller = new SecurityRemediationController(resolver, client, fakeManualRemediation);
    const out: any = await controller.revalidateBatch({ projectId: 'p', findingTaskIds: ['task-a'], expectedCandidateIdentity: 'b'.repeat(64) } as any);
    assert.equal(out.status, 'CANDIDATE_DRIFTED');
    assert.equal(out.freshCandidateIdentity, CANDIDATE_IDENTITY_A);
  }
  console.log('security-remediation.controller.batch) revalidateBatch(): mismatched identity -> CANDIDATE_DRIFTED, no write: PASS');

  // 10. revalidateBatch() -- a fresh non-ready outcome (e.g. NOT_ELIGIBLE)
  // passes straight through, unchanged, never silently reclassified.
  {
    const notReady = { status: 'NOT_ELIGIBLE', reason: 'TRANSITIVE_NOT_AUTOFIXABLE_V1', decisions: [], candidateIdentity: null, findings: [] };
    const { resolver } = fakeResolverFor({ 'task-a': RESOLUTION_A });
    const { client } = fakeCandidateVerification(null, notReady);
    const controller = new SecurityRemediationController(resolver, client, fakeManualRemediation);
    const out: any = await controller.revalidateBatch({ projectId: 'p', findingTaskIds: ['task-a'], expectedCandidateIdentity: CANDIDATE_IDENTITY_A } as any);
    assert.equal(out.status, 'NOT_ELIGIBLE');
    assert.equal(out.branchName, null);
  }
  console.log('security-remediation.controller.batch) revalidateBatch(): non-ready fresh outcome passes through unchanged, never reclassified: PASS');

  // 11. ★ N=1 non-regression AT THE CONTROLLER LAYER for revalidate too:
  // a singleton batch revalidation must be byte-identical to /revalidate.
  {
    const singularReady = { status: 'CANDIDATE_READY', decision: DECISION_A, candidateIdentity: CANDIDATE_IDENTITY_A, candidateManifest: null, guardResult: null };
    const batchReady = { status: 'CANDIDATE_READY', decisions: [DECISION_A], candidateIdentity: CANDIDATE_IDENTITY_A, candidateManifest: null, guardResult: null, findings: [{ status: 'CLOSED' }] };
    const { resolver: singularResolver } = fakeResolverFor({ 'task-a': RESOLUTION_A });
    const { resolver: batchResolver } = fakeResolverFor({ 'task-a': RESOLUTION_A });
    const { client } = fakeCandidateVerification(singularReady, batchReady);
    const singularController = new SecurityRemediationController(singularResolver, client, fakeManualRemediation);
    const batchController = new SecurityRemediationController(batchResolver, client, fakeManualRemediation);

    const singularOut: any = await singularController.revalidate({ projectId: 'p', findingTaskId: 'task-a', expectedCandidateIdentity: CANDIDATE_IDENTITY_A } as any);
    const batchOut: any = await batchController.revalidateBatch({ projectId: 'p', findingTaskIds: ['task-a'], expectedCandidateIdentity: CANDIDATE_IDENTITY_A } as any);

    assert.equal(singularOut.status, 'WRITE_AUTHORIZED');
    assert.equal(batchOut.status, 'WRITE_AUTHORIZED');
    assert.equal(batchOut.branchName, singularOut.branchName, 'N=1 revalidate-batch branchName must be byte-identical to /revalidate');
    assert.equal(batchOut.commitMessage, singularOut.commitMessage);
    assert.equal(batchOut.prBody, singularOut.prBody);
  }
  console.log('security-remediation.controller.batch) ★ N=1 revalidateBatch() byte-identical to /revalidate at the controller layer: PASS');

  // 12. ★ Why findingTaskIds[0] alone would be wrong: revalidating a SUBSET
  // of a real 2-finding batch recomputes a DIFFERENT identity than the one
  // the full batch was authorized under, so it correctly (and necessarily)
  // drifts -- demonstrating in code why the fix cannot be "just read index 0".
  {
    const twoFindingReady = { status: 'CANDIDATE_READY', decisions: [DECISION_A, { ...DECISION_A, findingIdentity: 'b'.repeat(64), provenance: { kind: 'DIRECT_EXPLICIT', package: RESOLUTION_B.finding.package, installedVersion: '2.13.3' }, selectedTargetVersion: '2.13.5' }], candidateIdentity: 'the-real-2-finding-batch-identity'.padEnd(64, '0').slice(0, 64), candidateManifest: null, guardResult: null, findings: [{ status: 'CLOSED' }, { status: 'CLOSED' }] };
    // Simulate "fix: read findingTaskIds[0]" -- revalidating ONLY task-a
    // recomputes a batch-of-1 identity (== DECISION_A's own single
    // identity, by the N=1 rule), which can NEVER equal the real
    // 2-finding batch identity the caller is trying to reauthorize.
    const oneFindingFresh = { status: 'CANDIDATE_READY', decisions: [DECISION_A], candidateIdentity: CANDIDATE_IDENTITY_A, candidateManifest: null, guardResult: null, findings: [{ status: 'CLOSED' }] };
    const { resolver } = fakeResolverFor({ 'task-a': RESOLUTION_A });
    const { client } = fakeCandidateVerification(null, oneFindingFresh);
    const controller = new SecurityRemediationController(resolver, client, fakeManualRemediation);
    const out: any = await controller.revalidateBatch({ projectId: 'p', findingTaskIds: ['task-a'], expectedCandidateIdentity: twoFindingReady.candidateIdentity } as any);
    assert.equal(out.status, 'CANDIDATE_DRIFTED', 'revalidating only findingTaskIds[0] of an originally 2-finding batch MUST drift -- proves index-0-only is not a valid fix');
  }
  console.log('security-remediation.controller.batch) ★ revalidating only findingTaskIds[0] of a real 2-finding batch necessarily drifts -- confirms the fix must revalidate the FULL list: PASS');

  // Modern correlation brackets the worker call and isolates its workspace.
  {
    const { resolver } = fakeResolverFor({ 'task-a': RESOLUTION_A });
    const { client, getCapturedBatchInput } = fakeCandidateVerification(null, {status:'NOT_ELIGIBLE', decisions:[], findings:[]});
    const checks: any[]=[];
    const manual: any={
    /** Vérifie WF6 cible Ownership dans ce scénario de test. */
    verifyWf6TargetOwnership:async()=>{},
    /** Vérifie WF6 tentative contexte dans ce scénario de test. */
    verifyWf6AttemptContext: async(...args: any[])=>checks.push(args)};
    const controller = new SecurityRemediationController(resolver, client, manual);
    const attempts=[{findingTaskId:'task-a',attemptId:'attempt-2',attemptNumber:2}];
    const out: any=await controller.evaluateBatch({projectId:'p',findingTaskIds:['task-a'],batchId:'sec-batch-unique',attempts} as any);
    assert.equal(checks.length,2);
    assert.equal(getCapturedBatchInput().batchId,'sec-batch-unique');
    assert.equal(getCapturedBatchInput().candidateAttempt,2);
    assert.deepEqual(out.attempts,attempts);
    const firstRequest=getCapturedBatchInput().requestId;
    await controller.evaluateBatch({projectId:'p',findingTaskIds:['task-a'],batchId:'sec-batch-next',attempts} as any);
    assert.notEqual(getCapturedBatchInput().requestId,firstRequest);
  }
  console.log('modern evaluation retains correlation, checks before/after worker and isolates attempt workspaces: PASS');
  {
    const { resolver } = fakeResolverFor({ 'task-a': RESOLUTION_A });
    const { client } = fakeCandidateVerification(null, {status:'CANDIDATE_READY', decisions:[], findings:[],candidateIdentity:'a'.repeat(64)});
    let checked=0;
    const manual: any={
    /** Vérifie WF6 cible Ownership dans ce scénario de test. */
    verifyWf6TargetOwnership:async()=>{},
    /** Vérifie WF6 tentative contexte dans ce scénario de test. */
    verifyWf6AttemptContext:async()=>{if(++checked===2)throw new Error('stale attempt');}};
    const controller=new SecurityRemediationController(resolver,client,manual);
    await assert.rejects(controller.revalidateBatch({projectId:'p',findingTaskIds:['task-a'],expectedCandidateIdentity:'a'.repeat(64),batchId:'b',attempts:[{findingTaskId:'task-a',attemptId:'a',attemptNumber:1}]} as any),/stale attempt/);
  }
  console.log('modern stale attempt cannot receive write authorization after revalidation: PASS');

  console.log('security-remediation.controller.batch.spec.ts: ALL CHECKS PASS');
}

main().catch(err => { console.error(err); process.exitCode = 1; });
