// Composant d'affichage d'un message de chat : reçoit du texte markdown brut et le rend en HTML
// via [innerHTML], avec un style non encapsulé (dédié au balisage généré par le markdown).

import { ChangeDetectionStrategy, Component, Input, ViewEncapsulation } from '@angular/core';
import { renderChatMarkdown } from './chat-markdown';

@Component({
  selector: 'app-chat-markdown',
  standalone: true,
  template: '<div class="chat-markdown" [innerHTML]="html"></div>',
  styleUrls: ['./chat-markdown.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
})
export class ChatMarkdownComponent {
  html = '';

  // Reçoit le texte markdown brut d'un message et le convertit immédiatement en HTML affichable.
  @Input({ required: true })
  set content(value: string) {
    this.html = renderChatMarkdown(value);
  }
}
