import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { environment } from '../../../environments/environment';
import { ToastService } from '../../core/services/toast.service';
import { ApiService } from '../../core/services/api.service';

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
  imports: [CommonModule, FormsModule],
  template: `
    <div class="page-container">
      <div class="page-header">
        <h1 class="page-title">// paramètres</h1>
        <p class="page-subtitle">Configuration de la plateforme DevSecOps IA</p>
      </div>

      <div class="settings-layout">

        <!-- ═══ INTÉGRATIONS ═══ -->
        <div class="section-block">
          <div class="section-label">Intégrations Infrastructure</div>

          <div class="tool-list">
            <div class="tool-item" *ngFor="let tool of tools">

              <!-- Header accordion -->
              <div class="tool-header" (click)="toggle(tool)">
                <div class="tool-icon" [style.color]="tool.color" [style.background]="tool.color+'1a'">
                  {{tool.icon}}
                </div>
                <div class="tool-meta">
                  <div class="tool-name">{{tool.name}}</div>
                  <div class="tool-desc">{{tool.description}}</div>
                </div>
                <div class="conn-status"
                     [class.connected]="tool.status === 'connected'"
                     [class.error]="tool.status === 'error'"
                     [class.disconnected]="tool.status === 'disconnected'">
                  <span class="conn-dot">{{tool.status === 'connected' ? '●' : tool.status === 'error' ? '✕' : '○'}}</span>
                  <span>{{tool.status === 'connected' ? 'Connecté' : tool.status === 'error' ? 'Erreur' : 'Non configuré'}}</span>
                </div>
                <div class="chevron" [class.open]="tool.expanded">▸</div>
              </div>

              <!-- Body accordion -->
              <div class="tool-body" *ngIf="tool.expanded">

                <!-- URL -->
                <div class="field-row">
                  <label class="field-label">URL</label>
                  <input class="field-input" type="text" [(ngModel)]="tool.url"
                         [placeholder]="getUrlPlaceholder(tool.toolType)" />
                </div>

                <!-- Token (Grafana, Kubernetes) -->
                <div class="field-row" *ngIf="tool.authType === 'token'">
                  <label class="field-label">{{tool.tokenLabel}}</label>
                  <input class="field-input" type="password" [(ngModel)]="tool.token"
                         placeholder="••••••••••••••••" />
                </div>

                <!-- Basic auth (Nexus) -->
                <ng-container *ngIf="tool.authType === 'basic'">
                  <div class="field-row">
                    <label class="field-label">Utilisateur</label>
                    <input class="field-input" type="text" [(ngModel)]="tool.username"
                           placeholder="admin" />
                  </div>
                  <div class="field-row">
                    <label class="field-label">Mot de passe</label>
                    <input class="field-input" type="password" [(ngModel)]="tool.password"
                           placeholder="••••••••" />
                  </div>
                </ng-container>

                <!-- Metadata display -->
                <div class="meta-block" *ngIf="tool.metadata && tool.status !== 'disconnected'">
                  <div class="meta-title">Réponse serveur</div>
                  <div class="meta-grid">
                    <ng-container *ngFor="let entry of getMetaEntries(tool.metadata)">
                      <span class="meta-key">{{entry.key}}</span>
                      <span class="meta-val" [class.err-text]="entry.key === 'error'">{{entry.val}}</span>
                    </ng-container>
                  </div>
                  <div class="meta-checked" *ngIf="tool.lastChecked">
                    Vérifié le {{tool.lastChecked | date:'dd/MM/yyyy à HH:mm'}}
                  </div>
                </div>

                <!-- Actions -->
                <div class="tool-actions">
                  <button class="btn-test" (click)="testTool(tool)"
                          [disabled]="tool.testing || tool.saving || !tool.url">
                    <span *ngIf="!tool.testing">⚡ Tester la connexion</span>
                    <span *ngIf="tool.testing" class="spin">↻</span>
                    <span *ngIf="tool.testing"> Test en cours…</span>
                  </button>
                  <button class="btn-save" [style.border-color]="tool.color" [style.color]="tool.color"
                          (click)="saveTool(tool)"
                          [disabled]="tool.saving || tool.testing || !tool.url">
                    <span *ngIf="!tool.saving">Enregistrer</span>
                    <span *ngIf="tool.saving" class="spin">↻</span>
                    <span *ngIf="tool.saving"> Sauvegarde…</span>
                  </button>
                </div>

              </div>
            </div>
          </div>
        </div>

        <!-- ═══ CONFIG IA ═══ -->
        <div class="section-block">
          <div class="section-label">Configuration IA</div>
          <div class="card">
            <div class="field-row">
              <label class="field-label">Modèle Ollama</label>
              <input class="field-input mono accent-blue" value="llama3.2:3b" readonly />
            </div>
            <div class="field-row">
              <label class="field-label">Seuil de confiance Judge</label>
              <div class="range-row">
                <input type="range" min="50" max="95" step="5" [(ngModel)]="confidenceThreshold" class="range-input" />
                <span class="range-val">{{confidenceThreshold}}%</span>
              </div>
              <div class="field-hint">Seuil en dessous duquel le Judge refuse une correction automatique.</div>
            </div>
            <div class="field-row">
              <label class="field-label">URL Webhook n8n</label>
              <input class="field-input mono" [value]="n8nUrl" readonly />
            </div>
            <button class="btn-save-primary" (click)="saveConfig()">Sauvegarder</button>
          </div>
        </div>

        <!-- ═══ INFOS PLATEFORME ═══ -->
        <div class="section-block">
          <div class="section-label">Informations plateforme</div>
          <div class="card">
            <div class="info-row" *ngFor="let info of platformInfo">
              <span class="info-key">{{info.label}}</span>
              <span class="info-val">{{info.value}}</span>
            </div>
          </div>
        </div>

      </div>
    </div>
  `,
  styles: [`
    .settings-layout { display: flex; flex-direction: column; gap: 24px; max-width: 760px; }

    .section-label {
      font-size: 10px; font-weight: 600; letter-spacing: 1.5px;
      text-transform: uppercase; color: var(--text-muted);
      font-family: var(--font-mono); margin-bottom: 10px;
    }

    /* ── Tool list ── */
    .tool-list { display: flex; flex-direction: column; gap: 2px; }

    .tool-item {
      background: var(--bg-secondary);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      overflow: hidden;
      transition: border-color .15s;
      &:hover { border-color: var(--border-light); }
    }

    .tool-header {
      display: flex; align-items: center; gap: 12px;
      padding: 14px 16px; cursor: pointer; user-select: none;
    }

    .tool-icon {
      width: 36px; height: 36px; border-radius: var(--radius-md);
      display: flex; align-items: center; justify-content: center;
      font-size: 15px; font-weight: 700; flex-shrink: 0;
      font-family: var(--font-mono);
    }

    .tool-meta { flex: 1; min-width: 0; }
    .tool-name { font-size: 13px; font-weight: 600; color: var(--text-primary); }
    .tool-desc { font-size: 10px; color: var(--text-muted); margin-top: 1px; }

    .conn-status {
      display: flex; align-items: center; gap: 5px;
      font-size: 11px; font-family: var(--font-mono);
      padding: 3px 10px; border-radius: 20px; border: 1px solid var(--border);
      color: var(--text-muted); white-space: nowrap;
      &.connected  { color: var(--accent-green);  border-color: var(--accent-green);  background: var(--accent-green-bg); }
      &.error      { color: var(--accent-red);     border-color: var(--accent-red);    background: var(--accent-red-bg); }
      &.disconnected { color: var(--text-muted); }
    }
    .conn-dot { font-size: 8px; }

    .chevron {
      color: var(--text-faint); font-size: 12px;
      transition: transform .2s; flex-shrink: 0;
      &.open { transform: rotate(90deg); }
    }

    /* ── Tool body ── */
    .tool-body {
      padding: 0 16px 16px;
      border-top: 1px solid var(--border);
      animation: slideDown .15s ease;
    }
    @keyframes slideDown { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: none; } }

    .field-row { display: flex; flex-direction: column; gap: 5px; margin-top: 12px; }
    .field-label { font-size: 10px; color: var(--text-muted); letter-spacing: .8px; text-transform: uppercase; font-family: var(--font-mono); }
    .field-input {
      background: var(--bg-primary); border: 1px solid var(--border);
      border-radius: var(--radius-sm); padding: 7px 10px;
      color: var(--text-primary); font-size: 12px; font-family: var(--font-mono);
      outline: none; transition: border-color .15s; width: 100%;
      &:focus { border-color: var(--accent-blue); }
      &.accent-blue { color: var(--accent-blue); }
    }
    .field-hint { font-size: 10px; color: var(--text-faint); margin-top: 3px; }

    .range-row { display: flex; align-items: center; gap: 12px; }
    .range-input { flex: 1; accent-color: var(--accent-blue); }
    .range-val { font-size: 13px; font-family: var(--font-mono); color: var(--accent-orange); min-width: 38px; }

    /* ── Metadata ── */
    .meta-block {
      margin-top: 12px; background: var(--bg-primary);
      border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 10px 12px;
    }
    .meta-title { font-size: 9px; text-transform: uppercase; letter-spacing: 1px; color: var(--text-faint); margin-bottom: 8px; }
    .meta-grid { display: grid; grid-template-columns: 110px 1fr; gap: 4px 12px; }
    .meta-key { font-size: 11px; color: var(--text-muted); font-family: var(--font-mono); }
    .meta-val { font-size: 11px; color: var(--text-secondary); font-family: var(--font-mono); }
    .meta-val.err-text { color: var(--accent-red); }
    .meta-checked { font-size: 9px; color: var(--text-faint); margin-top: 8px; }

    /* ── Actions ── */
    .tool-actions { display: flex; gap: 8px; margin-top: 14px; justify-content: flex-end; }

    .btn-test {
      display: inline-flex; align-items: center; gap: 5px;
      padding: 6px 14px; border-radius: var(--radius-sm);
      font-size: 11px; font-family: var(--font-mono); cursor: pointer;
      background: var(--accent-blue-bg); border: 1px solid var(--accent-blue);
      color: var(--accent-blue); transition: all .15s;
      &:hover:not(:disabled) { background: #38bdf822; }
      &:disabled { opacity: 0.4; cursor: not-allowed; }
    }

    .btn-save {
      display: inline-flex; align-items: center; gap: 5px;
      padding: 6px 14px; border-radius: var(--radius-sm);
      font-size: 11px; font-family: var(--font-mono); cursor: pointer;
      background: transparent; border: 1px solid; transition: all .15s;
      &:hover:not(:disabled) { opacity: 0.8; }
      &:disabled { opacity: 0.4; cursor: not-allowed; }
    }

    .spin { display: inline-block; animation: rotate .7s linear infinite; }
    @keyframes rotate { to { transform: rotate(360deg); } }

    /* ── Card ── */
    .card {
      background: var(--bg-secondary); border: 1px solid var(--border);
      border-radius: var(--radius-md); padding: 16px;
    }

    .btn-save-primary {
      margin-top: 14px; padding: 7px 16px;
      background: var(--accent-blue-bg); border: 1px solid var(--accent-blue);
      border-radius: var(--radius-sm); color: var(--accent-blue);
      font-size: 12px; font-family: var(--font-mono); cursor: pointer;
      &:hover { background: #38bdf822; }
    }

    /* ── Info table ── */
    .info-row {
      display: flex; gap: 16px; padding: 7px 0;
      border-bottom: 1px solid var(--border);
      &:last-child { border-bottom: none; }
    }
    .info-key { font-size: 11px; color: var(--text-faint); width: 180px; flex-shrink: 0; }
    .info-val { font-size: 12px; color: var(--text-secondary); font-family: var(--font-mono); }

    .mono { font-family: var(--font-mono) !important; font-size: 11px !important; }
  `],
})
export class SettingsComponent implements OnInit {
  confidenceThreshold = 70;
  n8nUrl = `${environment.n8nUrl}/webhook/jenkins-event`;

