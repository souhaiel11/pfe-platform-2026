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

  success(title: string, message?: string) { this.add('success', title, message); }
  error(title: string, message?: string)   { this.add('error', title, message); }
  info(title: string, message?: string)    { this.add('info', title, message); }
  warning(title: string, message?: string) { this.add('warning', title, message); }

  private add(type: Toast['type'], title: string, message?: string) {
    const id = Date.now().toString();
    const toast: Toast = { id, type, title, message };
    this.toastsSubject.next([...this.toastsSubject.value, toast]);
    setTimeout(() => this.remove(id), 4000);
  }

  remove(id: string) {
    this.toastsSubject.next(this.toastsSubject.value.filter(t => t.id !== id));
  }
}
