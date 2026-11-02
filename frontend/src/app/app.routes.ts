// Associe les URL aux pages et à leurs contrôles d’accès.
import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';
import { editorGuard } from './core/guards/editor.guard';
import { adminGuard } from './core/guards/admin.guard';
import { unsavedChangesGuard } from './core/guards/unsaved-changes.guard';

/**
 * Table de routes de l'application. Chaque route charge son composant à la demande (lazy loading).
 * authGuard protège tout l'espace connecté ; editorGuard réserve la création/édition de projet aux rôles admin/developer ;
 * adminGuard réserve /admin au rôle admin ; unsavedChangesGuard bloque la sortie d'un formulaire non enregistré.
 */
export const routes: Routes = [
  {
    path: 'login',
    /** Charge composant. */
    loadComponent: () =>
      import('./features/auth/login.component').then(m => m.LoginComponent)
  },
  {
    path: '',
    canActivate: [authGuard],
    /** Charge composant. */
    loadComponent: () =>
      import('./shared/layout/layout.component').then(m => m.LayoutComponent),
    children: [
      { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
      {
        path: 'scanner-reports/:incidentId/:scanner',
        /** Charge composant. */
        loadComponent: () => import('./shared/source-evidence/scanner-report-page.component').then(m => m.ScannerReportPageComponent),
      },
      {
        path: 'dashboard',
        /** Charge composant. */
        loadComponent: () =>
          import('./features/dashboard/dashboard.component').then(m => m.DashboardComponent)
      },
      {
        path: 'projects',
        /** Charge composant. */
        loadComponent: () =>
          import('./features/projects/projects.component').then(m => m.ProjectsComponent)
      },
      {
        path: 'projects/new',
        canActivate: [editorGuard],
        /** Charge composant. */
        loadComponent: () =>
          import('./features/projects/project-form.component').then(m => m.ProjectFormComponent)
      },
      {
        path: 'projects/:id/edit',
        canActivate: [editorGuard],
        canDeactivate: [unsavedChangesGuard],
        /** Charge composant. */
        loadComponent: () =>
          import('./features/projects/project-form.component').then(m => m.ProjectFormComponent)
      },
      {
        path: 'projects/:id',
        /** Charge composant. */
        loadComponent: () =>
          import('./features/projects/project-detail.component').then(m => m.ProjectDetailComponent)
      },
      {
        path: 'incidents',
        /** Charge composant. */
        loadComponent: () =>
          import('./features/incidents/incidents.component').then(m => m.IncidentsComponent)
      },
      {
        path: 'incidents/:id',
        /** Charge composant. */
        loadComponent: () =>
          import('./features/incidents/incident-detail.component').then(m => m.IncidentDetailComponent)
      },
      {
        path: 'analysis',
        /** Charge composant. */
        loadComponent: () =>
          import('./features/analysis/analysis.component').then(m => m.AnalysisComponent)
      },
      {
        path: 'admin',
        canActivate: [adminGuard],
        /** Charge composant. */
        loadComponent: () =>
          import('./features/admin/admin.component').then(m => m.AdminComponent)
      },
      {
        path: 'settings',
        /** Charge composant. */
        loadComponent: () =>
          import('./features/settings/settings.component').then(m => m.SettingsComponent)
      },
      {
        path: 'security',
        /** Charge composant. */
        loadComponent: () =>
          import('./features/tools/security.component').then(m => m.SecurityComponent)
      },
      {
        path: 'prediction',
        /** Charge composant. */
        loadComponent: () =>
          import('./features/analytics/prediction.component').then(m => m.PredictionComponent)
      },
      {
        path: 'not-found',
        /** Charge composant. */
        loadComponent: () => import('./shared/not-found.component').then(m => m.NotFoundComponent)
      },
    ]
  },
  { path: '**', redirectTo: 'not-found' }
];
