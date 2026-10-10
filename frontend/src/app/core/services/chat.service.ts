import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, defer, finalize } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  loading?: boolean;
  /** True only for a client-side failure fallback (HTTP error, or a 200
   * response the backend itself marked unusable) -- never for a real
   * assistant answer, so the UI can tell the two apart instead of
   * rendering a failed request as if it were a normal reply. */
  isError?: boolean;
}

@Injectable({ providedIn: 'root' })
export class ChatService {
  private isOpenSubject   = new BehaviorSubject<boolean>(false);
  private messagesSubject = new BehaviorSubject<ChatMessage[]>([]);
  private loadingSubject  = new BehaviorSubject<boolean>(false);

  isOpen$   = this.isOpenSubject.asObservable();
  messages$ = this.messagesSubject.asObservable();
  loading$  = this.loadingSubject.asObservable();

  // FIX: production webhook URL (not /webhook-test/)
  private readonly chatUrl = `${environment.apiUrl}/chat/ask`;

  constructor(private http: HttpClient) {}

  toggle() {
    const opening = !this.isOpenSubject.value;
    this.isOpenSubject.next(opening);
    if (opening && this.messagesSubject.value.length === 0) {
      this.addMessage('assistant',
        '👋 Bonjour ! Je suis votre assistant DevSecOps IA.\nPosez-moi une question sur vos incidents, corrections ou projets.'
      );
    }
  }

  close() { this.isOpenSubject.next(false); }

  sendMessage(question: string, projectId?: string) {
    if (!question.trim() || this.loadingSubject.value) return;

    this.addMessage('user', question);
    this.loadingSubject.next(true);

    defer(() => this.http.post<unknown>(this.chatUrl, {
      question: question.trim(),
      ...(projectId ? { projectId } : {})
    })).pipe(
      finalize(() => this.loadingSubject.next(false)),
    ).subscribe({
      next: res => {
        const response = res as { ok?: unknown; answer?: unknown } | null;
        const ok = response?.ok === true && typeof response.answer === 'string';
        const answer = ok ? (response!.answer as string).trim() : '';
        this.addMessage('assistant', answer || "Réponse indisponible. Vous pouvez réessayer.", !answer);
      },
      error: () => {
        this.addMessage('assistant', "Le service de discussion n'a pas pu répondre. Vous pouvez réessayer.", true);
      }
    });
  }

  clearHistory() {
    this.messagesSubject.next([]);
  }

  private addMessage(role: 'user' | 'assistant', content: string, isError = false) {
    const current = this.messagesSubject.value;
    this.messagesSubject.next([...current, { role, content, timestamp: new Date(), isError }]);
  }
}
