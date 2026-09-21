import * as assert from 'node:assert/strict';
import { computeCandidateDigest, computeContentSha256, computeGitBlobSha1 } from './candidate-digest';
import { CandidateManifest } from './candidate-verification.types';

function manifest(overrides: Partial<CandidateManifest> = {}): CandidateManifest {
  return {
    candidateId: 'c1', requestId: 'r1', batchId: 'b1', candidateAttempt: 0,
    repository: 'souhaiel11/pfe-app-test', candidateBaseSha: '8A315B0DD508EB9843BB3037FE2827F02F6FAA78',
    files: [
      { path: 'B.java', operation: 'MODIFY', content: 'b', contentSha256: computeContentSha256('b') },
      { path: 'A.java', operation: 'CREATE', content: 'a', contentSha256: computeContentSha256('a') },
    ],
    ...overrides,
  };
}

// --- deterministic and order-independent ---
{
  const digest1 = computeCandidateDigest(manifest());
  const reordered = manifest();
  reordered.files = [...reordered.files].reverse();
  const digest2 = computeCandidateDigest(reordered);
  assert.equal(digest1, digest2, 'digest is independent of input file array order (sorted internally)');
}

// --- case-insensitive on candidateBaseSha ---
{
  const upper = computeCandidateDigest(manifest({ candidateBaseSha: '8A315B0DD508EB9843BB3037FE2827F02F6FAA78' }));
  const lower = computeCandidateDigest(manifest({ candidateBaseSha: '8a315b0dd508eb9843bb3037fe2827f02f6faa78' }));
  assert.equal(upper, lower, 'digest treats candidateBaseSha case-insensitively');
}

// --- changes when a file's contentSha256 changes ---
{
  const original = computeCandidateDigest(manifest());
  const tampered = manifest();
  tampered.files[0].contentSha256 = computeContentSha256('different content entirely');
  const digestTampered = computeCandidateDigest(tampered);
  assert.notEqual(original, digestTampered, 'digest changes when any file content hash changes');
}

// --- changes when base SHA changes (test 24 support: digest is base-SHA-bound) ---
{
  const d1 = computeCandidateDigest(manifest({ candidateBaseSha: 'a'.repeat(40) }));
  const d2 = computeCandidateDigest(manifest({ candidateBaseSha: 'b'.repeat(40) }));
  assert.notEqual(d1, d2, 'digest is bound to candidateBaseSha, not just file contents');
}

// ============================================================================
// R81.3 — computeGitBlobSha1: verified byte-for-byte against REAL
// `git hash-object` output (not merely assumed to match git's algorithm).
// Reference values below were produced by actually running
// `git hash-object --stdin` / `git hash-object <file>` on this exact
// content, not hand-derived.
// ============================================================================
{
  assert.equal(computeGitBlobSha1('hello\n'), 'ce013625030ba8dba906f756967f9e9ca394464a', 'matches real `git hash-object` for "hello\\n"');
  assert.equal(computeGitBlobSha1('class X {}\n'), '91335d9690e8e22351e184d16045b76cf3032b79', 'matches real `git hash-object` for a small Java source snippet');
  assert.equal(computeGitBlobSha1(''), 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391', 'matches real `git hash-object` for empty content (the well-known empty-blob SHA)');
  console.log('candidate-digest: computeGitBlobSha1 matches real git hash-object: PASS');
}

// --- computeGitBlobSha1 is deterministic and content-sensitive ---
{
  const a = computeGitBlobSha1('class X {}\n');
  const b = computeGitBlobSha1('class X {}\n');
  const c = computeGitBlobSha1('class X { int a; }\n');
  assert.equal(a, b, 'computeGitBlobSha1 is deterministic for identical content');
  assert.notEqual(a, c, 'computeGitBlobSha1 changes when content changes');
}

console.log('candidate-digest: PASS');
