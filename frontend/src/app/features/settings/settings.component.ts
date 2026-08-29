import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ToastService } from '../../core/services/toast.service';
import { ApiService } from '../../core/services/api.service';
import { AuthService } from '../../core/services/auth.service';
import { FrenchDatePipe } from '../../shared/french-date.pipe';

interface ToolConfig {
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
  n8nUrl = '/webhook/jenkins-event (service n8n interne)';

  tools: ToolConfig[] = [
    {
      toolType: 'grafana', name: 'Grafana', icon: 'G', color: '#f59e0b',
      description: 'Dashboards & alerting — GET /api/health',
      authType: 'token', tokenLabel: 'API Key (Bearer)',
      url: '', token: '', username: '', password: '', hasToken: false, hasPassword: false,
      enabled: true, status: 'disconnected', expanded: false, testing: false, saving: false,
    },
    {
      toolType: 'prometheus', name: 'Prometheus', icon: 'P', color: '#e24b4a',
      description: 'Métriques & monitoring — GET /-/healthy',
      authType: 'none', tokenLabel: '',
      url: '', token: '', username: '', password: '', hasToken: false, hasPassword: false,
      enabled: true, status: 'disconnected', expanded: false, testing: false, saving: false,
    },
    {
      toolType: 'kubernetes', name: 'Kubernetes', icon: 'K', color: '#38bdf8',
      description: 'Orchestration de conteneurs — GET /readyz',
      authType: 'token', tokenLabel: 'Bearer Token (kubeconfig)',
      url: '', token: '', username: '', password: '', hasToken: false, hasPassword: false,
      enabled: true, status: 'disconnected', expanded: false, testing: false, saving: false,
    },
    {
      toolType: 'nexus', name: 'Nexus', icon: 'N', color: '#a78bfa',
      description: 'Dépôt d\'artefacts — GET /service/rest/v1/status',
      authType: 'basic', tokenLabel: '',
      url: '', token: '', username: '', password: '', hasToken: false, hasPassword: false,
      enabled: true, status: 'disconnected', expanded: false, testing: false, saving: false,
    },
  ];

  platformInfo = [
    { label: 'Version Angular',     value: '17.x (Standalone)' },
    { label: 'Version NestJS',      value: '10.x' },
    { label: 'Version n8n',         value: '2.14.2 (self-hosted)' },
    { label: 'Modèle LLM',          value: 'llama3.2:3b via Ollama' },
    { label: 'Base de données',     value: 'PostgreSQL 16' },
    { label: 'Environnement',       value: 'WSL Ubuntu 22.04' },
    { label: 'Auteur',              value: 'Amri Souhaiel — ESPRIT / Vermeg' },
  ];

  constructor(private toast: ToastService, private api: ApiService, public auth: AuthService) {}
  get canEdit() { return ['admin', 'developer'].includes(this.auth.currentUser?.role); }

  ngOnInit() {
    this.api.getIntegrations().subscribe({
      next: (integrations) => {
        for (const intg of integrations) {
          const tool = this.tools.find(t => t.toolType === intg.toolType);
          if (!tool) continue;
          tool.id       = intg.id;
          tool.url      = intg.url      || '';
          // Le backend ne renvoie plus le token/password en clair (voir FIX
          // sécurité 2026-08-04) — seuls hasToken/hasPassword indiquent si un
          // secret est déjà enregistré ; le champ reste vide tant que
          // l'utilisateur ne retape rien (voir saveTool()/getSecretPlaceholder()).
          tool.token    = '';
          tool.username = intg.username || '';
          tool.password = '';
          tool.hasToken    = !!intg.hasToken;
          tool.hasPassword = !!intg.hasPassword;
          tool.enabled  = intg.enabled;
          tool.status   = intg.status   || 'disconnected';
          tool.metadata = intg.metadata || null;
          tool.lastChecked = intg.lastChecked || null;
        }
      },
      error: () => {},
    });
  }

  toggle(tool: ToolConfig) {
    tool.expanded = !tool.expanded;
  }

  saveTool(tool: ToolConfig) {
    if (!tool.url) return;
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
        tool.saving = false;
        this.toast.success(`${tool.name} enregistré`, 'Configuration sauvegardée');
      },
      error: (e) => {
        tool.saving = false;
        this.toast.error(`Erreur sauvegarde ${tool.name}`, e?.error?.message || e.message);
      },
    });
  }

  testTool(tool: ToolConfig) {
    if (!tool.url) return;
    tool.testing = true;

    const doTest = (id: string) => {
      this.api.testIntegration(id).subscribe({
        next: (result) => {
          tool.status   = result.status;
          tool.metadata = result.metadata || null;
          tool.testing  = false;
          if (result.success) {
            this.toast.success(`${tool.name} connecté`, 'Connexion établie avec succès');
          } else {
            this.toast.error(`${tool.name} inaccessible`, result.error || 'Impossible de joindre le service');
          }
        },
        error: (e) => {
          tool.testing = false;
          this.toast.error(`Erreur test ${tool.name}`, e?.error?.message || e.message);
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
        error: () => doTest(tool.id!),
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
          this.toast.error(`Erreur création ${tool.name}`, e?.error?.message || e.message);
        },
      });
    }
  }

  getSecretPlaceholder(hasSecret: boolean, generic: string): string {
    return hasSecret ? 'Déjà configuré — laisser vide pour ne pas changer' : generic;
  }

  getUrlPlaceholder(type: string): string {
    const map: Record<string, string> = {
      grafana:    'https://grafana.example.internal',
      prometheus: 'https://prometheus.example.internal',
      kubernetes: 'https://kubernetes.example.internal',
      nexus:      'https://nexus.example.internal',
    };
    return map[type] || 'https://...';
  }

  getMetaEntries(metadata: any): { key: string; val: string }[] {
    if (!metadata) return [];
    return Object.entries(metadata).map(([key, val]) => ({ key, val: String(val) }));
  }

}
