// Gère l’affichage et les actions de tableau de bord.
import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Subscription, forkJoin, of, catchError } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { ProjectEventsService } from '../../core/services/project-events.service';
import { StatusChipComponent } from '../../shared/status-chip/status-chip.component';
import { InfoHintComponent } from '../../shared/info-hint/info-hint.component';
import { ZoneLabelComponent } from '../../shared/zone-label/zone-label.component';
import { presentationLabel } from '../../shared/status-labels';
import { frenchRelative } from '../../shared/french-format';
import {
  ProjectListRow, attentionReasons, buildProjectListRow, needsAttention, sortByAttention,
} from '../projects/project-list-row';

/**
 * Tableau de bord principal : nombre de projets, projets à traiter en
 * priorité, activité récente et vue d'ensemble sécurité/build/déploiement.
 */
interface AttentionItem {
  row: ProjectListRow;
  reasons: string[];
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterModule, StatusChipComponent, InfoHintComponent, ZoneLabelComponent],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss'],
})
export class DashboardComponent implements OnInit, OnDestroy {

  dataErrors: Record<string, string> = {};

  rows: ProjectListRow[] = [];
  projectsLoading = true;
  deploymentLoading = false;
  buildLoading = false;

  securitySummary: any = null;
  securitySummaryLoading = true;

  incidentSummary: { total: number; pending: number; completed: number; limited: boolean } | null = null;
  riskSummary: { total: number; elevated: number; average: number | null; highest: number | null } | null = null;
  riskSummaryLoading = true;

  activities: Array<{ tone: string; title: string; meta: string; incidentId: string }> = [];
  activitiesLoading = true;

  buildReliabilityLoading = true;
  buildReliability: { rate: number | null; sampleSize: number } | null = null;

  private projectEventsSub?: Subscription;
  private rawProjects: any[] = [];
  private securityByProject = new Map<string, any>();
  private jenkinsByProject = new Map<string, any>();
  private readinessByProject = new Map<string, any>();

  needsAttention = needsAttention;

  /** Initialise les dépendances et l’état de ce composant. */
  constructor(
    private api: ApiService,
    private projectEvents: ProjectEventsService,
  ) {}

  /** Lance les chargements initiaux du tableau de bord et les relance à chaque changement de projet. */
  ngOnInit() {
    this.loadProjects();
    this.loadSecuritySummary();
    this.loadIncidentFeeds();
    this.loadRiskSummary();
    this.projectEventsSub = this.projectEvents.projectsChanged$.subscribe(() => {
      this.loadProjects();
      this.loadSecuritySummary();
      this.loadIncidentFeeds();
      this.loadRiskSummary();
    });
  }

  /** Se désabonne du flux de changements de projets à la destruction du composant. */
  ngOnDestroy() { this.projectEventsSub?.unsubscribe(); }

  /** Projets à traiter, les plus dégradés d'abord, avec le motif exact. */
  get attentionItems(): AttentionItem[] {
    return sortByAttention(this.rows)
      .filter(row => needsAttention(row))
      .map(row => ({ row, reasons: attentionReasons(row) }));
  }

  /** Lignes de projets triées par ordre d'attention décroissant. */
  get orderedRows(): ProjectListRow[] { return sortByAttention(this.rows); }

  /** Récupère le résumé sécurité agrégé plateforme pour le panneau correspondant. */
  loadSecuritySummary() {
    delete this.dataErrors['security'];
    this.securitySummaryLoading = true;
    this.api.getSecurityGlobal().subscribe({
      /** Traite le résultat reçu et actualise les données locales. */
      next: (data: any) => { this.securitySummary = data?.summary || null; this.securitySummaryLoading = false; },
      /** Traite l’erreur reçue et termine le suivi de la demande. */
      error: () => {
        this.dataErrors['security'] = 'Impossible de charger les résultats de sécurité.';
        this.securitySummary = null;
        this.securitySummaryLoading = false;
      },
    });
  }

  /** Charge la liste des projets et le résumé sécurité par projet, puis déclenche les lectures Jenkins et de disponibilité au déploiement. */
  loadProjects() {
    delete this.dataErrors['projects'];
    this.projectsLoading = true;
    forkJoin({
      projects: this.api.getProjects(),
      security: this.api.getSecurityGlobal().pipe(catchError(() => of(null))),
    }).subscribe({
      /** Traite le résultat reçu et actualise les données locales. */
      next: ({ projects, security }) => {
        this.rawProjects = projects || [];
        this.securityByProject = new Map((security?.byProject || []).map((p: any) => [p.projectId, p]));
        this.rebuildRows();
        this.projectsLoading = false;
        this.deploymentLoading = this.rawProjects.length > 0;
        this.loadReadiness();
        this.loadJenkins();
      },
      /** Traite l’erreur reçue et termine le suivi de la demande. */
      error: () => {
        this.dataErrors['projects'] = 'Impossible de charger les projets.';
        this.rows = [];
        this.projectsLoading = false;
        this.buildReliabilityLoading = false;
        this.buildLoading = false;
      },
    });
  }

