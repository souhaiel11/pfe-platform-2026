/** Additive Phase 2A wire contract. Legacy rows may omit modern identity. */
export interface SecurityRemediationAttempt {
  attemptId?: string;
  attemptNumber?: number;
  attempt?: number;
  batchId?: string;
  status: string;
  reasonCode?: string | null;
  reasonMessage?: string | null;
  retryable?: boolean;
  startedAt?: string | null;
  finishedAt?: string | null;
  at?: string;
  executionId?: string | null;
  prUrl?: string | null;
  branchName?: string | null;
  candidateSha?: string | null;
  legacyAttempt?: boolean;
  verificationEvidence?: unknown;
}
export interface SecurityFindingRemediation extends Partial<SecurityRemediationAttempt> {
  attemptCount?: number;
  attempts?: SecurityRemediationAttempt[];
  reason?: string;
  prNumber?: number | null;
  unresolvedGitSideEffect?: boolean;
}
export interface SecurityRemediationTask {
  id: string;
  projectId?: string;
  source: string;
  findingFingerprint?: string;
  ruleOrCve?: string;
  status?: string;
  manualStatus?: string;
  scannerStatus?: string;
  projectFixVerified?: boolean;
  title?: string;
  severity?: string;
  remediationType?: string;
  findingSnapshot?: {
    ruleOrCve?: string; component?: string; legacyPackage?: string; pkg?: string; packageType?: string;
    fixedVersion?: string; currentVersion?: string; installedVersion?: string;
    fixedVersionSource?: string; fixedVersionUnavailableReason?: string;
    fixedVersionEvidence?: { trivyFixedVersionRaw?: string };
    title?: string; severity?: string;
  };
  securityFindingRemediation?: SecurityFindingRemediation | null;
  v1_8Decision?: { state?: string; requiresDeveloperReview?: boolean; installedVersion?: string; sandboxValidated?: boolean; targetCveClosed?: boolean; recommendedVersion?: string };
}
