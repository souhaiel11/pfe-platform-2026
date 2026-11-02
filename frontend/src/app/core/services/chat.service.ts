// État et logique du widget ChatOps : historique de conversation, ouverture/fermeture, envoi des questions au proxy backend.
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, defer, finalize } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  loading?: boolean;
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

  private readonly chatUrl = `${environment.apiUrl}/chat/ask`;

  /** Injecte le client HTTP utilisé par sendMessage(). */
  constructor(private http: HttpClient) {}

  /** Ouvre/ferme le widget ChatOps ; envoie un message d'accueil à la première ouverture si l'historique est vide. */
  toggle() {
    const opening = !this.isOpenSubject.value;
    this.isOpenSubject.next(opening);
    if (opening && this.messagesSubject.value.length === 0) {
      this.addMessage('assistant',
        '👋 Bonjour ! Je suis votre assistant DevSecOps IA.\nPosez-moi une question sur vos incidents, corrections ou projets.'
      );
    }
  }

  /** Ferme le widget ChatOps. */
  close() { this.isOpenSubject.next(false); }

  /** Envoie la question au proxy ChatOps backend (qui relaie vers n8n), affiche la réponse ou un message d'erreur distinct si la requête échoue ou si la réponse est inutilisable. */
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
      /** Traite le résultat reçu et actualise les données locales. */
      next: res => {
        const response = res as { ok?: unknown; answer?: unknown } | null;
        const ok = response?.ok === true && typeof response.answer === 'string';
        const answer = ok ? (response!.answer as string).trim() : '';
        this.addMessage('assistant', answer || "Réponse indisponible. Vous pouvez réessayer.", !answer);
      },
      /** Traite l’erreur reçue et termine le suivi de la demande. */
      error: () => {
        this.addMessage('assistant', "Le service de discussion n'a pas pu répondre. Vous pouvez réessayer.", true);
      }
    });
  }

  /** Vide l'historique de conversation affiché (ne touche à aucune donnée serveur). */
  clearHistory() {
    this.messagesSubject.next([]);
  }

  /** Ajoute un message local au flux affiché, sans appel réseau. */
  private addMessage(role: 'user' | 'assistant', content: string, isError = false) {
    const current = this.messagesSubject.value;
    this.messagesSubject.next([...current, { role, content, timestamp: new Date(), isError }]);
  }
}
