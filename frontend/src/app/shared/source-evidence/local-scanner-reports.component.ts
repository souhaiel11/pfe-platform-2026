// Affiche, par scanner (Trivy/OWASP/ZAP), si un rapport JSON local existe pour le build et permet
// de le consulter/télécharger dans une visionneuse modale.

import { Component, Input, OnChanges, OnDestroy, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { EvidenceLoadState, LocalScannerReportInfo, localScannerReportUrl } from './source-evidence.types';
import { ToolLogoComponent } from './tool-logo.component';

@Component({
  selector: 'app-local-scanner-reports', standalone: true, imports: [CommonModule, ToolLogoComponent],
  template: `
    <section class="local-reports" aria-labelledby="local-reports-title">
      <header><div><p class="eyebrow">FICHIERS SOURCE / JSON</p><h3 id="local-reports-title">Rapports locaux du build</h3></div></header>
      <p class="intro">Fichiers produits par les scanners et conservés dans le stockage local des rapports. Leur présence ne garantit pas la réussite du scan.</p>
      <p *ngIf="state === 'loading'" role="status">Chargement des sources locales…</p>
      <p *ngIf="state === 'error'" role="alert">Les sources locales n’ont pas pu être chargées.</p>
      <div class="report-grid" *ngIf="state === 'ready'">
        <article *ngFor="let scanner of scanners">
          <header class="scanner-head"><span class="scanner-mark"><app-tool-logo [provider]="scanner.key.toUpperCase()" [size]="25"></app-tool-logo></span><div><h4>{{scanner.label}}</h4><p>{{scanner.description}}</p></div></header>
          <ng-container *ngIf="info(scanner.key) as report; else absent">
            <ng-container *ngIf="report.available; else unavailable">
              <span class="availability">Fichier local disponible</span>
              <a *ngIf="reportUrl(scanner.key) as url" class="report-link" [href]="url" [attr.title]="url" target="_blank" rel="noopener noreferrer">Voir le rapport {{scanner.label}} <span aria-hidden="true">↗</span><span class="sr-only"> (nouvel onglet)</span></a>
              <button type="button" class="btn btn-secondary btn-sm" (click)="open(scanner.key)" [disabled]="opening !== null || !incidentId"
                [attr.aria-label]="'Consulter le rapport local ' + scanner.label">{{opening === scanner.key ? 'Ouverture…' : 'Aperçu du JSON'}}</button>
              <details class="report-location"><summary>Emplacement du fichier</summary><p>Chemin complet dans le stockage du backend</p><code>{{report.sourcePath}}</code></details>
              <span class="size">JSON · {{formatBytes(report.bytes)}}</span>
            </ng-container>
            <ng-template #unavailable><p class="unavailable">{{report.reason || 'Rapport local absent pour ce build.'}}</p></ng-template>
          </ng-container>
          <ng-template #absent><p class="unavailable">Aucune source locale déclarée pour cette analyse.</p></ng-template>
        </article>
      </div>
      <p *ngIf="error" class="report-error" role="alert">{{error}}</p>
    </section>
    <dialog #viewer aria-labelledby="report-viewer-title" (close)="selected = null" (cancel)="close()" (keydown.escape)="close(); $event.preventDefault(); $event.stopPropagation()">
      <ng-container *ngIf="selected">
        <header class="viewer-head"><div><p class="eyebrow">SOURCE LOCALE / BUILD #{{selected.buildNumber}}</p><h3 id="report-viewer-title">{{scannerLabel(selected.scanner)}} · {{selected.filename}}</h3></div><button type="button" class="btn btn-secondary btn-sm" (click)="close()" autofocus>Fermer</button></header>
        <dl><div><dt>Fichier</dt><dd><code>{{selected.sourcePath}}</code></dd></div><div><dt>Empreinte SHA-256</dt><dd><code>{{selected.sha256}}</code></dd></div><div *ngIf="selected.commitSha"><dt>Commit</dt><dd><code>{{selected.commitSha}}</code></dd></div></dl>
        <div class="viewer-actions"><span>{{formatBytes(selected.bytes)}} · Contenu brut du fichier JSON</span><button type="button" class="btn btn-primary btn-sm" (click)="download()">Télécharger le JSON</button></div>
        <pre tabindex="0" aria-label="Contenu brut du rapport local">{{selected.content}}</pre>
      </ng-container>
    </dialog>
  `,
  styles: [`
    :host{display:block;margin:20px 0} .local-reports{padding:22px;border:1px solid var(--border-color);border-top:2px solid var(--atelier-copper);background:var(--bg-secondary);border-radius:4px}
    .eyebrow{font:9px var(--font-mono);letter-spacing:.12em;color:var(--atelier-copper);margin:0 0 8px}h3{font-size:17px;font-weight:500;margin:0}h4{font-size:14px;margin:0 0 10px}.intro{font-size:12px;line-height:1.7;color:var(--text-secondary);margin:12px 0 18px}
    .report-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.report-grid article{min-width:0;border:1px solid var(--border-color);border-radius:5px;padding:18px;display:flex;align-items:flex-start;flex-direction:column;background:var(--bg-secondary)}
    code{font:10px/1.7 var(--font-mono);overflow-wrap:anywhere}.availability{font-size:11px;color:var(--accent-green);margin-bottom:6px}.size{font:10px var(--font-mono);color:var(--text-muted);margin:8px 0 14px}.unavailable{font-size:12px;color:var(--text-muted);line-height:1.7}.report-error{font-size:12px;color:var(--accent-red);margin-top:14px}
    .scanner-head{display:flex;align-items:center;gap:11px;margin-bottom:18px;min-width:0}.scanner-head>div{min-width:0}.scanner-head h4{margin:0;font-size:13px;line-height:1.45}.scanner-head p{font-size:10px;line-height:1.5;color:var(--text-muted);margin:3px 0 0}.scanner-mark{display:inline-flex;align-items:center;justify-content:center;width:43px;height:43px;flex:0 0 auto;border-radius:9px;border:1px solid var(--border-color);background:var(--bg-tertiary)}
    .report-link{display:inline-flex;align-items:center;gap:6px;margin:11px 0;max-width:100%;font-size:12px;font-weight:500;line-height:1.6;color:var(--accent-blue);text-decoration:none;overflow-wrap:anywhere}.report-link:hover{text-decoration:underline;text-underline-offset:4px}.report-link:focus-visible{outline:2px solid var(--accent-blue);outline-offset:4px}
    .report-location{width:100%;min-width:0;margin-top:16px;padding-top:12px;border-top:1px solid var(--border-color);font-size:10px;color:var(--text-muted)}.report-location summary{cursor:pointer;line-height:1.6}.report-location p{font-size:10px;margin:9px 0 4px}.report-location code{display:block;color:var(--text-secondary);font-size:10px}.size{margin:10px 0 0}.report-grid .btn{font-size:10px;padding:5px 9px;color:var(--text-secondary)}
    dialog{color:var(--text-primary);background:var(--bg-secondary);border:1px solid var(--border-light);border-radius:8px;padding:24px;width:min(1000px,calc(100vw - 32px));max-height:calc(100dvh - 32px);margin:auto;overflow:auto}dialog::backdrop{background:#101b17bd}.viewer-head,.viewer-actions{display:flex;justify-content:space-between;align-items:center;gap:14px}.viewer-head h3{overflow-wrap:anywhere}dl{margin:20px 0;padding:14px;background:var(--bg-tertiary)}dl>div{display:grid;grid-template-columns:130px minmax(0,1fr);gap:12px;margin:4px 0}dt{font-size:11px;color:var(--text-secondary)}dd{margin:0;min-width:0}.viewer-actions{font-size:11px;color:var(--text-secondary);margin-bottom:12px}pre{font:11px/1.6 var(--font-mono);padding:18px;background:var(--bg-primary);border:1px solid var(--border-color);overflow:auto;max-height:50dvh;white-space:pre;margin:0}
    @media(max-width:720px){.report-grid{grid-template-columns:minmax(0,1fr)}.local-reports{padding:16px}dialog{padding:16px}.viewer-head{align-items:flex-start}.viewer-head h3{font-size:14px}dl>div{grid-template-columns:minmax(0,1fr);gap:2px}.viewer-actions{align-items:flex-start;flex-direction:column}}
  `]
})
export class LocalScannerReportsComponent implements OnChanges, OnDestroy {
  @Input() incidentId: string | null = null;
  @Input() reports: LocalScannerReportInfo[] = [];
  @Input() state: EvidenceLoadState = 'loading';
  @ViewChild('viewer', { static: true }) viewer!: ElementRef<HTMLDialogElement>;
  readonly scanners = [{key: 'trivy', label: 'Trivy', description:'Images et composants'}, {key: 'owasp', label: 'OWASP Dependency-Check', description:'Dépendances du projet'}, {key: 'zap', label: 'ZAP', description:'Sécurité de l’application'}];
  opening: string | null = null;
  error = '';
  selected: any = null;
  private request?: Subscription;
  /** Initialise les dépendances et l’état de ce composant. */
  constructor(private api: ApiService) {}
  /** Change d'incident : annule toute requête en cours et referme la visionneuse pour ne jamais montrer le rapport du mauvais build. */
  ngOnChanges() { this.request?.unsubscribe(); this.opening = null; this.error = ''; this.close(); }
  // Annule toute requête en cours et referme la visionneuse à la destruction du composant.
  ngOnDestroy() { this.request?.unsubscribe(); this.close(); }
  // Renvoie l'entrée de rapport correspondant à un scanner donné, si connue.
  info(scanner: string) { return this.reports?.find(r => r.scanner === scanner); }
  /** Construit le lien direct vers le rapport local, uniquement si un fichier est réellement disponible pour cet incident. */
  reportUrl(scanner: string) { return this.incidentId && this.info(scanner)?.available ? localScannerReportUrl(`/scanner-reports/${this.incidentId}/${scanner}`) : null; }
  // Traduit la clé technique d'un scanner en libellé affiché.
  scannerLabel(scanner: string) { return this.scanners.find(s => s.key === scanner)?.label || 'Rapport'; }
  /** Formate une taille en octets/Ko lisible ; renvoie une chaîne vide si la taille est inconnue. */
  formatBytes(bytes: number | null) { return bytes == null ? '' : bytes < 1024 ? bytes + ' octets' : Math.round(bytes / 1024) + ' Ko'; }
  // Referme la visionneuse modale et efface le rapport sélectionné.
  close() { this.viewer?.nativeElement?.close(); this.selected = null; }
  /** Charge le contenu brut du rapport local demandé et l'affiche dans la visionneuse, en vérifiant que la réponse correspond bien à l'incident/scanner demandés. */
  open(scanner: string) {
    if (!this.incidentId || this.opening || !this.info(scanner)?.available) return;
    const incidentId = this.incidentId;
    this.opening = scanner; this.error = '';
    this.request = this.api.getLocalScannerReport(incidentId, scanner).subscribe({
      /** Traite le résultat reçu et actualise les données locales. */
      next: report => {
        this.opening = null;
        if (this.incidentId !== incidentId || report.incidentId !== incidentId || report.scanner !== scanner) { this.error = 'La source reçue ne correspond pas à l’analyse sélectionnée.'; return; }
        this.selected = report;
        this.viewer.nativeElement.showModal();
        setTimeout(() => { if (this.viewer.nativeElement.open) this.viewer.nativeElement.querySelector<HTMLButtonElement>('.viewer-head button')?.focus(); });
      },
      /** Traite l’erreur reçue et termine le suivi de la demande. */
      error: () => { this.opening = null; this.error = 'Impossible d’ouvrir ce rapport local. Le fichier a peut-être été retiré ou est illisible.'; }
    });
  }
  /** Déclenche le téléchargement du rapport JSON actuellement affiché, sous un nom de fichier identifiant le scanner et le build. */
  download() {
    if (!this.selected) return;
    const url = URL.createObjectURL(new Blob([this.selected.content], {type:'application/json;charset=utf-8'}));
    const link = document.createElement('a'); link.href = url;
    link.download = this.selected.scanner + '-build-' + this.selected.buildNumber + '.json';
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
