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
  integrationStatusLabel = integrationStatusLabel;
  enforcementModeLabel = enforcementModeLabel;
  editTypeLabel = editTypeLabel;
  scannerEvidenceLabel = scannerEvidenceLabel;
  pipelineStageLabel = pipelineStageLabel;

  constructor(private toast: ToastService, private api: ApiService, public auth: AuthService) {}
  get canEdit() { return ['admin', 'developer'].includes(this.auth.currentUser?.role); }

  ngOnInit() { this.loadIntegrations(); this.loadCapabilities(); }

  loadIntegrations() {
    this.integrationsState = 'LOADING';
    this.tools = [];
    this.api.getIntegrations().subscribe({
      next: rows => {
        this.tools = configuredIntegrationTools(rows || []);
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
    if (!this.canEdit || !tool.editable || !tool.url) return;
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
    if (!this.canEdit || !tool.editable || !tool.url) return;
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

    if (tool.id) {
      // Sync current form values first, then test
      const payload = {
        url: tool.url, token: tool.token || null,
        username: tool.username || null, password: tool.password || null,
      };
      this.api.updateIntegration(tool.id, payload).subscribe({
        next: () => doTest(tool.id!),
        error: (e) => { tool.testing = false; this.toast.error('Configuration non enregistrée', userHttpError(e, 'Enregistrez la configuration avant de tester la connexion.')); },
      });
    } else {
      // Create then test
      const payload = {
        toolType: tool.toolType, name: tool.name,
        url: tool.url, token: tool.token || null,
        username: tool.username || null, password: tool.password || null,
        enabled: tool.enabled,
      };
      this.api.createIntegration(payload).subscribe({
        next: (result) => { tool.id = result.id; doTest(result.id); },
        error: (e) => {
          tool.testing = false;
          this.toast.error(`Erreur création ${tool.name}`, userHttpError(e, 'Vérifiez la configuration et la connexion au service, puis réessayez.'));
        },
      });
    }
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
