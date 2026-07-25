import { Component, OnInit, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { ApiService } from '../../core/services/api.service';
import { ToastService } from '../../core/services/toast.service';
import { RiskStateService } from '../../core/services/risk-state.service';

@Component({
  selector: 'app-project-detail',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <div class="page" *ngIf="!loading && project">

      <!-- ═══ HEADER ═══ -->
      <div class="page-header">
        <div class="project-avatar" [style.background]="getAvatarBg(project.name)">
          {{project.name?.substring(0,2)?.toUpperCase()}}
        </div>
        <div class="header-info">
          <h1>{{project.name}}</h1>
          <div class="header-meta">
            <span class="badge-env">{{project.environment || 'dev'}}</span>
            <span class="sep">·</span>
            <span>{{project.githubRepo || 'No repo'}}</span>
            <span class="sep">·</span>
            <span>{{project.jenkinsJobName || 'No job'}}</span>
          </div>
        </div>
        <div class="header-actions">
          <div class="score-ring" [class.critical]="lastScore < 40" [class.high]="lastScore >= 40 && lastScore < 60"
               [class.medium]="lastScore >= 60 && lastScore < 80" [class.low]="lastScore >= 80">
            <span class="score-num">{{lastScore}}</span>
            <span class="score-lbl">SCORE</span>
          </div>
          <div class="risk-pill" [class.critical]="lastRisk==='critical'" [class.high]="lastRisk==='high'"
               [class.medium]="lastRisk==='medium'" [class.low]="lastRisk==='low'">
            {{lastRisk?.toUpperCase() || 'N/A'}}
          </div>
        </div>
      </div>

      <!-- ═══ TABS ═══ -->
      <div class="tabs-row">
        <button class="tab-btn" [class.active]="activeTab==='rapport'"   (click)="activeTab='rapport'">
          🤖 Rapport IA <span class="tab-badge" *ngIf="allReports.length">{{allReports.length}}</span>
        </button>
        <button class="tab-btn" [class.active]="activeTab==='jenkins'"   (click)="activeTab='jenkins'">
          ⚙️ Jenkins
        </button>
        <button class="tab-btn" [class.active]="activeTab==='sonarqube'" (click)="activeTab='sonarqube'">
          🔍 SonarQube
        </button>
        <button class="tab-btn" [class.active]="activeTab==='securite'"  (click)="activeTab='securite'">
          🔒 Sécurité
        </button>
        <button class="tab-btn" [class.active]="activeTab==='incidents'" (click)="activeTab='incidents'">
          ⚠️ Incidents <span class="tab-badge danger" *ngIf="incidents.length">{{incidents.length}}</span>
        </button>
        <button class="tab-btn" [class.active]="activeTab==='config'"    (click)="activeTab='config'">
          ⚙️ Config
        </button>
      </div>

      <!-- ═══════════════════════════════════════════ -->
      <!-- ONGLET RAPPORT IA                           -->
      <!-- ═══════════════════════════════════════════ -->
      <div *ngIf="activeTab === 'rapport'">
        <div *ngIf="!latestReport" class="empty-state">
          <div class="empty-icon">🤖</div>
          <div class="empty-title">Aucun rapport IA disponible</div>
          <div class="empty-sub">Lancez un build Jenkins pour générer une analyse</div>
        </div>

        <div *ngIf="latestReport">

          <!-- Section 1 : en-tête du rapport -->
          <div class="ai-hero">
            <div>
              <div class="ai-hero-tag">Build #{{rp.build || '?'}} — {{latestReport.createdAt | date:'dd/MM/yyyy HH:mm'}}</div>
              <div class="ai-hero-title">Analyse DevSecOps IA</div>
              <div class="ai-hero-sub">{{rp.job || 'N/A'}} — {{rp.status || 'N/A'}}</div>
            </div>
            <div class="ai-hero-right">
              <span class="ai-decision-badge" [style.color]="getDecisionColor(rp.decision)"
                    [style.border-color]="getDecisionColor(rp.decision)">{{rp.decision || 'N/A'}}</span>
              <div class="ai-confidence">
                <div class="ai-conf-bar"><div class="ai-conf-fill" [style.width]="rp.confidence" [style.background]="getDecisionColor(rp.decision)"></div></div>
                <span class="ai-conf-text">Confiance : {{rp.confidence || '0%'}}</span>
              </div>
              <span class="ai-sec-badge" [style.color]="getSecColor(rp.security)"
                    [style.border-color]="getSecColor(rp.security)">🔒 {{rp.security || 'UNKNOWN'}}</span>
            </div>
          </div>

          <!-- Section 2 : problèmes détectés -->
          <div class="ai-section">
            <div class="ai-section-title">Problèmes détectés</div>
            <div class="sev-count-grid">
              <div class="sev-count-card blocker">
                <div class="sev-count-num">{{countIssues('BLOCKER')}}</div>
                <div class="sev-count-lbl">BLOCKER</div>
                <div class="sev-count-sub">passwords, leaks</div>
              </div>
              <div class="sev-count-card critical">
                <div class="sev-count-num">{{countIssues('CRITICAL')}}</div>
                <div class="sev-count-lbl">CRITICAL</div>
                <div class="sev-count-sub">vulns, smells</div>
              </div>
              <div class="sev-count-card major">
                <div class="sev-count-num">{{countIssues('MAJOR')}}</div>
                <div class="sev-count-lbl">MAJOR</div>
              </div>
              <div class="sev-count-card bug">
                <div class="sev-count-num">{{countIssues('BUG')}}</div>
                <div class="sev-count-lbl">BUG</div>
              </div>
            </div>

            <div class="ai-justif" *ngIf="rp.justification">
              <div class="ai-justif-lbl">Justification IA</div>
              <p class="ai-justif-text">{{rp.justification}}</p>
            </div>

            <div class="ai-cicd-summary" *ngIf="rp.cicdIssues">
              <span class="ai-cicd-lbl">CI/CD :</span>
              <span class="ai-cicd-text">{{splitItems(rp.cicdIssues).join(' · ')}}</span>
            </div>
          </div>

          <!-- Section 3 : solutions proposées -->
          <div class="solutions-grid">

            <!-- Colonne gauche : correction agent IA -->
            <div class="solution-card">
              <div class="solution-header"><span class="solution-icon">🤖</span><span>Correction agent IA</span></div>

              <ol class="ai-action-list" *ngIf="devTasks.length">
                <li *ngFor="let t of devTasks; let i = index" class="ai-action-item" [class.done]="t.done" (click)="toggleTask(i)">
                  <span class="ai-action-num">{{i+1}}</span>
                  <span class="ai-action-txt">
                    <span class="task-pri" *ngIf="t.priority" [style.color]="getPriColor(t.priority)">[{{t.priority}}]</span>{{t.text}}
                  </span>
                </li>
              </ol>

              <div class="review-points" *ngIf="rp.developerReviewPoints?.length">
                <div class="review-points-lbl">Points de revue</div>
                <ul>
                  <li *ngFor="let pt of rp.developerReviewPoints">{{pt}}</li>
                </ul>
              </div>

              <div class="judge-warning" *ngIf="rp.warning">
                ⚠️ <strong>Avertissement du Judge :</strong> {{rp.warning}}
              </div>

              <div class="approval-box" *ngIf="(latestReport.status === 'analyzed' || latestReport.status === 'blocked') && (rp.decision === 'FIX_PROPOSED' || rp.decision === 'BLOCK' || rp.decision === 'AUTO_FIX')">
                <div class="approval-msg">Cette correction nécessite votre validation avant génération de la Pull Request.</div>
                <div class="approval-actions">
                  <button class="btn btn-action green" (click)="approveFix(latestReport.id)" [disabled]="approving">✓ Approuver la correction</button>
                  <button class="btn btn-action gray" (click)="rejectFix(latestReport.id)" [disabled]="approving">✗ Rejeter</button>
                </div>
              </div>
              <div class="approval-status info"     *ngIf="latestReport.status === 'approved'">⏳ Génération de la PR en cours...</div>
              <div class="approval-status success"  *ngIf="latestReport.status === 'fix_generated'">✅ PR créée : <a [href]="latestReport.prUrl" target="_blank">{{latestReport.prUrl}}</a></div>
              <div class="approval-status rejected" *ngIf="latestReport.status === 'rejected'">✗ Rejetée par le développeur</div>
            </div>

            <!-- Colonne droite : correction manuelle -->
            <div class="solution-card">
              <div class="solution-header"><span class="solution-icon">👤</span><span>Correction manuelle</span></div>

              <ng-container *ngIf="manualHigh.length">
                <div class="manual-group-lbl high">Priorité haute</div>
                <div class="manual-item" *ngFor="let m of manualHigh">
                  <span class="manual-chk">☐</span>
                  <div class="manual-body">
                    <span class="manual-txt">{{m.text}}</span>
                    <div class="manual-cmd" (click)="copyText(m.text)">
                      <span class="manual-cmd-text">{{m.text}}</span>
                      <span class="manual-copy-icon">📋</span>
                    </div>
                  </div>
                </div>
              </ng-container>

              <ng-container *ngIf="manualNormal.length">
                <div class="manual-group-lbl normal">Recommandé</div>
                <div class="manual-item" *ngFor="let m of manualNormal">
                  <span class="manual-chk">☐</span>
                  <div class="manual-body">
                    <span class="manual-txt">{{m.text}}</span>
                    <div class="manual-cmd" (click)="copyText(m.text)">
                      <span class="manual-cmd-text">{{m.text}}</span>
                      <span class="manual-copy-icon">📋</span>
                    </div>
                  </div>
                </div>
              </ng-container>

              <div class="empty-sub" *ngIf="!manualHigh.length && !manualNormal.length">Aucune recommandation manuelle</div>
            </div>

          </div><!-- /solutions-grid -->

          <!-- Section 4 : détail sécurité -->
          <div class="card mt-10" *ngIf="rp.securityIssues || ed.trivy?.cves?.length || ed.zap?.alerts?.length">
            <div class="card-title">🔒 Détail sécurité</div>

            <div class="zone-body" style="padding:0 0 10px" *ngIf="rp.securityIssues">
              <div *ngFor="let item of splitItems(rp.securityIssues)" class="zone-item">
                <span class="item-dot red">▸</span><span class="item-text">{{item}}</span>
              </div>
            </div>

            <table class="data-table mt-10" *ngIf="ed.trivy?.cves?.length">
              <thead><tr><th>CVE ID</th><th>Sévérité</th><th>Package</th><th>Version</th><th>Fix disponible</th></tr></thead>
              <tbody>
                <tr *ngFor="let cve of ed.trivy.cves">
                  <td style="font-family:var(--font-mono);font-size:10px;color:var(--accent-blue)">{{cve.id}}</td>
                  <td><span class="sev-badge" [style.background]="getSevColor(cve.severity)">{{cve.severity}}</span></td>
                  <td style="font-size:11px;font-family:var(--font-mono)">{{cve.package}}</td>
                  <td style="font-size:11px;color:var(--accent-red)">{{cve.version}}</td>
                  <td style="font-size:11px;color:var(--accent-green)">{{cve.fixedIn || 'Aucun fix'}}</td>
                </tr>
              </tbody>
            </table>

            <table class="data-table mt-10" *ngIf="ed.zap?.alerts?.length">
              <thead><tr><th>Alerte</th><th>Risque</th><th>URL</th><th>Solution</th></tr></thead>
              <tbody>
                <tr *ngFor="let alert of ed.zap.alerts">
                  <td style="font-size:11px;font-weight:600">{{alert.name}}</td>
                  <td><span class="sev-badge" [style.background]="getSevColor(alert.risk)">{{alert.risk?.split(' ')[0]}}</span></td>
                  <td style="font-size:10px;color:var(--text-muted);max-width:150px;overflow:hidden;text-overflow:ellipsis">{{alert.url}}</td>
                  <td style="font-size:10px;color:var(--accent-green);max-width:200px">{{alert.solution?.substring(0,100)}}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- Section 5 : analyse des agents -->
          <div class="agents-grid" *ngIf="rp.agentActions">
            <div class="agent-card">
              <div class="agent-card-hd"><span>🔎</span> Root Cause Agent</div>
              <p class="agent-card-txt">{{getAgentText('root') || '—'}}</p>
            </div>
            <div class="agent-card">
              <div class="agent-card-hd"><span>🛡️</span> Security Risk Agent</div>
              <p class="agent-card-txt">{{getAgentText('security') || '—'}}</p>
            </div>
            <div class="agent-card">
              <div class="agent-card-hd"><span>🛠️</span> Remediation Agent</div>
              <p class="agent-card-txt">{{getAgentText('remediation') || '—'}}</p>
            </div>
            <div class="judge-warning full" *ngIf="rp.warning">
              ⚠️ <strong>Avertissement du Judge :</strong> {{rp.warning}}
            </div>
          </div>

          <!-- Section 6 : historique des rapports -->
          <div class="history-box" *ngIf="allReports.length > 1">
            <div class="history-title">📋 Historique des rapports</div>
            <div class="history-list">
              <div *ngFor="let r of allReports" class="history-item"
                   [class.selected]="r.id === latestReport.id" (click)="selectReport(r)">
                <span class="h-dot" [style.background]="getDecisionColor(parseReport(r.aiAnalysis).decision)"></span>
                <span class="h-build">Build #{{parseReport(r.aiAnalysis).build || '?'}}</span>
                <span class="h-date">{{r.createdAt | date:'dd/MM HH:mm'}}</span>
                <span class="h-dec" [style.color]="getDecisionColor(parseReport(r.aiAnalysis).decision)">{{parseReport(r.aiAnalysis).decision || 'N/A'}}</span>
                <span class="h-score" [class.critical]="r.securityScore < 40">{{r.securityScore}}/100</span>
              </div>
            </div>
          </div>

          <div style="text-align:right;margin-top:8px">
            <button class="btn btn-secondary btn-sm" (click)="copyReport()">📋 Copier le rapport</button>
          </div>
        </div>
      </div>

      <!-- ═══════════════════════════════════════════ -->
      <!-- ONGLET JENKINS                              -->
      <!-- ═══════════════════════════════════════════ -->
      <div *ngIf="activeTab === 'jenkins'">
        <!-- KPIs depuis enrichedData du dernier rapport -->
        <div class="kpi-grid" *ngIf="ed.build">
          <div class="kpi-card">
            <div class="kpi-label">Build</div>
            <div class="kpi-value" [style.color]="ed.build.status==='SUCCESS'?'var(--accent-green)':'var(--accent-red)'">#{{ed.build.number || '?'}}</div>
            <div class="kpi-sub" [style.color]="ed.build.status==='SUCCESS'?'var(--accent-green)':'var(--accent-red)'">{{ed.build.status || 'N/A'}}</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">Tests</div>
            <div class="kpi-value" [style.color]="ed.tests?.failures>0?'var(--accent-red)':'var(--accent-green)'">
              {{ed.tests?.total || 0}}
            </div>
            <div class="kpi-sub">{{ed.tests?.failures || 0}} échecs</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">Coverage</div>
            <div class="kpi-value" style="color:var(--accent-blue)">{{ed.tests?.coverage || '0'}}%</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">Docker</div>
            <div class="kpi-value" style="font-size:12px" [style.color]="ed.docker?.build_status==='SUCCESS'?'var(--accent-green)':'var(--accent-red)'">
              {{ed.docker?.build_status || 'N/A'}}
            </div>
            <div class="kpi-sub">{{ed.docker?.image_tag || 'N/A'}}</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">Deploy</div>
            <div class="kpi-value" style="font-size:14px" [style.color]="ed.deploy?.status==='SUCCESS'?'var(--accent-green)':'var(--accent-red)'">
              {{ed.deploy?.status || 'N/A'}}
            </div>
            <div class="kpi-sub">{{ed.deploy?.namespace || 'N/A'}}</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">Nexus</div>
            <div class="kpi-value" style="font-size:14px" [style.color]="ed.docker?.push_status==='SUCCESS'?'var(--accent-green)':'var(--accent-red)'">
              {{ed.docker?.push_status || 'N/A'}}
            </div>
          </div>
        </div>

        <!-- Analyse IA Jenkins -->
        <div class="zone-card zone-cicd mt-10" *ngIf="rp.cicdIssues">
          <div class="zone-header"><span>🤖</span><span class="zone-title">ANALYSE IA — PIPELINE CI/CD</span></div>
          <div class="zone-body">
            <div *ngFor="let item of splitItems(rp.cicdIssues)" class="zone-item">
              <span class="item-dot orange">▸</span><span class="item-text">{{item}}</span>
            </div>
          </div>
        </div>

        <!-- Actions Jenkins -->
        <div class="action-row mt-10">
          <button class="btn btn-action green" (click)="triggerBuild()">
            🔄 Déclencher un build
          </button>
          <a [href]="'http://172.31.172.61:8082/job/'+(project.jenkinsJobName||'')" target="_blank" class="btn btn-action">
            🔗 Ouvrir Jenkins
          </a>
          <a [href]="ed.build?.url?.replace('jenkins:8080','172.31.172.61:8082')" target="_blank" class="btn btn-action" *ngIf="ed.build?.url">
            📋 Voir les logs
          </a>
        </div>

        <!-- Historique builds depuis Jenkins API -->
        <div class="card mt-10" *ngIf="jenkinsBuilds.length">
          <div class="card-title">📊 Derniers builds</div>
          <div class="build-list">
            <div *ngFor="let b of jenkinsBuilds" class="build-item">
              <div class="build-dot" [style.background]="b.result==='SUCCESS'?'var(--accent-green)':'var(--accent-red)'"></div>
              <span class="build-num" style="color:var(--accent-blue)">#{{b.number}}</span>
              <span class="build-result" [style.color]="b.result==='SUCCESS'?'var(--accent-green)':'var(--accent-red)'">{{b.result || 'RUNNING'}}</span>
              <span class="build-dur">{{b.duration}}s</span>
              <span class="build-time">{{b.timestamp | date:'dd/MM HH:mm'}}</span>
              <a [href]="b.url?.replace('jenkins:8080','172.31.172.61:8082')" target="_blank" class="build-link">→</a>
            </div>
          </div>
        </div>

        <div class="empty-state" *ngIf="!ed.build && !jenkinsBuilds.length">
          <div class="empty-icon">⚙️</div>
          <div class="empty-title">Aucune donnée Jenkins</div>
          <div class="empty-sub">Lancez un build pour voir les données</div>
        </div>
      </div>

      <!-- ═══════════════════════════════════════════ -->
      <!-- ONGLET SONARQUBE                            -->
      <!-- ═══════════════════════════════════════════ -->
      <div *ngIf="activeTab === 'sonarqube'">
        <!-- KPIs SonarQube -->
        <div class="kpi-grid" *ngIf="ed.sonar">
          <div class="kpi-card" [style.border-color]="ed.sonar.quality_gate==='OK'?'var(--accent-green)':'var(--accent-red)'">
            <div class="kpi-label">Quality Gate</div>
            <div class="kpi-value" [style.color]="ed.sonar.quality_gate==='OK'?'var(--accent-green)':'var(--accent-red)'">
              {{ed.sonar.quality_gate==='OK'?'✅ PASSED':'❌ FAILED'}}
            </div>
          </div>
          <div class="kpi-card"><div class="kpi-label">Bugs</div>
            <div class="kpi-value" [style.color]="ed.sonar.bugs>0?'var(--accent-red)':'var(--accent-green)'">{{ed.sonar.bugs || 0}}</div>
          </div>
          <div class="kpi-card"><div class="kpi-label">Vulnérabilités</div>
            <div class="kpi-value" [style.color]="ed.sonar.vulnerabilities>0?'var(--accent-orange)':'var(--accent-green)'">{{ed.sonar.vulnerabilities || 0}}</div>
          </div>
          <div class="kpi-card"><div class="kpi-label">Code Smells</div>
            <div class="kpi-value" style="color:var(--accent-yellow,#f59e0b)">{{ed.sonar.code_smells || 0}}</div>
          </div>
          <div class="kpi-card"><div class="kpi-label">Coverage</div>
            <div class="kpi-value" style="color:var(--accent-blue)">{{ed.sonar.coverage || '0'}}%</div>
          </div>
          <div class="kpi-card"><div class="kpi-label">Status</div>
            <div class="kpi-value" style="font-size:14px" [style.color]="ed.sonar.status==='SUCCESS'?'var(--accent-green)':'var(--accent-orange)'">
              {{ed.sonar.status || 'N/A'}}
            </div>
          </div>
        </div>

        <!-- Issues SonarQube détaillées -->
        <div class="card mt-10" *ngIf="ed.sonar?.issues?.length">
          <div class="card-title">🐛 Issues détectées ({{ed.sonar.issues.length}})</div>
          <table class="data-table">
            <thead>
              <tr><th>Sévérité</th><th>Type</th><th>Message</th><th>Fichier</th><th>Ligne</th><th>Effort</th></tr>
            </thead>
            <tbody>
              <tr *ngFor="let issue of ed.sonar.issues">
                <td><span class="sev-badge" [style.background]="getSevColor(issue.severity)">{{issue.severity}}</span></td>
                <td style="font-size:10px;color:var(--text-muted)">{{issue.type}}</td>
                <td style="max-width:280px;font-size:11px">{{issue.message}}</td>
                <td style="font-size:10px;color:var(--text-muted);font-family:var(--font-mono)">{{issue.component}}</td>
                <td style="font-size:10px;text-align:center">{{issue.line || '-'}}</td>
                <td style="font-size:10px;color:var(--accent-orange)">{{issue.effort || '-'}}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Analyse IA SonarQube -->
        <div class="zone-card mt-10" style="border-left:3px solid var(--accent-blue)" *ngIf="sonarAiAnalysis">
          <div class="zone-header"><span>🤖</span><span class="zone-title">ANALYSE IA — QUALITÉ CODE</span></div>
          <div class="zone-body">
            <p style="font-size:12px;color:var(--text-secondary)">{{sonarAiAnalysis}}</p>
          </div>
        </div>

        <!-- Actions SonarQube -->
        <div class="action-row mt-10">
          <a href="http://172.31.172.61:9000" target="_blank" class="btn btn-action">🔗 Ouvrir SonarQube</a>
          <a [href]="'http://172.31.172.61:9000/project/issues?id='+(project.sonarqubeKey||'')" target="_blank" class="btn btn-action">📋 Voir toutes les issues</a>
        </div>

        <div class="empty-state" *ngIf="!ed.sonar">
          <div class="empty-icon">🔍</div>
          <div class="empty-title">Aucune donnée SonarQube</div>
          <div class="empty-sub">Lancez un build pour voir l'analyse</div>
        </div>
      </div>

      <!-- ═══════════════════════════════════════════ -->
      <!-- ONGLET SÉCURITÉ                             -->
      <!-- ═══════════════════════════════════════════ -->
      <div *ngIf="activeTab === 'securite'">
        <!-- KPIs sécurité -->
        <div class="kpi-grid">
          <div class="kpi-card" [style.border-color]="(ed.trivy?.critical||0)>0?'var(--accent-red)':'var(--border)'">
            <div class="kpi-label">Trivy CRITICAL</div>
            <div class="kpi-value" [style.color]="(ed.trivy?.critical||0)>0?'var(--accent-red)':'var(--accent-green)'">{{ed.trivy?.cves_count || ed.trivy?.critical || 0}}</div>
            <div class="kpi-sub">{{ed.trivy?.status || 'N/A'}}</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">OWASP</div>
            <div class="kpi-value" style="font-size:13px" [style.color]="ed.owasp?.status==='SUCCESS'?'var(--accent-green)':'var(--accent-orange)'">{{ed.owasp?.status || 'N/A'}}</div>
            <div class="kpi-sub" style="color:var(--accent-red);font-size:9px">{{ed.owasp?.error || ''}}</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">ZAP DAST</div>
            <div class="kpi-value" style="font-size:13px" [style.color]="ed.zap?.status==='SUCCESS'?'var(--accent-green)':'var(--accent-orange)'">{{ed.zap?.status || 'N/A'}}</div>
            <div class="kpi-sub" style="color:var(--accent-red);font-size:9px">{{ed.zap?.error || ''}}</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">ZAP Alertes High</div>
            <div class="kpi-value" [style.color]="(ed.zap?.alerts_high||0)>0?'var(--accent-red)':'var(--accent-green)'">{{ed.zap?.alerts_high || 0}}</div>
          </div>
        </div>

        <!-- CVEs Trivy détaillées -->
        <div class="card mt-10" *ngIf="ed.trivy?.cves?.length">
          <div class="card-title">🛡️ CVEs Trivy ({{ed.trivy.cves.length}})</div>
          <table class="data-table">
            <thead>
              <tr><th>CVE ID</th><th>Sévérité</th><th>Package</th><th>Version</th><th>Fix disponible</th></tr>
            </thead>
            <tbody>
              <tr *ngFor="let cve of ed.trivy.cves">
                <td style="font-family:var(--font-mono);font-size:10px;color:var(--accent-blue)">{{cve.id}}</td>
                <td><span class="sev-badge" [style.background]="getSevColor(cve.severity)">{{cve.severity}}</span></td>
                <td style="font-size:11px;font-family:var(--font-mono)">{{cve.package}}</td>
                <td style="font-size:11px;color:var(--accent-red)">{{cve.version}}</td>
                <td style="font-size:11px;color:var(--accent-green)">{{cve.fixedIn || 'Aucun fix'}}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Alertes ZAP -->
        <div class="card mt-10" *ngIf="ed.zap?.alerts?.length">
          <div class="card-title">🌐 Alertes ZAP DAST ({{ed.zap.alerts.length}})</div>
          <table class="data-table">
            <thead>
              <tr><th>Alerte</th><th>Risque</th><th>URL</th><th>Solution</th></tr>
            </thead>
            <tbody>
              <tr *ngFor="let alert of ed.zap.alerts">
                <td style="font-size:11px;font-weight:600">{{alert.name}}</td>
                <td><span class="sev-badge" [style.background]="getSevColor(alert.risk)">{{alert.risk?.split(' ')[0]}}</span></td>
                <td style="font-size:10px;color:var(--text-muted);max-width:150px;overflow:hidden;text-overflow:ellipsis">{{alert.url}}</td>
                <td style="font-size:10px;color:var(--accent-green);max-width:200px">{{alert.solution?.substring(0,100)}}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Analyse IA sécurité -->
        <div class="zone-card zone-sec mt-10" *ngIf="rp.securityIssues">
          <div class="zone-header"><span>🤖</span><span class="zone-title">ANALYSE IA — RISQUES SÉCURITÉ</span></div>
          <div class="zone-body">
            <div *ngFor="let item of splitItems(rp.securityIssues)" class="zone-item">
              <span class="item-dot red">▸</span><span class="item-text">{{item}}</span>
            </div>
          </div>
        </div>

        <!-- Actions sécurité -->
        <div class="action-row mt-10">
          <button class="btn btn-action red" (click)="rollbackDeployment()" *ngIf="rp.decision==='BLOCK'">
            🚫 Rollback déploiement
          </button>
          <button class="btn btn-action green" (click)="createFixPR()" *ngIf="project.githubRepo">
            🔧 Créer PR de correction
          </button>
        </div>

        <div class="empty-state" *ngIf="!ed.trivy && !ed.zap && !ed.owasp">
          <div class="empty-icon">🛡️</div>
          <div class="empty-title">Aucune donnée de sécurité</div>
          <div class="empty-sub">Lancez un build avec Trivy et ZAP activés</div>
        </div>
      </div>

      <!-- ═══════════════════════════════════════════ -->
      <!-- ONGLET INCIDENTS                            -->
      <!-- ═══════════════════════════════════════════ -->
      <div *ngIf="activeTab === 'incidents'">
        <div class="card" style="padding:0;overflow:hidden">
          <table class="data-table">
            <thead><tr><th>Titre</th><th>Statut</th><th>Source</th><th>Date</th><th></th></tr></thead>
            <tbody>
              <tr *ngIf="incidents.length === 0">
                <td colspan="5" style="text-align:center;padding:30px;color:var(--text-faint)">Aucun incident</td>
              </tr>
              <tr *ngFor="let i of incidents">
                <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{i.title}}</td>
                <td><span class="badge" [class.info]="i.status==='analyzed'" [class.danger]="i.status==='failed'">{{i.status}}</span></td>
                <td><span class="badge">{{i.source}}</span></td>
                <td style="font-size:10px;font-family:var(--font-mono)">{{i.createdAt | date:'dd/MM HH:mm'}}</td>
                <td><a [routerLink]="['/incidents', i.id]" class="btn btn-secondary btn-sm">→</a></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- ═══════════════════════════════════════════ -->
      <!-- ONGLET CONFIG                               -->
      <!-- ═══════════════════════════════════════════ -->
      <div *ngIf="activeTab === 'config'">
        <div class="card">
          <div class="card-title">⚙️ Configuration du projet</div>
          <table style="width:100%;border-collapse:collapse">
            <tr *ngFor="let row of getInfoRows()" style="border-bottom:1px solid var(--border)">
              <td style="padding:10px;color:var(--text-muted);font-size:12px;width:160px">{{row.label}}</td>
              <td style="padding:10px;font-size:12px;font-family:var(--font-mono)">{{row.value}}</td>
            </tr>
          </table>
        </div>
      </div>

    </div>
    <div *ngIf="loading" class="loading-state">Chargement...</div>
  `,
  styles: [`
    :host { display:block }
    .page { padding:18px 20px; background:var(--bg-primary); min-height:100vh; color:var(--text-primary) }

    /* Header */
    .page-header { display:flex; align-items:center; gap:14px; margin-bottom:20px; padding:16px; background:var(--bg-secondary); border:1px solid var(--border); border-radius:10px }
    .project-avatar { width:44px; height:44px; border-radius:10px; display:flex; align-items:center; justify-content:center; font-size:14px; font-weight:700; color:#fff; flex-shrink:0 }
    .header-info h1 { font-size:18px; font-weight:700; margin:0 0 4px }
    .header-meta { display:flex; align-items:center; gap:6px; font-size:11px; color:var(--text-muted) }
    .badge-env { padding:2px 8px; background:var(--bg-hover); border-radius:4px; font-size:10px }
    .sep { color:var(--border) }
    .header-actions { margin-left:auto; display:flex; align-items:center; gap:12px }
    .score-ring { display:flex; flex-direction:column; align-items:center; padding:8px 12px; border-radius:8px; border:2px solid var(--border) }
    .score-ring.critical { border-color:var(--accent-red); }
    .score-ring.high { border-color:var(--accent-orange); }
    .score-ring.medium { border-color:var(--accent-yellow,#f59e0b); }
    .score-ring.low { border-color:var(--accent-green); }
    .score-num { font-size:24px; font-weight:700; line-height:1 }
    .score-ring.critical .score-num { color:var(--accent-red) }
    .score-ring.high .score-num { color:var(--accent-orange) }
    .score-ring.medium .score-num { color:var(--accent-yellow,#f59e0b) }
    .score-ring.low .score-num { color:var(--accent-green) }
    .score-lbl { font-size:9px; color:var(--text-muted); text-transform:uppercase; letter-spacing:1px }
    .risk-pill { padding:4px 12px; border-radius:20px; font-size:10px; font-weight:700; background:var(--bg-hover) }
    .risk-pill.critical { background:var(--accent-red-bg);    color:var(--accent-red) }
    .risk-pill.high     { background:var(--accent-orange-bg); color:var(--accent-orange) }
    .risk-pill.medium   { background:var(--accent-orange-bg); color:var(--accent-orange) }
    .risk-pill.low      { background:var(--accent-green-bg);  color:var(--accent-green) }

    /* Tabs */
    .tabs-row { display:flex; gap:4px; margin-bottom:16px; border-bottom:1px solid var(--border); flex-wrap:wrap }
    .tab-btn { display:flex; align-items:center; gap:5px; padding:8px 14px; border:none; background:none; color:var(--text-muted); cursor:pointer; font-size:12px; border-bottom:2px solid transparent; margin-bottom:-1px; transition:all .15s }
    .tab-btn:hover { color:var(--text-secondary) }
    .tab-btn.active { color:var(--accent-blue); border-bottom-color:var(--accent-blue) }
    .tab-badge { background:var(--accent-blue); color:#fff; border-radius:10px; padding:1px 6px; font-size:9px; font-weight:700 }
    .tab-badge.danger { background:var(--accent-red) }

    /* KPIs */
    .kpi-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(130px,1fr)); gap:8px; margin-bottom:14px }
    .kpi-card { background:var(--bg-secondary); border:1px solid var(--border); border-radius:8px; padding:12px; transition:border-color .2s }
    .kpi-label { font-size:9px; color:var(--text-muted); text-transform:uppercase; letter-spacing:.5px; margin-bottom:6px }
    .kpi-value { font-size:22px; font-weight:700 }
    .kpi-sub { font-size:10px; margin-top:2px; color:var(--text-muted) }

    /* Cards */
    .card { background:var(--bg-secondary); border:1px solid var(--border); border-radius:8px; padding:14px }
    .card-title { font-size:10px; font-weight:600; color:var(--text-muted); text-transform:uppercase; letter-spacing:.5px; margin-bottom:12px }
    .mt-10 { margin-top:10px }

    /* Rapport IA — Section 1 : hero */
    .ai-hero { display:flex; justify-content:space-between; align-items:flex-start; gap:16px; padding:18px 20px; border-radius:12px; margin-bottom:14px; background:#fff; border:0.5px solid rgba(0,0,0,0.08) }
    .ai-hero-tag { font-size:10px; color:var(--text-muted); font-family:var(--font-mono); margin-bottom:4px }
    .ai-hero-title { font-size:17px; font-weight:700; margin-bottom:4px }
    .ai-hero-sub { font-size:11px; color:var(--text-muted) }
    .ai-hero-right { display:flex; flex-direction:column; align-items:flex-end; gap:8px; flex-shrink:0 }
    .ai-decision-badge { font-size:11px; font-weight:700; padding:5px 14px; border-radius:20px; border:1px solid; font-family:var(--font-mono) }
    .ai-confidence { display:flex; flex-direction:column; align-items:flex-end; gap:3px }
    .ai-conf-bar { width:110px; height:4px; background:var(--bg-hover); border-radius:2px; overflow:hidden }
    .ai-conf-fill { height:100%; border-radius:2px }
    .ai-conf-text { font-size:10px; color:var(--text-muted) }
    .ai-sec-badge { font-size:10px; font-weight:700; padding:3px 10px; border-radius:20px; border:1px solid }

    /* Rapport IA — Section 2 : problèmes détectés */
    .ai-section { background:#fff; border:0.5px solid rgba(0,0,0,0.08); border-radius:12px; padding:16px 18px; margin-bottom:14px }
    .ai-section-title { font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.5px; color:var(--text-muted); margin-bottom:12px }
    .sev-count-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:10px; margin-bottom:14px }
    .sev-count-card { border-radius:10px; padding:12px; text-align:center; background:var(--bg-hover) }
    .sev-count-num { font-size:24px; font-weight:700 }
    .sev-count-lbl { font-size:10px; font-weight:700; letter-spacing:.5px; margin-top:2px }
    .sev-count-sub { font-size:9px; color:var(--text-muted); margin-top:2px }
    .sev-count-card.blocker  .sev-count-num, .sev-count-card.blocker  .sev-count-lbl { color:#E24B4A }
    .sev-count-card.critical .sev-count-num, .sev-count-card.critical .sev-count-lbl { color:#D85A30 }
    .sev-count-card.major    .sev-count-num, .sev-count-card.major    .sev-count-lbl { color:#BA7517 }
    .sev-count-card.bug      .sev-count-num, .sev-count-card.bug      .sev-count-lbl { color:#D4537E }
    .ai-justif { border-left:3px solid var(--accent-primary); padding:8px 14px; margin-bottom:10px; background:var(--bg-hover); border-radius:0 6px 6px 0 }
    .ai-justif-lbl { font-size:9px; font-weight:700; text-transform:uppercase; letter-spacing:.5px; color:var(--text-muted); margin-bottom:4px }
    .ai-justif-text { font-size:12px; color:var(--text-secondary); line-height:1.5; margin:0 }
    .ai-cicd-summary { font-size:11px; color:var(--text-secondary) }
    .ai-cicd-lbl { font-weight:700; color:var(--text-muted); margin-right:6px }

    /* Rapport IA — Section 3 : solutions proposées */
    .solutions-grid { display:grid; grid-template-columns:1fr 1fr; gap:14px; margin-bottom:14px }
    .solution-card { background:#fff; border:0.5px solid rgba(0,0,0,0.08); border-radius:12px; padding:16px 18px }
    .solution-header { display:flex; align-items:center; gap:8px; font-size:12px; font-weight:700; margin-bottom:12px; padding-bottom:10px; border-bottom:1px solid var(--border) }
    .solution-icon { font-size:15px }
    .ai-action-list { list-style:none; margin:0 0 12px; padding:0; display:flex; flex-direction:column; gap:8px }
    .ai-action-item { display:flex; align-items:flex-start; gap:8px; cursor:pointer; padding:6px 0; border-bottom:1px solid var(--border) }
    .ai-action-item:last-child { border-bottom:none }
    .ai-action-item.done .ai-action-txt { text-decoration:line-through; color:var(--text-faint) }
    .ai-action-num { background:var(--accent-primary); color:var(--accent-text-on); font-weight:700; font-size:0.7rem; width:18px; height:18px; border-radius:50%; display:flex; align-items:center; justify-content:center; flex-shrink:0 }
    .ai-action-txt { flex:1; font-size:12px; color:var(--text-secondary); line-height:1.4 }
    .task-pri { font-weight:700; font-size:10px; margin-right:4px }
    .review-points { margin-bottom:12px }
    .review-points-lbl { font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.5px; color:var(--text-muted); margin-bottom:6px }
    .review-points ul { margin:0; padding-left:18px; font-size:12px; color:var(--text-secondary); line-height:1.6 }
    .judge-warning { background:var(--accent-orange-bg); color:var(--accent-orange); border:1px solid var(--accent-orange); border-radius:8px; padding:10px 12px; font-size:11px; line-height:1.5; margin-bottom:12px }
    .judge-warning.full { grid-column:1 / -1 }
    .approval-box { background:var(--accent-purple-bg); border:1px solid var(--accent-purple); border-radius:8px; padding:12px 14px; margin-top:6px }
    .approval-msg { font-size:11px; color:var(--text-secondary); margin-bottom:10px }
    .approval-actions { display:flex; gap:8px; flex-wrap:wrap }
    .btn-action.gray { border-color:var(--text-muted); color:var(--text-muted); background:var(--bg-hover) }
    .approval-status { font-size:11px; padding:8px 12px; border-radius:8px; margin-top:6px }
    .approval-status.info     { background:var(--accent-blue-bg);   color:var(--accent-blue) }
    .approval-status.success  { background:var(--accent-green-bg);  color:var(--accent-green) }
    .approval-status.rejected { background:var(--accent-red-bg);    color:var(--accent-red) }
    .manual-group-lbl { font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.5px; margin:10px 0 6px }
    .manual-group-lbl.high   { color:var(--accent-red) }
    .manual-group-lbl.normal { color:var(--text-muted) }
    .manual-item { display:flex; align-items:flex-start; gap:8px; padding:6px 0; border-bottom:1px solid var(--border) }
    .manual-item:last-child { border-bottom:none }
    .manual-chk { flex-shrink:0; color:var(--text-muted) }
    .manual-body { flex:1; min-width:0 }
    .manual-txt { display:block; font-size:12px; color:var(--text-secondary); margin-bottom:4px }
    .manual-cmd { display:flex; align-items:center; justify-content:space-between; gap:8px; background:var(--bg-hover); border:1px solid transparent; border-radius:6px; padding:6px 10px; cursor:pointer; font-family:var(--font-mono); font-size:11px; color:var(--text-secondary) }
    .manual-cmd:hover { border-color:var(--accent-blue) }
    .manual-cmd-text { overflow:hidden; text-overflow:ellipsis; white-space:nowrap }
    .manual-copy-icon { flex-shrink:0; font-size:11px }
    @media (max-width:768px) { .solutions-grid { grid-template-columns:1fr } }

    /* Zones (partagées avec les onglets Jenkins / SonarQube / Sécurité) */
    .zone-card { background:var(--bg-secondary); border:1px solid var(--border); border-radius:8px; overflow:hidden }
    .zone-cicd { border-left:3px solid var(--accent-orange) }
    .zone-sec  { border-left:3px solid var(--accent-red) }
    .zone-header  { display:flex; align-items:center; gap:8px; padding:10px 14px; background:var(--bg-hover); border-bottom:1px solid var(--border) }
    .zone-title   { font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.5px; color:var(--text-muted); flex:1 }
    .zone-count   { background:rgba(255,255,255,0.1); border-radius:10px; padding:1px 8px; font-size:10px }
    .zone-body    { padding:12px 14px; font-size:12px }
    .zone-item    { display:flex; align-items:flex-start; gap:8px; padding:5px 0; border-bottom:1px solid rgba(255,255,255,0.04) }
    .zone-item:last-child { border-bottom:none }
    .item-dot     { font-size:1rem; flex-shrink:0 }
    .item-dot.orange { color:var(--accent-orange) }
    .item-dot.red    { color:var(--accent-red) }
    .item-dot.purple { color:var(--accent-purple) }
    .item-text { flex:1; color:var(--text-secondary); line-height:1.5 }

    /* Severity badge */
    .sev-badge { font-size:0.68rem; font-weight:700; padding:2px 6px; border-radius:4px; color:#000; white-space:nowrap; flex-shrink:0 }

    /* Rapport IA — Section 5 : analyse des agents */
    .agents-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:12px; margin-bottom:14px }
    .agent-card { background:#fff; border:0.5px solid rgba(0,0,0,0.08); border-radius:12px; padding:14px }
    .agent-card-hd { display:flex; align-items:center; gap:6px; font-size:11px; font-weight:700; color:var(--text-primary); margin-bottom:8px }
    .agent-card-txt { font-size:12px; color:var(--text-secondary); line-height:1.5; margin:0 }
    @media (max-width:768px) { .agents-grid { grid-template-columns:1fr } }

    /* Rapport IA — Section 6 : historique */
    .history-box { background:#fff; border:0.5px solid rgba(0,0,0,0.08); border-radius:12px; padding:12px; margin-bottom:12px }
    .history-title { font-size:10px; font-weight:700; color:var(--text-muted); text-transform:uppercase; letter-spacing:.5px; margin-bottom:8px }
    .history-list { display:flex; flex-direction:column; gap:4px }
    .history-item { display:flex; align-items:center; gap:10px; padding:7px 10px; background:var(--bg-hover); border-radius:5px; cursor:pointer; font-size:11px }
    .history-item:hover { background:var(--bg-primary) }
    .history-item.selected { border:1px solid var(--accent-blue) }
    .h-dot { width:8px; height:8px; border-radius:50%; flex-shrink:0 }
    .h-build { font-family:var(--font-mono) }
    .h-date { margin-left:auto; color:var(--text-faint); font-family:var(--font-mono); font-size:10px }
    .h-dec { font-size:10px; font-weight:600; font-family:var(--font-mono) }
    .h-score { font-size:10px; font-family:var(--font-mono); color:var(--accent-blue) }
    .h-score.critical { color:var(--accent-red) }

    /* Actions */
    .action-row { display:flex; gap:8px; flex-wrap:wrap }
    .btn { display:inline-flex; align-items:center; gap:5px; padding:7px 14px; border-radius:6px; font-size:11px; cursor:pointer; text-decoration:none; border:1px solid var(--border) }
    .btn-action { background:var(--bg-hover); color:var(--text-secondary) }
    .btn-action:hover { border-color:var(--accent-blue); color:var(--accent-blue) }
    .btn-action.green { border-color:var(--accent-green); color:var(--accent-green); background:var(--accent-green-bg) }
    .btn-action.red   { border-color:var(--accent-red);   color:var(--accent-red);   background:var(--accent-red-bg) }
    .btn-secondary { background:var(--bg-hover); color:var(--text-secondary) }
    .btn-sm { padding:4px 10px; font-size:10px }

    /* Builds */
    .build-list { display:flex; flex-direction:column; gap:4px }
    .build-item { display:flex; align-items:center; gap:10px; padding:8px 10px; background:var(--bg-hover); border-radius:5px; font-size:11px }
    .build-dot { width:7px; height:7px; border-radius:50%; flex-shrink:0 }
    .build-num { font-weight:600; width:35px }
    .build-result { width:80px; font-weight:600; font-size:10px }
    .build-dur { color:var(--text-muted); width:50px }
    .build-time { color:var(--text-muted); flex:1; font-family:var(--font-mono); font-size:10px }
    .build-link { color:var(--accent-blue); text-decoration:none }

    /* Table */
    .data-table { width:100%; border-collapse:collapse; font-size:12px }
    .data-table th { padding:10px 12px; text-align:left; font-size:10px; color:var(--text-muted); text-transform:uppercase; letter-spacing:.5px; border-bottom:1px solid var(--border); background:var(--bg-hover) }
    .data-table td { padding:10px 12px; border-bottom:1px solid var(--border) }
    .badge { padding:2px 8px; border-radius:4px; font-size:10px; font-weight:600; background:var(--bg-hover); color:var(--text-muted) }
    .badge.info   { background:var(--accent-blue-bg); color:var(--accent-blue) }
    .badge.danger { background:var(--accent-red-bg);  color:var(--accent-red) }

    /* Empty / loading */
    .empty-state { text-align:center; padding:60px 20px }
    .empty-icon { font-size:40px; margin-bottom:12px }
    .empty-title { font-size:15px; font-weight:600; color:var(--text-secondary); margin-bottom:6px }
    .empty-sub { font-size:12px; color:var(--text-muted) }
    .loading-state { text-align:center; padding:40px; color:var(--text-muted); font-size:13px }
  `]
})
export class ProjectDetailComponent implements OnInit {
  approving = false;
  @Input() id!: string;

  project: any = null;
  incidents: any[] = [];
  allReports: any[] = [];
  latestReport: any = null;
  loading = true;
  activeTab = 'rapport';

  // Parsed report
  rp: any = {};
  ed: any = {}; // enrichedData du dernier rapport
  devTasks: any[] = [];
  checkedTasks = 0;

  // Score affiché dans le header (du dernier rapport)
  lastScore = 100;
  lastRisk = 'low';

  // Jenkins builds
  jenkinsBuilds: any[] = [];

  // Analyse IA SonarQube extraite
  sonarAiAnalysis = '';

  // Correction manuelle (section 3, colonne droite) — recommandations réparties par priorité
  manualHigh: { text: string; high: boolean }[] = [];
  manualNormal: { text: string; high: boolean }[] = [];

  constructor(private api: ApiService, private toast: ToastService, private riskState: RiskStateService) {}

  ngOnInit() {
    this.api.getProject(this.id).subscribe({
      next: p => {
        this.project = p;
        this.loading = false;
        this.loadIncidents();
        this.loadReports();
        this.loadJenkinsBuilds();
      },
      error: () => {
        this.toast.error('Erreur', 'Projet introuvable');
        this.loading = false;
      }
    });
  }

  loadIncidents() {
    this.api.getIncidents({ projectId: this.id, size: 20 }).subscribe((r: any) => {
      this.incidents = r.content || r;
    });
  }

  loadReports() {
    this.api.getDecisions({ projectId: this.id }).subscribe({
      next: (r: any) => {
        const list: any[] = Array.isArray(r) ? r : [];
        this.allReports = list
          .filter(x => x.aiAnalysis)
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        if (this.allReports.length > 0) this.selectReport(this.allReports[0]);
      },
      error: () => {}
    });
  }

  loadJenkinsBuilds() {
    if (!this.project?.jenkinsJobName) return;
    this.api.getJenkins(this.id).subscribe({
      next: (d: any) => { this.jenkinsBuilds = d?.builds || []; },
      error: () => {}
    });
  }

  selectReport(r: any) {
    this.latestReport = r;
    this.rp = this.parseReport(r.aiAnalysis);
    // Charger enrichedData
    this.ed = (r.metadata?.enrichedData) ?? (r.rawData?.enrichedData) ?? {};
    // Score depuis le rapport
    const _lvl = (this.rp.security || r.riskLevel || "low").toUpperCase(); this.lastScore = _lvl === "CRITICAL" ? 10 : _lvl === "HIGH" ? 30 : _lvl === "MEDIUM" ? 60 : 90;
    this.lastRisk = _lvl.toLowerCase();
    this.riskState.setLevel(this.lastRisk);
    // Tâches développeur
    this.devTasks = this.parseDevTasks(this.rp.developerActions);
    this.checkedTasks = 0;
    // Extraire analyse IA SonarQube depuis agentActions
    this.sonarAiAnalysis = this.extractSonarAnalysis(this.rp.agentActions);
    // Recommandations de correction manuelle, réparties par priorité
    const manualItems = this.parseManualItems(this.rp.recommendations);
    this.manualHigh = manualItems.filter(m => m.high);
    this.manualNormal = manualItems.filter(m => !m.high);
  }

  extractSonarAnalysis(agentActions: string): string {
    if (!agentActions) return '';
    const parts = agentActions.split('|');
    const sonarPart = parts.find(p => p.toLowerCase().includes('sonar') || p.toLowerCase().includes('quality') || p.toLowerCase().includes('code smell'));
    return sonarPart ? sonarPart.trim() : '';
  }

  triggerBuild() {
    this.api.triggerBuild(this.project.id).subscribe({
      next: (r: any) => {
        if (r.success) this.toast.success('Build lancé', 'Build ' + (r.job || '') + ' démarré');
        else this.toast.error('Erreur', r.error || 'Echec du déclenchement');
      },
      error: () => this.toast.error('Erreur', 'Impossible de contacter le backend'),
    });
  }

  rollbackDeployment() {
    this.toast.success('Rollback', 'Commande kubectl rollout undo envoyée');
    // À connecter à un endpoint backend qui exécute kubectl
  }

  createFixPR() {
    this.toast.success('PR', 'Création de la PR en cours via WF2');
    // À connecter au WF2 n8n Auto-Fix
  }

  splitItems(text: string): string[] {
    if (!text) return [];
    return text.split('|').map(s => s.trim()).filter(s => s.length > 0);
  }

  getSevColor(item: string): string {
    if (!item) return 'var(--text-tertiary)';
    const s = item.toUpperCase();
    if (s.includes('CRITICAL')) return 'var(--color-critical)';
    if (s.includes('HIGH'))     return 'var(--color-high)';
    if (s.includes('MEDIUM'))   return 'var(--color-warning)';
    if (s.includes('LOW'))      return 'var(--accent-blue)';
    return 'var(--text-tertiary)';
  }

  getSevBadge(item: string): string {
    if (!item) return '';
    const s = item.toUpperCase();
    if (s.includes('CRITICAL')) return 'CRITICAL';
    if (s.includes('HIGH'))     return 'HIGH';
    if (s.includes('MEDIUM'))   return 'MEDIUM';
    if (s.includes('LOW'))      return 'LOW';
    return '';
  }

  parseReport(summary: string): any {
    if (!summary) return {};
    try {
      const json = JSON.parse(summary);
      return {
        build:            json.build || json.build_number || 'N/A',
        job:              json.job   || 'N/A',
        status:           json.status || 'N/A',
        decision:         json.decision || 'NOTIFY_ONLY',
        confidence:       (json.confidenceScore || 0) + '%',
        errors:           this.fmt(json.errorsSummary),
        cicdIssues:       this.fmt(json.cicdIssues),
        securityIssues:   this.fmt(json.securityIssues),
        agentActions:     this.fmt(json.agentActions),
        developerActions: this.fmt(json.developerActions),
        security:         json.securityLevel || 'LOW',
        recommendations:  this.fmt(json.recommendations),
        justification:    json.justification || '',
        warning:          json.warning || '',
        developerReviewPoints: Array.isArray(json.developerReviewPoints)
          ? json.developerReviewPoints
          : (json.developerReviewPoints ? [json.developerReviewPoints] : []),
        _raw:             json
      };
    } catch(e) { return {}; }
  }

  fmt(val: any): string {
    if (!val) return '';
    if (typeof val === 'string') return val;
    if (Array.isArray(val)) return val.map((x: any) => typeof x === 'string' ? x : JSON.stringify(x)).join(' | ');
    return JSON.stringify(val);
  }

  parseDevTasks(raw: string): any[] {
    if (!raw) return [];
    const lines = raw.split(/\d+\.\s+/).filter(l => l.trim());
    if (lines.length > 1) {
      return lines.map(l => {
        const pm = l.match(/\[(HAUTE|MOYENNE|BASSE)\]/i);
        return { text: l.replace(/\[.*?\]/g, '').trim(), priority: pm?.[1]?.toUpperCase() || null, done: false };
      });
    }
    return raw.split('|').map(l => ({ text: l.trim(), priority: null, done: false })).filter(t => t.text);
  }

  toggleTask(i: number) {
    this.devTasks[i].done = !this.devTasks[i].done;
    this.checkedTasks = this.devTasks.filter(t => t.done).length;
  }

  approveFix(id: string) {
    this.approving = true;
    this.api.approveFix(id).subscribe({
      next: () => { this.approving = false; this.loadReports(); },
      error: () => { this.approving = false; alert('Erreur approbation'); },
    });
  }

  rejectFix(id: string) {
    this.approving = true;
    this.api.rejectFix(id).subscribe({
      next: () => { this.approving = false; this.loadReports(); },
      error: () => { this.approving = false; alert('Erreur rejet'); },
    });
  }

  copyReport() {
    navigator.clipboard.writeText(this.latestReport?.aiAnalysis || this.latestReport?.aiSummary || '').then(() => {
      this.toast.success('Copié', 'Rapport copié dans le presse-papiers');
    });
  }

  copyText(text: string) {
    navigator.clipboard.writeText(text || '').then(() => {
      this.toast.success('Copié', 'Commande copiée dans le presse-papiers');
    });
  }

  countIssues(severity: 'BLOCKER' | 'CRITICAL' | 'MAJOR' | 'BUG'): number {
    const issues = this.ed?.sonar?.issues || [];
    if (severity === 'BUG') return issues.filter((i: any) => i.type === 'BUG').length;
    return issues.filter((i: any) => i.severity === severity).length;
  }

  parseManualItems(raw: string): { text: string; high: boolean }[] {
    return this.splitItems(raw).map(text => ({
      text: text.replace(/\[.*?\]/g, '').trim(),
      high: /\[(HAUTE|CRITIQUE|URGENT|BLOQUANT)\]/i.test(text)
    }));
  }

  getAgentText(kind: 'root' | 'security' | 'remediation'): string {
    if (!this.rp.agentActions) return '';
    const parts = this.splitItems(this.rp.agentActions);
    const keywords: Record<string, string[]> = {
      root:        ['root cause', 'cause racine', 'root-cause'],
      security:    ['security risk', 'risque sécurité', 'risque de sécurité', 'security'],
      remediation: ['remediation', 'remédiation', 'correction']
    };
    const found = parts.find(p => keywords[kind].some(k => p.toLowerCase().includes(k)));
    if (found) return found;
    const idx = kind === 'root' ? 0 : kind === 'security' ? 1 : 2;
    return parts[idx] || '';
  }

  getInfoRows() {
    if (!this.project) return [];
    return [
      { label: 'ID',             value: this.project.id },
      { label: 'Environnement',  value: this.project.environment || '—' },
      { label: 'Créé le',        value: this.project.createdAt ? new Date(this.project.createdAt).toLocaleDateString('fr-FR') : '—' },
      { label: 'CI/CD Tool',     value: this.project.cicdTool || '—' },
      { label: 'Jenkins Job',    value: this.project.jenkinsJobName || '—' },
      { label: 'Jenkins URL',    value: this.project.jenkinsUrl || '—' },
      { label: 'SonarQube Key',  value: this.project.sonarqubeKey || '—' },
      { label: 'GitHub Repo',    value: this.project.githubRepo || '—' },
      { label: 'Description',    value: this.project.description || '—' },
    ];
  }

  getAvatarBg(name: string): string {
    const colors = ['var(--accent-blue-bg)', 'var(--accent-green-bg)', 'var(--accent-orange-bg)', 'var(--accent-purple-bg)', 'var(--accent-red-bg)'];
    if (!name) return colors[0];
    return colors[name.charCodeAt(0) % colors.length];
  }

  getDecisionColor(d: string): string {
    if (d === 'FIX_PROPOSED' || d === 'AUTO_FIX') return '#1D9E75';
    if (d === 'BLOCK')       return '#E24B4A';
    if (d === 'NOTIFY_ONLY') return '#888780';
    return '#888780';
  }

  getSecColor(level: string): string {
    const l = (level || '').toUpperCase();
    if (l === 'CRITICAL') return 'var(--accent-red)';
    if (l === 'HIGH')     return 'var(--accent-orange)';
    if (l === 'MEDIUM')   return '#f59e0b';
    return 'var(--accent-green)';
  }

  getPriColor(p: string): string {
    if (p === 'HAUTE')   return 'var(--accent-red)';
    if (p === 'MOYENNE') return 'var(--accent-orange)';
    return 'var(--accent-blue)';
  }
}