  /** Recompose les lignes du tableau depuis les lectures déjà arrivées (projets, sécurité, Jenkins, disponibilité). */
  private rebuildRows() {
    this.rows = this.rawProjects.map(p => buildProjectListRow(
      p,
      this.securityByProject.get(p.id),
      this.jenkinsByProject.get(p.id),
      this.readinessByProject.get(p.id),
    ));
  }

  /** Charge les données Jenkins (colonne de build et taux de réussite global), indépendamment des autres lectures. */
  private loadJenkins() {
    delete this.dataErrors['jenkins'];
    this.buildReliabilityLoading = true;
    this.buildLoading = this.rawProjects.length > 0;
    this.api.getJenkinsGlobal().pipe(catchError(() => of(null))).subscribe(jenkins => {
      if (!jenkins) {
        this.dataErrors['jenkins'] = 'Impossible de charger les données Jenkins.';
        this.buildReliability = null;
        this.jenkinsByProject.clear();
      } else {
        const s = jenkins.summary;
        this.buildReliability = s
          ? { rate: s.aggregateSuccessRate ?? null, sampleSize: s.aggregateSampleSize ?? 0 }
          : null;
        this.jenkinsByProject = new Map((jenkins.projects || []).map((p: any) => [p.projectId, p]));
      }
      this.buildReliabilityLoading = false;
      this.buildLoading = false;
      this.rebuildRows();
    });
  }

  /** Charge la disponibilité au déploiement de chaque projet. */
  private loadReadiness() {
    if (!this.rawProjects.length) { this.deploymentLoading = false; return; }
    const projects = this.rawProjects;
    forkJoin(projects.map(p => this.api.getDeployReadiness(p.id).pipe(catchError(() => of(null)))))
      .subscribe(readinessRows => {
        this.readinessByProject = new Map<string, any>(projects.map((p, i) => [p.id, readinessRows[i]]));
        this.deploymentLoading = false;
        this.rebuildRows();
      });
  }

  /** Récupère les incidents les plus récents pour le panneau d'activité. */
  loadIncidentFeeds() {
    delete this.dataErrors['incidents'];
    this.activitiesLoading = true;
    this.incidentSummary = null;
    this.api.getIncidents({ size: 50 }).subscribe({
      /** Traite le résultat reçu et actualise les données locales. */
      next: (data: any) => {
        const incidents: any[] = (Array.isArray(data) ? data : data?.content) || [];
        this.incidentSummary = {
          total: incidents.length,
          pending: incidents.filter(i => i.status === 'pending').length,
          completed: incidents.filter(i => i.status === 'completed').length,
          limited: incidents.length >= 50,
        };
        this.activities = incidents.slice(0, 6).map(i => ({
          tone: i.status || '',
          title: i.title || 'Incident sans titre',
          incidentId: i.id,
          meta: [
            frenchRelative(i.updatedAt || i.createdAt) || 'Date non disponible',
            i.project?.name || 'Projet non disponible',
            presentationLabel(i.status),
          ].join(' · '),
        }));
        this.activitiesLoading = false;
      },
      /** Traite l’erreur reçue et termine le suivi de la demande. */
      error: () => {
        this.dataErrors['incidents'] = 'Impossible de charger les incidents récents.';
        this.activities = [];
        this.activitiesLoading = false;
      },
    });
  }

  loadRiskSummary() {
    delete this.dataErrors['risk'];
    this.riskSummaryLoading = true;
    this.riskSummary = null;
    this.api.getRiskIndicators().subscribe({
      next: (data: any) => {
        const projects: any[] = data?.projects || [];
        const scores: number[] = projects.map(p => p.risk).filter((score: unknown): score is number => typeof score === 'number' && Number.isFinite(score));
        this.riskSummary = {
          total: projects.length,
          elevated: projects.filter(p => ['eleve', 'critique'].includes(p.levelClass)).length,
          average: scores.length ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length) : null,
          highest: scores.length ? Math.max(...scores) : null,
        };
        this.riskSummaryLoading = false;
      },
      error: () => {
        this.dataErrors['risk'] = 'Impossible de charger les indicateurs de risque.';
        this.riskSummaryLoading = false;
      },
    });
  }

  /** Renvoie la couleur associée à un score sur 100 (gris si inconnu). */
  scoreColor(score: number | null): string {
    if (score === null) return 'var(--text-muted)';
    if (score >= 80) return 'var(--accent-green)';
    if (score >= 60) return 'var(--accent-orange)';
    return 'var(--accent-red)';
  }
}
