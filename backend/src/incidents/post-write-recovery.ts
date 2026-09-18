import { BadRequestException, ConflictException } from '@nestjs/common';
import { createHash } from 'crypto';

export type RecoveryOperation = 'MODIFY' | 'CREATE';

export interface RecoveryManifestFile {
  path: string;
  operation: RecoveryOperation;
  originalBlobSha: string | null;
  contentSha256: string;
}

export interface RecoveryReceipt {
  targetFile: string;
  fileOperation: RecoveryOperation;
  oldSha: string | null;
  newSha: string;
  contentSha256: string;
  commitSha: string;
  approvedFindingIds: string[];
  processedFindingIds: string[];
  candidateAcceptedFindingIds: string[];
  candidateStateVerified: true;
  updateApplied: true;
  outcome: 'CANDIDATE_ACCEPTABLE_FOR_SCANNER_VALIDATION';
  validationEvidence?: unknown;
}

export interface PostWriteRecoveryInput {
  fixRequestId: string;
  sourceAttempt: number;
  sourceExecutionId: string;
  batchId: string;
  candidateDigest: string;
  expectedBranch: string;
  expectedHeadSha: string;
  prNumber: number;
  evidence: {
    candidateId: string;
    candidateBaseSha: string;
    targetBranchName: string;
    files: RecoveryManifestFile[];
    receipts: RecoveryReceipt[];
    validation: {
      compileMain: 'PASS';
      compileTests: 'PASS';
      fullTest: 'PASS';
      review: 'PASS';
      noDefectCount: number;
      provenDefectCount: number;
      verificationRequiredCount: number;
      writeGuardOk: true;
    };
  };
}

/** HTTP-boundary DTO; semantic validation remains fail-closed in the service. */
export class PostWriteRecoveryDto implements PostWriteRecoveryInput {
  declare fixRequestId: string;
  declare sourceAttempt: number;
  declare sourceExecutionId: string;
  declare batchId: string;
  declare candidateDigest: string;
  declare expectedBranch: string;
  declare expectedHeadSha: string;
  declare prNumber: number;
  declare evidence: PostWriteRecoveryInput['evidence'];
}

export interface VerifiedRecoveryEvidence {
  plannedFiles: string[];
  processedFindingIds: string[];
  candidateAcceptedFindingIds: string[];
  candidateVerifiedFiles: string[];
  updatedFiles: string[];
  commitShas: string[];
  fileResults: RecoveryReceipt[];
}

const sha = (value: unknown, size: 40 | 64): boolean =>
  new RegExp(`^[a-f0-9]{${size}}$`, 'i').test(String(value || ''));
const normalized = (values: unknown[]): string[] => [...new Set(values.map(String).map(v => v.trim()).filter(Boolean))].sort();

export function postWriteRecoveryIdentity(input: Pick<PostWriteRecoveryInput,
  'fixRequestId' | 'sourceAttempt' | 'sourceExecutionId' | 'batchId' | 'candidateDigest' | 'expectedBranch' | 'expectedHeadSha' | 'prNumber'>): string {
  return createHash('sha256').update([
    input.fixRequestId, input.sourceAttempt, input.sourceExecutionId, input.batchId,
    input.candidateDigest.toLowerCase(), input.expectedBranch, input.expectedHeadSha.toLowerCase(), input.prNumber,
  ].join('\n')).digest('hex');
}

export function computeRecoveryCandidateDigest(candidateBaseSha: string, files: RecoveryManifestFile[]): string {
  const canonicalFiles = files.map(file => ({ path: file.path, operation: file.operation, contentSha256: file.contentSha256.toLowerCase() }))
    .sort((a, b) => a.path.localeCompare(b.path));
  return createHash('sha256').update(JSON.stringify({ candidateBaseSha: candidateBaseSha.toLowerCase(), files: canonicalFiles })).digest('hex');
}