  tools: ToolConfig[] = [
    {
      toolType: 'grafana', name: 'Grafana', icon: 'G', color: '#f59e0b',
      description: 'Dashboards & alerting — GET /api/health',
      authType: 'token', tokenLabel: 'API Key (Bearer)',
      url: '', token: '', username: '', password: '',
      enabled: true, status: 'disconnected', expanded: false, testing: false, saving: false,
    },
    {
      toolType: 'prometheus', name: 'Prometheus', icon: 'P', color: '#e24b4a',
      description: 'Métriques & monitoring — GET /-/healthy',
      authType: 'none', tokenLabel: '',
      url: '', token: '', username: '', password: '',
      enabled: true, status: 'disconnected', expanded: false, testing: false, saving: false,
    },
    {
      toolType: 'kubernetes', name: 'Kubernetes', icon: 'K', color: '#38bdf8',
      description: 'Orchestration de conteneurs — GET /readyz',
      authType: 'token', tokenLabel: 'Bearer Token (kubeconfig)',
      url: '', token: '', username: '', password: '',
      enabled: true, status: 'disconnected', expanded: false, testing: false, saving: false,
    },
    {
      toolType: 'nexus', name: 'Nexus', icon: 'N', color: '#a78bfa',
      description: 'Dépôt d\'artefacts — GET /service/rest/v1/status',
      authType: 'basic', tokenLabel: '',
      url: '', token: '', username: '', password: '',
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

  constructor(private toast: ToastService, private api: ApiService) {}

  ngOnInit() {
    this.api.getIntegrations().subscribe({
      next: (integrations) => {
        for (const intg of integrations) {
          const tool = this.tools.find(t => t.toolType === intg.toolType);
          if (!tool) continue;
          tool.id       = intg.id;
          tool.url      = intg.url      || '';
          tool.token    = intg.token    || '';
          tool.username = intg.username || '';
          tool.password = intg.password || '';
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

  getUrlPlaceholder(type: string): string {
    const map: Record<string, string> = {
      grafana:    'http://localhost:3000',
      prometheus: 'http://localhost:9090',
      kubernetes: 'https://192.168.49.2:8443',
      nexus:      'http://localhost:8081',
    };
    return map[type] || 'https://...';
  }

  getMetaEntries(metadata: any): { key: string; val: string }[] {
    if (!metadata) return [];
    return Object.entries(metadata).map(([key, val]) => ({ key, val: String(val) }));
  }

  saveConfig() {
    this.toast.success('Configuration sauvegardée', `Seuil Judge : ${this.confidenceThreshold}%`);
  }
}
