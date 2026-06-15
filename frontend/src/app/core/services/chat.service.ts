import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  loading?: boolean;
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
  private readonly webhookUrl = `${environment.n8nUrl}/webhook/chat-agent`;
  private readonly defaultProjectId = environment.defaultProjectId;

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

    this.http.post<any>(this.webhookUrl, {
      question: question.trim(),
      projectId: projectId || this.defaultProjectId
    }).subscribe({
      next: res => {
        this.addMessage('assistant', res.answer || 'Réponse reçue.');
        this.loadingSubject.next(false);
      },
      error: () => {
        this.addMessage('assistant', '⚠️ Impossible de contacter l\'agent IA. Vérifiez que le workflow n8n est actif.');
        this.loadingSubject.next(false);
      }
    });
  }

  clearHistory() {
    this.messagesSubject.next([]);
  }

  private addMessage(role: 'user' | 'assistant', content: string) {
    const current = this.messagesSubject.value;
    this.messagesSubject.next([...current, { role, content, timestamp: new Date() }]);
  }
}
