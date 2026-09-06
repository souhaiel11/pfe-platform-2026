import * as assert from 'node:assert/strict';
import { resolveCandidateBaseSha, CandidateBaseShaResolutionError } from './candidate-base-sha';

const branchHead = 'a'.repeat(40);
const baseline = 'b'.repeat(40);

// --- Test 1: new-branch candidate uses baseline SHA ---
{
  const sha = resolveCandidateBaseSha({ remediationBranchExists: false, baselineSha: baseline });
  assert.equal(sha, baseline, 'Test 1 - no existing branch: candidateBaseSha = baseline/main SHA');
}

// --- Test 2: existing remediation branch candidate uses branch HEAD, never baseline ---
{
  const sha = resolveCandidateBaseSha({ remediationBranchExists: true, remediationBranchHeadSha: branchHead, baselineSha: baseline });
  assert.equal(sha, branchHead, 'Test 2 - existing branch: candidateBaseSha = branch HEAD, not baseline');
  assert.notEqual(sha, baseline, 'Test 2 - baseline is explicitly NOT used when the branch already exists');
}

// --- fail closed: branch claimed to exist but no HEAD supplied ---
assert.throws(
  () => resolveCandidateBaseSha({ remediationBranchExists: true, remediationBranchHeadSha: null, baselineSha: baseline }),
  CandidateBaseShaResolutionError,
  'branch exists but HEAD missing must fail closed, never silently fall back to baseline',
);

// --- fail closed: branch does not exist and no baseline supplied ---
assert.throws(
  () => resolveCandidateBaseSha({ remediationBranchExists: false, baselineSha: null }),
  CandidateBaseShaResolutionError,
  'no branch and no baseline must fail closed, never guess',
);

// --- fail closed: malformed SHA never accepted ---
assert.throws(
  () => resolveCandidateBaseSha({ remediationBranchExists: true, remediationBranchHeadSha: 'not-a-real-sha' }),
  CandidateBaseShaResolutionError,
  'a non-hex/wrong-length value is never accepted as a SHA',
);

console.log('candidate-base-sha: PASS');
