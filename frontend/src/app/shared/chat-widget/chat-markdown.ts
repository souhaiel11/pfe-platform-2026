// Convertit le texte markdown renvoyé par l'agent de chat en HTML affichable, avec un rendu de
// tableau scrollable et sans jamais exécuter de balisage HTML fourni dans le message.

import { Marked, Renderer } from 'marked';

// Échappe les caractères HTML sensibles pour afficher du texte brut sans jamais l'interpréter comme balisage.
const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]!));

const markdown = new Marked({
  async: false,
  gfm: true,
  breaks: true,
  renderer: {
    /** Produit le rendu HTML autorisé pour le chat. */
    html: ({ text }) => escapeHtml(text),
    /** Prépare le tableau pour son affichage. */
    table(token) {
      return `<div class="chat-table-scroll" tabindex="0" role="region" aria-label="Tableau de la réponse">${Renderer.prototype.table.call(this, token)}</div>`;
    },
  },
});

/** Convertit le markdown d'un message de chat en HTML (tableaux scrollables inclus) ; le HTML brut d'entrée est échappé, jamais exécuté. */
export function renderChatMarkdown(content: string): string {
  return markdown.parse(content, { async: false });
}
