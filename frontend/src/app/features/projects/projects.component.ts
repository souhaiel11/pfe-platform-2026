// Affiche les projets et permet de gérer leur configuration.
import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { forkJoin, of, catchError } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { ToastService } from '../../core/services/toast.service';
import { ProjectEventsService } from '../../core/services/project-events.service';
import { AuthService } from '../../core/services/auth.service';
import { StatusChipComponent } from '../../shared/status-chip/status-chip.component';
import { InfoHintComponent } from '../../shared/info-hint/info-hint.component';
import { ZoneLabelComponent } from '../../shared/zone-label/zone-label.component';
import { ProjectListRow, buildProjectListRow, needsAttention } from './project-list-row';

/**
 * Page de liste des projets : chargement étagé (projets, sécurité, Jenkins,
 * disponibilité au déploiement), suppression de projet et mise en forme des
 * colonnes (score, note sécurité, infobulle de déploiement).
 */
@Component({
  selector: 'app-projects',
  standalone: true,
  imports: [CommonModule, RouterModule, StatusChipComponent, InfoHintComponent, ZoneLabelComponent],
  templateUrl: './projects.component.html',
  styleUrls: ['./projects.component.scss'],
})
export class ProjectsComponent implements OnInit {
  rows: ProjectListRow[] = [];
  loadError = '';
  loading = false;
  partialErrors: string[] = [];
  deploymentLoading = false;
  buildLoading = false;
  needsAttention = needsAttention;

  private rawProjects: any[] = [];
  private securityByProject = new Map<string, any>();
  private jenkinsByProject = new Map<string, any>();
  private readinessByProject = new Map<string, any>();

  /** Initialise les dépendances et l’état de ce composant. */
  constructor(
    private api: ApiService,
    private toast: ToastService,
    private router: Router,
    private projectEvents: ProjectEventsService,
    public auth: AuthService,
  ) {}

  /** Vrai si l'utilisateur connecté peut modifier les projets. */
  get canEdit() { return ['admin', 'developer'].includes(this.auth.currentUser?.role); }

  /** Nombre de projets demandant une attention — compté, jamais estimé. */
  get attentionCount() { return this.rows.filter(r => needsAttention(r)).length; }

  /** Charge la liste des projets dès l'affichage de la page. */
  ngOnInit() { this.load(); }

  /** Navigue vers le formulaire de création de projet. */
  goToNewProject() { this.router.navigate(['/projects/new']); }

  /** Charge les projets et le résumé sécurité, puis déclenche les lectures Jenkins et de disponibilité au déploiement (hors chemin critique). */
  load() {
    this.loadError = '';
    this.partialErrors = [];
    this.loading = true;
    this.deploymentLoading = false;
    this.buildLoading = false;
    forkJoin({
      projects: this.api.getProjects(),
      security: this.api.getSecurityGlobal().pipe(catchError(() => of(null))),
    }).subscribe({
      /** Traite le résultat reçu et actualise les données locales. */
      next: ({ projects, security }) => {
        if (!security) this.partialErrors.push('Les résultats de sécurité n’ont pas pu être chargés.');
        this.securityByProject = new Map<string, any>(
          (security?.byProject || []).map((p: any) => [p.projectId, p]),
        );
        this.rawProjects = projects || [];
        this.rebuildRows();
        this.loading = false;
        this.deploymentLoading = this.rawProjects.length > 0;
        this.buildLoading = this.rawProjects.length > 0;
        this.loadDeploymentState();
        this.loadBuildState();
      },
      /** Traite l’erreur reçue et termine le suivi de la demande. */
      error: () => {
        this.loadError = 'La requête vers le backend n’a pas abouti. Les projets existants ne sont pas affichés.';
        this.rows = [];
        this.toast.error('Erreur', 'Impossible de charger les projets');
        this.loading = false;
      },
    });
  }

