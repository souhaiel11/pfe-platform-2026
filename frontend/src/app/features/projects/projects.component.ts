import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { forkJoin, of, catchError } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { ToastService } from '../../core/services/toast.service';
import { ProjectEventsService } from '../../core/services/project-events.service';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-projects',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './projects.component.html',
  styleUrls: ['./projects.component.scss'],
})
export class ProjectsComponent implements OnInit {
  projects: any[] = [];
  loading   = false;

  constructor(
    private api: ApiService,
    private toast: ToastService,
    private router: Router,
    private projectEvents: ProjectEventsService,
    public auth: AuthService,
  ) {}
  get canEdit() { return ['admin', 'developer'].includes(this.auth.currentUser?.role); }

  ngOnInit() { this.load(); }

  goToNewProject() { this.router.navigate(['/projects/new']); }

  // securityScore vient TOUJOURS de security-global (live). Si l'appel
  // échoue, ou qu'un projet n'y apparaît pas, on met securityScore à null —
  // jamais un repli silencieux sur Project.securityScore (désynchronisable
  // sans alerte, comme on l'a constaté). Le template affiche un état neutre.
  load() {
    this.loading = true;
    forkJoin({
      projects: this.api.getProjects(),
      // Ne fait jamais échouer le forkJoin : si security-global tombe, on
      // dégrade en neutre (byProject: []), la liste des projets reste affichée.
      security: this.api.getSecurityGlobal().pipe(catchError(() => of({ byProject: [] }))),
    }).subscribe({
      next: ({ projects, security }) => {
        const liveScores = new Map<string, number>(
          (security?.byProject || []).map((p: any) => [p.projectId, p.securityScore]),
        );
        this.projects = (projects || []).map((p: any) => ({
          ...p,
          securityScore: liveScores.has(p.id) ? liveScores.get(p.id) : null,
        }));
        this.loading = false;
      },
      error: () => { this.toast.error('Erreur', 'Impossible de charger les projets'); this.loading = false; }
    });
  }

  confirmDelete(p: any) {
    if (!confirm(`Supprimer le projet "${p.name}" ?`)) return;
    this.api.deleteProject(p.id).subscribe({
      next: () => {
        this.toast.success('Projet supprimé');
        this.load();
        this.projectEvents.notifyChanged();
      },
      error: () => this.toast.error('Erreur', 'Impossible de supprimer le projet')
    });
  }

  getHealthColor(score: number | null): string {
    if (score === null || score === undefined) return 'var(--text-secondary)';
    if (score >= 80) return 'var(--accent-green)';
    if (score >= 60) return 'var(--accent-orange)';
    return 'var(--accent-red)';
  }
}
