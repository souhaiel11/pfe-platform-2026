import * as assert from 'node:assert/strict';
import { assertRemoteHeadMatchesCandidateBase } from './remote-head-drift';

const sha = 'a'.repeat(40);

assert.deepEqual(assertRemoteHeadMatchesCandidateBase(sha, sha), { ok: true }, 'matching remote head accepted');
assert.deepEqual(assertRemoteHeadMatchesCandidateBase(sha.toUpperCase(), sha), { ok: true }, 'comparison is case-insensitive');
assert.deepEqual(
  assertRemoteHeadMatchesCandidateBase('b'.repeat(40), sha),
  { ok: false, failureClass: 'CANDIDATE_BASE_MOVED' },
  'a moved remote head is rejected as CANDIDATE_BASE_MOVED, never force-written over',
);
assert.deepEqual(
  assertRemoteHeadMatchesCandidateBase(null, sha),
  { ok: false, failureClass: 'CANDIDATE_BASE_MOVED' },
  'an unreadable/absent remote head fails closed the same way as a genuine mismatch, never treated as "no drift"',
);

console.log('remote-head-drift: PASS');
