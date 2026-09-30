import { HttpErrorResponse } from '@angular/common/http';

export function userHttpError(error: unknown, fallback = 'Une erreur est survenue. Veuillez réessayer.'): string {
  const status = error instanceof HttpErrorResponse ? error.status : Number((error as any)?.status || 0);
  const backendMessage = error instanceof HttpErrorResponse
    ? error.error?.message
    : (error as any)?.error?.message;
  if (status === 401) return 'Authentification requise. Veuillez vous reconnecter.';
  const code = String(backendMessage || (error as any)?.error?.code || '');
  if (code.includes('V1_8_EVIDENCE_STALE')) return 'La correction ne peut pas être lancée car les preuves de validation ne correspondent plus à la version actuelle du projet. Actualisez les données et faites vérifier la correction.';
  if ((status === 409 || status === 403) && typeof backendMessage === 'string' && /^(Déjà en cours|Conflit de propriété|La |Les |Une |Vous |Impossible |Cette )/.test(backendMessage) && !/[A-Z][A-Z0-9]+_[A-Z_]+/.test(backendMessage)) return backendMessage;
  if (status === 403) return 'Vous n’avez pas l’autorisation d’effectuer cette action.';
  if (status === 409) return 'Les données ont changé ou une opération incompatible est déjà enregistrée. Actualisez la page avant de réessayer.';
  if (status === 404) return 'Ressource introuvable.';
  if (status >= 500) return 'Une erreur interne est survenue. Réessayez ou consultez les détails techniques.';
  if (status === 400) return 'La demande contient des informations invalides. Vérifiez les champs puis réessayez.';
  return fallback;
}
