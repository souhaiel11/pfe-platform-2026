// Arrête les processus externes lorsqu’ils dépassent leur délai.
/** Vérifie l’état suivant : processus délai dépassé. */
/** Vérifie l’état suivant : processus délai dépassé. */
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
