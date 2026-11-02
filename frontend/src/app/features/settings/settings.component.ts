// Gère l’affichage et les actions de paramètres.
import { jenkinsSettingsPresentation } from './jenkins-settings-presentation';
import { generalSettingsSummary } from './general-settings-presentation';
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
  activeSection = 'general';
  readonly settingsSections = [
    {id:'general',label:'Général'}, {id:'integrations',label:'Intégrations'},
    {id:'security',label:'Sécurité'}, {id:'delivery',label:'CI/CD et déploiement'},
    {id:'diagnostics',label:'Diagnostics'},
  ];
  readinessState: 'IDLE' | 'LOADING' | 'LOADED' | 'ERROR' = 'IDLE';
  deployReadiness: any = null;
  private readinessRequest = 0;

  /** Change d'onglet de réglages et déclenche la lecture de gouvernance de déploiement la première fois qu'on ouvre "CI/CD et déploiement". */
  setSettingsSection(id: string) {
    if (!this.settingsSections.some(section => section.id === id)) return;
    this.activeSection = id;
    if (id === 'delivery' && this.project && this.readinessState === 'IDLE') this.loadDeployReadiness();
  }

  /** Navigation clavier entre onglets (flèches gauche/droite, Début/Fin), avec déplacement du focus. */
  navigateSettings(event: KeyboardEvent, index: number) {
    const last = this.settingsSections.length - 1;
    const next = event.key === 'ArrowRight' ? (index + 1) % this.settingsSections.length
      : event.key === 'ArrowLeft' ? (index + last) % this.settingsSections.length
      : event.key === 'Home' ? 0 : event.key === 'End' ? last : null;
    if (next === null) return;
    event.preventDefault();
    this.setSettingsSection(this.settingsSections[next].id);
    const nav = (event.currentTarget as HTMLElement)?.parentElement;
    (nav?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next])?.focus();
  }

  /** Identifie projet Section. */
  trackProjectSection(_index: number, section: {title:string}) { return section.title; }

  /** Filtre les sections de champs projet selon l'onglet actif : champs de connexion dans "Intégrations", le reste ailleurs. */
  get visibleProjectSections() {
    const connectionFields = new Set(['githubRepo','jenkinsInternalUrl','jenkinsPublicUrl','sonarqubeUrl','sonarqubeKey','azure.registry','azure.imageRepository']);
    return this.projectSections.map(section => ({...section,fields:section.fields.filter(field =>
      this.activeSection === 'integrations' ? connectionFields.has(field.key) : !connectionFields.has(field.key))})).filter(section => section.fields.length);
  }

  /** Décrit les scanners configurés et leur disponibilité. */
  get securityScanners() { return (this.capabilities?.security || []).filter((scanner: any) => ['sonar','owasp','trivy','zap'].includes(scanner.id)); }
  /** Résume la configuration des contrôles de sécurité. */
  securityDescription(id: string) {
    return ({sonar:'Analyse de qualité et de sécurité du code.',owasp:'Analyse des dépendances du projet.',trivy:'Analyse de sécurité des images et conteneurs.',zap:'Tests dynamiques de sécurité sur une application accessible.'} as Record<string,string>)[id] || 'Capacité de sécurité rapportée par le backend.';
  }

  /** Récupère l'état de gouvernance du déploiement pour le projet sélectionné ; les réponses tardives d'un projet déjà changé sont ignorées (requête numérotée). */
  loadDeployReadiness() {
    if (!this.project) return;
    const id = this.project.id;
    const request = ++this.readinessRequest;
    this.readinessState = 'LOADING'; this.deployReadiness = null;
    this.api.getDeployReadiness(id).subscribe({
      /** Traite le résultat reçu et actualise les données locales. */
      next: data => { if (request === this.readinessRequest && this.project?.id === id) { this.deployReadiness = data; this.readinessState = 'LOADED'; } },
      /** Traite l’erreur reçue et termine le suivi de la demande. */
      error: () => { if (request === this.readinessRequest && this.project?.id === id) this.readinessState = 'ERROR'; },
    });
  }
  /** Traduit la règle de contrôle du déploiement. */
  deploymentGateLabel() { return this.deployReadiness?.ready === true ? 'Déploiement autorisé par les contrôles' : this.deployReadiness?.ready === false ? 'Déploiement non autorisé par les contrôles' : 'État non disponible'; }

  /** Résume les paramètres de connexion Jenkins. */
  get jenkinsSummary() { return jenkinsSettingsPresentation(this.project); }

  /** Résume les paramètres généraux de la plateforme. */
  get generalSummary() { return generalSettingsSummary(this.project, this.capabilities); }
  tools: ToolConfig[] = [];
  integrationsState: 'LOADING' | 'LOADED' | 'EMPTY' | 'ERROR' = 'LOADING';
  capabilitiesState: 'LOADING' | 'LOADED' | 'ERROR' = 'LOADING';
  capabilities: any = null;
  /** Traduit l’état de disponibilité du service. */
  availabilityLabel(value: boolean | null | undefined) {
    return value === true ? 'Disponible' : value === false ? 'Indisponible' : 'Disponibilité non déterminée';
  }

  /** Indique si le paramètre est configuré. */
  configuredLabel(value: boolean | null | undefined) {
    return value === true ? 'Oui' : value === false ? 'Non' : 'Valeur indisponible';
  }

  /** Convertit une durée en millisecondes en heures affichables, ou signale l'absence de valeur. */
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

  /** Initialise les dépendances et l’état de ce composant. */
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

  /** Charge la liste des projets, sélectionne le premier par défaut, et déclenche le chargement de ses détails. */
  loadProjects() {
    this.projectsState = 'LOADING';
    this.projects = [];
    this.api.getProjects().subscribe({
      /** Traite le résultat reçu et actualise les données locales. */
      next: rows => {
        this.projects = rows || [];
        this.projectsState = this.projects.length ? 'LOADED' : 'EMPTY';
        if (this.projects.length) {
          if (!this.projects.some(p => p.id === this.selectedProjectId)) this.selectedProjectId = this.projects[0].id;
          this.selectProject();
        } else { this.project = null; this.projectRequest++; }
      },
      /** Traite l’erreur reçue et termine le suivi de la demande. */
      error: () => { this.projectsState = 'ERROR'; this.project = null; this.projectRequest++; },
    });
  }

  /** Charge le projet sélectionné (bloqué si une sauvegarde/vérification est en cours) ; une réponse tardive d'un projet déjà quitté est ignorée. */
  selectProject() {
    if (this.projectSaving || this.projectTesting || this.credentialSaving) return;
    const request = ++this.projectRequest;
    const id = this.selectedProjectId;
    this.project = null;
    this.deployReadiness = null; this.readinessState = 'IDLE'; this.readinessRequest++;
    this.projectState = 'LOADING';
    this.projectMessage = '';
    this.credentialUsername = ''; this.credentialToken = '';
    this.api.getProject(id).subscribe({
      /** Traite le résultat reçu et actualise les données locales. */
      next: project => { if (request === this.projectRequest) { this.setProject(project); this.projectState = 'LOADED'; if (this.activeSection === 'delivery') this.loadDeployReadiness(); } },
      /** Traite l’erreur reçue et termine le suivi de la demande. */
      error: () => { if (request === this.projectRequest) this.projectState = 'ERROR'; },
    });
  }

  /** Installe le projet courant et reconstruit le brouillon de formulaire (champs à plat, y compris azureConfig aplati en "azure.*"). */
  private setProject(project: any) {
    this.project = project;
    this.deployReadiness = null; this.readinessState = 'IDLE'; this.readinessRequest++;
    const draft: Record<string, string> = {};
    for (const section of this.projectSections) for (const field of section.fields) {
      draft[field.key] = String(field.key.startsWith('azure.') ? project.azureConfig?.[field.key.slice(6)] || '' : project[field.key] || '');
    }
    this.projectDraft = draft;
    this.projectOriginal = {...draft};
  }

  /** Indique si les paramètres du projet ont changé. */
  get projectDirty() { return Object.keys(this.projectDraft).some(key => this.projectDraft[key] !== this.projectOriginal[key]); }
  /** Valide qu'une URL est http(s), a un hôte, et ne porte ni identifiants ni fragment ni requête intégrés. */
  validUrl(value: string) {
    try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !!url.hostname && !url.username && !url.password && !url.hash && !url.search; } catch { return false; }
  }
  /** Valide un champ modifié selon son type (URL, "propriétaire/dépôt", clé) ; un champ inchangé n'est jamais signalé invalide. */
  fieldInvalid(field: {key:string;kind:string}) {
    const value = (this.projectDraft[field.key] || '').trim();
    if (value === this.projectOriginal[field.key]) return false;
    if (!value) return field.key !== 'azure.region';
    if (field.kind === 'url') return !this.validUrl(value);
    if (field.kind === 'repo') return !/^[\w.-]+\/[\w.-]+$/.test(value);
    if (field.kind === 'key') return !/^(?=.*[^0-9])[A-Za-z0-9_.:-]+$/.test(value);
    return false;
  }
  /** Vrai si la configuration Azure est incomplète après modification, ou si un champ quelconque échoue sa validation. */
  get projectInvalid() {
    const azureChanged = Object.keys(this.projectDraft).some(key => key.startsWith('azure.') && this.projectDraft[key] !== this.projectOriginal[key]);
    if (azureChanged && ['resourceGroup', 'targetName', 'registry', 'imageRepository'].some(key => !this.projectDraft['azure.' + key]?.trim())) return true;
    return this.projectSections.some(section => section.fields.some(field => this.fieldInvalid(field))); }
  /** Annule le projet. */
  cancelProject() { if (this.project && !this.projectSaving) this.setProject(this.project); this.projectMessage = ''; this.credentialUsername = ''; this.credentialToken = ''; }

  /** Envoie uniquement les champs réellement modifiés (dont azureConfig reconstitué) à l'API de mise à jour du projet. */
  saveProject() {
    if (!this.canEdit || !this.project || !this.projectDirty || this.projectInvalid || this.projectSaving || this.projectTesting || this.credentialSaving) return;
    const payload: any = {};
    for (const key of Object.keys(this.projectDraft)) {
      if (this.projectDraft[key] === this.projectOriginal[key]) continue;
      if (key.startsWith('azure.')) {
        payload.azureConfig = payload.azureConfig || {provider: 'azure-container-instances', ...this.project.azureConfig};
        payload.azureConfig[key.slice(6)] = this.projectDraft[key].trim();
      } else payload[key] = this.projectDraft[key].trim();
    }
    this.projectSaving = true; this.projectMessage = '';
    this.api.updateProject(this.project.id, payload).subscribe({
      /** Traite le résultat reçu et actualise les données locales. */
      next: project => { this.projectSaving = false; this.setProject(project); this.projectMessage = 'Configuration enregistrée.'; if (this.activeSection === 'delivery') this.loadDeployReadiness(); },
      /** Traite l’erreur reçue et termine le suivi de la demande. */
      error: error => { this.projectSaving = false; this.projectMessage = userHttpError(error, 'Impossible d’enregistrer la configuration. Vérifiez les champs puis réessayez.'); },
    });
  }

  /** Lance la vérification de connectivité (SonarQube/Jenkins/Trivy) pour la configuration déjà enregistrée du projet. */
  testProject() {
    if (!this.canEdit || !this.project || this.projectDirty || this.projectTesting || this.projectSaving || this.credentialSaving) return;
    this.projectTesting = true; this.projectMessage = '';
    this.api.validateProject(this.project.id).subscribe({
      /** Traite le résultat reçu et actualise les données locales. */
      next: response => {
        this.projectTesting = false;
        this.project.validationStatus = response.results || {};
        this.projectMessage = Object.keys(response.results || {}).length ? 'Vérification terminée. Consultez les résultats datés ci-dessous.' : 'Aucune connexion vérifiable avec cette configuration.';
      },
      /** Traite l’erreur reçue et termine le suivi de la demande. */
      error: () => { this.projectTesting = false; this.projectMessage = 'Échec de la vérification. Réessayez après avoir contrôlé la configuration.'; },
    });
  }

  /** Remplace l'identifiant Jenkins (admin uniquement) ; le jeton saisi est vidé de la mémoire du composant dès l'envoi. */
  replaceJenkinsCredential() {
    if (!this.auth.isAdmin || !this.project || this.projectDirty || this.projectSaving || this.projectTesting || this.credentialSaving || !this.credentialUsername.trim() || !this.credentialToken.trim()) return;
    this.credentialSaving = true;
    const token = this.credentialToken; this.credentialToken = '';
    this.api.updateJenkinsCredentials(this.project.id, this.credentialUsername.trim(), token).subscribe({
      /** Traite le résultat reçu et actualise les données locales. */
      next: () => { this.credentialSaving = false; this.credentialUsername = ''; this.selectProject(); this.toast.success('Configuration enregistrée', 'Authentification Jenkins vérifiée et enregistrée.'); },
      /** Traite l’erreur reçue et termine le suivi de la demande. */
      error: () => { this.credentialSaving = false; this.projectMessage = 'Échec de l’enregistrement des identifiants Jenkins. Vérifiez les autorisations et réessayez.'; },
    });
  }

  /** Présente le nom de l’environnement. */
  environmentLabel(value: string) { return ({dev:'Développement',development:'Développement',staging:'Validation',prod:'Production',production:'Production',test:'Test'} as Record<string,string>)[value] || 'Valeur indisponible'; }

  /** Présente le résultat du test de connexion. */
  diagnosticLabel(value: any) { return !value?.checkedAt ? 'Connexion non vérifiée' : value.valid === true ? 'Disponible lors de la dernière vérification' : value.valid === false ? 'Indisponible lors de la dernière vérification' : 'Échec de la vérification'; }

  /** Empreinte des champs non sensibles d'un outil, utilisée pour détecter une modification sans comparer les secrets. */
  private toolSnapshot(tool: ToolConfig) { return JSON.stringify({url:tool.url,username:tool.username,enabled:tool.enabled}); }
  /** Un outil est "modifié" si un secret a été saisi ou si son empreinte non sensible a changé. */
  toolDirty(tool: ToolConfig) { return !!tool.token || !!tool.password || tool.original !== this.toolSnapshot(tool); }
  /** Indique si les paramètres de l’outil sont invalides. */
  toolInvalid(tool: ToolConfig) { return !this.validUrl(tool.url); }
  /** Annule les modifications d'un outil en restaurant son dernier instantané sauvegardé et en vidant les champs secrets. */
  cancelTool(tool: ToolConfig) { if (tool.original) Object.assign(tool,JSON.parse(tool.original)); tool.token=''; tool.password=''; }

  /** Vérifie si l’action est autorisée : Edit. */
  get canEdit() { return ['admin', 'developer'].includes(this.auth.currentUser?.role); }

  /** Lance les 3 chargements initiaux de la page réglages. */
  ngOnInit() { this.loadIntegrations(); this.loadCapabilities(); this.loadProjects(); }

  /** Récupère les intégrations existantes et initialise l'empreinte de détection de modification de chacune. */
  loadIntegrations() {
    this.integrationsState = 'LOADING';
    this.tools = [];
    this.api.getIntegrations().subscribe({
      /** Traite le résultat reçu et actualise les données locales. */
      next: rows => {
        this.tools = configuredIntegrationTools(rows || []);
        this.tools.forEach(tool => tool.original = this.toolSnapshot(tool));
        this.integrationsState = this.tools.length ? 'LOADED' : 'EMPTY';
      },
      /** Traite l’erreur reçue et termine le suivi de la demande. */
      error: () => { this.integrationsState = 'ERROR'; },
    });
  }

  /** Récupère les capacités plateforme (scanners actifs, mode de remédiation, etc.) pour les onglets Sécurité/Diagnostics. */
  loadCapabilities() {
    this.capabilitiesState = 'LOADING';
    this.capabilities = null;
    this.api.getPlatformCapabilities().subscribe({
      /** Traite le résultat reçu et actualise les données locales. */
      next: data => { this.capabilities = data; this.capabilitiesState = 'LOADED'; },
      /** Traite l’erreur reçue et termine le suivi de la demande. */
      error: () => { this.capabilitiesState = 'ERROR'; },
    });
  }

  /** Bascule l’option ou la sélection demandée. */
  toggle(tool: ToolConfig) {
    tool.expanded = !tool.expanded;
  }

  /** Crée ou met à jour un outil d'intégration ; les secrets ne sont envoyés que s'ils ont été saisis, et vidés localement après succès. */
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
      /** Traite le résultat reçu et actualise les données locales. */
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
      /** Traite l’erreur reçue et termine le suivi de la demande. */
      error: (e) => {
        tool.saving = false;
        this.toast.error(`Erreur sauvegarde ${tool.name}`, userHttpError(e, 'Vérifiez la configuration et la connexion au service, puis réessayez.'));
      },
    });
  }

  /** Teste la connectivité réelle d'un outil déjà enregistré et rafraîchit sa date de dernière vérification. */
  testTool(tool: ToolConfig) {
    if (!this.canEdit || !tool.editable || tool.testing || tool.saving || !tool.id || this.toolDirty(tool) || this.toolInvalid(tool)) return;
    tool.testing = true;

    /** Exécute le test de connexion de l’intégration. */
    const doTest = (id: string) => {
      this.api.testIntegration(id).subscribe({
        /** Traite le résultat reçu et actualise les données locales. */
        next: (result) => {
          tool.status   = result.status;
          tool.metadata = result.metadata || null;
          this.api.getIntegration(id).subscribe({
          /** Traite le résultat reçu et actualise les données locales. */
          next: saved => tool.lastChecked = saved.lastChecked,
          /** Traite l’erreur reçue et termine le suivi de la demande. */
          error: () => tool.lastChecked = undefined });
          tool.testing  = false;
          if (result.success) {
            this.toast.success(`${tool.name} connecté`, 'Connexion établie avec succès');
          } else {
            this.toast.error(`${tool.name} inaccessible`, 'Impossible de joindre le service. Vérifiez son URL et ses identifiants, puis réessayez.');
          }
        },
        /** Traite l’erreur reçue et termine le suivi de la demande. */
        error: (e) => {
          tool.testing = false;
          this.toast.error(`Erreur test ${tool.name}`, userHttpError(e, 'Vérifiez la configuration et la connexion au service, puis réessayez.'));
        },
      });
    };

    if (!tool.id || this.toolDirty(tool) || this.toolInvalid(tool) || tool.saving) { tool.testing = false; return; }
    doTest(tool.id);
  }

  /** Renvoie secret Placeholder. */
  getSecretPlaceholder(hasSecret: boolean, generic: string): string {
    return hasSecret ? 'Déjà configuré — laisser vide pour ne pas changer' : generic;
  }

  /** Renvoie URL Placeholder. */
  getUrlPlaceholder(_type: string): string { return 'URL réelle du service'; }

  /** Transforme les métadonnées de test d'un outil (objet libre) en paires clé/valeur affichables. */
  getMetaEntries(metadata: any): { key: string; val: string }[] {
    if (!metadata) return [];
    return Object.entries(metadata).map(([key, val]) => ({ key, val: String(val) }));
  }

}
