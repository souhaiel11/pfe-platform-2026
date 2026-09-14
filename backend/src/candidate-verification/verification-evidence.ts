// R76 -- observability-only: extracts a small, bounded, redaction-safe
// summary from a real CandidateVerification, for the exact non-PASS case
// (see write-guard.ts). Never influences PASS/FAIL/INCONCLUSIVE semantics
// and never returns the full compiler/test log or workspace content --
// only what's needed to later tell FAIL apart from INCONCLUSIVE and which
// stage rejected the candidate.
import { CandidateVerification, VerificationEvidence } from './candidate-verification.types';

const MAX_EVIDENCE_LENGTH = 500;
const SECRET_PATTERN = /(token|password|secret|authorization|api[_-]?key)\s*[=:]\s*[^ ,;]+/ig;

/** Same redaction/truncation convention already used by WF2's failure-envelope nodes. */
export function redactAndCapEvidence(value: unknown, maxLength: number = MAX_EVIDENCE_LENGTH): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).replace(/[\r\n]+/g, ' ').replace(SECRET_PATTERN, '$1=[REDACTED]');
  if (!text.trim()) return null;
  return text.slice(0, maxLength);
}

export function buildVerificationEvidence(verification: CandidateVerification): VerificationEvidence {
  return {
    overall: verification?.overall ?? null,
    failureClass: verification?.failureClass ?? null,
    compile: {
      status: verification?.compile?.status ?? null,
      exitCode: typeof verification?.compile?.exitCode === 'number' ? verification.compile.exitCode : null,
      evidenceTail: redactAndCapEvidence(verification?.compile?.evidenceRef),
    },
    tests: {
      regressionStatus: verification?.tests?.regression?.status ?? null,
      evidenceTail: redactAndCapEvidence(verification?.tests?.regression?.evidenceRef),
    },
    staticAnalysis: {
      status: verification?.staticAnalysis?.status ?? null,
    },
  };
}
