// R-SEC-V1.4 §8/§12 (L/M/N) — proves a caller cannot override trusted
// values. The DTO (SecurityRemediationEvaluateDto) already makes this
// structurally impossible at the class-validator layer (targetVersion/
// package/controllingFile simply do not exist as fields), reinforced by
// the app's global `whitelist: true` ValidationPipe (main.ts). This spec
// proves the SECOND, independent layer: even if a raw object with extra
// fields somehow reached the controller method (e.g. a future refactor
// that loosens the DTO), the controller itself only ever reads
// body.projectId/body.findingTaskId -- every other field the orchestrator
// needs is built EXCLUSIVELY from the resolver's trusted output.
import * as assert from 'node:assert/strict';
import { SecurityRemediationController } from './security-remediation.controller';
import { computeSecurityBranchName } from './security-branch-name';

function fakeResolver(resolution: any) {
  let capturedArgs: any[] | null = null;
  const resolver: any = { resolve: async (...args: any[]) => { capturedArgs = args; return resolution; } };
  return { resolver, getCapturedArgs: () => capturedArgs };
}

function fakeCandidateVerification() {
  let capturedInput: any = null;
  const client: any = { evaluateSecurityRemediation: async (input: any) => { capturedInput = input; return { status: 'CANDIDATE_READY', reason: 'x', decision: {}, candidateIdentity: 'id', candidateManifest: null, patchEvidence: null, guardResult: null, dependencyResolutionEvidence: null }; } };
  return { client, getCapturedInput: () => capturedInput };
}

const TRUSTED_RESOLUTION = {
  ok: true, repository: 'souhaiel11/pfe-app-test', candidateBaseSha: 'a81be45709aba07da50d44206d073c2eb55892b5',
  finding: { findingIdentity: 'fp-trusted', source: 'TRIVY', package: 'ch.qos.logback:logback-classic', expectedInstalledVersion: '1.2.11', fixedVersion: '1.2.13' },
};

