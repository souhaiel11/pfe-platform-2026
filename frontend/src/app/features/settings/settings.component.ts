import { configuredIntegrationTools, integrationStatusLabel, enforcementModeLabel, editTypeLabel, scannerEvidenceLabel } from '../../shared/platform-capability-presentation';
import { pipelineStageLabel } from '../../shared/pipeline-stage-presentation';
import { userHttpError } from '../../core/http-error-message';
import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ToastService } from '../../core/services/toast.service';
import { ApiService } from '../../core/services/api.service';
import { AuthService } from '../../core/services/auth.service';
import { FrenchDatePipe } from '../../shared/french-date.pipe';

interface ToolConfig {
  editable?: boolean;
  toolType: string;
  name: string;
  icon: string;
  color: string;
  description: string;
  authType: 'token' | 'basic' | 'none';
  tokenLabel: string;
  id?: string;
  url: string;
  token: string;
  username: string;
  password: string;
  // Le backend ne renvoie plus jamais la valeur réelle (voir integrations.service.ts
  // sanitize()) — seule sa présence est connue, pour afficher "déjà configuré".
  hasToken: boolean;
  hasPassword: boolean;
  enabled: boolean;
  status: 'connected' | 'disconnected' | 'error';
  lastChecked?: string;
  metadata?: any;
  original?: string;
  expanded: boolean;
  testing: boolean;
  saving: boolean;
}

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule, FormsModule, FrenchDatePipe],
  templateUrl: './settings.component.html',
  styleUrls: ['./settings.component.scss'],
})
export class SettingsComponent implements OnInit {
  tools: ToolConfig[] = [];
  integrationsState: 'LOADING' | 'LOADED' | 'EMPTY' | 'ERROR' = 'LOADING';
  capabilitiesState: 'LOADING' | 'LOADED' | 'ERROR' = 'LOADING';
  capabilities: any = null;
  effectiveConfigState: 'LOADING' | 'LOADED' | 'ERROR' = 'LOADING';
  effectiveConfig: any = null;

  loadEffectiveConfig() {
    this.effectiveConfigState = 'LOADING';
    this.effectiveConfig = null;
    this.api.getEffectiveConfig().subscribe({
      next: data => { this.effectiveConfig = data; this.effectiveConfigState = 'LOADED'; },
      error: () => { this.effectiveConfigState = 'ERROR'; },
    });
  }

  availabilityLabel(value: boolean | null | undefined) {
    return value === true ? 'Disponible' : value === false ? 'Indisponible' : 'Disponibilité non déterminée';
  }

  configuredLabel(value: boolean | null | undefined) {
    return value === true ? 'Oui' : value === false ? 'Non' : 'Valeur indisponible';
  }

