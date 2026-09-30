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
