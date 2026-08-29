import { Component, OnInit, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { ApiService } from '../../core/services/api.service';
import { ProjectEventsService } from '../../core/services/project-events.service';

@Component({
  selector: 'app-project-form',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './project-form.component.html',
})
export class ProjectFormComponent implements OnInit {
  form!: FormGroup;
  isEdit      = false;
  projectId   = '';
  loading     = false;
  validating  = false;
  saveSuccess = false;
  saveError   = '';
  validationResult: any = null;
  activeSection = 'general';

  sections = [
    { id: 'general',       label: 'Général',      icon: '📋' },
    { id: 'cicd',          label: 'CI/CD',         icon: '⚙️' },
    { id: 'sonarqube',     label: 'SonarQube',     icon: '🔍' },
    { id: 'notifications', label: 'Notifications', icon: '🔔' },
  ];

  constructor(
    private fb: FormBuilder,
    private api: ApiService,
    private router: Router,
    private route: ActivatedRoute,
    private projectEvents: ProjectEventsService,
  ) {}

  ngOnInit() {
    this.buildForm();
    this.projectId = this.route.snapshot.params['id'];
    if (this.projectId) {
      this.isEdit = true;
      this.loadProject();
    }
    // Activer/désactiver champs notifications
    this.form.get('emailEnabled')?.valueChanges.subscribe(v =>
      v ? this.form.get('emailRecipient')?.enable() : this.form.get('emailRecipient')?.disable()
    );
    this.form.get('slackEnabled')?.valueChanges.subscribe(v => {
      v ? this.form.get('slackChannel')?.enable() : this.form.get('slackChannel')?.disable();
    });
  }

  private buildForm() {
    this.form = this.fb.group({
      // Général
      name:        ['', [Validators.required, Validators.minLength(3)]],
      description: [''],
      environment: ['dev'],
      // CI/CD
      cicdTool:       ['jenkins'],
      jenkinsUrl:     [''],
      jenkinsJobName: ['', [Validators.required, Validators.pattern(/^[a-zA-Z0-9._-]+$/)]],
      jenkinsJobPath: [''],
      githubRepo:     ['', [Validators.required, Validators.pattern(/^[\w-]+\/[\w.-]+$/)]],
      // SonarQube
      sonarqubeUrl:   [''],
      sonarqubeKey:   [''],
      // Notifications
      emailEnabled:   [false],
      emailRecipient: [{ value: '', disabled: true }],
      slackEnabled:   [false],
      slackChannel:   [{ value: '', disabled: true }],
    });
  }

  private loadProject() {
    this.loading = true;
    this.api.getProject(this.projectId).subscribe({
      next: (p: any) => {
        this.form.patchValue(p);
        if (p.emailEnabled) this.form.get('emailRecipient')?.enable();
        if (p.slackEnabled) {
          this.form.get('slackChannel')?.enable();
        }
        this.form.markAsPristine();
        this.loading = false;
      },
      error: () => { this.loading = false; }
    });
  }

  save() {
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
        this.saveError = e?.error?.message || 'Erreur lors de la sauvegarde';
      }
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
  getValidIcon(key: string)  { if (!this.validationResult?.results?.[key]) return ''; return this.validationResult.results[key].valid ? '✅' : '❌'; }
  getValidMsg(key: string)   { return this.validationResult?.results?.[key]?.message || ''; }
}
