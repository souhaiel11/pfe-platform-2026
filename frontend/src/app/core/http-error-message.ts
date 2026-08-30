import { HttpErrorResponse } from '@angular/common/http';

export function userHttpError(error: unknown, fallback = 'Une erreur est survenue. Veuillez réessayer.'): string {
  const status = error instanceof HttpErrorResponse ? error.status : Number((error as any)?.status || 0);
  const backendMessage = error instanceof HttpErrorResponse
    ? error.error?.message
    : (error as any)?.error?.message;
  if (status === 401) return 'Authentification requise. Veuillez vous reconnecter.';
  if (status === 403) return 'Vous n’avez pas l’autorisation d’effectuer cette action.';
  if (status === 409) {
    return typeof backendMessage === 'string' && backendMessage.trim()
      ? backendMessage.trim()
      : 'Une opération incompatible est déjà enregistrée pour cet élément.';
  }
  if (status === 404) return 'Ressource introuvable.';
  if (status >= 500) return 'Une erreur interne est survenue. Réessayez ou consultez les détails techniques.';
  if (status === 400) return 'La demande contient des informations invalides. Vérifiez les champs puis réessayez.';
  return fallback;
}
