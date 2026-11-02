// Intercepteur HTTP global : attache le token JWT à chaque requête sortante et gère la déconnexion automatique en cas de session invalide.
import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';

/** Ajoute le Bearer token aux requêtes sortantes (sauf login/register et n8n), et déconnecte l'utilisateur si le backend signale un token expiré ou invalide. */
export const jwtInterceptor: HttpInterceptorFn = (req, next) => {
  const router = inject(Router);
  const token = localStorage.getItem('token');

  const PUBLIC_AUTH_PATHS = ['/auth/login', '/auth/register'];
  const isPublic = PUBLIC_AUTH_PATHS.some(p => req.url.endsWith(p)) || req.url.includes('5678');
  const cloned = (token && !isPublic)
    ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
    : req;

  return next(cloned).pipe(
    catchError((err: HttpErrorResponse) => {
      const code = err.error?.code;
      if (err.status === 401 && (code === 'TOKEN_EXPIRED' || code === 'TOKEN_INVALID')) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        router.navigate(['/login']);
      }
      return throwError(() => err);
    })
  );
};
