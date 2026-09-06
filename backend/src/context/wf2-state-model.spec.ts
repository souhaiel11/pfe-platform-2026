import * as assert from 'node:assert/strict';
import { translateCurrentFixRequestStatus, CURRENT_FIX_REQUEST_STATUSES } from './wf2-state-model';

for (const status of CURRENT_FIX_REQUEST_STATUSES) {
  const translated = translateCurrentFixRequestStatus(status);
  assert.notEqual(translated, 'UNKNOWN', `every currently-real persisted status (${status}) must have a translation, not UNKNOWN`);
}
assert.equal(translateCurrentFixRequestStatus('SOMETHING_NEVER_PERSISTED'), 'UNKNOWN', 'an unrecognized status honestly reports UNKNOWN, never a guessed target state');
assert.equal(translateCurrentFixRequestStatus(undefined), 'UNKNOWN', 'undefined input reports UNKNOWN, never throws');

console.log('wf2-state-model translation: PASS');
