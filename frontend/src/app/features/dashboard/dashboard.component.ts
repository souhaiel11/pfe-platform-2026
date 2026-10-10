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

// ─────────────────────────────────────────────────────────────────────
//  Tableau de bord (§28).
//
//  Quatre questions, dans cet ordre : combien de projets, lesquels demandent
//  une attention, qu'est-ce qui a échoué récemment, quels problèmes de
//  sécurité ou de déploiement existent. Rien d'autre.
//
//  Ce qui a été retiré ici l'a été parce qu'il répétait (§27) :
//   — un bandeau latéral et une barre supérieure propres au tableau de bord,
//     masqués en CSS mais toujours dans le DOM, qui dupliquaient la
//     navigation, le bouton de thème et la fiche utilisateur de la coquille
//     applicative ;
//   — un panneau d'anneaux de risque qui affichait, en graphique, le MÊME
//     score déjà écrit deux fois sur la carte du projet juste en dessous ;
//   — une colonne « Risque » dérivée de ce même score, soit une quatrième
//     représentation du même nombre.
//
//  Le modèle de ligne est celui de la liste des projets
//  (features/projects/project-list-row.ts) : une seule définition de ce
//  qu'est un build connu, un score partiel ou un déploiement bloqué, donc
//  aucun risque que les deux écrans affirment deux choses différentes du
//  même projet.
// ─────────────────────────────────────────────────────────────────────

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
  /** §18 — tant que la gouvernance n'a pas répondu, la colonne le dit. */
  deploymentLoading = false;
  /** §18 — idem pour Jenkins, la lecture la plus lente du tableau de bord. */
  buildLoading = false;

  securitySummary: any = null;
  securitySummaryLoading = true;

  activities: Array<{ tone: string; title: string; meta: string; incidentId: string }> = [];
  activitiesLoading = true;

  // §18 — le taux de réussite affichait « Non disponible » pendant sa propre
  // lecture : une absence affirmée avant même d'avoir interrogé Jenkins.
  buildReliabilityLoading = true;
  // Taux de réussite des builds — même source que l'onglet Jenkins
  // (GET /dashboard/jenkins-global::summary). rate=null => "Non disponible",
  // jamais un chiffre dérivé de builds fabriqués.
  buildReliability: { rate: number | null; sampleSize: number } | null = null;

  private projectEventsSub?: Subscription;
  private rawProjects: any[] = [];
  private securityByProject = new Map<string, any>();
  private jenkinsByProject = new Map<string, any>();
  private readinessByProject = new Map<string, any>();

  needsAttention = needsAttention;

  constructor(
    private api: ApiService,
    private projectEvents: ProjectEventsService,
  ) {}

  ngOnInit() {
    this.loadProjects();
    this.loadSecuritySummary();
    this.loadIncidentFeeds();
    this.projectEventsSub = this.projectEvents.projectsChanged$.subscribe(() => {
      this.loadProjects();
      this.loadSecuritySummary();
      this.loadIncidentFeeds();
    });
  }

  ngOnDestroy() { this.projectEventsSub?.unsubscribe(); }

  /** Projets à traiter, les plus dégradés d'abord, avec le motif exact. */
  get attentionItems(): AttentionItem[] {
    return sortByAttention(this.rows)
      .filter(row => needsAttention(row))
      .map(row => ({ row, reasons: attentionReasons(row) }));
  }

  get orderedRows(): ProjectListRow[] { return sortByAttention(this.rows); }

  loadSecuritySummary() {
    delete this.dataErrors['security'];
    this.securitySummaryLoading = true;
    this.api.getSecurityGlobal().subscribe({
      next: (data: any) => { this.securitySummary = data?.summary || null; this.securitySummaryLoading = false; },
      error: () => {
        this.dataErrors['security'] = 'Impossible de charger les résultats de sécurité.';
        this.securitySummary = null;
        this.securitySummaryLoading = false;
      },
    });
  }

  /**
   * Lectures étagées — même correctif que la liste des projets, même cause.
   *
   * /dashboard/jenkins-global met 5 008 ms sur ce backend (son plafond de
   * 5 000 ms, atteint dès qu'un projet pointe vers une adresse Jenkins
   * injoignable), contre 7 ms pour /projects et 20 ms pour security-global.
   * Dans un `forkJoin` bloquant, le tableau de bord entier attendait donc la
   * plus lente des trois. Jenkins part désormais en parallèle : ni le
   * panneau « À traiter en priorité » ni le tableau des projets ne
   * l'attendent, et le panneau « Taux de réussite des builds » garde son
   * propre indicateur de chargement, qui est exactement ce qu'il attend.
   */
  loadProjects() {
    delete this.dataErrors['projects'];
    this.projectsLoading = true;
    forkJoin({
      projects: this.api.getProjects(),
      security: this.api.getSecurityGlobal().pipe(catchError(() => of(null))),
    }).subscribe({
      next: ({ projects, security }) => {
        this.rawProjects = projects || [];
        this.securityByProject = new Map((security?.byProject || []).map((p: any) => [p.projectId, p]));
        this.rebuildRows();
        this.projectsLoading = false;
        this.deploymentLoading = this.rawProjects.length > 0;
        this.loadReadiness();
        this.loadJenkins();
      },
      error: () => {
        this.dataErrors['projects'] = 'Impossible de charger les projets.';
        this.rows = [];
        this.projectsLoading = false;
        this.buildReliabilityLoading = false;
        this.buildLoading = false;
      },
    });
  }

  /** Recompose les lignes depuis les lectures déjà arrivées, et elles seules. */
  private rebuildRows() {
    this.rows = this.rawProjects.map(p => buildProjectListRow(
      p,
      this.securityByProject.get(p.id),
      this.jenkinsByProject.get(p.id),
      this.readinessByProject.get(p.id),
    ));
  }

  /** Jenkins, hors du chemin critique : colonne de build ET taux de réussite. */
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

  /**
   * Activité récente — incidents, les plus récents d'abord. La tonalité vient
   * de la table de statuts partagée, pas d'un second barème local.
   */
  loadIncidentFeeds() {
    delete this.dataErrors['incidents'];
    this.activitiesLoading = true;
    this.api.getIncidents({ size: 20 }).subscribe({
      next: (data: any) => {
        const incidents: any[] = (Array.isArray(data) ? data : data?.content) || [];
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
      error: () => {
        this.dataErrors['incidents'] = 'Impossible de charger les incidents récents.';
        this.activities = [];
        this.activitiesLoading = false;
      },
    });
  }

  /** Couleur d'un score sur 100 — gris neutre quand il n'est pas connu. */
  scoreColor(score: number | null): string {
    if (score === null) return 'var(--text-muted)';
    if (score >= 80) return 'var(--accent-green)';
    if (score >= 60) return 'var(--accent-orange)';
    return 'var(--accent-red)';
  }
}
