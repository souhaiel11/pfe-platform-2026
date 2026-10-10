import { ChangeDetectionStrategy, Component, Input, ViewEncapsulation } from '@angular/core';
import { renderChatMarkdown } from './chat-markdown';

@Component({
  selector: 'app-chat-markdown',
  standalone: true,
  template: '<div class="chat-markdown" [innerHTML]="html"></div>',
  styleUrls: ['./chat-markdown.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Generated HTML has no Angular scope attributes. All styles below are
  // explicitly scoped to app-chat-markdown, so other application tables stay unchanged.
  encapsulation: ViewEncapsulation.None,
})
export class ChatMarkdownComponent {
  html = '';

  @Input({ required: true })
  set content(value: string) {
    this.html = renderChatMarkdown(value);
  }
}
