// Gère la pile de notifications toast affichées à l'écran : ajout, catégorisation, disparition automatique ou manuelle.
import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export interface Toast {
  id: string;
  type: 'success' | 'error' | 'info' | 'warning';
  title: string;
  message?: string;
}

@Injectable({ providedIn: 'root' })
export class ToastService {
  private toastsSubject = new BehaviorSubject<Toast[]>([]);
  toasts$ = this.toastsSubject.asObservable();

  /** Affiche un toast de succès. */
  success(title: string, message?: string) { this.add('success', title, message); }
  /** Affiche un toast d'erreur. */
  error(title: string, message?: string)   { this.add('error', title, message); }
  /** Affiche un toast d'information. */
  info(title: string, message?: string)    { this.add('info', title, message); }
  /** Affiche un toast d'avertissement. */
  warning(title: string, message?: string) { this.add('warning', title, message); }

  /** Ajoute un toast à la pile affichée et programme sa disparition automatique après 4 secondes. */
  private add(type: Toast['type'], title: string, message?: string) {
    const id = Date.now().toString();
    const toast: Toast = { id, type, title, message };
    this.toastsSubject.next([...this.toastsSubject.value, toast]);
    setTimeout(() => this.remove(id), 4000);
  }

  /** Retire un toast précis de la pile affichée (fermeture manuelle ou automatique). */
  remove(id: string) {
    this.toastsSubject.next(this.toastsSubject.value.filter(t => t.id !== id));
  }
}
