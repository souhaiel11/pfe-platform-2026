import * as assert from 'node:assert/strict';
import { computeCandidateDigest, computeContentSha256 } from './candidate-digest';
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

console.log('candidate-digest: PASS');
