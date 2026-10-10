import { userHttpError } from '../../core/http-error-message';
import { Component, OnInit, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { ApiService } from '../../core/services/api.service';
import { ProjectEventsService } from '../../core/services/project-events.service';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-project-form',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, FormsModule],
  templateUrl: './project-form.component.html',
  styleUrls: ['./project-form.component.scss'],
})
export class ProjectFormComponent implements OnInit {
  form!: FormGroup;
  isEdit      = false;
  projectId   = '';
  loading     = false;
  // Séparé de `loading` (réservé à save()) : loadProject() ne doit jamais
  // faire afficher le libellé « Sauvegarde… » du bouton pendant un simple
  // chargement -- les deux opérations ne se chevauchent jamais, mais
  // partager le même flag mélangeait leurs libellés.
  projectLoading = false;
  validating  = false;
  saveSuccess = false;
  saveError   = '';
  validationResult: any = null;
  activeSection = 'general';

  // Identifiants Jenkins — flux séparé, write-only, ADMIN-ONLY (jamais
  // mélangé au formulaire général : le token n'est jamais préchargé, jamais
  // relu). Voir PUT /projects/:id/jenkins-credentials.
  jenkinsCredentialConfigured = false;
  jenkinsCredUsername = '';
  jenkinsCredToken = '';
  jenkinsCredBusy = false;
  jenkinsCredMessage = '';
  jenkinsCredSuccess = false;

  // §6 — mêmes icônes que le reste de la plateforme (police « ti »), pas des
  // émojis dont le rendu change d'un système à l'autre.
  sections = [
    { id: 'general',       label: 'Général',   icon: 'ti-file-description' },
    { id: 'cicd',          label: 'CI/CD',     icon: 'ti-git-branch' },
    { id: 'sonarqube',     label: 'SonarQube', icon: 'ti-search' },
    { id: 'sources',       label: 'Sources',   icon: 'ti-link' },
  ];

  constructor(
    private fb: FormBuilder,
    private api: ApiService,
    private router: Router,
    private route: ActivatedRoute,
    private projectEvents: ProjectEventsService,
    public auth: AuthService,
  ) {}

  ngOnInit() {
    this.buildForm();
    this.projectId = this.route.snapshot.params['id'];
    if (this.projectId) {
      this.isEdit = true;
      this.loadProject();
    }
  }

