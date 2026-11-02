// Widget flottant de ChatOps : affiche l'historique de conversation, la zone de saisie et les
// suggestions, et délègue tout l'état (ouverture, messages, envoi) au ChatService partagé.

import { Component, OnInit, OnDestroy, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { ChatService, ChatMessage } from '../../core/services/chat.service';
import { ChatMarkdownComponent } from './chat-markdown.component';

@Component({
  selector: 'app-chat-widget',
  standalone: true,
  imports: [CommonModule, FormsModule, ChatMarkdownComponent],
  templateUrl: './chat-widget.component.html',
  styleUrls: ['./chat-widget.component.scss'],
})
export class ChatWidgetComponent implements OnInit, OnDestroy {
  messages: ChatMessage[] = [];
  loading  = false;
  isOpen   = false;
  inputText = '';

  suggestions = [
    'Incidents en cours ?',
    'Dernières corrections ?',
    'Santé du projet ?',
    'Incidents Jenkins ?'
  ];

  private subs: Subscription[] = [];

  @ViewChild('messagesContainer') private container!: ElementRef;

  /** Initialise les dépendances et l’état de ce composant. */
  constructor(private chatService: ChatService) {}

  // S'abonne à l'état du service de chat (ouverture, messages, chargement) et fait défiler vers le dernier message à chaque mise à jour.
  ngOnInit() {
    this.subs.push(
      this.chatService.isOpen$.subscribe(v => this.isOpen = v),
      this.chatService.messages$.subscribe(m => {
        this.messages = m;
        setTimeout(() => this.scrollToBottom(), 50);
      }),
      this.chatService.loading$.subscribe(v => this.loading = v)
    );
  }

  // Ouvre ou referme le widget de chat.
  toggle()      { this.chatService.toggle(); }
  // Referme le widget de chat.
  close()       { this.chatService.close(); }
  // Vide l'historique de la conversation.
  clearChat()   { this.chatService.clearHistory(); }

  // Envoie le texte passé en paramètre, ou sinon le contenu du champ de saisie (si non vide), puis vide le champ.
  send(text?: string) {
    const q = text || this.inputText.trim();
    if (!q) return;
    this.inputText = '';
    this.chatService.sendMessage(q);
  }

  // Envoie le message sur Entrée seule (Maj+Entrée reste réservé au retour à la ligne).
  onKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.send();
    }
  }

  // Fait défiler la liste des messages jusqu'en bas, pour garder le dernier message visible.
  private scrollToBottom() {
    if (this.container?.nativeElement) {
      this.container.nativeElement.scrollTop = this.container.nativeElement.scrollHeight;
    }
  }

  // Libère les abonnements RxJS à la destruction du composant.
  ngOnDestroy() { this.subs.forEach(s => s.unsubscribe()); }
}
