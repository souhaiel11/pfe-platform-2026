// Agrège les verdicts de régression en tenant compte de la comparabilité et de la disponibilité des scanners. Une preuve absente peut rendre le résultat indéterminé.
import type { HeadVerificationResult } from './merge-authorization';
import type { IdentifiedFinding, RegressionOutput, RegressionResult } from './pr-regression-engine';

export type ScannerComparability = 'PROVEN' | 'UNPROVEN';

export interface RegressionVerdictInput {
  headVerificationResult: HeadVerificationResult;
  scannerDiff: RegressionOutput;
  evidenceIntegrity: { ok: boolean; reasons: string[] };
  scannerComparability?: ScannerComparability;
}

export type RegressionBlockingCause =
  | { type: 'HEAD_CODE_FAILURE' }
  | { type: 'SCANNER_FINDING'; finding: IdentifiedFinding };

export interface RegressionAdvisory {
  code: string;
  message: string;
  findingRef?: IdentifiedFinding;
}

export interface RegressionVerdict {
  result: RegressionResult;
  blockingCauses: RegressionBlockingCause[];
  advisories: RegressionAdvisory[];
  decisionReasons: string[];
}

/** Combine la vérification HEAD et le diff scanner en un verdict unique. */
export function combineRegressionVerdict(input: RegressionVerdictInput): RegressionVerdict {
  const { headVerificationResult, scannerDiff, evidenceIntegrity } = input;
  if (headVerificationResult === 'CODE_FAILURE') {
    return {
      result: 'CHANGES_REQUIRED', blockingCauses: [{ type: 'HEAD_CODE_FAILURE' }],
      advisories: [], decisionReasons: ['HEAD_CODE_FAILURE'],
    };
  }
  if (headVerificationResult !== 'PASS') {
    return {
      result: 'INCONCLUSIVE', blockingCauses: [], advisories: [],
      decisionReasons: ['HEAD_VERIFICATION_INCONCLUSIVE'],
    };
  }
  if (evidenceIntegrity.ok !== true) {
    return {
      result: 'INCONCLUSIVE', blockingCauses: [], advisories: [],
      decisionReasons: ['EVIDENCE_INCOMPLETE', ...evidenceIntegrity.reasons],
    };
  }
  if (input.scannerComparability !== 'PROVEN') {
    return {
      result: 'CLEAN', blockingCauses: [],
      advisories: scannerDiff.introducedFindings.map(finding => ({
        code: 'SCANNER_FINDING_REVIEW_UNPROVEN_COMPARABILITY',
        message: 'Finding supplémentaire détecté, comparabilité non prouvée, à revoir.',
        findingRef: { ...finding },
      })),
      decisionReasons: ['HEAD_VERIFICATION_PASS', 'SCANNER_ADVISORY_ONLY_UNPROVEN_COMPARABILITY'],
    };
  }
  if (scannerDiff.result === 'INCONCLUSIVE') {
    return {
      result: 'INCONCLUSIVE', blockingCauses: [], advisories: [],
      decisionReasons: ['HEAD_VERIFICATION_PASS', 'SCANNER_DIFF_INCONCLUSIVE'],
    };
  }

  const remainingBlocking = [...scannerDiff.blockingIntroducedFindings];
  const advisories: RegressionAdvisory[] = [];
  for (const finding of scannerDiff.introducedFindings) {
    const index = remainingBlocking.findIndex(blocking =>
      blocking === finding || (
        blocking.fingerprint === finding.fingerprint && blocking.source === finding.source
        && blocking.rule === finding.rule && blocking.path === finding.path
        && blocking.message === finding.message && blocking.severity === finding.severity
        && blocking.line === finding.line
      ));
    if (index >= 0) remainingBlocking.splice(index, 1);
    else advisories.push({
      code: 'SCANNER_NON_BLOCKING_FINDING',
      message: 'Finding supplémentaire non bloquant détecté, à revoir.',
      findingRef: { ...finding },
    });
  }
  const blockingCauses: RegressionBlockingCause[] = scannerDiff.blockingIntroducedFindings
    .map(finding => ({ type: 'SCANNER_FINDING', finding: { ...finding } }));
  return {
    result: blockingCauses.length > 0 ? 'CHANGES_REQUIRED' : 'CLEAN',
    blockingCauses, advisories,
    decisionReasons: ['HEAD_VERIFICATION_PASS', blockingCauses.length > 0
      ? 'SCANNER_PROVEN_BLOCKING_FINDINGS' : 'SCANNER_PROVEN_NO_BLOCKING_FINDINGS'],
  };
}
