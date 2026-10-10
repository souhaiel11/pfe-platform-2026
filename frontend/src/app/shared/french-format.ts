export function frenchDate(value: string | number | Date | null | undefined, includeTime = true): string {
  if (value == null || value === '') return 'Non disponible';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Non disponible';
  return new Intl.DateTimeFormat('fr-FR', includeTime
    ? { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }
    : { day: 'numeric', month: 'long', year: 'numeric' }).format(date);
}
export function frenchDuration(seconds: unknown): string {
  if (seconds == null || !Number.isFinite(Number(seconds)) || Number(seconds) < 0) return 'Non disponible';
  const total = Math.round(Number(seconds));
  const hours = Math.floor(total / 3600), minutes = Math.floor(total % 3600 / 60), rest = total % 60;
  return [hours ? `${hours} h` : '', minutes ? `${minutes} min` : '', `${rest} s`].filter(Boolean).join(' ');
}
export function frenchNumber(value: number): string { return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(value); }

/**
 * Fraîcheur RELATIVE (« il y a 12 min ») — §19.
 *
 * Ne fabrique jamais de fraîcheur : une date absente ou illisible renvoie
 * null, et l'appelant affiche alors « Non disponible » plutôt qu'un « il y a
 * un instant » inventé. Une date dans le futur est rendue telle quelle par
 * l'appelant (horloge désynchronisée), jamais présentée comme récente.
 */
export function frenchRelative(value: string | number | Date | null | undefined, now: Date = new Date()): string | null {
  if (value === null || value === undefined || value === '') return null;
  const date = new Date(value as any);
  const time = date.getTime();
  if (!Number.isFinite(time)) return null;
  const seconds = Math.round((now.getTime() - time) / 1000);
  if (seconds < 0) return null;
  if (seconds < 60) return 'il y a moins d’une minute';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 31) return `il y a ${days} j`;
  const months = Math.floor(days / 30);
  if (months < 12) return `il y a ${months} mois`;
  return `il y a ${Math.floor(days / 365)} an(s)`;
}
