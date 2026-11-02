// Gère l’affichage et les actions de source preuve liste.
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SourceEvidenceLinkComponent } from './source-evidence-link.component';
import { EvidenceLoadState, EvidenceSection, SourceEvidence } from './source-evidence.types';
import { ToolLogoComponent } from './tool-logo.component';
import { SourceTool, sourceTool } from './tool-presentation';

// Bloc « Sources & preuves » : rend les sections de preuve fournies par le backend (groupées par
// outil source), dans l'ordre fourni, en masquant par défaut les sections entièrement vides.

interface ToolEvidenceGroup { tool: SourceTool; sections: EvidenceSection[]; }

@Component({
  selector: 'app-source-evidence-list',
  standalone: true,
  imports: [CommonModule, SourceEvidenceLinkComponent, ToolLogoComponent],
  template: `
    <section class="sev-block" *ngIf="state !== 'ready' || sections?.length">
      <header class="sev-block-head" *ngIf="title">
        <h4 class="sev-block-title">{{ title }}</h4>
        <p class="sev-block-note" *ngIf="note && state === 'ready'">{{ note }}</p>
      </header>

      <!-- Chargement : des squelettes, jamais un état vide provisoire qui
           ressemblerait à « aucune source ». -->
      <ul class="sev-items" *ngIf="state === 'loading'" aria-busy="true">
        <li class="sev-item" *ngFor="let i of [1,2,3]">
          <app-source-evidence-link state="loading"></app-source-evidence-link>
        </li>
      </ul>

      <!-- Échec de requête ≠ absence de preuve (§17). On le dit, et on offre
           l'action qui peut le résoudre. -->
      <div class="sev-block-error" *ngIf="state === 'error'" role="alert">
        <p>Impossible de charger les sources de cet élément.</p>
        <button type="button" class="sev-block-retry" (click)="retry.emit()">Réessayer</button>
      </div>

      <div class="sev-tools" *ngIf="state === 'ready'">
        <article class="sev-tool" *ngFor="let group of toolGroups(); trackBy: trackTool" [attr.aria-label]="group.tool.name">
          <header class="sev-tool-head">
            <span class="sev-tool-mark"><app-tool-logo [provider]="group.tool.provider" [size]="25"></app-tool-logo></span>
            <div><h5>{{group.tool.name}}</h5><p>{{group.tool.description}}</p></div>
          </header>
          <div class="sev-tool-section" *ngFor="let section of group.sections; trackBy: trackSection" [attr.data-section]="section.id">
            <div class="sev-section-title">{{section.title}}</div>
            <ul class="sev-items">
              <li class="sev-item" *ngFor="let slot of section.slots; trackBy: trackSlot">
                <app-source-evidence-link [item]="slotOf(slot)" [showProvider]="false" [showReason]="showReason"></app-source-evidence-link>
              </li>
            </ul>
          </div>
        </article>
      </div>

      <!-- Vide discret (§15/§16) : une preuve facultative absente n'est pas un
           problème, et ne doit pas occuper l'écran comme s'il s'agissait d'une
           erreur. On ne laisse pas croire au succès pour autant. -->
      <p class="sev-block-empty" *ngIf="state === 'ready' && !visibleSections().length">
        Aucune source n’a été enregistrée pour cet élément.
      </p>
    </section>
  `,
  styles: [`
    .sev-block { border:1px solid var(--border-color);border-radius:6px;background:var(--bg-secondary);padding:20px; }
    .sev-block-head { margin-bottom: 18px; }
    .sev-block-title {
      margin: 0; font-size: 12px; font-weight: 600; letter-spacing: .03em;
      text-transform: uppercase; color: var(--text-secondary);
    }
    .sev-block-note { margin: 4px 0 0; font-size: 11px; color: var(--text-muted); }
    .sev-tools{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,255px),1fr));gap:14px;align-items:start}
    .sev-tool{min-width:0;padding:17px;border:1px solid var(--border-color);border-radius:5px;background:var(--bg-secondary)}
    .sev-tool-head{display:flex;align-items:center;gap:12px;margin-bottom:18px}.sev-tool-head>div{min-width:0}
    .sev-tool-mark{display:inline-flex;align-items:center;justify-content:center;width:43px;height:43px;flex:0 0 auto;background:var(--bg-tertiary);border:1px solid var(--border-color);border-radius:9px}
    .sev-tool-head h5{margin:0;font-size:14px;font-weight:600;line-height:1.4;color:var(--text-primary)}
    .sev-tool-head p{margin:3px 0 0;font-size:10px;line-height:1.5;color:var(--text-muted)}
    .sev-tool-section+.sev-tool-section{margin-top:13px;padding-top:12px;border-top:1px solid var(--border-color)}
    .sev-section-title {
      font-size: 10px; font-family: var(--font-mono); letter-spacing: .05em;
      text-transform: uppercase; color: var(--text-muted); margin-bottom: 8px;font-size:9px;
    }
    .sev-items { list-style: none; margin: 0; padding: 0; display: grid; gap: 5px; }
    .sev-item { display: flex; flex-wrap: wrap; align-items: center; min-width:0; }
    @media(max-width:600px){.sev-block{padding:15px}.sev-tool{padding:15px}.sev-tools{grid-template-columns:minmax(0,1fr)}}
    .sev-block-empty { margin: 0; font-size: 11px; color: var(--text-muted); font-style: italic; }
    .sev-block-error { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
    .sev-block-error p { margin: 0; font-size: 12px; color: var(--color-warning); }
    .sev-block-retry {
      border: 1px solid var(--color-warning); background: transparent; color: var(--color-warning);
      border-radius: 4px; padding: 2px 10px; font-size: 11px; cursor: pointer; font-family: inherit;
    }
    .sev-block-retry:hover { background: var(--bg-hover); }
  `],
})
export class SourceEvidenceListComponent {
  @Input() title: string | null = 'Sources & preuves';
  @Input() note: string | null = null;
  @Input() sections: EvidenceSection[] | null = null;
  @Input() slots: Record<string, SourceEvidence> | null = null;
  @Input() showProvider = true;
  @Input() showReason = false;
  /** Masque les sections entièrement dépourvues d'information de source. */
  @Input() hideEmptySections = true;
  /** État du chargement, distinct de la disponibilité des preuves (§17/§18). */
  @Input() state: EvidenceLoadState = 'ready';
  @Output() retry = new EventEmitter<void>();

