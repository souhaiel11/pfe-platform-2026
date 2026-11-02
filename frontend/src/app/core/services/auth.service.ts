// Gère la session utilisateur côté front : connexion, déconnexion, et exposition réactive du profil courant.
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { BehaviorSubject, tap } from 'rxjs';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private userSubject = new BehaviorSubject<any>(
    JSON.parse(localStorage.getItem('user') || 'null')
  );
  user$ = this.userSubject.asObservable();

  /** Injecte le client HTTP et le routeur utilisés par login()/logout(). */
  constructor(private http: HttpClient, private router: Router) {}

  /** Authentifie l'utilisateur, puis stocke le token JWT et le profil en localStorage et dans le flux réactif user$. */
  login(email: string, password: string) {
    return this.http.post<any>(`${environment.apiUrl}/auth/login`, { email, password }).pipe(
      tap(res => {
        localStorage.setItem('token', res.token);
        localStorage.setItem('user', JSON.stringify(res.user));
        this.userSubject.next(res.user);
      })
    );
  }

  /** Efface la session locale (token + profil) et renvoie l'utilisateur sur /login. */
  logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    this.userSubject.next(null);
    this.router.navigate(['/login']);
  }

  /** Profil de l'utilisateur actuellement connecté, ou null. */
  get currentUser() { return this.userSubject.value; }
  /** Indique si un token de session est présent en localStorage. */
  get isLoggedIn()  { return !!localStorage.getItem('token'); }
  /** Indique si l'utilisateur connecté a le rôle admin. */
  get isAdmin()     { return this.currentUser?.role === 'admin'; }
}
