import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';
import { editorGuard } from './core/guards/editor.guard';
import { adminGuard } from './core/guards/admin.guard';

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () =>
      import('./features/auth/login.component').then(m => m.LoginComponent)
  },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./shared/layout/layout.component').then(m => m.LayoutComponent),
    children: [
      { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
      {
        path: 'dashboard',
        loadComponent: () =>
          import('./features/dashboard/dashboard.component').then(m => m.DashboardComponent)
      },
      {
        path: 'projects',
        loadComponent: () =>
          import('./features/projects/projects.component').then(m => m.ProjectsComponent)
      },
      {
        path: 'projects/new',
        canActivate: [editorGuard],
        loadComponent: () =>
          import('./features/projects/project-form.component').then(m => m.ProjectFormComponent)
      },
      {
        path: 'projects/:id',
        loadComponent: () =>
          import('./features/projects/project-detail.component').then(m => m.ProjectDetailComponent)
      },
      {
        path: 'incidents',
        loadComponent: () =>
          import('./features/incidents/incidents.component').then(m => m.IncidentsComponent)
      },
      {
        path: 'incidents/:id',
        loadComponent: () =>
          import('./features/incidents/incident-detail.component').then(m => m.IncidentDetailComponent)
      },
      {
        path: 'analysis',
        loadComponent: () =>
          import('./features/analysis/analysis.component').then(m => m.AnalysisComponent)
      },
      {
        path: 'admin',
        canActivate: [adminGuard],
        loadComponent: () =>
          import('./features/admin/admin.component').then(m => m.AdminComponent)
      },
      {
        path: 'settings',
        loadComponent: () =>
          import('./features/settings/settings.component').then(m => m.SettingsComponent)
      },
      // ── Nouvelles pages ──────────────────────────────────
      // jenkins/sonarqube/kubernetes/dora : composants conservés sur disque
      // (features/tools, features/analytics) mais retirés du routing — pages
      // mockées, aucune ne correspond à une fonctionnalité déposée. Voir
      // audit frontend (lot C).
      {
        path: 'security',
        loadComponent: () =>
          import('./features/tools/security.component').then(m => m.SecurityComponent)
      },
      {
        path: 'monitoring',
        loadComponent: () =>
          import('./features/tools/monitoring.component').then(m => m.MonitoringComponent)
      },
      {
        path: 'prediction',
        loadComponent: () =>
          import('./features/analytics/prediction.component').then(m => m.PredictionComponent)
      },
      {
        path: 'not-found',
        loadComponent: () => import('./shared/not-found.component').then(m => m.NotFoundComponent)
      },
    ]
  },
  { path: '**', redirectTo: 'not-found' }
];
