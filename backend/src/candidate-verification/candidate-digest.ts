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
