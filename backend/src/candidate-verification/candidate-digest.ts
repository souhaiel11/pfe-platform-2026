// R22-C — pure digest functions. No filesystem/process access here, so
// these are trivially testable and reusable by both the verification
// service and the future Git Writer's assertCandidateStillValidForWrite
// guard (write-guard.ts) without either depending on the other.
import { createHash } from 'crypto';
import { CandidateFile, CandidateManifest } from './candidate-verification.types';

export function computeContentSha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * R81.3 — the exact SHA-1 git itself uses to identify a blob's content:
 * sha1("blob " + byteLength + "\0" + content). Pure, no I/O, no git binary
 * invoked. This lets the write-guard independently RE-DERIVE the hash of a
 * candidate-supplied `sourceContent` string and compare it against
 * `originalBlobSha` -- a value GitHub itself already reports for that exact
 * path/ref at fetch time, before any LLM runs (see write-guard.ts's
 * trust-binding check and generated-comment-guard.ts's INTEGRITY_MISMATCH
 * verdict). Deliberately reuses this ALREADY-THREADED field instead of
 * inventing a parallel SHA-256 that WF2 would need a new node to compute:
 * `originalBlobSha` has the identical trust property (sourced from GitHub's
 * API before the writer LLM ever runs, never overwritten by writer output --
 * proven by WF2's own object-spread ordering) and is already carried,
 * unconditionally, on every MODIFY CandidateFile. Verified byte-for-byte
 * against real `git hash-object` output for empty/ASCII/real source content
 * in this function's own test file -- not merely assumed to match git.
 */
export function computeGitBlobSha1(content: string): string {
  const bytes = Buffer.from(content, 'utf8');
  const header = Buffer.from(`blob ${bytes.length}\0`, 'utf8');
  return createHash('sha1').update(Buffer.concat([header, bytes])).digest('hex');
}

/**
 * CRITICAL INVARIANT 2: computed from candidateBaseSha + sorted file paths +
 * operation + contentSha256 -- never from the raw file content directly, so
 * the digest is cheap to recompute and compare even for large candidates.
 * Deterministic regardless of input file array order.
 */
export function computeCandidateDigest(manifest: Pick<CandidateManifest, 'candidateBaseSha' | 'files'>): string {
  const canonicalFiles = manifest.files
    .map((file: CandidateFile) => ({ path: file.path, operation: file.operation, contentSha256: file.contentSha256 }))
    .sort((a, b) => a.path.localeCompare(b.path));
  const canonical = { candidateBaseSha: manifest.candidateBaseSha.toLowerCase(), files: canonicalFiles };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}