  /** Résout un identifiant d'emplacement vers son évidence réelle, ou null si rien n'a été fourni pour ce slot. */
  slotOf(slot: string): SourceEvidence | null {
    return (this.slots && this.slots[slot]) || null;
  }

  /** Filtre les sections à afficher : ne garde que celles qui portent au moins un emplacement réellement disponible, si le masquage est actif. */
  visibleSections(): EvidenceSection[] {
    const sections = this.sections || [];
    if (!this.hideEmptySections) return sections;
    return sections.filter(section =>
      (section.slots || []).some(slot => {
        const item = this.slotOf(slot);
        return !!item && item.availability !== 'UNAVAILABLE';
      }));
  }

  // Regroupe les sections visibles par outil source (Jenkins/Sonar/Trivy…), en conservant pour chaque outil la section d'origine de chaque lien.
  toolGroups(): ToolEvidenceGroup[] {
    const groups = new Map<string, ToolEvidenceGroup>();
    for (const section of this.visibleSections()) {
      for (const slot of section.slots || []) {
        const item = this.slotOf(slot);
        if (!item) continue;
        const tool = sourceTool(item.provider);
        let group = groups.get(tool.key);
        if (!group) { group = {tool, sections:[]}; groups.set(tool.key, group); }
        let context = group.sections.find(value => value.id === section.id);
        if (!context) { context = {...section, slots:[]}; group.sections.push(context); }
        context.slots.push(slot);
      }
    }
    return [...groups.values()].filter(group => !this.hideEmptySections || group.sections.some(section => section.slots.some(slot => this.slotOf(slot)?.availability !== 'UNAVAILABLE')));
  }
  // Fonctions trackBy pour *ngFor, afin que Angular ne recrée pas les éléments de liste inutilement.
  trackTool(_index: number, group: ToolEvidenceGroup) { return group.tool.key; }
  /** Identifie Section. */
  trackSection(_index: number, section: EvidenceSection) { return section.id; }
  /** Identifie Slot. */
  trackSlot(_index: number, slot: string) { return slot; }
}
