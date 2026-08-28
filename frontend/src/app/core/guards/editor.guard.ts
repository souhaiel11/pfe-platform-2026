import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

export const editorGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  if (['admin', 'developer'].includes(auth.currentUser?.role)) return true;
  return inject(Router).createUrlTree(['/projects']);
};