  durationLabel(value: number | null | undefined) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0
      ? new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(value / 3600000) + ' h'
      : 'Valeur indisponible';
  }
  integrationStatusLabel = integrationStatusLabel;
  enforcementModeLabel = enforcementModeLabel;
  editTypeLabel = editTypeLabel;
  scannerEvidenceLabel = scannerEvidenceLabel;
  pipelineStageLabel = pipelineStageLabel;

  constructor(private toast: ToastService, private api: ApiService, public auth: AuthService) {}
  projects: any[] = [];
  projectsState: 'LOADING' | 'LOADED' | 'EMPTY' | 'ERROR' = 'LOADING';
  selectedProjectId = '';
  project: any = null;
  projectState: 'LOADING' | 'LOADED' | 'ERROR' = 'LOADING';
  projectDraft: Record<string, string> = {};
  projectOriginal: Record<string, string> = {};
  projectSaving = false;
  projectTesting = false;
  projectMessage = '';
  credentialUsername = '';
  credentialToken = '';
  credentialSaving = false;
  private projectRequest = 0;
  readonly projectSections = [
    { title: 'Projet / dépôt', fields: [{key:'githubRepo',label:'Dépôt GitHub (propriétaire/dépôt)',kind:'repo'}] },
    { title: 'Jenkins', fields: [
      {key:'jenkinsInternalUrl',label:'URL du serveur — appels backend',kind:'url'},
      {key:'jenkinsPublicUrl',label:'URL du serveur — liens navigateur',kind:'url'},
      {key:'jenkinsJobName',label:'Nom du job',kind:'text'},
      {key:'jenkinsJobPath',label:'Chemin du job',kind:'text'}] },
    { title: 'SonarQube', fields: [{key:'sonarqubeUrl',label:'URL du serveur',kind:'url'},{key:'sonarqubeKey',label:'Clé du projet',kind:'key'}] },
    { title: 'Azure / déploiement', fields: [
      {key:'azure.resourceGroup',label:'Groupe de ressources',kind:'text'},
      {key:'azure.targetName',label:'Identifiant de la cible',kind:'text'},
      {key:'azure.registry',label:'Registre des images',kind:'text'},
      {key:'azure.imageRepository',label:'Dépôt des images',kind:'text'},
      {key:'azure.region',label:'Région',kind:'text'}] },
  ];

  loadProjects() {
    this.projectsState = 'LOADING';
    this.projects = [];
    this.api.getProjects().subscribe({
      next: rows => {
        this.projects = rows || [];
        this.projectsState = this.projects.length ? 'LOADED' : 'EMPTY';
        if (this.projects.length) {
          if (!this.projects.some(p => p.id === this.selectedProjectId)) this.selectedProjectId = this.projects[0].id;
          this.selectProject();
        } else { this.project = null; this.projectRequest++; }
      },
      error: () => { this.projectsState = 'ERROR'; this.project = null; this.projectRequest++; },
    });
  }

  selectProject() {
    if (this.projectSaving || this.projectTesting || this.credentialSaving) return;
    const request = ++this.projectRequest;
    const id = this.selectedProjectId;
    this.project = null;
    this.projectState = 'LOADING';
    this.projectMessage = '';
    this.credentialUsername = ''; this.credentialToken = '';
    this.api.getProject(id).subscribe({
      next: project => { if (request === this.projectRequest) { this.setProject(project); this.projectState = 'LOADED'; } },
      error: () => { if (request === this.projectRequest) this.projectState = 'ERROR'; },
    });
  }

  private setProject(project: any) {
    this.project = project;
    const draft: Record<string, string> = {};
    for (const section of this.projectSections) for (const field of section.fields) {
      draft[field.key] = String(field.key.startsWith('azure.') ? project.azureConfig?.[field.key.slice(6)] || '' : project[field.key] || '');
    }
    this.projectDraft = draft;
    this.projectOriginal = {...draft};
  }

  get projectDirty() { return Object.keys(this.projectDraft).some(key => this.projectDraft[key] !== this.projectOriginal[key]); }
  validUrl(value: string) {
    try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !!url.hostname && !url.username && !url.password && !url.hash && !url.search; } catch { return false; }
  }
  fieldInvalid(field: {key:string;kind:string}) {
    const value = (this.projectDraft[field.key] || '').trim();
    if (value === this.projectOriginal[field.key]) return false;
    if (!value) return field.key !== 'azure.region';
    if (field.kind === 'url') return !this.validUrl(value);
    if (field.kind === 'repo') return !/^[\w.-]+\/[\w.-]+$/.test(value);
    if (field.kind === 'key') return !/^(?=.*[^0-9])[A-Za-z0-9_.:-]+$/.test(value);
    return false;
  }
  get projectInvalid() { return this.projectSections.some(section => section.fields.some(field => this.fieldInvalid(field))); }
  cancelProject() { if (this.project && !this.projectSaving) this.setProject(this.project); this.projectMessage = ''; this.credentialUsername = ''; this.credentialToken = ''; }

  saveProject() {
    if (!this.canEdit || !this.project || !this.projectDirty || this.projectInvalid || this.projectSaving || this.projectTesting || this.credentialSaving) return;
    const payload: any = {};
    for (const key of Object.keys(this.projectDraft)) {
      if (this.projectDraft[key] === this.projectOriginal[key]) continue;
      if (key.startsWith('azure.')) {
        if (!this.project.azureConfig) return;
        payload.azureConfig = payload.azureConfig || {...this.project.azureConfig};
        payload.azureConfig[key.slice(6)] = this.projectDraft[key].trim();
      } else payload[key] = this.projectDraft[key].trim();
    }
    this.projectSaving = true; this.projectMessage = '';
    this.api.updateProject(this.project.id, payload).subscribe({
      next: project => { this.projectSaving = false; this.setProject(project); this.projectMessage = 'Configuration enregistrée.'; },
      error: error => { this.projectSaving = false; this.projectMessage = userHttpError(error, 'Impossible d’enregistrer la configuration. Vérifiez les champs puis réessayez.'); },
    });
  }

  testProject() {
    if (!this.canEdit || !this.project || this.projectDirty || this.projectTesting || this.projectSaving || this.credentialSaving) return;
    this.projectTesting = true; this.projectMessage = '';
    this.api.validateProject(this.project.id).subscribe({
      next: response => {
        this.projectTesting = false;
        this.project.validationStatus = response.results || {};
        this.projectMessage = Object.keys(response.results || {}).length ? 'Vérification terminée. Consultez les résultats datés ci-dessous.' : 'Aucune connexion vérifiable avec cette configuration.';
      },
      error: () => { this.projectTesting = false; this.projectMessage = 'Échec de la vérification. Réessayez après avoir contrôlé la configuration.'; },
    });
  }

  replaceJenkinsCredential() {
    if (!this.auth.isAdmin || !this.project || this.projectDirty || this.projectSaving || this.projectTesting || this.credentialSaving || !this.credentialUsername.trim() || !this.credentialToken.trim()) return;
    this.credentialSaving = true;
    const token = this.credentialToken; this.credentialToken = '';
    this.api.updateJenkinsCredentials(this.project.id, this.credentialUsername.trim(), token).subscribe({
      next: () => { this.credentialSaving = false; this.credentialUsername = ''; this.selectProject(); this.toast.success('Configuration enregistrée', 'Authentification Jenkins vérifiée et enregistrée.'); },
      error: () => { this.credentialSaving = false; this.projectMessage = 'Échec de l’enregistrement des identifiants Jenkins. Vérifiez les autorisations et réessayez.'; },
    });
  }

  environmentLabel(value: string) { return ({dev:'Développement',development:'Développement',staging:'Validation',prod:'Production',production:'Production',test:'Test'} as Record<string,string>)[value] || 'Valeur indisponible'; }

  diagnosticLabel(value: any) { return !value?.checkedAt ? 'Connexion non vérifiée' : value.valid === true ? 'Disponible lors de la dernière vérification' : value.valid === false ? 'Indisponible lors de la dernière vérification' : 'Échec de la vérification'; }

  private toolSnapshot(tool: ToolConfig) { return JSON.stringify({url:tool.url,username:tool.username,enabled:tool.enabled}); }
  toolDirty(tool: ToolConfig) { return !!tool.token || !!tool.password || tool.original !== this.toolSnapshot(tool); }
  toolInvalid(tool: ToolConfig) { return !this.validUrl(tool.url); }
  cancelTool(tool: ToolConfig) { if (tool.original) Object.assign(tool,JSON.parse(tool.original)); tool.token=''; tool.password=''; }

  get canEdit() { return ['admin', 'developer'].includes(this.auth.currentUser?.role); }

  ngOnInit() { this.loadIntegrations(); this.loadCapabilities(); this.loadEffectiveConfig(); this.loadProjects(); }

  loadIntegrations() {
    this.integrationsState = 'LOADING';
    this.tools = [];
    this.api.getIntegrations().subscribe({
      next: rows => {
        this.tools = configuredIntegrationTools(rows || []);
        this.tools.forEach(tool => tool.original = this.toolSnapshot(tool));
        this.integrationsState = this.tools.length ? 'LOADED' : 'EMPTY';
      },
      error: () => { this.integrationsState = 'ERROR'; },
    });
  }

  loadCapabilities() {
    this.capabilitiesState = 'LOADING';
    this.capabilities = null;
    this.api.getPlatformCapabilities().subscribe({
      next: data => { this.capabilities = data; this.capabilitiesState = 'LOADED'; },
      error: () => { this.capabilitiesState = 'ERROR'; },
    });
  }

  toggle(tool: ToolConfig) {
    tool.expanded = !tool.expanded;
  }

  saveTool(tool: ToolConfig) {
    if (!this.canEdit || !tool.editable || tool.saving || tool.testing || this.toolInvalid(tool) || !this.toolDirty(tool)) return;
    tool.saving = true;

    const payload = {
      toolType: tool.toolType,
      name: tool.name,
      url: tool.url,
      token:    tool.token    || null,
      username: tool.username || null,
      password: tool.password || null,
      enabled:  tool.enabled,
    };

    const req$ = tool.id
      ? this.api.updateIntegration(tool.id, payload)
      : this.api.createIntegration(payload);

    req$.subscribe({
      next: (result) => {
        tool.id     = result.id;
        tool.status = result.status;
        tool.hasToken = !!result.hasToken;
        tool.hasPassword = !!result.hasPassword;
        tool.token = '';
        tool.password = '';
        tool.original = this.toolSnapshot(tool);
        tool.saving = false;
        this.toast.success(`${tool.name} enregistré`, 'Configuration sauvegardée');
      },
      error: (e) => {
        tool.saving = false;
        this.toast.error(`Erreur sauvegarde ${tool.name}`, userHttpError(e, 'Vérifiez la configuration et la connexion au service, puis réessayez.'));
      },
    });
  }

  testTool(tool: ToolConfig) {
    if (!this.canEdit || !tool.editable || tool.testing || tool.saving || !tool.id || this.toolDirty(tool) || this.toolInvalid(tool)) return;
    tool.testing = true;

    const doTest = (id: string) => {
      this.api.testIntegration(id).subscribe({
        next: (result) => {
          tool.status   = result.status;
          tool.metadata = result.metadata || null;
          this.api.getIntegration(id).subscribe({ next: saved => tool.lastChecked = saved.lastChecked, error: () => tool.lastChecked = undefined });
          tool.testing  = false;
          if (result.success) {
            this.toast.success(`${tool.name} connecté`, 'Connexion établie avec succès');
          } else {
            this.toast.error(`${tool.name} inaccessible`, 'Impossible de joindre le service. Vérifiez son URL et ses identifiants, puis réessayez.');
          }
        },
        error: (e) => {
          tool.testing = false;
          this.toast.error(`Erreur test ${tool.name}`, userHttpError(e, 'Vérifiez la configuration et la connexion au service, puis réessayez.'));
        },
      });
    };

    if (!tool.id || this.toolDirty(tool) || this.toolInvalid(tool) || tool.saving) { tool.testing = false; return; }
    doTest(tool.id);
  }

  getSecretPlaceholder(hasSecret: boolean, generic: string): string {
    return hasSecret ? 'Déjà configuré — laisser vide pour ne pas changer' : generic;
  }

  getUrlPlaceholder(_type: string): string { return 'URL réelle du service'; }

  getMetaEntries(metadata: any): { key: string; val: string }[] {
    if (!metadata) return [];
    return Object.entries(metadata).map(([key, val]) => ({ key, val: String(val) }));
  }

}
