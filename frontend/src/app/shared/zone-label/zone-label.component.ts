import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

// ─────────────────────────────────────────────────────────────────────
//  <app-zone-label> — déclare la NATURE d'une zone d'écran.
//
//  Deux natures, et une seule question à laquelle elles répondent :
//  « est-ce que j'ai quelque chose à faire ici, ou est-ce que je lis ? »
//
//    information — zone de lecture. Constats, mesures, preuves. Rien à
//                  décider, rien à déclencher. On peut la parcourir puis
//                  passer à autre chose.
//    action      — zone d'intervention humaine. Un bouton y engage la
//                  plateforme : approuver, corriger, relancer, autoriser,
//                  déployer, modifier une configuration.
//
//  Pourquoi le dire explicitement plutôt que de le laisser deviner : sur un
//  écran dense, un tableau de résultats et un panneau de décision se
//  ressemblent — même carte, même bordure, même densité. Le développeur doit
//  alors lire le contenu pour savoir s'il est concerné. L'étiquette répond
//  avant la lecture, et c'est tout son intérêt : elle réduit le coût
//  d'orientation, pas le volume d'information.
//
//  Discipline : l'étiquette décrit ce qui est VRAIMENT là. Une zone marquée
//  « action » doit contenir au moins un contrôle réellement actionnable par
//  l'utilisateur courant ; sinon elle est « information ». Une étiquette qui
//  mentirait sur ce point serait pire que pas d'étiquette — elle enverrait
//  chercher un bouton qui n'existe pas.
// ─────────────────────────────────────────────────────────────────────

export type ZoneKind = 'information' | 'action';

@Component({
  selector: 'app-zone-label',
  standalone: true,
  imports: [CommonModule],
  template: `
    <p class="zl" [attr.data-kind]="kind">
      <span class="zl-tag">
        <span class="zl-glyph" aria-hidden="true">{{ kind === 'action' ? '◆' : '◇' }}</span>
        {{ kind === 'action' ? 'Action' : 'Information' }}
      </span>
      <span class="zl-note" *ngIf="note">{{ note }}</span>
    </p>
  `,
  styles: [`
    .zl {
      display: flex; align-items: baseline; flex-wrap: wrap; gap: 4px 10px;
      margin: 0 0 12px; font-size: 11px; line-height: 1.5;
    }
    .zl-tag {
      display: inline-flex; align-items: center; gap: 5px; flex: 0 0 auto;
      padding: 2px 9px; border-radius: 999px;
      font-size: 10px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase;
      font-family: var(--font-mono);
      border: 1px solid currentColor;
    }
    .zl-glyph { font-size: 9px; }
    /* Repère non chromatique : le glyphe (◇ creux / ◆ plein) et le libellé
       portent la distinction, la couleur ne fait que la renforcer (§24). */
    .zl[data-kind="information"] .zl-tag { color: var(--text-muted); background: var(--bg-tertiary); }
    .zl[data-kind="action"]      .zl-tag { color: var(--accent-blue); background: var(--accent-blue-bg); }
    .zl-note { color: var(--text-muted); min-width: 0; }
  `],
})
export class ZoneLabelComponent {
  @Input() kind: ZoneKind = 'information';
  /** Phrase courte : ce qu'on lit ici, ou ce qu'on y engage. */
  @Input() note = '';
}
