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
  /** §17 — dégradations PARTIELLES : la liste s'affiche, la colonne le dit. */
  partialErrors: string[] = [];
  /** §18 — tant que la gouvernance n'a pas répondu, la colonne le dit. */
  deploymentLoading = false;
  /** §18 — idem pour Jenkins, qui est la lecture la plus lente des trois. */
  buildLoading = false;
  needsAttention = needsAttention;

  // Chaque lecture arrive à son rythme et dépose son résultat ici ; les
  // lignes sont recomposées à chaque arrivée depuis ce qui est connu.
  private rawProjects: any[] = [];
  private securityByProject = new Map<string, any>();
  private jenkinsByProject = new Map<string, any>();
  private readinessByProject = new Map<string, any>();

  constructor(
    private api: ApiService,
    private toast: ToastService,
    private router: Router,
    private projectEvents: ProjectEventsService,
    public auth: AuthService,
  ) {}

  get canEdit() { return ['admin', 'developer'].includes(this.auth.currentUser?.role); }

  /** Nombre de projets demandant une attention — compté, jamais estimé. */
  get attentionCount() { return this.rows.filter(r => needsAttention(r)).length; }

  ngOnInit() { this.load(); }

  goToNewProject() { this.router.navigate(['/projects/new']); }

  /**
   * Lectures étagées, et l'étagement est le correctif.
   *
   * Mesures sur le backend live : /projects répond en 7 ms,
   * /dashboard/security-global en 20 ms, /azure-deploy/ready/:id en 6 à
   * 23 ms — et /dashboard/jenkins-global en **5 008 ms**, parce qu'il touche
   * son propre plafond de 5 000 ms dès qu'un seul projet pointe vers une
   * adresse Jenkins injoignable.
   *
   * Agréger les trois dans un `forkJoin` bloquant alignait donc toute la
   * page sur la plus lente : 5 s d'écran de chargement pour des données
   * disponibles en 27 ms. Jenkins part maintenant en parallèle et ne retient
   * plus rien ; la colonne « Dernier build » dit « Vérification… » le temps
   * qu'il réponde, ce qui est exact, et ne montre jamais un état de build
   * provisoire.
   *
   * Seul GET /projects reste bloquant : sans lui il n'y a rien à afficher.
   * Un échec de l'une des lectures secondaires dégrade la colonne concernée
   * en « non disponible » explicite — jamais en « 0 vulnérabilité » ni en
   * « build en échec », qui seraient des affirmations non constatées.
   */
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

  /**
   * Jenkins, hors du chemin critique. La lecture peut prendre 5 s ; la liste
   * est déjà à l'écran quand elle arrive.
   */
  private loadBuildState() {
    if (!this.rawProjects.length) { this.buildLoading = false; return; }
    this.api.getJenkinsGlobal().pipe(catchError(() => of(null))).subscribe(jenkins => {
      if (!jenkins) this.partialErrors.push('Les données Jenkins n’ont pas pu être chargées.');
      this.jenkinsByProject = new Map<string, any>((jenkins?.projects || []).map((p: any) => [p.projectId, p]));
      this.buildLoading = false;
      this.rebuildRows();
    });
  }

  /**
   * L'état de déploiement est gouverné PAR PROJET : il n'existe pas de
   * lecture globale, donc un appel par projet, chacun tolérant à l'échec.
   * Chargé après coup pour que la liste s'affiche sans attendre : la colonne
   * reste « Vérification… » tant que la réponse n'est pas là, jamais
   * « non configuré » par défaut (§18).
   */
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

  confirmDelete(row: ProjectListRow, event: Event) {
    event.stopPropagation();
    event.preventDefault();
    if (!confirm(`Supprimer le projet "${row.name}" ?`)) return;
    this.api.deleteProject(row.id).subscribe({
      next: () => {
        this.toast.success('Projet supprimé');
        this.load();
        this.projectEvents.notifyChanged();
      },
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

  /** Libellé de la colonne sécurité, hors score. */
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
