/**
 * Child-process timeout signatures used by all build adapters.
 *
 * Node normally exposes a timeout as SIGTERM/killed, but wrappers such as
 * Maven can propagate the conventional 128 + SIGTERM exit code (143) while
 * omitting both fields. A null exit code at the timeout boundary is the final
 * conservative signature; an ordinary non-zero exit code remains a real
 * build/test failure.
 */
export function isProcessTimeout(
  error: any,
  status: number | null,
  durationMs: number,
  timeoutMs: number,
): boolean {
  const nearTimeout = status === null && durationMs >= Math.max(0, timeoutMs - 1000);
  return error?.signal === 'SIGTERM'
    || error?.killed === true
    || status === 143
    || nearTimeout;
}
