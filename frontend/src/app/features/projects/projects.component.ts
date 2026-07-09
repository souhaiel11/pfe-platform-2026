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
  template: `
    <div class="page-container">
      <div class="page-header" style="display:flex;align-items:center;justify-content:space-between;">
        <div>
          <h1 class="page-title">// projets</h1>
          <p class="page-subtitle">Gestion des projets sous surveillance DevSecOps IA</p>
        </div>
        <button class="btn btn-primary" (click)="goToNewProject()">+ Nouveau projet</button>
      </div>

      <div *ngIf="loading" class="loading-overlay"><div class="spinner"></div><span>Chargement...</span></div>

      <!-- Projects grid -->
      <div class="projects-grid" *ngIf="!loading">
        <div *ngIf="projects.length === 0" class="empty-state" style="grid-column:1/-1;">
          <div class="empty-icon">◧</div>
          <div class="empty-title">Aucun projet</div>
          <div class="empty-sub">Créez votre premier projet pour commencer</div>
        </div>

        <div *ngFor="let p of projects" class="project-card">
          <div class="project-card-header">
            <div class="project-avatar" [style.border-color]="getHealthColor(p.securityScore)">
              {{p.name?.substring(0,2).toUpperCase()}}
            </div>
            <div style="flex:1;min-width:0;">
              <div class="project-name">{{p.name}}</div>
              <div class="project-id">{{p.id?.substring(0,8)}}...</div>
            </div>
            <div class="health-badge" [style.color]="getHealthColor(p.securityScore)"
                 [style.background]="getHealthColor(p.securityScore)+'11'">
              {{p.securityScore | number:'1.0-0'}}%
            </div>
          </div>

          <div class="project-stats">
            <div class="stat">
              <div class="stat-val red">{{p.openIncidents || 0}}</div>
              <div class="stat-label">ouverts</div>
            </div>
            <div class="stat">
              <div class="stat-val orange">{{p.analyzingIncidents || 0}}</div>
              <div class="stat-label">analyse</div>
            </div>
            <div class="stat">
              <div class="stat-val green">{{p.resolvedIncidents || 0}}</div>
              <div class="stat-label">résolus</div>
            </div>
          </div>

          <div class="health-bar-wrap">
            <div class="health-bar">
              <div [style.width]="(p.securityScore||0)+'%'"
                   [style.background]="getHealthColor(p.securityScore)"></div>
            </div>
          </div>

          <div class="project-footer">
            <span style="font-size:10px;color:var(--text-faint);font-family:var(--font-mono);">
              Créé le {{p.createdAt | date:'dd/MM/yyyy'}}
            </span>
            <div style="display:flex;gap:6px;">
              <a [routerLink]="['/projects', p.id]" class="btn btn-secondary btn-sm">Voir →</a>
              <button class="btn btn-danger btn-sm" (click)="confirmDelete(p)">✕</button>
            </div>
          </div>
        </div>
      </div>

      <!-- Create Modal -->
      <div class="modal-overlay" *ngIf="showModal" (click)="showModal=false">
        <div class="modal" (click)="$event.stopPropagation()">
          <div class="modal-header">
            <span class="card-title">Nouveau projet</span>
            <button class="btn btn-secondary btn-sm" (click)="showModal=false">✕</button>
          </div>
          <div class="form-group">
            <label class="form-label">Nom du projet *</label>
            <input class="form-control" [(ngModel)]="newProject.name" placeholder="ex: PFE-VERMEG" />
          </div>
          <div class="form-group">
            <label class="form-label">Description</label>
            <input class="form-control" [(ngModel)]="newProject.description" placeholder="Description optionnelle" />
          </div>
          <div class="form-group">
            <label class="form-label">Clé SonarQube</label>
            <input class="form-control" [(ngModel)]="newProject.sonarKey" placeholder="ex: equipe1-3arctic1-2425" />
          </div>
          <div class="form-group">
            <label class="form-label">GitHub Repository</label>
            <input class="form-control" [(ngModel)]="newProject.githubRepo" placeholder="ex: souhaiel11/pfe-devsecops-2026" />
          </div>
          <div class="form-group">
            <label class="form-label">Jenkins Job Name</label>
            <input class="form-control" [(ngModel)]="newProject.jenkinsJobName" placeholder="ex: pfe-devsecops-pipeline" />
          </div>
          <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:20px;">
            <button class="btn btn-secondary" (click)="showModal=false">Annuler</button>
            <button class="btn btn-primary" (click)="createProject()" [disabled]="!newProject.name">
              Créer le projet
            </button>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .projects-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 16px;
    }

    .project-card {
      background: var(--bg-secondary);
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      padding: 18px;
      transition: border-color 0.2s;
      &:hover { border-color: var(--border-light); }
    }

    .project-card-header {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 14px;
    }

    .project-avatar {
      width: 36px; height: 36px;
      border-radius: var(--radius-md);
      background: var(--bg-tertiary);
      border: 1px solid;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      font-weight: 700;
      font-family: var(--font-mono);
      color: var(--text-secondary);
      flex-shrink: 0;
    }

    .project-name {
      font-size: 13px;
      font-weight: 600;
      color: var(--text-primary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .project-id {
      font-size: 10px;
      color: var(--text-faint);
      font-family: var(--font-mono);
    }

    .health-badge {
      font-size: 12px;
      font-weight: 700;
      padding: 4px 8px;
      border-radius: var(--radius-sm);
      font-family: var(--font-mono);
      flex-shrink: 0;
    }

    .project-stats {
      display: flex;
      gap: 12px;
      margin-bottom: 12px;
    }

    .stat { text-align: center; flex: 1; }

    .stat-val {
      font-size: 20px;
      font-weight: 700;
      font-family: var(--font-mono);
      &.red    { color: var(--accent-red); }
      &.orange { color: var(--accent-orange); }
      &.green  { color: var(--accent-green); }
    }

    .stat-label {
      font-size: 9px;
      color: var(--text-faint);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .health-bar-wrap { margin-bottom: 12px; }

    .health-bar {
      height: 3px;
      background: var(--border);
      border-radius: 2px;
      overflow: hidden;
      div { height: 100%; border-radius: 2px; transition: width 0.8s ease; }
    }

    .project-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.6);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 500;
    }

    .modal {
      background: var(--bg-secondary);
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      padding: 24px;
      width: 420px;
    }

    .modal-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 20px;
    }
  `]
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
