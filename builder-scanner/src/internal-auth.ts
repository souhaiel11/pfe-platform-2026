// Vérifie le secret des appels internes au constructeur et scanner.
import { timingSafeEqual } from 'crypto';

export const INTERNAL_AUTH_HEADER = 'x-internal-secret';

/** Vérifie le secret présenté par un appel interne. */
export function checkInternalAuth(headerValue: unknown, expectedSecret: string | undefined): boolean {
  if (!expectedSecret) return false;
  if (typeof headerValue !== 'string' || headerValue.length === 0) return false;
  const provided = Buffer.from(headerValue, 'utf8');
  const expected = Buffer.from(expectedSecret, 'utf8');
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}