async function main() {
  // L/M/N: a caller attempts to override targetVersion, package, and
  // controllingFile (plus provenance and installedVersion for good
  // measure) by stuffing them into the request body. None of these fields
  // exist on SecurityRemediationEvaluateDto, so @Body() would already
  // strip them under the app's real ValidationPipe -- this test proves the
  // controller method ITSELF never reads them even if they arrived anyway.
  {
    const { resolver, getCapturedArgs } = fakeResolver(TRUSTED_RESOLUTION);
    const { client, getCapturedInput } = fakeCandidateVerification();
    const controller = new SecurityRemediationController(resolver, client);

    const maliciousBody: any = {
      projectId: 'project-1', findingTaskId: 'task-1',
      targetVersion: '99.99.99', package: 'com.evil:malicious-package', installedVersion: '0.0.1',
      controllingFile: '/etc/passwd', controllingElement: '<version>99.99.99</version>', controllingProperty: 'evil.version',
      provenance: 'DIRECT_EXPLICIT', evaluatedSha: 'f'.repeat(40), fixedVersions: ['99.99.99'],
      candidateContent: 'malicious file content',
    };
    await controller.evaluate(maliciousBody);

    const resolveArgs = getCapturedArgs()!;
    assert.deepEqual(resolveArgs, ['project-1', 'task-1'], 'the resolver is called with ONLY projectId/findingTaskId -- no other body field is ever forwarded');

    const orchestratorInput = getCapturedInput();
    assert.equal(orchestratorInput.finding.package, TRUSTED_RESOLUTION.finding.package, 'L/M: package comes from the TRUSTED resolution, never from the caller-supplied "com.evil:malicious-package"');
    assert.notEqual(orchestratorInput.finding.package, maliciousBody.package);
    assert.equal(orchestratorInput.finding.expectedInstalledVersion, TRUSTED_RESOLUTION.finding.expectedInstalledVersion);
    assert.equal(orchestratorInput.repository, TRUSTED_RESOLUTION.repository);
    assert.equal(orchestratorInput.candidateBaseSha, TRUSTED_RESOLUTION.candidateBaseSha);
    assert.notEqual(orchestratorInput.candidateBaseSha, maliciousBody.evaluatedSha, 'H-adjacent: caller-supplied SHA is never used either');
    // The orchestrator input has NO targetVersion/package(top-level)/
    // controllingFile/provenance/candidateContent fields at all -- they
    // only ever exist INSIDE the decision the orchestrator computes itself.
    assert.equal('targetVersion' in orchestratorInput, false, 'N: no targetVersion field exists anywhere on the request sent to the worker');
    assert.equal('controllingFile' in orchestratorInput, false, 'N: no controllingFile field exists anywhere on the request sent to the worker');
    assert.equal('provenance' in orchestratorInput, false);
    assert.equal('candidateContent' in orchestratorInput, false);
  }
  console.log('security-remediation.controller L/M/N) caller-supplied targetVersion/package/controllingFile/provenance/SHA are structurally impossible to reach the worker: PASS');

  // A REJECTED resolution is passed through as a clean, typed rejection --
  // never silently converted into a worker call.
  {
    const { resolver } = fakeResolver({ ok: false, reason: 'UNKNOWN_FINDING', detail: 'no such task' });
    const { client, getCapturedInput } = fakeCandidateVerification();
    const controller = new SecurityRemediationController(resolver, client);
    const result: any = await controller.evaluate({ projectId: 'p', findingTaskId: 't' } as any);
    assert.equal(result.status, 'REJECTED');
    assert.equal(result.reason, 'UNKNOWN_FINDING');
    assert.equal(getCapturedInput(), null, 'a rejected resolution must never reach the worker client at all');
  }
  console.log('security-remediation.controller) rejected trusted resolution never reaches the worker: PASS');

  // O (part 2): the SAME findingTaskId always derives the SAME requestId --
  // no random/timestamp value influences the request sent to the worker.
  {
    const { resolver } = fakeResolver(TRUSTED_RESOLUTION);
    const { client: client1, getCapturedInput: input1 } = fakeCandidateVerification();
    const { client: client2, getCapturedInput: input2 } = fakeCandidateVerification();
    await new SecurityRemediationController(resolver, client1).evaluate({ projectId: 'project-1', findingTaskId: 'task-1' } as any);
    await new SecurityRemediationController(resolver, client2).evaluate({ projectId: 'project-1', findingTaskId: 'task-1' } as any);
    assert.equal(input1()!.requestId, input2()!.requestId, 'O: identical findingTaskId -> identical requestId across two independent calls, deterministically');
    assert.equal(input1()!.batchId, input2()!.batchId);
  }
  console.log('security-remediation.controller O) identical findingTaskId -> deterministic requestId/batchId, no randomness: PASS');

  // R-SEC-V1.5 §4 — revalidate(): matching fresh candidateIdentity -> WRITE_AUTHORIZED.
  {
    const { resolver } = fakeResolver(TRUSTED_RESOLUTION);
    const client: any = { evaluateSecurityRemediation: async () => ({ status: 'CANDIDATE_READY', reason: 'x', decision: { findingIdentity: 'fp-trusted' }, candidateIdentity: 'abc123', candidateManifest: { files: [{ path: 'pom.xml' }] }, patchEvidence: null, guardResult: { ok: true }, dependencyResolutionEvidence: null }) };
    const controller = new SecurityRemediationController(resolver, client);
    const result: any = await controller.revalidate({ projectId: 'p', findingTaskId: 't', expectedCandidateIdentity: 'abc123' } as any);
    assert.equal(result.status, 'WRITE_AUTHORIZED');
    assert.equal(result.candidateIdentity, 'abc123');
    assert.deepEqual(result.candidateManifest, { files: [{ path: 'pom.xml' }] }, 'the caller never supplies candidate bytes -- WRITE_AUTHORIZED always carries the backend\'s OWN freshly recomputed manifest');
  }
  console.log('security-remediation.controller) revalidate(): matching fresh identity -> WRITE_AUTHORIZED, backend-owned manifest: PASS');

  // I: candidate identity drifted between evaluate and write -> CANDIDATE_DRIFTED, never WRITE_AUTHORIZED.
  {
    const { resolver } = fakeResolver(TRUSTED_RESOLUTION);
    const client: any = { evaluateSecurityRemediation: async () => ({ status: 'CANDIDATE_READY', reason: 'x', decision: {}, candidateIdentity: 'DIFFERENT-FRESH-IDENTITY', candidateManifest: { files: [{ path: 'pom.xml', content: 'tampered' }] }, patchEvidence: null, guardResult: { ok: true }, dependencyResolutionEvidence: null }) };
    const controller = new SecurityRemediationController(resolver, client);
    const result: any = await controller.revalidate({ projectId: 'p', findingTaskId: 't', expectedCandidateIdentity: 'abc123' } as any);
    assert.equal(result.status, 'CANDIDATE_DRIFTED', 'I: content/identity mutation between evaluation and write must be rejected, never authorized');
    assert.equal(result.expectedCandidateIdentity, 'abc123');
    assert.equal(result.freshCandidateIdentity, 'DIFFERENT-FRESH-IDENTITY');
    assert.equal('candidateManifest' in result, false, 'a drifted result never carries ANY candidate bytes, tampered or otherwise');
  }
  console.log('security-remediation.controller I) candidateIdentity drift between evaluate and revalidate -> CANDIDATE_DRIFTED, no write: PASS');

  // B/C/D/G: a fresh non-CANDIDATE_READY outcome (NOT_ELIGIBLE / TECHNICAL_FAILURE /
  // TRANSITIVE-via-NOT_ELIGIBLE / GUARD_REJECTED) is passed straight through,
  // unchanged -- revalidate() never overrides or upgrades a real rejection.
  for (const freshStatus of ['NOT_ELIGIBLE', 'TECHNICAL_FAILURE', 'GUARD_REJECTED', 'MAVEN_RESOLUTION_MISMATCH']) {
    const { resolver } = fakeResolver(TRUSTED_RESOLUTION);
    const client: any = { evaluateSecurityRemediation: async () => ({ status: freshStatus, reason: 'real reason', decision: {} }) };
    const controller = new SecurityRemediationController(resolver, client);
    const result: any = await controller.revalidate({ projectId: 'p', findingTaskId: 't', expectedCandidateIdentity: 'abc123' } as any);
    assert.equal(result.status, freshStatus, `a non-CANDIDATE_READY fresh outcome (${freshStatus}) must pass through unchanged, never become WRITE_AUTHORIZED`);
  }
  console.log('security-remediation.controller B/C/D/G) non-CANDIDATE_READY fresh outcomes pass through unchanged -> never WRITE_AUTHORIZED: PASS');

  // R-SEC-V1.5 §6 — branchName is computed server-side (WF6 needs zero
  // naming logic of its own) and is IDENTICAL whether it arrives via
  // evaluate()'s CANDIDATE_READY or revalidate()'s WRITE_AUTHORIZED, for
  // the same finding/candidate identity. Absent for every other status.
  const REAL_FP = 'a37e178f7ce1805b0b1b0e8ac2d41d20333041c26b4e88490f8af4e9885b7cf2';
  const REAL_CI = '1ebe4cecc872dea657218031000f817a0e6a7b68aa53dd71d84eacdd87c86e4'.slice(0, 63) + '8';
  {
    const { resolver } = fakeResolver(TRUSTED_RESOLUTION);
    const decision = { findingIdentity: REAL_FP, evaluatedSha: 'a81be45709aba07da50d44206d073c2eb55892b5', selectedTargetVersion: '1.2.13', provenance: { ecosystem: 'MAVEN', kind: 'DIRECT_EXPLICIT', package: 'ch.qos.logback:logback-classic', installedVersion: '1.2.11', controllingFile: 'pom.xml', controllingElement: null, controllingProperty: null, groundedSha: 'a81be45709aba07da50d44206d073c2eb55892b5', evidence: 'x' } };
    const client: any = { evaluateSecurityRemediation: async () => ({ status: 'CANDIDATE_READY', reason: 'x', decision, candidateIdentity: REAL_CI, candidateManifest: { files: [] }, patchEvidence: null, guardResult: null, dependencyResolutionEvidence: null }) };
    const evalResult: any = await new SecurityRemediationController(resolver, client).evaluate({ projectId: 'p', findingTaskId: 't' } as any);
    const revalResult: any = await new SecurityRemediationController(resolver, client).revalidate({ projectId: 'p', findingTaskId: 't', expectedCandidateIdentity: REAL_CI } as any);
    const expected = computeSecurityBranchName(REAL_FP, REAL_CI);
    assert.equal(evalResult.branchName, expected);
    assert.equal(revalResult.branchName, expected, 'branchName is identical between evaluate (CANDIDATE_READY) and revalidate (WRITE_AUTHORIZED) for the same finding/candidate');
    assert.equal(evalResult.commitMessage, 'fix(security): remediate security-advisory in logback-classic (1.2.11 -> 1.2.13)', 'commitMessage computed server-side too (TRUSTED_RESOLUTION carries no cveId -> safe fallback advisory label)');
    assert.equal(evalResult.prTitle, evalResult.commitMessage);
    assert.match(evalResult.prBody, /Security remediation candidate/);
    assert.doesNotMatch(evalResult.prBody, /Vulnerability fixed/i);
    assert.equal(evalResult.repository, TRUSTED_RESOLUTION.repository, 'repository is exposed as trusted OUTPUT so WF6 can address the GitHub API -- never accepted back as input (see the DTOs)');
  }
  {
    const { resolver } = fakeResolver({ ok: false, reason: 'UNKNOWN_FINDING', detail: 'x' });
    const client: any = { evaluateSecurityRemediation: async () => ({}) };
    const result: any = await new SecurityRemediationController(resolver, client).evaluate({ projectId: 'p', findingTaskId: 't' } as any);
    assert.equal(result.branchName, null, 'a REJECTED outcome never carries a branch name');
  }
  console.log('security-remediation.controller) branchName computed server-side, identical across evaluate/revalidate, absent for non-ready statuses: PASS');

  console.log('security-remediation.controller.spec.ts: ALL CHECKS PASS');
}

main().catch(err => { console.error(err); process.exitCode = 1; });