  private buildForm() {
    this.form = this.fb.group({
      // Général
      name:        ['', [Validators.required, Validators.minLength(3)]],
      description: [''],
      environment: ['dev'],
      // CI/CD
      cicdTool:       ['jenkins'],
      jenkinsUrl:         [''],
      jenkinsInternalUrl: [''],
      jenkinsPublicUrl:   [''],
      jenkinsJobName: ['', [Validators.required, Validators.pattern(/^[a-zA-Z0-9._-]+$/)]],
      jenkinsJobPath: [''],
      githubRepo:     ['', [Validators.required, Validators.pattern(/^[\w-]+\/[\w.-]+$/)]],
      // SonarQube
      sonarqubeUrl:   [''],
      sonarqubePublicUrl: [''],
      sonarqubeKey:   [''],
      // Sources / preuves — chemins RÉELS des rapports produits par le
      // pipeline de ce projet, et chemin du Dockerfile. Vides, l'UI affiche
      // « Source non disponible » pour ces preuves : jamais un chemin
      // supposé par convention d'outil (tous les projets ne sont pas Maven).
      trivyReportPath: ['', [Validators.pattern(/^(?:https?:\/\/[^\s<>"']+|(?!.*\.\.)[A-Za-z0-9_.\/@-]+)$/)]],
      owaspReportPath: ['', [Validators.pattern(/^(?:https?:\/\/[^\s<>"']+|(?!.*\.\.)[A-Za-z0-9_.\/@-]+)$/)]],
      zapReportPath:   ['', [Validators.pattern(/^(?:https?:\/\/[^\s<>"']+|(?!.*\.\.)[A-Za-z0-9_.\/@-]+)$/)]],
      dockerfilePath:  ['', [Validators.pattern(/^(?!.*\.\.)[A-Za-z0-9_.\/-]+$/)]],
    });
  }

  private loadProject() {
    this.projectLoading = true;
    this.api.getProject(this.projectId).subscribe({
      next: (p: any) => {
        this.form.patchValue(p);
        this.jenkinsCredentialConfigured = !!p.jenkinsCredentialConfigured;
        this.form.markAsPristine();
        this.projectLoading = false;
      },
      error: () => { this.saveError = 'Impossible de charger la configuration du projet. Actualisez la page pour réessayer.'; this.projectLoading = false; }
    });
  }

  save() {
    if (this.loading || this.projectLoading) return;
    if (this.form.invalid) { this.form.markAllAsTouched(); return; }
    this.loading = true;
    this.saveError = '';
    this.saveSuccess = false;

    const payload = this.form.getRawValue();

    const req = this.isEdit
      ? this.api.updateProject(this.projectId, payload)
      : this.api.createProject(payload);

    const wasCreate = !this.isEdit;
    req.subscribe({
      next: (p: any) => {
        this.loading = false;
        this.saveSuccess = true;
        this.form.markAsPristine();
        if (!this.isEdit) { this.projectId = p.id; this.isEdit = true; }
        if (wasCreate) this.projectEvents.notifyChanged();
        this.validateProject();
      },
      error: (e: any) => {
        this.loading = false;
        this.saveError = userHttpError(e, 'Impossible d’enregistrer le projet. Vérifiez les champs puis réessayez.');
      }
    });
  }

  saveJenkinsCredentials() {
    if (!this.projectId || !this.jenkinsCredUsername || !this.jenkinsCredToken) return;
    this.jenkinsCredBusy = true;
    this.jenkinsCredMessage = '';
    this.api.updateJenkinsCredentials(this.projectId, this.jenkinsCredUsername, this.jenkinsCredToken).subscribe({
      next: () => {
        this.jenkinsCredBusy = false;
        this.jenkinsCredSuccess = true;
        this.jenkinsCredMessage = 'Connexion Jenkins vérifiée.';
        this.jenkinsCredentialConfigured = true;
        // Le token n'est jamais reconservé côté client une fois envoyé.
        this.jenkinsCredUsername = '';
        this.jenkinsCredToken = '';
      },
      error: (e: any) => {
        this.jenkinsCredBusy = false;
        this.jenkinsCredSuccess = false;
        this.jenkinsCredMessage = userHttpError(e, 'Vérifiez les identifiants Jenkins puis réessayez.');
        this.jenkinsCredToken = '';
      },
    });
  }

  validateProject() {
    if (!this.projectId) return;
    this.validating = true;
    this.validationResult = null;
    this.api.validateProject(this.projectId).subscribe({
      next:  (r: any) => { this.validating = false; this.validationResult = r; },
      error: ()       => { this.validating = false; this.validationResult = { overallValid: false, results: {} }; }
    });
  }

  goBack()            { this.router.navigate(this.isEdit ? ['/projects', this.projectId] : ['/projects']); }
  hasUnsavedChanges() { return !!this.form?.dirty && !this.saveSuccess; }
  @HostListener('window:beforeunload', ['$event'])
  warnUnsaved(event: BeforeUnloadEvent) { if (this.form?.dirty && !this.saveSuccess) event.preventDefault(); }
  setSection(id: string) { this.activeSection = id; }
  get f()             { return this.form.controls; }
  isInvalid(field: string) { const c = this.form.get(field); return !!(c?.invalid && (c.dirty || c.touched)); }
  getValidIcon(key: string)  { if (!this.validationResult?.results?.[key]) return ''; return this.validationResult.results[key].valid ? '✓' : '✕'; }
  getValidMsg(key: string)   { return this.validationResult?.results?.[key]?.message || ''; }
}
