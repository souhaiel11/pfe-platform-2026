// Garde de routage qui réserve certaines pages aux comptes administrateur.
import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

/** Autorise la navigation si l'utilisateur connecté est admin, sinon le redirige vers /dashboard. */
export const adminGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  return auth.isAdmin ? true : inject(Router).createUrlTree(['/dashboard']);
};
