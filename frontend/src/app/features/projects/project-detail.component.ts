import { Component, OnInit, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { ApiService } from '../../core/services/api.service';
import { ToastService } from '../../core/services/toast.service';

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
          <!-- Hero décision -->
          <div class="rapport-hero" [class.block]="rp.decision==='BLOCK'"
               [class.autofix]="rp.decision==='AUTO_FIX'" [class.notify]="rp.decision==='NOTIFY_ONLY'">
            <div>
              <div class="rapport-build-tag">Build #{{rp.build || '?'}} · {{latestReport.createdAt | date:'dd/MM/yyyy HH:mm'}}</div>
              <div class="rapport-title">ANALYSE DEVSECOPS IA</div>
              <div class="rapport-meta">{{rp.job || 'N/A'}} · {{rp.status || 'N/A'}}</div>
            </div>
            <div class="hero-right">
              <div class="decision-badge" [style.color]="getDecisionColor(rp.decision)"
                   [style.border-color]="getDecisionColor(rp.decision)">{{rp.decision || 'N/A'}}</div>
              <div class="confidence-wrap">
                <div class="conf-bar"><div class="conf-fill" [style.width]="rp.confidence" [style.background]="getDecisionColor(rp.decision)"></div></div>
                <span class="conf-text">Confiance : {{rp.confidence}}</span>
              </div>
              <div class="sec-level" [style.color]="getSecColor(rp.security)">🔒 {{rp.security || 'UNKNOWN'}}</div>
            </div>
          </div>

          <!-- 4 zones en grille -->
          <div class="zone-grid">

            <!-- Zone Erreurs -->
            <div class="zone-card zone-errors" *ngIf="rp.errors">
              <div class="zone-header"><span>❌</span><span class="zone-title">ERREURS DÉTECTÉES</span>
                <span class="zone-count">{{splitItems(rp.errors).length}}</span></div>
              <div class="zone-body">
                <div *ngFor="let item of splitItems(rp.errors)" class="zone-item">
                  <span class="sev-badge" [style.background]="getSevColor(item)" *ngIf="getSevBadge(item)">{{getSevBadge(item)}}</span>
                  <span class="item-text">{{item}}</span>
                </div>
              </div>
            </div>

            <!-- Zone CI/CD -->
            <div class="zone-card zone-cicd" *ngIf="rp.cicdIssues">
              <div class="zone-header"><span>⚠️</span><span class="zone-title">PROBLÈMES CI/CD</span>
                <span class="zone-count">{{splitItems(rp.cicdIssues).length}}</span></div>
              <div class="zone-body">
                <div *ngFor="let item of splitItems(rp.cicdIssues)" class="zone-item">
                  <span class="item-dot orange">▸</span><span class="item-text">{{item}}</span>
                </div>
              </div>
            </div>

            <!-- Zone Sécurité IA -->
            <div class="zone-card zone-sec" *ngIf="rp.securityIssues">
              <div class="zone-header"><span>🔒</span><span class="zone-title">RISQUES SÉCURITÉ</span>
                <span class="zone-count">{{splitItems(rp.securityIssues).length}}</span></div>
              <div class="zone-body">
                <div *ngFor="let item of splitItems(rp.securityIssues)" class="zone-item">
                  <span class="item-dot red">▸</span><span class="item-text">{{item}}</span>
                </div>
              </div>
            </div>

            <!-- Zone Actions développeur -->
            <div class="zone-card zone-dev">
              <div class="zone-header"><span>👨‍💻</span><span class="zone-title">ACTIONS DÉVELOPPEUR</span>
                <span class="task-prog">{{checkedTasks}}/{{devTasks.length}}</span></div>
              <div class="zone-body">
                <div *ngFor="let t of devTasks; let i = index" class="task-item" [class.done]="t.done" (click)="toggleTask(i)">
                  <span class="task-chk">{{t.done ? '✅' : '⬜'}}</span>
                  <span class="task-pri" *ngIf="t.priority" [style.color]="getPriColor(t.priority)">[{{t.priority}}]</span>
                  <span class="task-txt">{{t.text}}</span>
                </div>
              </div>
            </div>

            <!-- Zone Agents IA -->
            <div class="zone-card zone-agents" *ngIf="rp.agentActions">
              <div class="zone-header"><span>🤖</span><span class="zone-title">ACTIONS DES AGENTS IA</span></div>
              <div class="zone-body">
                <div *ngFor="let item of splitItems(rp.agentActions)" class="zone-item">
                  <span class="item-dot purple">▸</span><span class="item-text agent-txt">{{item}}</span>
                </div>
              </div>
            </div>

            <!-- Zone Recommandations -->
            <div class="zone-card zone-rec" *ngIf="rp.recommendations">
              <div class="zone-header"><span>💡</span><span class="zone-title">RECOMMANDATIONS</span></div>
              <div class="zone-body">
                <div *ngFor="let item of splitItems(rp.recommendations); let i = index" class="zone-item">
                  <span class="rec-num">{{i+1}}</span><span class="item-text">{{item}}</span>
                </div>
              </div>
            </div>

          </div><!-- /zone-grid -->

          <!-- Historique -->
          <div class="history-box" *ngIf="allReports.length > 1">
            <div class="history-title">📋 Historique des rapports</div>
            <div class="history-list">
              <div *ngFor="let r of allReports" class="history-item"
                   [class.selected]="r.id === latestReport.id" (click)="selectReport(r)">
                <span [style.color]="getDecisionColor(parseReport(r.aiSummary).decision)">●</span>
                <span>Build #{{parseReport(r.aiSummary).build || '?'}}</span>
                <span class="h-date">{{r.createdAt | date:'dd/MM HH:mm'}}</span>
                <span class="h-dec">{{parseReport(r.aiSummary).decision || 'N/A'}}</span>
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
    .risk-pill.critical { background:rgba(248,81,73,.15); color:var(--accent-red) }
    .risk-pill.high { background:rgba(255,136,0,.15); color:var(--accent-orange) }
    .risk-pill.medium { background:rgba(245,158,11,.15); color:#f59e0b }
    .risk-pill.low { background:rgba(63,185,80,.15); color:var(--accent-green) }

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

    /* Rapport Hero */
    .rapport-hero { display:flex; justify-content:space-between; align-items:flex-start; padding:18px; border-radius:10px; margin-bottom:14px; background:var(--bg-secondary); border:1px solid var(--border) }
    .rapport-hero.block { border-color:var(--accent-red); background:rgba(248,81,73,.05) }
    .rapport-hero.autofix { border-color:var(--accent-green); background:rgba(63,185,80,.05) }
    .rapport-hero.notify { border-color:var(--accent-orange); background:rgba(210,153,34,.05) }
    .rapport-build-tag { font-size:10px; color:var(--text-muted); font-family:var(--font-mono); margin-bottom:4px }
    .rapport-title { font-size:16px; font-weight:700; letter-spacing:1px; margin-bottom:4px }
    .rapport-meta { font-size:11px; color:var(--text-muted) }
    .hero-right { display:flex; flex-direction:column; align-items:flex-end; gap:8px }
    .decision-badge { font-size:11px; font-weight:700; padding:5px 14px; border-radius:20px; border:1px solid; font-family:var(--font-mono) }
    .confidence-wrap { display:flex; flex-direction:column; align-items:flex-end; gap:3px }
    .conf-bar { width:100px; height:3px; background:var(--border); border-radius:2px; overflow:hidden }
    .conf-fill { height:100%; border-radius:2px }
    .conf-text { font-size:10px; color:var(--text-muted) }
    .sec-level { font-size:11px; font-weight:600 }

    /* Zones */
    .zone-grid { display:flex; flex-direction:column; gap:10px; margin-bottom:14px }
    .zone-card { background:var(--bg-secondary); border:1px solid var(--border); border-radius:8px; overflow:hidden }
    .zone-errors  { border-left:3px solid var(--accent-red) }
    .zone-cicd    { border-left:3px solid var(--accent-orange) }
    .zone-sec     { border-left:3px solid var(--accent-red) }
    .zone-dev     { border-left:3px solid var(--accent-orange) }
    .zone-agents  { border-left:3px solid var(--accent-blue) }
    .zone-rec     { border-left:3px solid var(--accent-green) }
    .zone-header  { display:flex; align-items:center; gap:8px; padding:10px 14px; background:var(--bg-hover); border-bottom:1px solid var(--border) }
    .zone-title   { font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.5px; color:var(--text-muted); flex:1 }
    .zone-count   { background:rgba(255,255,255,0.1); border-radius:10px; padding:1px 8px; font-size:10px }
    .zone-body    { padding:12px 14px; font-size:12px }
    .zone-item    { display:flex; align-items:flex-start; gap:8px; padding:5px 0; border-bottom:1px solid rgba(255,255,255,0.04) }
    .zone-item:last-child { border-bottom:none }
    .item-dot     { font-size:1rem; flex-shrink:0 }
    .item-dot.orange { color:var(--accent-orange) }
    .item-dot.red    { color:var(--accent-red) }
    .item-dot.purple { color:#7c6af7 }
    .item-text { flex:1; color:var(--text-secondary); line-height:1.5 }
    .agent-txt { color:#a0a0c0; font-style:italic }

    /* Severity badge */
    .sev-badge { font-size:0.68rem; font-weight:700; padding:2px 6px; border-radius:4px; color:#000; white-space:nowrap; flex-shrink:0 }

    /* Tasks */
    .task-prog { font-size:10px; color:var(--accent-green); font-family:var(--font-mono) }
    .task-item { display:flex; align-items:flex-start; gap:8px; padding:6px 0; cursor:pointer; border-bottom:1px solid var(--border); font-size:11px }
    .task-item:last-child { border:none }
    .task-item.done .task-txt { text-decoration:line-through; color:var(--text-faint) }
    .task-chk { flex-shrink:0 }
    .task-pri { font-weight:700; flex-shrink:0; font-size:10px }
    .task-txt { flex:1 }

    /* Recommendations */
    .rec-num { background:var(--accent-blue); color:#000; font-weight:700; font-size:0.72rem; width:20px; height:20px; border-radius:50%; display:flex; align-items:center; justify-content:center; flex-shrink:0 }

    /* History */
    .history-box { background:var(--bg-secondary); border:1px solid var(--border); border-radius:8px; padding:12px; margin-bottom:12px }
    .history-title { font-size:10px; font-weight:700; color:var(--text-muted); text-transform:uppercase; letter-spacing:.5px; margin-bottom:8px }
    .history-list { display:flex; flex-direction:column; gap:4px }
    .history-item { display:flex; align-items:center; gap:10px; padding:7px 10px; background:var(--bg-hover); border-radius:5px; cursor:pointer; font-size:11px }
    .history-item:hover { background:var(--bg-primary) }
    .history-item.selected { border:1px solid var(--accent-blue) }
    .h-date { margin-left:auto; color:var(--text-faint); font-family:var(--font-mono); font-size:10px }
    .h-dec { font-size:10px; font-weight:600; font-family:var(--font-mono) }
    .h-score { font-size:10px; font-family:var(--font-mono); color:var(--accent-blue) }
    .h-score.critical { color:var(--accent-red) }

    /* Actions */
    .action-row { display:flex; gap:8px; flex-wrap:wrap }
    .btn { display:inline-flex; align-items:center; gap:5px; padding:7px 14px; border-radius:6px; font-size:11px; cursor:pointer; text-decoration:none; border:1px solid var(--border) }
    .btn-action { background:var(--bg-hover); color:var(--text-secondary) }
    .btn-action:hover { border-color:var(--accent-blue); color:var(--accent-blue) }
    .btn-action.green { border-color:var(--accent-green); color:var(--accent-green); background:rgba(63,185,80,.08) }
    .btn-action.red   { border-color:var(--accent-red);   color:var(--accent-red);   background:rgba(248,81,73,.08) }
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
    .badge.info { background:rgba(88,166,255,.1); color:var(--accent-blue) }
    .badge.danger { background:rgba(248,81,73,.1); color:var(--accent-red) }

    /* Empty / loading */
    .empty-state { text-align:center; padding:60px 20px }
    .empty-icon { font-size:40px; margin-bottom:12px }
    .empty-title { font-size:15px; font-weight:600; color:var(--text-secondary); margin-bottom:6px }
    .empty-sub { font-size:12px; color:var(--text-muted) }
    .loading-state { text-align:center; padding:40px; color:var(--text-muted); font-size:13px }
  `]
})
export class ProjectDetailComponent implements OnInit {
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

  constructor(private api: ApiService, private toast: ToastService) {}

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
          .filter(x => x.type === 'combined')
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
    this.rp = this.parseReport(r.aiSummary);
    // Charger enrichedData
    this.ed = r.rawData?.enrichedData || {};
    // Score depuis le rapport
    this.lastScore = r.securityScore ?? 100;
    this.lastRisk  = r.riskLevel || 'low';
    // Tâches développeur
    this.devTasks = this.parseDevTasks(this.rp.developerActions);
    this.checkedTasks = 0;
    // Extraire analyse IA SonarQube depuis agentActions
    this.sonarAiAnalysis = this.extractSonarAnalysis(this.rp.agentActions);
  }

  extractSonarAnalysis(agentActions: string): string {
    if (!agentActions) return '';
    const parts = agentActions.split('|');
    const sonarPart = parts.find(p => p.toLowerCase().includes('sonar') || p.toLowerCase().includes('quality') || p.toLowerCase().includes('code smell'));
    return sonarPart ? sonarPart.trim() : '';
  }

  triggerBuild() {
    const url = `http://172.31.172.61:8082/job/${this.project.jenkinsJobName}/build`;
    const [user, token] = (this.project.jenkinsToken || ':').split(':');
    fetch(url, { method: 'POST', headers: { 'Authorization': 'Basic ' + btoa(`${user}:${token}`) } })
      .then(() => this.toast.success('Build lancé', `Build #${this.project.jenkinsJobName} démarré`))
      .catch(() => this.toast.error('Erreur', 'Impossible de déclencher le build'));
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
    if (!item) return '#888';
    const s = item.toUpperCase();
    if (s.includes('CRITICAL')) return '#ff4444';
    if (s.includes('HIGH'))     return '#ff8800';
    if (s.includes('MEDIUM'))   return '#ffcc00';
    if (s.includes('LOW'))      return '#44aaff';
    return '#888888';
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

  copyReport() {
    navigator.clipboard.writeText(this.latestReport?.aiSummary || '').then(() => {
      this.toast.success('Copié', 'Rapport copié dans le presse-papiers');
    });
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
    const colors = ['#0c1c2e','#0d2119','#271d0a','#1e1433','#2d1117'];
    if (!name) return colors[0];
    return colors[name.charCodeAt(0) % colors.length];
  }

  getDecisionColor(d: string): string {
    if (d === 'AUTO_FIX') return 'var(--accent-green)';
    if (d === 'BLOCK')    return 'var(--accent-red)';
    return 'var(--accent-orange)';
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
