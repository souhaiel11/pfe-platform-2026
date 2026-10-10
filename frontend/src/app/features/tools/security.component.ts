import { securitySummaryForDisplay } from '../../shared/data-truth';
import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { ProjectEventsService } from '../../core/services/project-events.service';
import { InfoHintComponent } from '../../shared/info-hint/info-hint.component';
import { ZoneLabelComponent } from '../../shared/zone-label/zone-label.component';

@Component({
  selector: 'app-security',
  standalone: true,
  imports: [CommonModule, InfoHintComponent, ZoneLabelComponent],
  template: `
    <div class="page">
      <div class="page-header">
        <div class="page-icon" style="background:var(--accent-red-bg)"><i class="ti ti-shield-check" aria-hidden="true" style="color:var(--accent-red)"></i></div>
        <div>
          <h2>Sécurité — Trivy &amp; OWASP</h2>
          <div class="page-sub">Vue plateforme : dernière analyse de chaque projet. Observations cumulées Trivy et OWASP ; une CVE peut apparaître dans les deux sources.</div>
        </div>
      </div>

      <app-zone-label kind="information"
        note="Vue agrégée des scanners. Les corrections se demandent sur la page du projet concerné."></app-zone-label>

      <!-- §18 — patron de chargement standard, pas une ligne de texte. -->
      <div class="card" *ngIf="loading">
        <div class="loading-overlay" role="status"><div class="spinner"></div><span>Chargement des résultats…</span></div>
      </div>

      <!-- §17 — un échec de requête n'est pas « aucune vulnérabilité ». -->
      <div class="card" *ngIf="!loading && loadError" role="alert">
        <div class="empty-state">
          <div class="empty-icon"><i class="ti ti-plug-connected-x" aria-hidden="true"></i></div>
          <div class="empty-title">Impossible de charger les résultats de sécurité</div>
          <div class="empty-sub">{{loadError}}</div>
          <button class="btn btn-secondary btn-sm" style="margin-top:14px;" (click)="load()">Réessayer</button>
        </div>
      </div>

      <!-- §27 — une carte « Observations moyennes » affichait un « Non
           disponible » codé en dur, sans source ni calcul derrière : retirée
           plutôt que maintenue comme décor. -->
      <div class="kpi-grid" *ngIf="!loading && summary">
        <div class="kpi r"><div class="kpi-l">CVE critiques</div><div class="kpi-v">{{summary.totalCriticalCves ?? 'Non disponible'}}</div></div>
        <div class="kpi o"><div class="kpi-l">CVE élevées</div><div class="kpi-v">{{summary.totalHighCves ?? 'Non disponible'}}</div></div>
        <div class="kpi o"><div class="kpi-l">Alertes ZAP élevées<app-info-hint term="dast"></app-info-hint></div><div class="kpi-v">{{summary.zapHighAlerts ?? 'Non disponible'}}</div></div>
        <div class="kpi o"><div class="kpi-l">Alertes ZAP moyennes</div><div class="kpi-v">{{summary.zapMediumAlerts ?? 'Non disponible'}}</div></div>
        <div class="kpi">
          <div class="kpi-l">Score moyen<app-info-hint term="security-score"></app-info-hint></div>
          <div class="kpi-v" [style.color]="summary.avgSecurityScore == null ? 'var(--text-muted)' : getScoreColor(summary.avgSecurityScore)">{{summary.avgSecurityScore ?? 'Non disponible'}}</div>
        </div>
      </div>

      <div class="card" *ngIf="!loading && !loadError">
        <div class="card-title"><i class="ti ti-list-details" aria-hidden="true"></i> Par projet — CVE critiques décroissantes</div>

        <!-- §16 — un état vide dit ce qui est vide. -->
        <div class="empty-state" *ngIf="!byProject.length">
          <div class="empty-icon"><i class="ti ti-shield-search" aria-hidden="true"></i></div>
          <div class="empty-title">Aucun résultat de scan</div>
          <div class="empty-sub">Aucun projet surveillé n’a de résultat Trivy, OWASP ou ZAP exploitable. L’absence de résultat ne signifie pas l’absence de vulnérabilité.</div>
        </div>

        <ng-template #missingScanner><span class="na" title="Résultat non disponible" aria-label="Résultat non disponible">—</span></ng-template>
        <!-- §23 — le tableau défile dans son conteneur, jamais la page. -->
        <div class="table-scroll" *ngIf="byProject.length">
        <table class="proj-table">
          <thead>
            <tr>
              <th scope="col">Projet</th>
              <th scope="col">Score</th>
              <th scope="col">Critiques</th>
              <th scope="col">Élevées</th>
              <th scope="col">Trivy<app-info-hint term="sca"></app-info-hint></th>
              <th scope="col">OWASP<app-info-hint term="sca"></app-info-hint></th>
              <th scope="col">ZAP<app-info-hint term="dast"></app-info-hint></th>
            </tr>
          </thead>
          <tbody>
            <!-- §24 — une ligne cliquable annonce son rôle et son libellé, et
                 répond au clavier (Entrée et Espace). -->
            <tr class="proj-row" *ngFor="let p of byProject"
                tabindex="0" role="button" [attr.aria-label]="'Ouvrir le projet ' + p.projectName"
                (click)="goToProject(p.projectId)"
                (keydown.enter)="goToProject(p.projectId)"
                (keydown.space)="goToProject(p.projectId)">
              <td class="proj-name">{{p.projectName}}</td>
              <td>
                <span class="score-badge"
                      [style.color]="p.incomplete ? 'var(--text-muted)' : getScoreColor(p.securityScore)"
                      [title]="p.incomplete ? ('Scanner(s) requis sans résultat : ' + (p.missingScanners || []).join(', ')) : ''">
                  {{p.incomplete ? 'Non vérifié' : p.securityScore}}
                </span>
              </td>
              <td><span class="cnt" [class.alert]="!p.incomplete && p.criticalCves>0">{{p.incomplete ? 'Non disponible' : p.criticalCves}}</span></td>
              <td><span class="cnt" [class.warn]="!p.incomplete && p.highCves>0">{{p.incomplete ? 'Non disponible' : p.highCves}}</span></td>
              <td class="sub"><ng-container *ngIf="!(p.missingScanners || []).includes('trivy'); else missingScanner">{{p.trivy.critical}} critiques · {{p.trivy.high}} élevées</ng-container></td>
              <td class="sub"><ng-container *ngIf="!(p.missingScanners || []).includes('owasp'); else missingScanner">{{p.owasp.critical}} critiques · {{p.owasp.high}} élevées</ng-container></td>
              <td class="sub"><ng-container *ngIf="!(p.missingScanners || []).includes('zap'); else missingScanner">{{p.zap.high}} élevées · {{p.zap.medium}} moyennes</ng-container></td>
            </tr>
          </tbody>
        </table>
        </div>

        <div class="no-data-note" *ngIf="projectsWithoutData.length">
          <i class="ti ti-alert-triangle" aria-hidden="true"></i>
          Aucune donnée de scanner pour : {{projectsWithoutData.join(', ')}}
        </div>
        <p class="evidence-note" *ngIf="byProject.length">
          Les preuves exactes — rapport, build et commit d’origine de chaque constat — sont sur la page du projet concerné.
        </p>
      </div>
    </div>
  `,
  styles: [`
    :host{display:block}
    /* §2/§26 — typographie de la plateforme ; min-height:100vh retiré, la
       coquille gère déjà le défilement. */
    .page{padding:18px 20px;background:var(--bg-primary);color:var(--text-primary)}
    .page-header{display:flex;align-items:center;gap:12px;margin-bottom:18px}
    .page-icon{width:40px;height:40px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:18px}
    h2{font-size:16px;font-weight:700;margin:0}
    .page-sub{font-size:10px;color:var(--text-secondary);margin-top:2px}
    .kpi-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px;margin-bottom:14px}
    .kpi{background:var(--bg-secondary);border:1px solid var(--border-color);border-radius:7px;padding:10px 12px}
    .kpi-l{font-size:9px;color:var(--text-secondary);margin-bottom:4px}
    .kpi-v{font-size:20px;font-weight:700}
    .kpi.g .kpi-v{color:var(--accent-green)}.kpi.o .kpi-v{color:var(--accent-orange)}.kpi.r .kpi-v{color:var(--accent-red)}
    .card{background:var(--bg-secondary);border:1px solid var(--border-color);border-radius:8px;padding:14px;margin-bottom:12px}
    .card-title{display:flex;align-items:center;gap:5px;font-size:10px;font-weight:600;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.5px;margin-bottom:12px}
    .empty{font-size:11px;color:var(--text-secondary);padding:10px 0}
    .proj-table{width:100%;border-collapse:collapse;font-size:11px}
    .proj-table th{text-align:left;font-size:9px;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.4px;padding:6px 8px;border-bottom:1px solid var(--border-color)}
    .proj-table td{padding:8px;border-bottom:1px solid var(--border-color)}
    .proj-row{cursor:pointer}
    .proj-row:hover{background:var(--bg-hover)}
    .proj-name{font-weight:600}
    .sub{color:var(--text-secondary);font-size:10px}
    .cnt{font-weight:700}
    .cnt.alert{color:var(--accent-red)}
    .cnt.warn{color:var(--accent-orange)}
    .score-badge{font-weight:700}
    .no-data-note{margin-top:12px;padding:8px 10px;font-size:10px;color:var(--accent-orange);background:var(--accent-orange-bg);border-radius:5px;display:flex;align-items:center;gap:6px}
    .kpi-l{display:flex;align-items:center}
    .kpi-v{font-family:var(--font-mono)}
    .proj-row:focus-visible{outline:2px solid var(--accent-blue);outline-offset:-2px}
    /* §15 — la preuve exacte vit sur la page du projet ; le dire discrètement
       vaut mieux que l'absence de toute mention de provenance. */
    .evidence-note{margin:12px 0 0;font-size:10px;color:var(--text-muted)}
  `]
})
export class SecurityComponent implements OnInit, OnDestroy {
  summary: any = null;
  byProject: any[] = [];
  projectsWithoutData: string[] = [];
  loadError = '';
  loading = true;
  private projectEventsSub?: Subscription;

