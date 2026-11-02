// Garde de routage qui réserve certaines pages aux rôles ayant le droit de modifier (admin/developer).
import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

/** Autorise la navigation si le rôle de l'utilisateur est admin ou developer, sinon redirige vers /projects. */
export const editorGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  if (['admin', 'developer'].includes(auth.currentUser?.role)) return true;
  return inject(Router).createUrlTree(['/projects']);
};
