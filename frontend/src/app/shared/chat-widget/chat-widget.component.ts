import { Component, OnInit, OnDestroy, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { ChatService, ChatMessage } from '../../core/services/chat.service';

@Component({
  selector: 'app-chat-widget',
  standalone: true,
  // FIX: No HttpClientModule here — already provided globally in app.config.ts
  imports: [CommonModule, FormsModule],
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

  // FIX: Only inject ChatService — no direct HttpClient here
  constructor(private chatService: ChatService) {}

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

  toggle()      { this.chatService.toggle(); }
  close()       { this.chatService.close(); }
  clearChat()   { this.chatService.clearHistory(); }

  send(text?: string) {
    const q = text || this.inputText.trim();
    if (!q) return;
    this.inputText = '';
    this.chatService.sendMessage(q);
  }

  onKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.send();
    }
  }

  private scrollToBottom() {
    if (this.container?.nativeElement) {
      this.container.nativeElement.scrollTop = this.container.nativeElement.scrollHeight;
    }
  }

  ngOnDestroy() { this.subs.forEach(s => s.unsubscribe()); }
}
