/** V1.7 final predeploy phase — Phase A: candidate-verifier -> builder-
 * scanner authentication. Pure unit tests for the shared-secret header
 * check, same style as the rest of this codebase (plain assertions, no
 * test framework). */
import * as assert from 'assert';
import { checkInternalAuth, INTERNAL_AUTH_HEADER } from './internal-auth';

assert.equal(INTERNAL_AUTH_HEADER, 'x-internal-secret');

// 1. NO_AUTH: header entirely absent -> rejected, even with a real secret configured.
assert.equal(checkInternalAuth(undefined, 'correct-secret'), false);

// 2. NO_AUTH: header present but empty string -> rejected.
assert.equal(checkInternalAuth('', 'correct-secret'), false);

// 3. BAD_AUTH: header present but wrong value -> rejected.
assert.equal(checkInternalAuth('wrong-secret', 'correct-secret'), false);

// 4. BAD_AUTH: header value differs only in length (never crashes on the
// length mismatch instead of comparing) -> rejected.
assert.equal(checkInternalAuth('correct-secret-but-longer', 'correct-secret'), false);
assert.equal(checkInternalAuth('short', 'correct-secret'), false);

// 5. Malformed credential: Node's http headers can be an array for a
// repeated header -- never treated as a string, always rejected.
assert.equal(checkInternalAuth(['correct-secret', 'correct-secret'], 'correct-secret'), false);

// 6. Malformed credential: wrong type entirely.
assert.equal(checkInternalAuth(12345 as any, 'correct-secret'), false);

// 7. Server-side secret unset/empty -> ALWAYS rejected, even a header that
// happens to equal the empty string (fail-closed: unconfigured never means
// "accept anything").
assert.equal(checkInternalAuth('anything', undefined), false);
assert.equal(checkInternalAuth('anything', ''), false);
assert.equal(checkInternalAuth('', ''), false);

// 8. VALID_AUTH: header present and exactly equal to the configured secret -> accepted.
assert.equal(checkInternalAuth('correct-secret', 'correct-secret'), true);

// 9. Case-sensitivity: not normalized, an exact match is required.
assert.equal(checkInternalAuth('Correct-Secret', 'correct-secret'), false);

console.log('internal-auth: PASS (NO_AUTH/BAD_AUTH/malformed all rejected, fail-closed on unset server secret, exact match accepted)');
