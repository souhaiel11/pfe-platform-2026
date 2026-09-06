import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CandidateMaterializer, MaterializationError } from './candidate-materializer.service';
import { computeContentSha256 } from './candidate-digest';
import { CandidateManifest } from './candidate-verification.types';

function freshWorkspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pfe-materializer-spec-'));
  fs.writeFileSync(path.join(dir, 'Existing.java'), 'old content', 'utf8');
  return dir;
}

function manifestWith(files: CandidateManifest['files']): CandidateManifest {
  return { candidateId: 'c1', requestId: 'r1', batchId: 'b1', candidateAttempt: 0, repository: 'x/y', candidateBaseSha: 'a'.repeat(40), files };
}

const materializer = new CandidateMaterializer();

// --- Test 4: MODIFY applies exact content ---
{
  const ws = freshWorkspace();
  const newContent = 'new content for Existing.java';
  materializer.materialize(ws, manifestWith([{ path: 'Existing.java', operation: 'MODIFY', content: newContent, contentSha256: computeContentSha256(newContent) }]));
  assert.equal(fs.readFileSync(path.join(ws, 'Existing.java'), 'utf8'), newContent, 'Test 4 - MODIFY writes the exact manifest content');
}

// --- MODIFY rejected when target does not exist at candidateBaseSha ---
{
  const ws = freshWorkspace();
  assert.throws(
    () => materializer.materialize(ws, manifestWith([{ path: 'DoesNotExist.java', operation: 'MODIFY', content: 'x', contentSha256: computeContentSha256('x') }])),
    (err: unknown) => err instanceof MaterializationError && err.failureClass === 'CANDIDATE_MATERIALIZATION_FAILED',
    'MODIFY on a nonexistent path is rejected, never silently created',
  );
}

// --- Test 5: CREATE applies exact content ---
{
  const ws = freshWorkspace();
  const content = 'brand new file';
  materializer.materialize(ws, manifestWith([{ path: 'nested/New.java', operation: 'CREATE', content, contentSha256: computeContentSha256(content) }]));
  assert.equal(fs.readFileSync(path.join(ws, 'nested', 'New.java'), 'utf8'), content, 'Test 5 - CREATE writes the exact manifest content, including creating parent directories inside the workspace');
}

// --- CREATE rejected when target already exists ---
{
  const ws = freshWorkspace();
  assert.throws(
    () => materializer.materialize(ws, manifestWith([{ path: 'Existing.java', operation: 'CREATE', content: 'x', contentSha256: computeContentSha256('x') }])),
    (err: unknown) => err instanceof MaterializationError && err.failureClass === 'CANDIDATE_MATERIALIZATION_FAILED',
    'CREATE on an already-existing path is rejected, never silently overwritten',
  );
}

// --- Test 6: DELETE rejected explicitly, never reinterpreted ---
{
  const ws = freshWorkspace();
  assert.throws(
    () => materializer.materialize(ws, manifestWith([{ path: 'Existing.java', operation: 'DELETE' as any, content: '', contentSha256: computeContentSha256('') }])),
    (err: unknown) => err instanceof MaterializationError && err.failureClass === 'CANDIDATE_MANIFEST_INVALID',
    'Test 6 - DELETE operation is rejected explicitly, not silently no-op\'d or reinterpreted as MODIFY/CREATE',
  );
  assert.equal(fs.readFileSync(path.join(ws, 'Existing.java'), 'utf8'), 'old content', 'the existing file is untouched after a rejected DELETE');
}

// --- Test 7: path traversal rejected ---
for (const badPath of ['../escape.java', 'nested/../../escape.java', '/absolute/Escape.java']) {
  const ws = freshWorkspace();
  assert.throws(
    () => materializer.materialize(ws, manifestWith([{ path: badPath, operation: 'CREATE', content: 'x', contentSha256: computeContentSha256('x') }])),
    (err: unknown) => err instanceof MaterializationError && err.failureClass === 'CANDIDATE_MANIFEST_INVALID',
    `Test 7 - path traversal/absolute path rejected: ${badPath}`,
  );
}
{
  const ws = freshWorkspace();
  assert.throws(
    () => materializer.materialize(ws, manifestWith([{ path: '.git/hooks/pre-commit', operation: 'CREATE', content: 'x', contentSha256: computeContentSha256('x') }])),
    (err: unknown) => err instanceof MaterializationError && err.failureClass === 'CANDIDATE_MANIFEST_INVALID',
    'Test 7b - write into .git/ rejected',
  );
}

// --- Test 8: out-of-scope path rejected (ScopeLockService reuse) ---
{
  const ws = freshWorkspace();
  fs.writeFileSync(path.join(ws, 'Unrelated.java'), 'old', 'utf8');
  assert.throws(
    () => materializer.materialize(
      ws,
      manifestWith([{ path: 'Unrelated.java', operation: 'MODIFY', content: 'x', contentSha256: computeContentSha256('x') }]),
      ['Existing.java'], // allowedPaths does not include Unrelated.java
    ),
    (err: unknown) => err instanceof MaterializationError && err.failureClass === 'CANDIDATE_MANIFEST_INVALID',
    'Test 8 - a path outside allowedPaths is rejected via ScopeLockService (R22-A) reuse',
  );
}

// --- Test 9: post-write SHA256 matches manifest (happy path, proven via independent readback) ---
{
  const ws = freshWorkspace();
  const content = 'verified content';
  const sha = computeContentSha256(content);
  materializer.materialize(ws, manifestWith([{ path: 'Existing.java', operation: 'MODIFY', content, contentSha256: sha }]));
  const independentSha = computeContentSha256(fs.readFileSync(path.join(ws, 'Existing.java'), 'utf8'));
  assert.equal(independentSha, sha, 'Test 9 - bytes actually on disk hash to exactly the declared contentSha256');
}

// --- Test 10: tampered candidate content fails digest verification ---
{
  const ws = freshWorkspace();
  assert.throws(
    () => materializer.materialize(ws, manifestWith([{ path: 'Existing.java', operation: 'MODIFY', content: 'actual content', contentSha256: computeContentSha256('a completely different declared hash source') }])),
    (err: unknown) => err instanceof MaterializationError && err.failureClass === 'CANDIDATE_CONTENT_MISMATCH',
    'Test 10 - content whose real hash does not match its declared contentSha256 fails closed as CANDIDATE_CONTENT_MISMATCH',
  );
}

console.log('CandidateMaterializer: PASS');
