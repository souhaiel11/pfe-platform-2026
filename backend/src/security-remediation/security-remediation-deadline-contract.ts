// Centralise les budgets de temps et contraintes de délai entre phases de remédiation pour éviter qu'un appel externe consomme tout le temps disponible.
export const WORKER_DEADLINE_MS = 900_000;

// Below this remaining budget, an expensive operation is refused outright
// rather than attempted -- shared by the worker's own deadline
// (candidate-verifier/src/worker-deadline.ts) AND the dedicated builder's
// scan/build stage gating (builder-scanner/src/security-artifact-validator.ts),
// so both sides agree on the same floor.
export const MIN_STAGE_BUDGET_MS = 1_000;

export const BACKEND_TRANSPORT_SLACK_MS = 10_000;

// Derived, never a second hand-maintained literal: BACKEND_HTTP_TIMEOUT_MS
// must always be strictly greater than WORKER_DEADLINE_MS by exactly
// BACKEND_TRANSPORT_SLACK_MS -- there must never be a state where the
// worker is legitimately still processing but the backend has already
// timed out.
export const BACKEND_HTTP_TIMEOUT_MS = WORKER_DEADLINE_MS + BACKEND_TRANSPORT_SLACK_MS;