  constructor(
    private api: ApiService,
    private router: Router,
    private projectEvents: ProjectEventsService,
  ) {}

  ngOnInit() {
    this.load();
    // Re-fetch après création/suppression d'un projet, sans reload manuel.
    this.projectEventsSub = this.projectEvents.projectsChanged$.subscribe(() => this.load());
  }

  ngOnDestroy() {
    this.projectEventsSub?.unsubscribe();
  }

  load() {
    this.loadError = '';
    this.loading = true;
    this.api.getSecurityGlobal().subscribe({
      next: (data: any) => {
        this.summary = securitySummaryForDisplay(data);
        this.byProject = (data.byProject || []).map((p: any) => (data.projectsWithoutData || []).includes(p.projectName) ? {...p, incomplete:true, missingScanners:['trivy','owasp','zap','sonar']} : p);
        this.projectsWithoutData = data.projectsWithoutData || [];
        this.loading = false;
      },
      error: () => {
        this.loadError = 'Impossible de charger les résultats de sécurité.';
        this.summary = null;
        this.byProject = [];
        this.projectsWithoutData = [];
        this.loading = false;
      },
    });
  }

  goToProject(projectId: string) {
    this.router.navigate(['/projects', projectId]);
  }

  getScoreColor(score: number): string {
    if (score >= 80) return 'var(--accent-green)';
    if (score >= 60) return 'var(--accent-orange)';
    return 'var(--accent-red)';
  }
}
