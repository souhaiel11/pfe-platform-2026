// V1.7 final predeploy phase — service-to-service authentication for
// candidate-verifier -> builder-scanner's one business route
// (POST /internal/build-scan). Reuses the SAME mechanism the codebase
// already uses one hop up (backend/src/auth/internal-secret.guard.ts /
// jwt-or-internal-secret.guard.ts: a single shared-secret header, checked
// with the server-side secret fail-closed if unset) rather than inventing
// a second kind of credential system (OAuth/mTLS/JWT) here. The header
// name is intentionally the SAME literal ('x-internal-secret') those two
// guards already use — that string is duplicated rather than imported
// from a shared module, exactly like those two guards themselves each
// already independently declare it; there is no existing shared-constants
// module for it in this codebase. The SECRET VALUE, however, is its own
// dedicated `BUILDER_INTERNAL_SECRET`, never the backend's own
// `N8N_INTERNAL_SECRET` — the two trust domains (n8n->backend,
// candidate-verifier->builder-scanner) stay independent, so a compromise
// of either secret cannot unlock the other.
import { timingSafeEqual } from 'crypto';

export const INTERNAL_AUTH_HEADER = 'x-internal-secret';

/**
 * Fail-closed by construction: an unset/empty server-side secret NEVER
 * accepts any header value (not even an empty one), and a missing/
 * malformed (non-string, e.g. a repeated-header array) header is always
 * rejected before any comparison is attempted.
 */
export function checkInternalAuth(headerValue: unknown, expectedSecret: string | undefined): boolean {
  if (!expectedSecret) return false;
  if (typeof headerValue !== 'string' || headerValue.length === 0) return false;
  const provided = Buffer.from(headerValue, 'utf8');
  const expected = Buffer.from(expectedSecret, 'utf8');
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}
