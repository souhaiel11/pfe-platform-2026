import { Component, OnInit, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { ApiService } from '../../core/services/api.service';
import { ToastService } from '../../core/services/toast.service';

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
        <!-- Header card -->
        <div class="card" style="margin-bottom:16px;border-left:3px solid {{getSeverityColor(incident.severity)}};">
          <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px;">
            <div>
              <div style="font-family:var(--font-mono);font-size:11px;color:var(--text-muted);margin-bottom:6px;">
                {{incident.incidentId}}
              </div>
              <h2 style="font-size:16px;color:var(--text-primary);margin-bottom:8px;">
                {{incident.title || 'Incident ' + incident.sourceType}}
              </h2>
              <div style="display:flex;gap:8px;flex-wrap:wrap;">
                <span class="badge {{incident.severity?.toLowerCase()}}">{{incident.severity}}</span>
                <span class="badge {{incident.status?.toLowerCase()}}">{{incident.status}}</span>
                <span style="font-size:11px;color:var(--text-muted);font-family:var(--font-mono);">
                  {{incident.sourceType}} · {{incident.createdAt | date:'dd/MM/yyyy HH:mm'}}
                </span>
              </div>
            </div>
            <div style="display:flex;gap:8px;flex-shrink:0;">
              <button *ngIf="incident.status === 'CORRECTION_PROPOSED'"
                      class="btn btn-success btn-sm" (click)="applyCorrection()">
                ✓ Appliquer correction
              </button>
              <button *ngIf="incident.status !== 'RESOLVED' && incident.status !== 'CLOSED'"
                      class="btn btn-secondary btn-sm" (click)="resolveIncident()">
                Résoudre
              </button>
            </div>
          </div>
        </div>

        <!-- Agent reports -->
        <div *ngIf="reports.length > 0">
          <h3 style="font-size:12px;color:var(--text-muted);letter-spacing:1px;text-transform:uppercase;font-family:var(--font-mono);margin-bottom:12px;">
            Rapports des agents IA
          </h3>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px;margin-bottom:16px;">
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

        <!-- Decision -->
        <div *ngIf="decision" class="card decision-card">
          <div class="card-header">
            <span class="card-title">Décision du Judge Agent</span>
            <span class="badge" [class]="decision.action === 'APPROVE' ? 'info' : 'high'">
              {{decision.action}}
            </span>
          </div>
          <div class="report-content">{{decision.reasoning}}</div>
          <div *ngIf="decision.proposedFix" style="margin-top:12px;">
            <div style="font-size:10px;color:var(--text-faint);margin-bottom:6px;font-family:var(--font-mono);">
              CORRECTION PROPOSÉE
            </div>
            <pre class="code-block">{{decision.proposedFix}}</pre>
          </div>
        </div>

        <!-- Raw data -->
        <div class="card" style="margin-top:16px;">
          <div class="card-header">
            <span class="card-title">Données brutes</span>
            <button class="btn btn-secondary btn-sm" (click)="showRaw = !showRaw">
              {{showRaw ? 'Masquer' : 'Afficher'}}
            </button>
          </div>
          <pre class="code-block" *ngIf="showRaw">{{incident | json}}</pre>
        </div>
      </ng-container>
    </div>
  `,
  styles: [`
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

    .decision-card {
      border-left: 3px solid var(--accent-orange);
    }

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
  incident: any  = null;
  reports: any[] = [];
  decision: any  = null;
  loading  = true;
  showRaw  = false;

  constructor(private api: ApiService, private toast: ToastService) {}

  ngOnInit() { this.load(); }

  load() {
    this.loading = true;
    this.api.getIncident(this.id).subscribe({
      next: (inc: any) => {
        this.incident = inc;
        this.reports  = inc.agentReports || [];
        this.decision = inc.decision || null;
        this.loading  = false;
      },
      error: () => { this.toast.error('Erreur', 'Incident introuvable'); this.loading = false; }
    });
  }

  applyCorrection() {
    this.api.updateIncidentStatus(this.id, 'CORRECTION_APPLIED').subscribe({
      next: () => { this.toast.success('Correction appliquée'); this.load(); },
      error: () => this.toast.error('Erreur', 'Impossible d\'appliquer la correction')
    });
  }

  resolveIncident() {
    this.api.updateIncidentStatus(this.id, 'RESOLVED').subscribe({
      next: () => { this.toast.success('Incident résolu'); this.load(); },
      error: () => this.toast.error('Erreur', 'Impossible de résoudre l\'incident')
    });
  }

  getSeverityColor(s: string) {
    const map: any = { CRITICAL: 'var(--accent-red)', HIGH: 'var(--accent-red)',
      MEDIUM: 'var(--accent-orange)', LOW: 'var(--accent-green)' };
    return map[s] || 'var(--border)';
  }

  getAgentColor(t: string) {
    const map: any = { ROOT_CAUSE: '#38bdf8', SECURITY: '#e24b4a',
      REMEDIATION: '#22c55e', JUDGE: '#f59e0b' };
    return map[t] || '#7ba8c8';
  }

  getAgentIcon(t: string) {
    const map: any = { ROOT_CAUSE: '◈', SECURITY: '⬡', REMEDIATION: '◆', JUDGE: '▣' };
    return map[t] || '◉';
  }

  getAgentLabel(t: string) {
    const map: any = { ROOT_CAUSE: 'Root Cause Analysis', SECURITY: 'Security Risk',
      REMEDIATION: 'Remediation', JUDGE: 'Judge Agent' };
    return map[t] || t;
  }
}