  /** Recompose les lignes depuis les lectures déjà arrivées, et elles seules. */
  private rebuildRows() {
    this.rows = this.rawProjects.map((p: any) => buildProjectListRow(
      p,
      this.securityByProject.get(p.id),
      this.jenkinsByProject.get(p.id),
      this.readinessByProject.get(p.id),
    ));
  }

  /** Charge les données Jenkins (colonne "dernier build") indépendamment du reste. */
  private loadBuildState() {
    if (!this.rawProjects.length) { this.buildLoading = false; return; }
    this.api.getJenkinsGlobal().pipe(catchError(() => of(null))).subscribe(jenkins => {
      if (!jenkins) this.partialErrors.push('Les données Jenkins n’ont pas pu être chargées.');
      this.jenkinsByProject = new Map<string, any>((jenkins?.projects || []).map((p: any) => [p.projectId, p]));
      this.buildLoading = false;
      this.rebuildRows();
    });
  }

  /** Charge l'état de disponibilité au déploiement de chaque projet (un appel par projet, tolérant à l'échec). */
  private loadDeploymentState() {
    if (!this.rawProjects.length) { this.deploymentLoading = false; return; }
    const projects = this.rawProjects;
    forkJoin(projects.map(p => this.api.getDeployReadiness(p.id).pipe(catchError(() => of(null)))))
      .subscribe(readinessRows => {
        this.readinessByProject = new Map<string, any>(projects.map((p: any, i: number) => [p.id, readinessRows[i]]));
        this.deploymentLoading = false;
        this.rebuildRows();
      });
  }

  /** Supprime un projet après confirmation explicite, recharge la liste et notifie les autres composants. */
  confirmDelete(row: ProjectListRow, event: Event) {
    event.stopPropagation();
    event.preventDefault();
    if (!confirm(`Supprimer le projet "${row.name}" ?`)) return;
    this.api.deleteProject(row.id).subscribe({
      /** Traite le résultat reçu et actualise les données locales. */
      next: () => {
        this.toast.success('Projet supprimé');
        this.load();
        this.projectEvents.notifyChanged();
      },
      /** Traite l’erreur reçue et termine le suivi de la demande. */
      error: () => this.toast.error('Erreur', 'Impossible de supprimer le projet'),
    });
  }

  /** Couleur du score — gris neutre quand le score n'est pas connu. */
  scoreColor(row: ProjectListRow): string {
    if (row.security.score === null) return 'var(--text-muted)';
    if (row.security.score >= 80) return 'var(--accent-green)';
    if (row.security.score >= 60) return 'var(--accent-orange)';
    return 'var(--accent-red)';
  }

  /** Libellé complémentaire de la colonne sécurité (score absent ou analyse partielle). */
  securityNote(row: ProjectListRow): string | null {
    if (row.security.state === 'UNAVAILABLE') return 'Score non disponible';
    if (row.security.state === 'INCOMPLETE') {
      const missing = row.security.missingScanners.length;
      return missing
        ? `Partiel — ${missing} scanner${missing > 1 ? 's' : ''} sans résultat`
        : 'Partiel — analyse incomplète';
    }
    return null;
  }

  /** Construit l'infobulle expliquant pourquoi un projet n'est pas prêt à déployer (ou null si rien à préciser). */
  deploymentTooltip(row: ProjectListRow): string | null {
    if (row.deployment.state === 'NOT_READY' && row.deployment.firstReason) {
      const n = row.deployment.blockingCount ?? 0;
      return `${n} condition${n > 1 ? 's' : ''} bloquante${n > 1 ? 's' : ''} — ${row.deployment.firstReason}`;
    }
    if (row.deployment.state === 'NOT_CONFIGURED') return 'Aucune cible de déploiement configurée pour ce projet.';
    if (row.deployment.state === 'UNAVAILABLE') return 'L’état de gouvernance du déploiement n’est pas connu.';
    return null;
  }
}
