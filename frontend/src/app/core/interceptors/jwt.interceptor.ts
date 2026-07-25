import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';

export const jwtInterceptor: HttpInterceptorFn = (req, next) => {
  const router = inject(Router);
  const token = localStorage.getItem('token');

  // Do not add token for auth endpoints or n8n webhooks
  const isPublic = req.url.includes('/auth/') || req.url.includes('5678');
  const cloned = (token && !isPublic)
    ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
    : req;

  return next(cloned).pipe(
    catchError((err: HttpErrorResponse) => {
      // Only purge the session on a real JWT problem (expired/invalid token),
      // as reported explicitly by the backend. A generic 401 (e.g. a
      // misconfigured guard on some route) must not log the user out.
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
