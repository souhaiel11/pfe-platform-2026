import { Component, OnInit, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { ApiService } from '../../core/services/api.service';
import { ToastService } from '../../core/services/toast.service';

// ═══════════════════════════════════════════════════════════════════
//  INCIDENT DETAIL — v2.0
//  Ajouts : timeline cycle de vie + onglet Validation WF3
//  Données WF1 : incident.metadata.enrichedData + incident.aiAnalysis
//  Données WF3 : incident.metadata.validation
// ═══════════════════════════════════════════════════════════════════

@Component({
  selector: 'app-incident-detail',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <div class="page-container">
      <div class="page-header">
        <a routerLink="/incidents" style="font-size:12px;color:var(--text-muted);">← Retour aux incidents</a>
        <h1 class="page-title" style="margin-top:8px;">// incident_detail</h1>
      </div>

      <div *ngIf="loading" class="loading-overlay"><div class="spinner"></div><span>Chargement...</span></div>

      <ng-container *ngIf="incident && !loading">

        <!-- ─── HEADER CARD ─── -->
        <div class="card" style="margin-bottom:16px;border-left:3px solid {{getSeverityColor(aiAnalysis?.securityLevel)}};">
          <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap;">
            <div>
              <div style="font-family:var(--font-mono);font-size:11px;color:var(--text-muted);margin-bottom:6px;">
                {{incident.id}}
              </div>
              <h2 style="font-size:16px;color:var(--text-primary);margin-bottom:8px;">
                {{incident.title}}
              </h2>
              <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
                <span class="badge" [class]="getStatusBadgeClass(incident.status)">{{incident.status}}</span>
                <span *ngIf="aiAnalysis?.securityLevel" class="badge" [class]="getSeverityBadgeClass(aiAnalysis.securityLevel)">
                  {{aiAnalysis.securityLevel}}
                </span>
                <span *ngIf="aiAnalysis?.confidenceScore" style="font-size:11px;color:var(--text-muted);font-family:var(--font-mono);">
                  confiance {{aiAnalysis.confidenceScore}}%
                </span>
                <span style="font-size:11px;color:var(--text-muted);font-family:var(--font-mono);">
                  · {{incident.createdAt | date:'dd/MM/yyyy HH:mm'}}
                </span>
              </div>
            </div>
            <div style="display:flex;gap:8px;flex-shrink:0;">
              <button *ngIf="incident.status === 'analyzed' || incident.status === 'blocked'"
                      class="btn btn-success btn-sm" (click)="approveFix()">
                ✓ Approuver le fix
              </button>
              <button *ngIf="incident.status === 'analyzed' || incident.status === 'blocked'"
                      class="btn btn-secondary btn-sm" (click)="rejectFix()">
                ✕ Rejeter
              </button>
            </div>
          </div>
        </div>

        <!-- ─── TIMELINE CYCLE DE VIE ─── -->
        <div class="card" style="margin-bottom:16px;padding:16px 20px;">
          <div style="font-size:10px;color:var(--text-muted);letter-spacing:1px;text-transform:uppercase;font-family:var(--font-mono);margin-bottom:14px;">
            Cycle de vie de l'incident
          </div>
          <div class="lifecycle-timeline">
            <div *ngFor="let step of lifecycleSteps; let i = index" class="lifecycle-step">
              <!-- Connecteur -->
              <div *ngIf="i > 0" class="lifecycle-connector"
                   [style.background]="step.done ? 'var(--accent-green)' : 'var(--border)'"></div>
              <!-- Point -->
              <div class="lifecycle-dot"
                   [style.border-color]="step.done ? (step.active ? 'var(--accent-orange)' : 'var(--accent-green)') : 'var(--border)'"
                   [style.background]="step.done ? (step.active ? 'var(--accent-orange)' : 'var(--accent-green)') : 'var(--bg-primary)'">
                <span *ngIf="step.done && !step.active" style="color:white;font-size:9px;">✓</span>
                <span *ngIf="step.active" style="color:white;font-size:9px;">●</span>
              </div>
              <!-- Label -->
              <div class="lifecycle-label">
                <div style="font-size:11px;font-weight:600;"
                     [style.color]="step.done ? (step.active ? 'var(--accent-orange)' : 'var(--text-primary)') : 'var(--text-muted)'">
                  {{step.label}}
                </div>
                <div style="font-size:10px;color:var(--text-muted);font-family:var(--font-mono);">{{step.sub}}</div>
              </div>
            </div>
          </div>
        </div>

        <!-- ─── ONGLETS ─── -->
        <div style="display:flex;gap:0;border-bottom:1px solid var(--border);margin-bottom:16px;">
          <button *ngFor="let tab of tabs" class="tab-btn"
                  [class.active]="activeTab === tab.id"
                  (click)="activeTab = tab.id">
            <span *ngIf="tab.dot" class="tab-dot" [style.background]="tab.dot"></span>
            {{tab.label}}
          </button>
        </div>

        <!-- ══ ONGLET : ANALYSE IA (WF1) ══ -->
        <div *ngIf="activeTab === 'analysis'">

          <!-- Décision Judge -->
          <div *ngIf="aiAnalysis" class="card decision-card" style="margin-bottom:16px;">
            <div class="card-header" style="margin-bottom:12px;">
              <span class="card-title">▣ Décision du Judge Agent</span>
              <span class="badge" [class]="getDecisionBadgeClass(aiAnalysis.decision)">
                {{aiAnalysis.decision}}
              </span>
            </div>
            <div style="font-size:12px;color:var(--text-secondary);line-height:1.7;white-space:pre-wrap;margin-bottom:12px;">
              {{aiAnalysis.justification}}
            </div>
            <div *ngIf="aiAnalysis.errorsSummary" style="font-family:var(--font-mono);font-size:11px;color:var(--accent-orange);background:var(--bg-primary);padding:10px 12px;border-radius:var(--radius-sm);">
              {{aiAnalysis.errorsSummary}}
            </div>
          </div>

          <!-- Scanners sécurité -->
          <div *ngIf="enrichedData" style="margin-bottom:16px;">
            <div style="font-size:10px;color:var(--text-muted);letter-spacing:1px;text-transform:uppercase;font-family:var(--font-mono);margin-bottom:10px;">
              Résultats des scanners
            </div>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px;">

              <!-- SonarQube -->
              <div class="card scanner-card" style="border-left:2px solid #f59e0b;">
                <div style="font-size:10px;color:var(--text-muted);font-family:var(--font-mono);margin-bottom:8px;">SONARQUBE</div>
                <div style="display:flex;gap:12px;">
                  <div style="text-align:center;">
                    <div style="font-size:18px;font-weight:700;color:var(--accent-red);">{{enrichedData.sonar?.vulnerabilities || 0}}</div>
                    <div style="font-size:9px;color:var(--text-muted);">VULNÉRABILITÉS</div>
                  </div>
                  <div style="text-align:center;">
                    <div style="font-size:18px;font-weight:700;color:var(--accent-orange);">{{enrichedData.sonar?.code_smells || 0}}</div>
                    <div style="font-size:9px;color:var(--text-muted);">CODE SMELLS</div>
                  </div>
                </div>
                <div class="scanner-status" [class]="enrichedData.sonar?.status?.toLowerCase()">
                  {{enrichedData.sonar?.status}}
                </div>
              </div>

              <!-- Trivy -->
              <div class="card scanner-card" style="border-left:2px solid #e24b4a;">
                <div style="font-size:10px;color:var(--text-muted);font-family:var(--font-mono);margin-bottom:8px;">TRIVY (IMAGE)</div>
                <div style="display:flex;gap:12px;">
                  <div style="text-align:center;">
                    <div style="font-size:18px;font-weight:700;color:var(--accent-red);">{{enrichedData.trivy?.critical || 0}}</div>
                    <div style="font-size:9px;color:var(--text-muted);">CRITICAL</div>
                  </div>
                  <div style="text-align:center;">
                    <div style="font-size:18px;font-weight:700;color:var(--accent-orange);">{{enrichedData.trivy?.high || 0}}</div>
                    <div style="font-size:9px;color:var(--text-muted);">HIGH</div>
                  </div>
                </div>
                <div class="scanner-status" [class]="enrichedData.trivy?.status?.toLowerCase()">
                  {{enrichedData.trivy?.status}}
                </div>
              </div>

              <!-- OWASP -->
              <div class="card scanner-card" style="border-left:2px solid #8b5cf6;">
                <div style="font-size:10px;color:var(--text-muted);font-family:var(--font-mono);margin-bottom:8px;">OWASP DC</div>
                <div style="display:flex;gap:12px;">
                  <div style="text-align:center;">
                    <div style="font-size:18px;font-weight:700;color:var(--accent-red);">{{enrichedData.owasp?.critical || 0}}</div>
                    <div style="font-size:9px;color:var(--text-muted);">CRITICAL</div>
                  </div>
                  <div style="text-align:center;">
                    <div style="font-size:18px;font-weight:700;color:var(--accent-orange);">{{enrichedData.owasp?.high || 0}}</div>
                    <div style="font-size:9px;color:var(--text-muted);">HIGH</div>
                  </div>
                </div>
                <div class="scanner-status" [class]="enrichedData.owasp?.status?.toLowerCase()">
                  {{enrichedData.owasp?.status}}
                </div>
              </div>

              <!-- ZAP -->
              <div class="card scanner-card" style="border-left:2px solid #38bdf8;">
                <div style="font-size:10px;color:var(--text-muted);font-family:var(--font-mono);margin-bottom:8px;">ZAP (DAST)</div>
                <div style="display:flex;gap:12px;">
                  <div style="text-align:center;">
                    <div style="font-size:18px;font-weight:700;color:var(--accent-red);">{{enrichedData.zap?.alerts_high || 0}}</div>
                    <div style="font-size:9px;color:var(--text-muted);">HIGH</div>
                  </div>
                  <div style="text-align:center;">
                    <div style="font-size:18px;font-weight:700;color:var(--accent-orange);">{{enrichedData.zap?.alerts_medium || 0}}</div>
                    <div style="font-size:9px;color:var(--text-muted);">MEDIUM</div>
                  </div>
                </div>
                <div class="scanner-status" [class]="enrichedData.zap?.status?.toLowerCase()">
                  {{enrichedData.zap?.status}}
                </div>
              </div>

            </div>
          </div>

          <!-- Actions développeur -->
          <div *ngIf="aiAnalysis?.developerActions" class="card" style="margin-bottom:16px;">
            <div class="card-header" style="margin-bottom:10px;">
              <span class="card-title">Actions recommandées</span>
            </div>
            <div style="font-size:12px;color:var(--text-secondary);line-height:1.8;white-space:pre-wrap;">
              {{aiAnalysis.developerActions}}
            </div>
          </div>

          <!-- Rapports agents -->
          <div *ngIf="reports.length > 0">
            <div style="font-size:10px;color:var(--text-muted);letter-spacing:1px;text-transform:uppercase;font-family:var(--font-mono);margin-bottom:10px;">
              Rapports des agents IA
            </div>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px;">
              <div *ngFor="let r of reports" class="card agent-report-card">
                <div class="card-header" style="margin-bottom:12px;">
                  <div style="display:flex;align-items:center;gap:8px;">
                    <span class="agent-badge" [style.color]="getAgentColor(r.agentType)"
                          [style.background]="getAgentColor(r.agentType)+'11'">
                      {{getAgentIcon(r.agentType)}}
                    </span>
                    <span class="card-title">{{getAgentLabel(r.agentType)}}</span>
                  </div>
                  <div style="display:flex;align-items:center;gap:4px;">
                    <div class="confidence-bar">
                      <div [style.width]="(r.confidence||0)*100+'%'"
                           [style.background]="getAgentColor(r.agentType)"></div>
                    </div>
                    <span style="font-size:10px;color:var(--text-muted);font-family:var(--font-mono);">
                      {{((r.confidence||0)*100)|number:'1.0-0'}}%
                    </span>
                  </div>
                </div>
                <div class="report-content">{{r.analysis || r.content}}</div>
              </div>
            </div>
          </div>
        </div>

        <!-- ══ ONGLET : VALIDATION WF3 ══ -->
        <div *ngIf="activeTab === 'validation'">

          <!-- Pas encore validé -->
          <div *ngIf="!validation" class="card" style="text-align:center;padding:40px;border:1px dashed var(--border);">
            <div style="font-size:32px;margin-bottom:12px;">⏳</div>
            <div style="font-size:14px;color:var(--text-secondary);margin-bottom:6px;">
              En attente de validation automatique
            </div>
            <div style="font-size:11px;color:var(--text-muted);font-family:var(--font-mono);">
              WF3 se déclenchera automatiquement après le build de la PR
            </div>
          </div>

          <!-- Résultat WF3 disponible -->
          <ng-container *ngIf="validation">

            <!-- Verdict principal -->
            <div class="card" style="margin-bottom:16px;"
                 [style.border-left]="'3px solid ' + (validation.passed ? 'var(--accent-green)' : 'var(--accent-red)')">
              <div style="display:flex;align-items:center;gap:16px;">
                <div style="font-size:36px;">{{validation.passed ? '✅' : '❌'}}</div>
                <div>
                  <div style="font-size:15px;font-weight:600;color:var(--text-primary);margin-bottom:4px;">
                    Validation automatique {{validation.passed ? 'RÉUSSIE' : 'ÉCHOUÉE'}}
                  </div>
                  <div style="font-size:12px;color:var(--text-secondary);">{{validation.verdict}}</div>
                  <div style="font-size:10px;color:var(--text-muted);font-family:var(--font-mono);margin-top:4px;">
                    {{validation.validatedAt | date:'dd/MM/yyyy HH:mm:ss'}}
                  </div>
                </div>
              </div>
            </div>

            <!-- Tableau des contrôles -->
            <div class="card" style="margin-bottom:16px;">
              <div class="card-header" style="margin-bottom:12px;">
                <span class="card-title">Résultats des contrôles</span>
              </div>
              <table style="width:100%;border-collapse:collapse;">
                <thead>
                  <tr style="border-bottom:1px solid var(--border);">
                    <th style="text-align:left;padding:8px 0;font-size:10px;color:var(--text-muted);font-family:var(--font-mono);font-weight:400;letter-spacing:1px;">CONTRÔLE</th>
                    <th style="text-align:left;padding:8px 0;font-size:10px;color:var(--text-muted);font-family:var(--font-mono);font-weight:400;letter-spacing:1px;">RÉSULTAT</th>
                    <th style="text-align:left;padding:8px 0;font-size:10px;color:var(--text-muted);font-family:var(--font-mono);font-weight:400;letter-spacing:1px;">DÉTAIL</th>
                  </tr>
                </thead>
                <tbody>
                  <tr style="border-bottom:1px solid var(--border);">
                    <td style="padding:10px 0;font-size:12px;color:var(--text-primary);">Build Jenkins (PR)</td>
                    <td style="padding:10px 0;">
                      <span class="badge" [class]="validation.build?.status === 'SUCCESS' ? 'info' : 'high'">
                        {{validation.build?.status || 'N/A'}}
                      </span>
                    </td>
                    <td style="padding:10px 0;font-size:11px;color:var(--text-muted);">
                      <a *ngIf="validation.build?.buildUrl" [href]="validation.build.buildUrl" target="_blank"
                         style="color:var(--accent-blue);text-decoration:none;font-family:var(--font-mono);">
                        Build #{{validation.build?.buildNumber}} ↗
                      </a>
                    </td>
                  </tr>
                  <tr style="border-bottom:1px solid var(--border);">
                    <td style="padding:10px 0;font-size:12px;color:var(--text-primary);">SonarQube Quality Gate</td>
                    <td style="padding:10px 0;">
                      <span class="badge" [class]="getSonarGateBadgeClass(validation.sonarQualityGate?.status)">
                        {{validation.sonarQualityGate?.status || 'N/A'}}
                      </span>
                    </td>
                    <td style="padding:10px 0;font-size:11px;color:var(--text-muted);">
                      {{validation.sonarQualityGate?.detail}}
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:10px 0;font-size:12px;color:var(--text-primary);">Commentaire GitHub posté</td>
                    <td style="padding:10px 0;">
                      <span class="badge" [class]="validation.commentPosted ? 'info' : 'medium'">
                        {{validation.commentPosted ? 'OUI' : 'NON'}}
                      </span>
                    </td>
                    <td style="padding:10px 0;font-size:11px;color:var(--text-muted);">
                      <a *ngIf="validation.prUrl" [href]="validation.prUrl" target="_blank"
                         style="color:var(--accent-blue);text-decoration:none;font-family:var(--font-mono);">
                        PR #{{validation.prNumber}} ↗
                      </a>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <!-- Info Pull Request -->
            <div class="card" style="margin-bottom:16px;">
              <div class="card-header" style="margin-bottom:10px;">
                <span class="card-title">Pull Request</span>
              </div>
              <div style="display:grid;grid-template-columns:auto 1fr;gap:6px 16px;align-items:center;">
                <div style="font-size:10px;color:var(--text-muted);font-family:var(--font-mono);">NUMÉRO</div>
                <div style="font-size:12px;color:var(--text-primary);">
                  <a [href]="validation.prUrl" target="_blank"
                     style="color:var(--accent-blue);text-decoration:none;">#{{validation.prNumber}}</a>
                </div>
                <div style="font-size:10px;color:var(--text-muted);font-family:var(--font-mono);">BRANCHE</div>
                <div style="font-size:11px;color:var(--text-secondary);font-family:var(--font-mono);">{{validation.prBranch}}</div>
                <div style="font-size:10px;color:var(--text-muted);font-family:var(--font-mono);">URL</div>
                <div style="font-size:11px;">
                  <a [href]="validation.prUrl" target="_blank"
                     style="color:var(--accent-blue);text-decoration:none;font-family:var(--font-mono);">
                    {{validation.prUrl}}
                  </a>
                </div>
              </div>
            </div>

          </ng-container>
        </div>

        <!-- ══ ONGLET : DONNÉES BRUTES ══ -->
        <div *ngIf="activeTab === 'raw'" class="card">
          <div class="card-header">
            <span class="card-title">Données brutes</span>
          </div>
          <pre class="code-block" style="margin-top:12px;">{{incident | json}}</pre>
        </div>

      </ng-container>
    </div>
  `,
  styles: [`
    /* ── Timeline ── */
    .lifecycle-timeline {
      display: flex;
      align-items: flex-start;
      gap: 0;
      overflow-x: auto;
      padding-bottom: 4px;
    }
    .lifecycle-step {
      display: flex;
      flex-direction: column;
      align-items: center;
      min-width: 90px;
      position: relative;
    }
    .lifecycle-connector {
      position: absolute;
      top: 9px;
      right: calc(50% + 9px);
      width: calc(100% - 18px);
      height: 2px;
      transition: background 0.4s;
    }
    .lifecycle-dot {
      width: 18px;
      height: 18px;
      border-radius: 50%;
      border: 2px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1;
      transition: all 0.3s;
      margin-bottom: 8px;
      flex-shrink: 0;
    }
    .lifecycle-label {
      text-align: center;
      padding: 0 4px;
    }

    /* ── Onglets ── */
    .tab-btn {
      padding: 8px 16px;
      background: none;
      border: none;
      border-bottom: 2px solid transparent;
      color: var(--text-muted);
      font-size: 12px;
      cursor: pointer;
      font-family: var(--font-mono);
      display: flex;
      align-items: center;
      gap: 6px;
      transition: all 0.2s;
    }
    .tab-btn:hover { color: var(--text-primary); }
    .tab-btn.active {
      color: var(--accent-blue);
      border-bottom-color: var(--accent-blue);
    }
    .tab-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    /* ── Scanners ── */
    .scanner-card { padding: 12px 14px; }
    .scanner-status {
      font-size: 10px;
      font-family: var(--font-mono);
      margin-top: 8px;
      padding: 2px 6px;
      border-radius: 3px;
      display: inline-block;
    }
    .scanner-status.completed { color: var(--accent-green); background: var(--accent-green)11; }
    .scanner-status.unknown   { color: var(--text-muted);   background: var(--border); }
    .scanner-status.error     { color: var(--accent-red);   background: var(--accent-red)11; }

    /* ── Agents ── */
    .agent-badge {
      width: 28px; height: 28px;
      border-radius: var(--radius-sm);
      display: flex; align-items: center; justify-content: center;
      font-size: 14px; flex-shrink: 0;
    }
    .confidence-bar {
      width: 60px; height: 3px;
      background: var(--border);
      border-radius: 2px;
      overflow: hidden;
      div { height: 100%; border-radius: 2px; transition: width 0.8s ease; }
    }
    .report-content {
      font-size: 12px;
      color: var(--text-secondary);
      line-height: 1.6;
      white-space: pre-wrap;
    }

    /* ── Autres ── */
    .decision-card { border-left: 3px solid var(--accent-orange); }
    .code-block {
      background: var(--bg-primary);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      padding: 12px;
      font-family: var(--font-mono);
      font-size: 11px;
      color: var(--text-secondary);
      overflow-x: auto;
      white-space: pre-wrap;
    }
  `]
})
export class IncidentDetailComponent implements OnInit {
  @Input() id!: string;

  incident:    any  = null;
  reports:     any[] = [];
  aiAnalysis:  any  = null;   // colonne aiAnalysis (WF1)
  enrichedData: any = null;   // metadata.enrichedData (WF1)
  validation:  any  = null;   // metadata.validation (WF3)
  decision:    any  = null;   // legacy
  loading      = true;
  activeTab    = 'analysis';

  // ── Tabs (mis à jour dans load()) ──
  tabs: any[] = [];

  private updateTabs() {
    this.tabs = [
      { id: 'analysis',   label: 'Analyse IA', dot: null },
      { id: 'validation', label: 'Validation PR',
        dot: this.validation ? (this.validation.passed ? '#22c55e' : '#e24b4a') : null },
      { id: 'raw',        label: 'Données brutes', dot: null },
    ];
  }

  // ── Timeline étapes (mis à jour dans load()) ──
  lifecycleSteps: any[] = [];

  private updateLifecycle() {
    const s = this.incident?.status || '';
    const ORDER = ['pending','analyzing','analyzed','fix_generated','validating','approved','completed'];
    const idx   = ORDER.indexOf(s);
    this.lifecycleSteps = [
      { label: 'Détecté',    sub: 'WF1',  done: idx >= 0, active: idx === 0 },
      { label: 'Analysé',    sub: 'WF1',  done: idx >= 2, active: idx === 1 || idx === 2 },
      { label: 'Fix proposé',sub: 'WF2',  done: idx >= 3, active: idx === 3 },
      { label: 'Validé',     sub: 'WF3',  done: idx >= 5, active: idx === 4 || idx === 5 },
      { label: 'Résolu',     sub: 'merge',done: idx >= 6, active: idx === 6 },
    ];
  }

  constructor(private api: ApiService, private toast: ToastService) {}

  ngOnInit() { this.load(); }

  load() {
    this.loading = true;
    this.api.getIncident(this.id).subscribe({
      next: (inc: any) => {
        this.incident     = inc;
        // Rapports agents depuis metadata (rootCause, security, remediation)
        const meta = inc.metadata || {};
        this.reports = [
          meta.rootCause && Object.keys(meta.rootCause).length > 0
            ? { agentType: 'ROOT_CAUSE', analysis: meta.rootCause.rootCause || meta.rootCause.analysisSummary || '', confidence: meta.rootCause.confidence || 0 }
            : null,
          meta.security && Object.keys(meta.security).length > 0
            ? { agentType: 'SECURITY', analysis: meta.security.securitySummary || '', confidence: meta.security.confidence || 0 }
            : null,
          meta.remediation && Object.keys(meta.remediation).length > 0
            ? { agentType: 'REMEDIATION', analysis: meta.remediation.fixDescription || (meta.remediation.fixSteps || []).join('\n') || '', confidence: meta.remediation.confidence || 0 }
            : null,
        ].filter(r => r !== null);
        this.decision     = inc.decision || null;
        // ── Données WF1 ──
        // aiAnalysis peut être du JSON string OU du texte brut — parse sûr
        if (inc.aiAnalysis && typeof inc.aiAnalysis === 'string') {
          try {
            this.aiAnalysis = JSON.parse(inc.aiAnalysis);
          } catch (e) {
            // texte brut : on l'enveloppe pour l'affichage
            this.aiAnalysis = { justification: inc.aiAnalysis };
          }
        } else {
          this.aiAnalysis = inc.aiAnalysis || null;
        }
        this.enrichedData = inc.metadata?.enrichedData || null;
        // ── Données WF3 ──
        this.validation   = inc.metadata?.validation || null;
        this.updateLifecycle();
        this.updateTabs();
        this.loading = false;
        // Si validé, ouvrir directement l'onglet validation
        if (this.validation) this.activeTab = 'validation';
      },
      error: () => { this.toast.error('Erreur', 'Incident introuvable'); this.loading = false; }
    });
  }

  approveFix() {
    this.api.approveFix(this.id).subscribe({
      next: () => { this.toast.success('Fix approuvé — WF2 déclenché'); this.load(); },
      error: () => this.toast.error('Erreur', 'Impossible d\'approuver')
    });
  }

  rejectFix() {
    this.api.rejectFix(this.id).subscribe({
      next: () => { this.toast.success('Fix rejeté'); this.load(); },
      error: () => this.toast.error('Erreur', 'Impossible de rejeter')
    });
  }

  getSeverityColor(s: string) {
    const map: any = { CRITICAL:'var(--accent-red)', HIGH:'var(--accent-red)',
      MEDIUM:'var(--accent-orange)', LOW:'var(--accent-green)' };
    return map[s] || 'var(--border)';
  }
  getSeverityBadgeClass(s: string) {
    const map: any = { CRITICAL:'high', HIGH:'high', MEDIUM:'medium', LOW:'info' };
    return map[s] || '';
  }
  getStatusBadgeClass(s: string) {
    const map: any = { approved:'info', analyzed:'medium', failed:'high',
      pending:'', completed:'info', validating:'medium' };
    return map[s] || '';
  }
  getDecisionBadgeClass(d: string) {
    const map: any = { FIX_PROPOSED:'info', BLOCK:'high', NOTIFY_ONLY:'medium' };
    return map[d] || '';
  }
  getSonarGateBadgeClass(s: string) {
    if (s === 'OK') return 'info';
    if (s === 'ERROR') return 'high';
    if (s === 'SKIPPED') return 'medium';
    return '';
  }
  getAgentColor(t: string) {
    const map: any = { ROOT_CAUSE:'#38bdf8', SECURITY:'#e24b4a',
      REMEDIATION:'#22c55e', JUDGE:'#f59e0b' };
    return map[t] || '#7ba8c8';
  }
  getAgentIcon(t: string) {
    const map: any = { ROOT_CAUSE:'◈', SECURITY:'⬡', REMEDIATION:'◆', JUDGE:'▣' };
    return map[t] || '◉';
  }
  getAgentLabel(t: string) {
    const map: any = { ROOT_CAUSE:'Root Cause Analysis', SECURITY:'Security Risk',
      REMEDIATION:'Remediation', JUDGE:'Judge Agent' };
    return map[t] || t;
  }
}
