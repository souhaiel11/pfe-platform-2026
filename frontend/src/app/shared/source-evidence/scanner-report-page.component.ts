// Page dédiée affichant le contenu brut d'un rapport scanner local (Trivy/OWASP/ZAP), identifié par l'incident et le scanner dans l'URL.

import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { ApiService } from '../../core/services/api.service';

@Component({
  selector: 'app-scanner-report-page', standalone: true, imports: [CommonModule, RouterLink],
  template: `
    <div class="page-wrap report-page">
      <p class="eyebrow">RAPPORT SOURCE</p><h1>{{label()}}</h1>
      <p *ngIf="loading" role="status">Chargement du rapport…</p>
      <p *ngIf="error" class="report-error" role="alert">{{error}}</p>
      <button *ngIf="error" class="btn btn-secondary" (click)="load()">Réessayer</button>
      <ng-container *ngIf="report">
        <p>Build #{{report.buildNumber}} · {{report.filename}}</p>
        <dl>
          <dt>Chemin complet dans le stockage du backend</dt><dd><code>{{report.sourcePath}}</code></dd>
          <dt>Adresse de consultation</dt><dd><code>{{address()}}</code></dd>
          <dt>Empreinte SHA-256 du fichier</dt><dd><code>{{report.sha256}}</code></dd>
          <ng-container *ngIf="report.commitSha"><dt>Commit</dt><dd><code>{{report.commitSha}}</code></dd></ng-container>
        </dl>
        <div class="actions">
          <a class="btn btn-secondary" [routerLink]="['/projects', report.projectId]" [queryParams]="{tab:'securite'}">Retour au projet</a>
          <button class="btn btn-primary" (click)="download()">Télécharger le JSON</button>
        </div>
        <p class="hint">Contenu brut du fichier. Sa présence ne garantit pas la réussite du scan.</p>
        <pre tabindex="0" aria-label="Contenu brut du rapport JSON">{{report.content}}</pre>
      </ng-container>
    </div>
  `,
  styles: [`
    .report-page{max-width:1200px;margin:auto;min-width:0}.eyebrow{font:11px var(--font-mono);color:var(--atelier-copper)}
    h1{font-size:26px}dl{padding:18px;background:var(--bg-secondary);border:1px solid var(--border-color)}
    dt{font-size:12px;color:var(--text-secondary);margin-bottom:5px}dd{margin:0 0 16px;min-width:0}dd:last-child{margin-bottom:0}
    code{font:11px/1.7 var(--font-mono);overflow-wrap:anywhere}.actions{display:flex;flex-wrap:wrap;gap:10px;margin:18px 0}
    .hint{font-size:12px;color:var(--text-secondary)}pre{max-width:100%;box-sizing:border-box;overflow:auto;max-height:65vh;white-space:pre;
    padding:18px;background:var(--bg-secondary);border:1px solid var(--border-color);font:11px/1.6 var(--font-mono)}
    .report-error{color:var(--accent-red)}
  `],
})
export class ScannerReportPageComponent implements OnInit, OnDestroy {
  report: any = null;
  loading = false;
  error = '';
  incidentId = '';
  scanner = '';
  private params?: Subscription;
  private request?: Subscription;
  /** Initialise les dépendances et l’état de ce composant. */
  constructor(private route: ActivatedRoute, private api: ApiService) {}
  /** Lit l'incident et le scanner depuis l'URL et charge le rapport correspondant à chaque changement de paramètres. */
  ngOnInit() {
    this.params = this.route.paramMap.subscribe(params => {
      this.incidentId = params.get('incidentId') || '';
      this.scanner = params.get('scanner') || '';
      this.load();
    });
  }
  // Libère les abonnements RxJS à la destruction du composant.
  ngOnDestroy() { this.params?.unsubscribe(); this.request?.unsubscribe(); }
  // Traduit la clé technique du scanner en titre de page affiché.
  label() { return ({trivy:'Rapport Trivy',owasp:'Rapport OWASP Dependency-Check',zap:'Rapport ZAP'} as Record<string,string>)[this.scanner] || 'Rapport de sécurité'; }
  // Renvoie l'URL courante de la page, affichée comme adresse de consultation.
  address() { return typeof location !== 'undefined' ? location.href : ''; }
  /** Valide la forme de l'URL (UUID + nom de scanner connu) puis charge le rapport, en vérifiant que la réponse correspond bien à la demande. */
  load() {
    this.request?.unsubscribe(); this.report = null; this.error = ''; this.loading = false;
    const incidentId = this.incidentId, scanner = this.scanner;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(incidentId) || !['trivy','owasp','zap'].includes(scanner)) {
      this.error = 'Adresse de rapport invalide.'; return;
    }
    this.loading = true;
    this.request = this.api.getLocalScannerReport(incidentId, scanner).subscribe({
      /** Traite le résultat reçu et actualise les données locales. */
      next: report => {
        this.loading = false;
        if (this.incidentId !== incidentId || this.scanner !== scanner || report.incidentId !== incidentId || report.scanner !== scanner) {
          this.error = 'Le rapport reçu ne correspond pas à l’adresse demandée.'; return;
        }
        this.report = report;
      },
      /** Traite l’erreur reçue et termine le suivi de la demande. */
      error: () => { this.loading = false; this.error = 'Rapport absent, illisible ou accès indisponible. Vérifiez votre connexion et réessayez.'; },
    });
  }
  /** Déclenche le téléchargement du rapport JSON affiché, sous un nom de fichier identifiant le scanner et le build. */
  download() {
    if (!this.report) return;
    const url = URL.createObjectURL(new Blob([this.report.content], {type:'application/json;charset=utf-8'}));
    const link = document.createElement('a'); link.href = url;
    link.download = this.report.scanner + '-build-' + this.report.buildNumber + '.json';
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
