import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { ApiService } from '../../core/services/api.service';

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
      v ? this.form.get('slackToken')?.enable()   : this.form.get('slackToken')?.disable();
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
      jenkinsJobName: [''],
      jenkinsToken:   [''],
      githubRepo:     [''],
      githubToken:    [''],
      // SonarQube
      sonarqubeUrl:   [''],
      sonarqubeKey:   [''],
      sonarqubeToken: [''],
      // Notifications
      emailEnabled:   [false],
      emailRecipient: [{ value: '', disabled: true }],
      slackEnabled:   [false],
      slackChannel:   [{ value: '', disabled: true }],
      slackToken:     [{ value: '', disabled: true }],
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
          this.form.get('slackToken')?.enable();
        }
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

    req.subscribe({
      next: (p: any) => {
        this.loading = false;
        this.saveSuccess = true;
        if (!this.isEdit) { this.projectId = p.id; this.isEdit = true; }
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

  goBack()            { this.router.navigate(['/projects']); }
  setSection(id: string) { this.activeSection = id; }
  get f()             { return this.form.controls; }
  isInvalid(field: string) { const c = this.form.get(field); return !!(c?.invalid && (c.dirty || c.touched)); }
  getValidIcon(key: string)  { if (!this.validationResult?.results?.[key]) return ''; return this.validationResult.results[key].valid ? '✅' : '❌'; }
  getValidMsg(key: string)   { return this.validationResult?.results?.[key]?.message || ''; }
}