export function validatePostWriteRecoveryEvidence(input: PostWriteRecoveryInput, expectedFindingIds: string[]): VerifiedRecoveryEvidence {
  if (!input || !input.evidence || !sha(input.candidateDigest, 64) || !sha(input.expectedHeadSha, 40)
    || !Number.isInteger(input.sourceAttempt) || input.sourceAttempt < 1
    || !Number.isInteger(input.prNumber) || input.prNumber < 1
    || !input.fixRequestId || !input.sourceExecutionId || !input.batchId || !input.expectedBranch) {
    throw new BadRequestException({ code: 'POST_WRITE_RECOVERY_INPUT_INVALID' });
  }
  const { evidence } = input;
  if (!sha(evidence.candidateBaseSha, 40) || evidence.targetBranchName !== input.expectedBranch
    || computeRecoveryCandidateDigest(evidence.candidateBaseSha, evidence.files) !== input.candidateDigest.toLowerCase()) {
    throw new ConflictException({ code: 'POST_WRITE_RECOVERY_CANDIDATE_DIGEST_MISMATCH' });
  }
  if (!evidence.files.length || evidence.files.length !== evidence.receipts.length) {
    throw new ConflictException({ code: 'POST_WRITE_RECOVERY_BATCH_INCOMPLETE' });
  }
  const files = new Map<string, RecoveryManifestFile>();
  for (const file of evidence.files) {
    if (!file.path || files.has(file.path) || !['MODIFY', 'CREATE'].includes(file.operation) || !sha(file.contentSha256, 64)
      || (file.operation === 'MODIFY' && !sha(file.originalBlobSha, 40))
      || (file.operation === 'CREATE' && file.originalBlobSha !== null)) {
      throw new ConflictException({ code: 'POST_WRITE_RECOVERY_MANIFEST_INVALID', path: file.path || null });
    }
    files.set(file.path, file);
  }
  const expectedIds = normalized(expectedFindingIds);
  const seen = new Set<string>();
  for (const receipt of evidence.receipts) {
    const file = files.get(receipt.targetFile);
    if (!file || seen.has(receipt.targetFile) || receipt.fileOperation !== file.operation
      || receipt.contentSha256.toLowerCase() !== file.contentSha256.toLowerCase()
      || !sha(receipt.newSha, 40) || !sha(receipt.commitSha, 40)
      || (file.operation === 'MODIFY' && receipt.oldSha !== file.originalBlobSha)
      || (file.operation === 'CREATE' && receipt.oldSha !== null)
      || receipt.candidateStateVerified !== true || receipt.updateApplied !== true
      || receipt.outcome !== 'CANDIDATE_ACCEPTABLE_FOR_SCANNER_VALIDATION'
      || JSON.stringify(normalized(receipt.approvedFindingIds || [])) !== JSON.stringify(expectedIds)
      || JSON.stringify(normalized(receipt.processedFindingIds || [])) !== JSON.stringify(expectedIds)
      || JSON.stringify(normalized(receipt.candidateAcceptedFindingIds || [])) !== JSON.stringify(expectedIds)) {
      throw new ConflictException({ code: 'POST_WRITE_RECOVERY_RECEIPT_INVALID', path: receipt.targetFile || null });
    }
    seen.add(receipt.targetFile);
  }
  const validation = evidence.validation;
  if (validation?.compileMain !== 'PASS' || validation?.compileTests !== 'PASS' || validation?.fullTest !== 'PASS'
    || validation?.review !== 'PASS' || validation?.writeGuardOk !== true
    || validation?.provenDefectCount !== 0 || validation?.verificationRequiredCount !== 0 || validation?.noDefectCount < 1) {
    throw new ConflictException({ code: 'POST_WRITE_RECOVERY_VALIDATION_NOT_PROVEN' });
  }
  const paths = normalized([...files.keys()]);
  return {
    plannedFiles: paths,
    processedFindingIds: expectedIds,
    candidateAcceptedFindingIds: expectedIds,
    candidateVerifiedFiles: paths,
    updatedFiles: paths,
    commitShas: normalized(evidence.receipts.map(receipt => receipt.commitSha)),
    fileResults: evidence.receipts,
  };
}

export function isPostWriteFailureNode(value: unknown): boolean {
  return ['Validate Batch Completeness', 'Lookup Existing Batch PR', 'Select Existing PR', 'Existing PR?',
    'Use Existing PR', 'Create Pull Request1', 'Save Execution Result to Backend'].includes(String(value || ''));
}

export function commonPrCreatedFields(input: {
  prUrl: string; prNumber: number; prHeadSha: string; now: string; evidence: VerifiedRecoveryEvidence;
}): Record<string, unknown> {
  return {
    status: 'PR_CREATED', prUrl: input.prUrl, prNumber: input.prNumber, prHeadSha: input.prHeadSha,
    prCreatedAt: input.now, completenessPassed: true,
    processedFindingIds: input.evidence.processedFindingIds,
    candidateAcceptedFindingIds: input.evidence.candidateAcceptedFindingIds,
    candidateVerifiedFiles: input.evidence.candidateVerifiedFiles,
    plannedFiles: input.evidence.plannedFiles,
    fileResults: input.evidence.fileResults,
    updatedFiles: input.evidence.updatedFiles,
    commitShas: input.evidence.commitShas,
    retryEligible: false,
    validationTargetSha: null,
  };
}
