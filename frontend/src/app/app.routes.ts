import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';

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
        path: 'notifications',
        loadComponent: () =>
          import('./features/notifications/notifications.component').then(m => m.NotificationsComponent)
      },
      {
        path: 'admin',
        loadComponent: () =>
          import('./features/admin/admin.component').then(m => m.AdminComponent)
      },
      {
        path: 'settings',
        loadComponent: () =>
          import('./features/settings/settings.component').then(m => m.SettingsComponent)
      },
      // ── Nouvelles pages ──────────────────────────────────
      {
        path: 'jenkins',
        loadComponent: () =>
          import('./features/tools/jenkins.component').then(m => m.JenkinsComponent)
      },
      {
        path: 'sonarqube',
        loadComponent: () =>
          import('./features/tools/sonarqube.component').then(m => m.SonarqubeComponent)
      },
      {
        path: 'security',
        loadComponent: () =>
          import('./features/tools/security.component').then(m => m.SecurityComponent)
      },
      {
        path: 'kubernetes',
        loadComponent: () =>
          import('./features/tools/kubernetes.component').then(m => m.KubernetesComponent)
      },
      {
        path: 'monitoring',
        loadComponent: () =>
          import('./features/tools/monitoring.component').then(m => m.MonitoringComponent)
      },
      {
        path: 'dora',
        loadComponent: () =>
          import('./features/analytics/dora.component').then(m => m.DoraComponent)
      },
      {
        path: 'prediction',
        loadComponent: () =>
          import('./features/analytics/prediction.component').then(m => m.PredictionComponent)
      },
    ]
  },
  { path: '**', redirectTo: '' }
];
