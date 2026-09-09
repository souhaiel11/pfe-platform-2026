import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { CandidateVerificationExecutor } from './candidate-verification-executor';
import { WorkspaceManager } from './workspace-manager.service';
import { HeadVerificationRequest } from '../../backend/src/candidate-verification/candidate-verification.types';
import { CandidateVerificationController } from '../../backend/src/candidate-verification/candidate-verification.controller';
import { CandidateVerificationService } from '../../backend/src/candidate-verification/candidate-verification.service';
import { assertCandidateStillValidForWrite } from '../../backend/src/candidate-verification/write-guard';

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'head-verification-'));
  const repo = path.join(root, 'repo'); fs.mkdirSync(repo);
  const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const originalFetch = globalThis.fetch;
  try {
    git('init'); fs.writeFileSync(path.join(repo, 'proof.txt'), 'exact committed bytes');
    git('add', '.'); git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'fixture');
    const sha = git('rev-parse', 'HEAD');
    const request: HeadVerificationRequest = { verifyHeadOnly: true, repository: 'owner/repo', targetSha: sha.toUpperCase(), validationRequestId: 'v1', requestId: 'r1', batchId: 'b1', candidateAttempt: 1 };
    let calls = 0;
    const adapter: any = { supports: () => true, compile: (ws: string) => {
      calls++; assert.equal(fs.readFileSync(path.join(ws, 'proof.txt'), 'utf8'), 'exact committed bytes');
      return { status: 'SUCCESS', exitCode: 0, durationMs: 1, evidenceTail: 'compile proof' };
    }, runRegressionTests: () => ({ status: 'SUCCESS', total: 1, failures: 0, errors: 0, skipped: 0, durationMs: 1, evidenceRef: 'test proof' }) };
    const manager = new WorkspaceManager(path.join(root, 'workspaces'));
    const executor = new CandidateVerificationExecutor(manager, { materialize: () => { throw Error('must not materialize'); } } as any, { ensureRepo: () => repo } as any, [adapter]);
    const result = executor.executeHead(request);
    assert.equal(result.overall, 'PASS'); assert.equal(result.workspace.checkoutSha, sha);
    assert.equal(result.workspace.exactShaVerified, true); assert.equal(result.workspace.cleaned, true);
    assert.equal('manifestValidation' in result, false); assert.equal('candidateDigest' in result.identity, false);
    assert.equal(fs.existsSync(path.join(root, 'workspaces', result.workspace.workspaceId)), false);
    assert.deepEqual(assertCandidateStillValidForWrite(result, {} as any), { ok: false, reason: 'HEAD_ONLY_NOT_WRITABLE' });
    // Even a forged result carrying manifest identity fields cannot authorize writes.
    assert.equal(assertCandidateStillValidForWrite({ ...result, identity: { ...result.identity, candidateDigest: 'd', candidateBaseSha: sha } } as any, { candidateDigest: 'd', candidateBaseSha: sha } as any).ok, false);
    const missing = executor.executeHead({ ...request, targetSha: 'f'.repeat(40) });
    assert.equal(missing.overall, 'INCONCLUSIVE'); assert.equal(missing.failureClass, 'SHA_UNAVAILABLE');
    assert.equal(missing.workspace.checkoutSha, null); assert.equal(calls, 1);
    const mismatch = new CandidateVerificationExecutor({ workspaceId: () => 'w', createWorkspace: () => ({ path: repo, exactShaVerified: true, checkoutSha: 'e'.repeat(40) }), cleanupWorkspace: () => {} } as any, {} as any, { ensureRepo: () => repo } as any, [adapter]).executeHead(request);
    assert.equal(mismatch.overall, 'INCONCLUSIVE'); assert.equal(mismatch.failureClass, 'SHA_UNAVAILABLE'); assert.equal(calls, 1);
    const passingTests = adapter.runRegressionTests;
    for (const status of ['FAILED', 'UNKNOWN', 'NOT_RUN']) {
      adapter.runRegressionTests = () => ({ ...passingTests(), status });
      const checked = executor.executeHead(request);
      assert.equal(checked.overall, status === 'FAILED' ? 'FAIL' : 'INCONCLUSIVE');
      assert.equal(checked.workspace.cleaned, true);
    }
    adapter.runRegressionTests = () => { throw Error('tests must not run after compile failure'); };
    adapter.compile = () => ({ status: 'FAILED', exitCode: 1, durationMs: 1, evidenceTail: 'compile failed' });
    const compileFailed = executor.executeHead(request);
    assert.equal(compileFailed.overall, 'FAIL'); assert.equal(compileFailed.tests.regression.status, 'NOT_RUN');
    assert.equal(compileFailed.workspace.cleaned, true);
    assert.throws(() => executor.executeHead({ ...request, manifest: { files: [] } } as any), /INVALID_HEAD/);
    assert.throws(() => executor.executeHead({ ...request, targetSha: 'main' }), /INVALID_HEAD/);
    const empty = executor.execute({ candidateId: 'c', requestId: 'r', batchId: 'b', candidateAttempt: 0, repository: 'owner/repo', candidateBaseSha: sha, files: [] });
    assert.equal(empty.failureClass, 'CANDIDATE_MANIFEST_INVALID'); assert.equal(empty.overall, 'FAIL');
    const controller = new CandidateVerificationController({ verifyHead: (r: any) => { assert.deepEqual(r, request); return result; } } as any);
    assert.equal(await controller.verify(request), result);
    assert.throws(() => controller.verify({ ...request, manifest: { files: [] } } as any), /INVALID_HEAD/);
    const service = new CandidateVerificationService();
    globalThis.fetch = (async (_url: any, init: any) => { assert.deepEqual(JSON.parse(init.body), request); return new Response(JSON.stringify(result)); }) as any;
    assert.deepEqual(await service.verifyHead(request), result);
    globalThis.fetch = (async () => new Response(JSON.stringify({ ...result, workspace: { ...result.workspace, checkoutSha: 'e'.repeat(40) } }))) as any;
    assert.equal((await service.verifyHead(request)).failureClass, 'VERIFIER_PROTOCOL_ERROR');
    globalThis.fetch = (async () => { throw Error('offline'); }) as any;
    const unavailable = await service.verifyHead(request);
    assert.equal(unavailable.overall, 'INCONCLUSIVE'); assert.equal(unavailable.failureClass, 'VERIFIER_UNAVAILABLE');
    assert.equal('manifestValidation' in unavailable, false);
    console.log('HEAD_ONLY: PASS (real Git checkout, no materialization, SHA failures, dispatch, transport, write guard, empty manifest)');
  } finally { globalThis.fetch = originalFetch; fs.rmSync(root, { recursive: true, force: true }); }
}
main().catch(err => { console.error(err); process.exitCode = 1; });
