import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/services/api.service';
import { ToastService } from '../../core/services/toast.service';

@Component({
  selector: 'app-projects',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  templateUrl: './projects.component.html',
  styleUrls: ['./projects.component.scss'],
})
export class ProjectsComponent implements OnInit {
  projects: any[] = [];
  loading   = false;
  showModal = false;
  newProject = { name: '', description: '', sonarKey: '', githubRepo: '', jenkinsJobName: '' };

  constructor(private api: ApiService, private toast: ToastService, private router: Router) {}

  ngOnInit() { this.load(); }

  goToNewProject() { this.router.navigate(['/projects/new']); }

  load() {
    this.loading = true;
    this.api.getProjects().subscribe({
      next: p => { this.projects = p; this.loading = false; },
      error: () => { this.toast.error('Erreur', 'Impossible de charger les projets'); this.loading = false; }
    });
  }

  createProject() {
    if (!this.newProject.name) return;
    this.api.createProject(this.newProject).subscribe({
      next: () => {
        this.toast.success('Projet créé', this.newProject.name);
        this.showModal = false;
        this.newProject = { name: '', description: '', sonarKey: '', githubRepo: '', jenkinsJobName: '' };
        this.load();
      },
      error: () => this.toast.error('Erreur', 'Impossible de créer le projet')
    });
  }

  confirmDelete(p: any) {
    if (!confirm(`Supprimer le projet "${p.name}" ?`)) return;
    this.api.deleteProject(p.id).subscribe({
      next: () => { this.toast.success('Projet supprimé'); this.load(); },
      error: () => this.toast.error('Erreur', 'Impossible de supprimer le projet')
    });
  }

  getHealthColor(score: number): string {
    if (score >= 80) return 'var(--accent-green)';
    if (score >= 60) return 'var(--accent-orange)';
    return 'var(--accent-red)';
  }
}
