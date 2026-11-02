// Affiche le logo (masque SVG) de l'outil correspondant à un fournisseur de preuve, avec une icône générique de repli.

import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { sourceTool } from './tool-presentation';

@Component({
  selector:'app-tool-logo', standalone:true, imports:[CommonModule],
  template:`<span class="tool-logo" aria-hidden="true" [style.width.px]="size" [style.height.px]="size">
    <span *ngIf="mask(); else generic" class="tool-glyph" [style.mask-image]="mask()" [style.-webkit-mask-image]="mask()"></span>
    <ng-template #generic><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="m10 13 4-4m-6 6-2 2a3 3 0 0 1-4-4l4-4a3 3 0 0 1 4 0m4 0 2-2a3 3 0 0 1 4 4l-4 4a3 3 0 0 1-4 0"/></svg></ng-template>
  </span>`,
  styles:[`:host{display:inline-flex;flex:0 0 auto;vertical-align:middle}.tool-logo{display:inline-flex;align-items:center;justify-content:center;color:var(--text-primary)}.tool-glyph{display:block;width:100%;height:100%;background:currentColor;mask-size:contain;mask-position:center;mask-repeat:no-repeat;-webkit-mask-size:contain;-webkit-mask-position:center;-webkit-mask-repeat:no-repeat}svg{width:100%;height:100%}`],
})
export class ToolLogoComponent {
  @Input() provider: unknown = null;
  @Input() size = 20;
  /** Résout l'URL du masque SVG correspondant au fournisseur, ou null pour afficher l'icône générique de repli. */
  mask() { const icon=sourceTool(this.provider).icon;return icon ? `url("assets/tool-logos/${icon}.svg")` : null; }
}
