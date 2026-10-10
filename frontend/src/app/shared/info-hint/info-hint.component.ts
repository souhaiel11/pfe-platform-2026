import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

// ─────────────────────────────────────────────────────────────────────
//  <app-info-hint term="provenance"> — aide contextuelle COURTE (§22).
//
//  Une phrase, dans l'infobulle native, sur les concepts qu'un développeur
//  qui arrive sur la plateforme n'a pas de raison de connaître. Pas de
//  paragraphe pédagogique dans une interface d'exploitation : si l'explication
//  ne tient pas en une phrase, elle appartient à la documentation.
//
//  Accessible : c'est un <button> atteignable au clavier, avec un
//  aria-label qui porte le texte complet (une infobulle `title` seule n'est
//  pas annoncée de façon fiable).
// ─────────────────────────────────────────────────────────────────────

export const GLOSSARY: Record<string, string> = {
  'quality-gate': 'Contrôle qualité SonarQube : un ensemble de conditions évaluées sur le code nouveau. « Réussi » ne signifie pas « aucun problème ».',
  provenance: 'Preuve que l’image publiée a bien été construite depuis le commit annoncé. Non vérifiée, l’image ne peut pas être déployée.',
  digest: 'Empreinte immuable du contenu de l’image (sha256). Contrairement au tag, elle ne peut pas être réattribuée à d’autres octets.',
  sast: 'Analyse statique : lit le code source sans l’exécuter (SonarQube).',
  sca: 'Analyse de composition : recherche des vulnérabilités connues dans les dépendances (Trivy, OWASP Dependency-Check).',
  dast: 'Analyse dynamique : teste l’application en cours d’exécution (ZAP).',
  'deployment-governance': 'Décision de la plateforme autorisant ou refusant un déploiement, recalculée côté serveur à chaque demande.',
  'security-score': 'Score technique calculé à partir des résultats de scan réels. Il vaut « non disponible » si un scanner requis n’a pas produit de résultat.',
  'merge-authorization': 'Verdict de la validation post-PR : il indique si la correction a été prouvée sur le commit exact de la Pull Request.',
};

@Component({
  selector: 'app-info-hint',
  standalone: true,
  imports: [CommonModule],
  template: `
    <button *ngIf="text()" type="button" class="ih"
            [attr.title]="text()" [attr.aria-label]="text()">
      <span aria-hidden="true">?</span>
    </button>
  `,
  styles: [`
    .ih {
      display: inline-flex; align-items: center; justify-content: center;
      width: 14px; height: 14px; padding: 0; margin-left: 4px;
      border: 1px solid var(--border-light); border-radius: 50%;
      background: transparent; color: var(--text-muted);
      font-size: 9px; font-weight: 700; line-height: 1; cursor: help;
      font-family: inherit; vertical-align: middle; flex: 0 0 auto;
    }
    .ih:hover, .ih:focus-visible { color: var(--accent-blue); border-color: var(--accent-blue); }
  `],
})
export class InfoHintComponent {
  @Input() term = '';
  /** Texte imposé, pour un concept hors glossaire partagé. */
  @Input() hint: string | null = null;

  /** Un terme inconnu n'affiche RIEN plutôt qu'un point d'interrogation vide. */
  text(): string | null {
    return this.hint || GLOSSARY[this.term] || null;
  }
}
