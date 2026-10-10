import { Marked, Renderer } from 'marked';

const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]!));

const markdown = new Marked({
  async: false,
  gfm: true,
  breaks: true,
  renderer: {
    // Display embedded HTML as text. Never execute markup supplied by a message.
    html: ({ text }) => escapeHtml(text),
    table(token) {
      return `<div class="chat-table-scroll" tabindex="0" role="region" aria-label="Tableau de la réponse">${Renderer.prototype.table.call(this, token)}</div>`;
    },
  },
});

// This returns an ordinary string, not trusted HTML. The component's Angular
// innerHTML binding sanitizes generated elements, attributes and link URLs.
export function renderChatMarkdown(content: string): string {
  return markdown.parse(content, { async: false });
}
