// Garde de routage qui protège les pages nécessitant une session connectée.
import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

/** Vérifie la présence d'un token en localStorage ; sinon redirige vers /login en gardant l'URL cible pour y revenir après connexion. */
export const authGuard: CanActivateFn = (_route, state) => {
  const router = inject(Router);
  const token = localStorage.getItem('token');
  if (token) return true;
  return router.createUrlTree(['/login'], {queryParams: {returnUrl: state.url}});
};
