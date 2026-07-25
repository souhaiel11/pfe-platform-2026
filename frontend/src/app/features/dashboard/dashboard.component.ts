import { Component, OnInit, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/services/api.service';
import { ThemeService } from '../../core/services/theme.service';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  template: `
    <div class="dashboard">

      <!-- TOP BAR -->
      <div class="topbar">
        <div class="topbar-left">
          <div class="logo-mark">D</div>
          <div>
            <div class="logo-title">DevSecOps AI</div>
            <div class="logo-sub">Vermeg · PFE 2026</div>
          </div>
        </div>
        <div class="topbar-right">
          <div class="live-badge">
            <span class="live-dot"></span>
            LIVE
          </div>
          <button class="icon-btn notif-btn" (click)="toggleNotif()">
            <i class="ti ti-bell"></i>
            <span class="notif-count" *ngIf="notifications.length">{{notifications.length}}</span>
          </button>
          <button class="icon-btn" (click)="exportPDF()">
            <i class="ti ti-file-type-pdf"></i>
          </button>
          <button class="icon-btn" (click)="toggleTheme()">
            <i class="ti ti-sun"  *ngIf="themeService.theme() === 'dark'"></i>
            <i class="ti ti-moon" *ngIf="themeService.theme() === 'light'"></i>
          </button>
          <div class="user-av">SA</div>
        </div>
      </div>

      <!-- NOTIF PANEL -->
      <div class="notif-panel" [class.open]="notifOpen">
        <div class="notif-header">
          <span>Notifications</span>
          <button class="close-btn" (click)="toggleNotif()"><i class="ti ti-x"></i></button>
        </div>
        <div class="notif-list">
          <div class="notif-item" *ngFor="let n of notifications" [class]="n.level">
            <div class="notif-dot"></div>
            <div>
              <div class="notif-title">{{n.title}}</div>
              <div class="notif-meta">{{n.meta}}</div>
            </div>
          </div>
        </div>
      </div>

      <!-- CONTENT -->
      <div class="content">

        <!-- KPIs -->
        <div class="kpi-grid">
          <div class="kpi-card" [class]="k.color" *ngFor="let k of kpis">
            <div class="kpi-icon"><i [class]="'ti ' + k.icon"></i></div>
            <div class="kpi-body">
              <div class="kpi-val">{{k.value}}</div>
              <div class="kpi-label">{{k.label}}</div>
              <div class="kpi-sub">{{k.sub}}</div>
            </div>
          </div>
        </div>

        <!-- RISK + HEATMAP ROW -->
        <div class="two-col" style="margin-bottom:20px">

          <!-- RISK SCORES -->
          <div class="card">
            <div class="card-title">
              <i class="ti ti-shield-half"></i>
              Score de risque global
            </div>
            <div class="loading-overlay" *ngIf="projectsLoading"><div class="spinner"></div><span>Chargement...</span></div>
            <div class="empty-state" *ngIf="!projectsLoading && projects.length === 0">
              <div class="empty-icon">◧</div>
              <div class="empty-title">Aucun projet</div>
              <div class="empty-sub">Ajoutez un projet pour voir son score de risque</div>
            </div>
            <div class="risk-list" *ngIf="!projectsLoading && projects.length > 0">
              <div class="risk-item" *ngFor="let p of projects">
                <div class="risk-proj-info">
                  <div class="risk-av" [style.background]="p.avatarBg" [style.color]="p.avatarColor">{{p.initials}}</div>
                  <div>
                    <div class="risk-name">{{p.name}}</div>
                    <div class="risk-tech">{{p.tech}}</div>
                  </div>
                </div>
                <div class="risk-ring-wrap">
                  <canvas [id]="'risk-' + p.id" width="70" height="70"></canvas>
                  <div class="risk-center-txt" [style.color]="getRiskColor(p.riskScore)">
                    {{p.riskScore}}
                  </div>
                </div>
                <div class="risk-breakdown">
                  <div class="rb-row" *ngFor="let r of p.riskBreakdown">
                    <span class="rb-lbl">{{r.label}}</span>
                    <div class="rb-bar-bg">
                      <div class="rb-bar" [style.width]="r.value + '%'" [style.background]="getBarColor(r.value)"></div>
                    </div>
                    <span class="rb-val" [style.color]="getBarColor(r.value)">{{r.value}}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- HEATMAP -->
          <div class="card">
            <div class="card-title">
              <i class="ti ti-calendar-stats"></i>
              Heatmap builds — 8 semaines
            </div>
            <div class="heatmap-wrap" id="heatmap"></div>
            <div class="heatmap-legend">
              <span>Moins</span>
              <div class="hm-swatch" style="background:var(--bg-tertiary);border:1px solid var(--border-color)"></div>
              <div class="hm-swatch" style="background:var(--accent-green-bg)"></div>
              <div class="hm-swatch" style="background:var(--color-success)"></div>
              <div class="hm-swatch" style="background:var(--accent-green)"></div>
              <div class="hm-swatch" style="background:var(--accent-red)"></div>
              <span>Échec</span>
            </div>
          </div>
        </div>

        <!-- PROJECTS -->
        <div class="section-title">
          <i class="ti ti-folder"></i>
          Projets surveillés
          <span class="section-count">{{projects.length}}</span>
        </div>
        <div class="loading-overlay" *ngIf="projectsLoading"><div class="spinner"></div><span>Chargement...</span></div>
        <div class="empty-state" *ngIf="!projectsLoading && projects.length === 0">
          <div class="empty-icon">◧</div>
          <div class="empty-title">Aucun projet</div>
          <div class="empty-sub">Créez votre premier projet pour commencer</div>
        </div>
        <div class="proj-grid" *ngIf="!projectsLoading && projects.length > 0">
          <a class="proj-card" *ngFor="let p of projects" [routerLink]="['/projects', p.id]">
            <div class="proj-card-header">
              <div class="proj-av" [style.background]="p.avatarBg" [style.color]="p.avatarColor">{{p.initials}}</div>
              <div class="proj-info">
                <div class="proj-name">{{p.name}}</div>
                <div class="proj-tech">{{p.tech}}</div>
              </div>
            </div>
            <div class="proj-pills">
              <span class="pill red" *ngIf="p.incidents > 0">{{p.incidents}} incident{{p.incidents > 1 ? 's' : ''}}</span>
              <span class="pill green" *ngIf="p.incidents === 0">0 incidents</span>
              <span class="pill" [class]="p.buildStatus === 'SUCCESS' ? 'green' : 'red'">Build {{p.buildStatus}}</span>
            </div>
            <div class="health-bar-wrap">
              <div class="health-bar" [style.width]="p.health + '%'" [style.background]="getBarColor(p.health)"></div>
            </div>
            <div class="health-label">
              <span>Santé globale</span>
              <span [style.color]="getBarColor(p.health)" style="font-weight:600">{{p.health}}%</span>
            </div>
            <div class="proj-footer">
              <span>{{p.lastUpdate}}</span>
              <span class="risk-badge" [style.color]="getRiskColor(p.riskScore)">Risque : {{p.riskScore}}/100</span>
            </div>
          </a>
        </div>

        <!-- DORA + ACTIVITY ROW -->
        <div class="two-col">

          <!-- DORA -->
          <div class="card">
            <div class="card-title">
              <i class="ti ti-chart-bar"></i>
              Métriques DORA
            </div>
            <div class="dora-grid">
              <div class="dora-card" *ngFor="let d of doraMetrics">
                <div class="dora-icon">{{d.icon}}</div>
                <div class="dora-val" [style.color]="d.color">{{d.value}}</div>
                <div class="dora-label">{{d.label}}</div>
                <span class="dora-badge" [style.background]="d.badgeBg" [style.color]="d.color">{{d.level}}</span>
              </div>
            </div>
          </div>

          <!-- ACTIVITY -->
          <div class="card">
            <div class="card-title">
              <i class="ti ti-activity"></i>
              Activité récente
            </div>
            <div class="activity-list">
              <div class="activity-item" *ngFor="let a of activities">
                <div class="act-dot" [style.background]="a.color"></div>
                <div class="act-body">
                  <div class="act-title">{{a.title}}</div>
                  <div class="act-meta">{{a.meta}}</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- PREDICTION BANNER -->
        <div class="pred-banner" *ngIf="showPrediction">
          <div class="pred-left">
            <i class="ti ti-brain pred-icon"></i>
            <div>
              <div class="pred-title">⚠️ Prédiction IA — Risque détecté</div>
              <div class="pred-desc">Le Judge Agent prédit <strong>73% de probabilité d'incident</strong> dans les 48h sur <strong>pfe-app-test</strong> — 2 CVE HIGH non corrigées.</div>
            </div>
          </div>
          <div class="pred-right">
            <a routerLink="/prediction" class="pred-btn">Voir l'analyse</a>
            <button class="close-btn" (click)="showPrediction=false"><i class="ti ti-x"></i></button>
          </div>
        </div>

      </div>

      <!-- CHAT FAB -->
      <div class="chat-fab" (click)="toggleChat()">
        <i class="ti ti-message-chatbot"></i>
        <span class="fab-badge" *ngIf="unreadChat">{{unreadChat}}</span>
      </div>

      <!-- CHAT POPUP -->
      <div class="chat-popup" [class.open]="chatOpen">
        <div class="cp-header">
          <div class="cp-title"><i class="ti ti-robot"></i> DevSecOps AI</div>
          <span class="online-dot">● En ligne</span>
          <button class="close-btn" (click)="toggleChat()"><i class="ti ti-x"></i></button>
        </div>
        <div class="cp-messages" id="cp-msgs">
          <div class="cp-msg ai" *ngFor="let m of chatMessages; let i = index" [class]="m.role">
            {{m.content}}
          </div>
        </div>
        <div class="cp-suggestions">
          <button class="cp-sug" *ngFor="let s of chatSuggestions" (click)="sendSuggestion(s)">{{s}}</button>
        </div>
        <div class="cp-input-row">
          <input class="cp-input" [(ngModel)]="chatInput" placeholder="Question..."
            (keydown.enter)="sendChat()" [ngModelOptions]="{standalone: true}">
          <button class="cp-send" (click)="sendChat()"><i class="ti ti-send"></i></button>
        </div>
      </div>

    </div>
  `,
  styles: [`
    :host { display: block; }

    .dashboard {
      min-height: 100vh;
      background: var(--bg-primary);
      color: var(--text-primary);
      font-family: 'JetBrains Mono', 'Fira Code', monospace;
      position: relative;
    }

    /* TOPBAR */
    .topbar {
      display: flex; align-items: center; justify-content: space-between;
      padding: 12px 20px;
      background: var(--header-bg);
      border-bottom: 1px solid var(--border-color);
      position: sticky; top: 0; z-index: 50;
    }
    .topbar-left { display: flex; align-items: center; gap: 10px; }
    .logo-mark {
      width: 28px; height: 28px;
      background: var(--accent-primary);
      border-radius: 6px;
      display: flex; align-items: center; justify-content: center;
      color: var(--accent-text-on); font-weight: 700; font-size: 13px;
    }
    .logo-title { font-size: 13px; font-weight: 600; color: var(--text-primary); }
    .logo-sub   { font-size: 9px; color: var(--text-secondary); }
    .topbar-right { display: flex; align-items: center; gap: 8px; }
    .live-badge {
      display: flex; align-items: center; gap: 5px;
      padding: 3px 9px;
      background: var(--color-success-bg);
      border: 1px solid var(--color-success);
      border-radius: 12px;
      font-size: 10px; font-weight: 700;
      color: var(--color-success);
    }
    .live-dot {
      width: 6px; height: 6px;
      background: var(--color-success);
      border-radius: 50%;
      animation: pulse 1.5s infinite;
    }
    @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }
    .icon-btn {
      width: 30px; height: 30px;
      background: var(--bg-tertiary);
      border: 1px solid var(--border-color);
      border-radius: 6px;
      color: var(--text-secondary);
      cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      font-size: 14px; position: relative;
      transition: all .15s;
    }
    .icon-btn:hover { color: var(--text-primary); border-color: var(--accent-primary); }
    .notif-count {
      position: absolute; top: -4px; right: -4px;
      background: var(--accent-red); color: #fff;
      border-radius: 50%; width: 14px; height: 14px;
      font-size: 8px; display: flex; align-items: center; justify-content: center;
      font-weight: 700;
    }
    .user-av {
      width: 28px; height: 28px;
      background: var(--accent-blue-bg);
      border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      font-size: 10px; font-weight: 700;
      color: var(--accent-primary);
    }
    .close-btn { background: none; border: none; color: var(--text-secondary); cursor: pointer; font-size: 13px; }

    /* NOTIF */
    .notif-panel {
      position: fixed; top: 50px; right: 20px; width: 290px;
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 10px; z-index: 100; display: none;
      box-shadow: 0 4px 24px rgba(0,0,0,0.12);
    }
    .notif-panel.open { display: block; }
    .notif-header {
      display: flex; justify-content: space-between; align-items: center;
      padding: 10px 14px;
      border-bottom: 1px solid var(--border-color);
      font-size: 12px; font-weight: 600; color: var(--text-primary);
    }
    .notif-item {
      display: flex; align-items: flex-start; gap: 8px;
      padding: 9px 14px;
      border-bottom: 1px solid var(--border-color);
    }
    .notif-item:last-child { border: none; }
    .notif-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; margin-top: 3px; }
    .notif-item.error .notif-dot { background: var(--accent-red); }
    .notif-item.warn  .notif-dot { background: var(--accent-orange); }
    .notif-item.info  .notif-dot { background: var(--accent-primary); }
    .notif-title { font-size: 11px; font-weight: 500; color: var(--text-primary); }
    .notif-meta  { font-size: 9px; color: var(--text-secondary); margin-top: 2px; }

    /* CONTENT */
    .content { padding: 18px 20px; }

    /* KPIs */
    .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 18px; }
    .kpi-card {
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 8px; padding: 12px 14px;
      display: flex; align-items: center; gap: 12px;
    }
    .kpi-icon { font-size: 20px; }
    .kpi-val   { font-size: 22px; font-weight: 700; line-height: 1; color: var(--text-primary); }
    .kpi-label { font-size: 10px; color: var(--text-secondary); margin-top: 2px; }
    .kpi-sub   { font-size: 9px;  color: var(--text-secondary); margin-top: 1px; }
    .kpi-card.red    .kpi-icon, .kpi-card.red    .kpi-val { color: var(--accent-red); }
    .kpi-card.green  .kpi-icon, .kpi-card.green  .kpi-val { color: var(--accent-green); }
    .kpi-card.blue   .kpi-icon, .kpi-card.blue   .kpi-val { color: var(--accent-primary); }
    .kpi-card.orange .kpi-icon, .kpi-card.orange .kpi-val { color: var(--accent-orange); }

    /* TWO COL */
    .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 18px; }

    /* CARD */
    .card {
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 8px; padding: 14px;
    }
    .card-title {
      display: flex; align-items: center; gap: 6px;
      font-size: 11px; font-weight: 600;
      color: var(--text-secondary);
      text-transform: uppercase; letter-spacing: .5px; margin-bottom: 12px;
    }
    .card-title i { font-size: 13px; }

    /* RISK */
    .risk-list { display: flex; flex-direction: column; gap: 14px; }
    .risk-item { display: flex; align-items: center; gap: 12px; }
    .risk-proj-info { display: flex; align-items: center; gap: 7px; min-width: 130px; }
    .risk-av {
      width: 28px; height: 28px; border-radius: 6px;
      display: flex; align-items: center; justify-content: center;
      font-weight: 700; font-size: 10px; flex-shrink: 0;
    }
    .risk-name { font-size: 11px; font-weight: 600; color: var(--text-primary); }
    .risk-tech { font-size: 9px; color: var(--text-secondary); }
    .risk-ring-wrap { position: relative; width: 70px; height: 70px; flex-shrink: 0; }
    .risk-center-txt {
      position: absolute; top: 50%; left: 50%;
      transform: translate(-50%,-50%);
      font-size: 14px; font-weight: 700;
    }
    .risk-breakdown { flex: 1; display: flex; flex-direction: column; gap: 4px; }
    .rb-row { display: flex; align-items: center; gap: 6px; font-size: 9px; }
    .rb-lbl { width: 65px; color: var(--text-secondary); }
    .rb-bar-bg { flex: 1; height: 3px; background: var(--bg-tertiary); border-radius: 2px; overflow: hidden; }
    .rb-bar { height: 100%; border-radius: 2px; transition: width .4s; }
    .rb-val { width: 22px; text-align: right; font-weight: 600; font-size: 9px; }

    /* HEATMAP */
    .heatmap-wrap { margin-bottom: 8px; }
    .heatmap-legend { display: flex; align-items: center; gap: 4px; font-size: 9px; color: var(--text-secondary); }
    .hm-swatch { width: 10px; height: 10px; border-radius: 2px; }
    .hm-row { display: flex; align-items: center; gap: 2px; margin-bottom: 2px; }
    .hm-lbl { width: 18px; font-size: 8px; color: var(--text-secondary); text-align: right; }
    .hm-cell { width: 12px; height: 12px; border-radius: 2px; cursor: pointer; transition: opacity .1s; }
    .hm-cell:hover { opacity: .7; }

    /* SECTION TITLE */
    .section-title {
      display: flex; align-items: center; gap: 6px;
      font-size: 11px; font-weight: 600;
      color: var(--text-secondary);
      text-transform: uppercase; letter-spacing: .5px; margin-bottom: 10px;
    }
    .section-count {
      background: var(--bg-tertiary);
      border-radius: 8px; padding: 1px 6px; font-size: 9px;
      color: var(--text-secondary);
    }

    /* PROJ CARDS */
    .proj-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-bottom: 18px; }
    .proj-card {
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 10px; padding: 14px;
      cursor: pointer; transition: all .15s;
      text-decoration: none; color: inherit; display: block;
    }
    .proj-card:hover {
      border-color: var(--accent-primary);
      transform: translateY(-2px);
      box-shadow: 0 4px 16px rgba(31,78,138,.12);
    }
    .proj-card-header { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
    .proj-av {
      width: 32px; height: 32px; border-radius: 7px;
      display: flex; align-items: center; justify-content: center;
      font-weight: 700; font-size: 11px; flex-shrink: 0;
    }
    .proj-info { flex: 1; }
    .proj-name { font-size: 12px; font-weight: 600; color: var(--text-primary); }
    .proj-tech { font-size: 9px; color: var(--text-secondary); margin-top: 1px; }
    .decision-badge { padding: 2px 7px; border-radius: 4px; font-size: 9px; font-weight: 700; }
    .decision-badge.notify_only, .decision-badge.notify { background: var(--accent-orange-bg); color: var(--accent-orange); }
    .decision-badge.auto_fix,   .decision-badge.autofix { background: var(--accent-green-bg);  color: var(--accent-green); }
    .decision-badge.block                               { background: var(--accent-red-bg);    color: var(--accent-red); }
    .proj-pills { display: flex; gap: 5px; flex-wrap: wrap; margin-bottom: 8px; }
    .pill { padding: 2px 6px; border-radius: 8px; font-size: 9px; font-weight: 600; }
    .pill.red    { background: var(--accent-red-bg);    color: var(--accent-red); }
    .pill.green  { background: var(--accent-green-bg);  color: var(--accent-green); }
    .pill.orange { background: var(--accent-orange-bg); color: var(--accent-orange); }
    .proj-sparkline { height: 30px; margin: 6px 0; }
    .health-bar-wrap { height: 3px; background: var(--bg-tertiary); border-radius: 2px; overflow: hidden; }
    .health-bar { height: 100%; border-radius: 2px; transition: width .4s; }
    .health-label {
      display: flex; justify-content: space-between;
      margin-top: 3px; font-size: 9px; color: var(--text-secondary);
    }
    .proj-footer {
      display: flex; justify-content: space-between; align-items: center;
      margin-top: 8px; font-size: 9px; color: var(--text-secondary);
    }
    .risk-badge { font-weight: 600; }

    /* DORA */
    .dora-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
    .dora-card {
      background: var(--bg-tertiary);
      border: 1px solid var(--border-color);
      border-radius: 7px; padding: 10px; text-align: center;
    }
    .dora-icon  { font-size: 18px; margin-bottom: 4px; }
    .dora-val   { font-size: 16px; font-weight: 700; margin-bottom: 2px; }
    .dora-label { font-size: 9px; color: var(--text-secondary); line-height: 1.3; margin-bottom: 4px; }
    .dora-badge { display: inline-block; padding: 2px 7px; border-radius: 8px; font-size: 8px; font-weight: 700; }

    /* ACTIVITY */
    .activity-list { display: flex; flex-direction: column; gap: 6px; }
    .activity-item {
      display: flex; align-items: flex-start; gap: 8px;
      padding: 7px 9px;
      background: var(--bg-tertiary);
      border-radius: 5px;
    }
    .act-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; margin-top: 3px; }
    .act-title { font-size: 11px; font-weight: 500; color: var(--text-primary); }
    .act-meta  { font-size: 9px; color: var(--text-secondary); margin-top: 2px; }

    /* PREDICTION BANNER */
    .pred-banner {
      display: flex; align-items: center; justify-content: space-between; gap: 12px;
      background: var(--accent-purple-bg);
      border: 1px solid var(--accent-purple);
      border-radius: 8px; padding: 12px 16px;
    }
    .pred-left   { display: flex; align-items: center; gap: 12px; }
    .pred-icon   { font-size: 22px; color: var(--accent-purple); }
    .pred-title  { font-size: 12px; font-weight: 600; color: var(--accent-purple); margin-bottom: 3px; }
    .pred-desc   { font-size: 11px; color: var(--text-secondary); }
    .pred-right  { display: flex; align-items: center; gap: 8px; }
    .pred-btn {
      padding: 6px 12px;
      background: var(--accent-purple);
      border-radius: 6px; color: #fff;
      font-size: 11px; font-weight: 600; text-decoration: none;
    }

    /* CHAT FAB */
    .chat-fab {
      position: fixed; bottom: 20px; right: 20px;
      width: 44px; height: 44px;
      background: var(--accent-primary);
      border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      cursor: pointer; z-index: 100;
      box-shadow: 0 4px 14px rgba(31,78,138,.35);
      font-size: 20px; color: var(--accent-text-on);
    }
    .fab-badge {
      position: absolute; top: -3px; right: -3px;
      background: var(--accent-red); color: #fff;
      border-radius: 50%; width: 16px; height: 16px;
      font-size: 9px; display: flex; align-items: center; justify-content: center;
      font-weight: 700;
    }

    /* CHAT POPUP */
    .chat-popup {
      position: fixed; bottom: 72px; right: 20px;
      width: 310px;
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 12px; z-index: 99;
      display: none; flex-direction: column; max-height: 400px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.12);
    }
    .chat-popup.open { display: flex; }
    .cp-header {
      display: flex; align-items: center; gap: 7px;
      padding: 10px 12px;
      border-bottom: 1px solid var(--border-color);
      font-size: 12px; font-weight: 600; color: var(--text-primary);
    }
    .cp-title    { display: flex; align-items: center; gap: 5px; flex: 1; }
    .online-dot  { font-size: 9px; color: var(--color-success); margin-left: auto; }
    .cp-messages { flex: 1; overflow-y: auto; padding: 10px; display: flex; flex-direction: column; gap: 6px; }
    .cp-msg {
      font-size: 11px; padding: 7px 9px;
      border-radius: 8px; line-height: 1.4; max-width: 90%;
    }
    .cp-msg.ai {
      background: var(--bg-tertiary);
      border: 1px solid var(--border-color);
      color: var(--text-primary);
      align-self: flex-start;
    }
    .cp-msg.user {
      background: var(--accent-primary);
      color: var(--accent-text-on);
      align-self: flex-end;
    }
    .cp-suggestions {
      display: flex; gap: 4px; padding: 6px 9px; flex-wrap: wrap;
      border-top: 1px solid var(--border-color);
    }
    .cp-sug {
      padding: 3px 7px;
      background: var(--bg-tertiary);
      border: 1px solid var(--border-color);
      border-radius: 10px; font-size: 9px;
      color: var(--text-secondary); cursor: pointer;
      transition: all .15s;
    }
    .cp-sug:hover { color: var(--text-primary); border-color: var(--accent-primary); }
    .cp-input-row {
      display: flex; gap: 6px; padding: 8px 10px;
      border-top: 1px solid var(--border-color);
    }
    .cp-input {
      flex: 1; padding: 6px 9px;
      background: var(--bg-tertiary);
      border: 1px solid var(--border-color);
      border-radius: 6px;
      color: var(--text-primary);
      font-size: 11px; outline: none; font-family: inherit;
      transition: border-color .15s;
    }
    .cp-input:focus { border-color: var(--accent-primary); }
    .cp-input::placeholder { color: var(--text-tertiary); }
    .cp-send {
      padding: 6px 10px;
      background: var(--accent-primary);
      border: none; border-radius: 6px;
      color: var(--accent-text-on);
      font-size: 12px; cursor: pointer;
    }
  `]
})
export class DashboardComponent implements OnInit, AfterViewInit {

  notifOpen = false;
  chatOpen = false;
  chatInput = '';
  unreadChat = 1;
  showPrediction = true;

  notifications = [
    { level: 'error', title: 'CRITICAL — Pod app-test CrashLoopBackOff', meta: 'il y a 6h · Corrigé → DB_HOST=postgres' },
    { level: 'warn',  title: 'WARN — 2 CVE HIGH Trivy · eclipse-temurin', meta: 'il y a 5h · Patch recommandé' },
    { level: 'info',  title: 'INFO — Build #132 SUCCESS · Deploy K8s OK', meta: 'il y a 2h · main-132 déployé' },
  ];

  kpis = [
    { label: 'Incidents actifs', value: '3', sub: '+2 depuis hier',  icon: 'ti-alert-circle',       color: 'red' },
    { label: 'Builds réussis',   value: '12', sub: "aujourd'hui",    icon: 'ti-circle-check',        color: 'green' },
    { label: 'Décisions IA',     value: '7',  sub: 'cette semaine',  icon: 'ti-robot',               color: 'blue' },
    { label: 'CVE HIGH',         value: '2',  sub: 'en attente',     icon: 'ti-shield-exclamation',  color: 'orange' },
  ];

  projects: any[] = [];
  projectsLoading = true;

  private readonly avatarPalette = [
    { bg: 'var(--accent-blue-bg)',   color: 'var(--accent-primary)' },
    { bg: 'var(--accent-purple-bg)', color: 'var(--accent-purple)' },
    { bg: 'var(--accent-green-bg)',  color: 'var(--accent-green)' },
    { bg: 'var(--accent-orange-bg)', color: 'var(--accent-orange)' },
  ];

  doraMetrics = [
    { icon: '🚀', value: '3.2/j',  label: 'Deployment Frequency', level: 'ELITE',  color: 'var(--accent-green)',  badgeBg: 'var(--accent-green-bg)' },
    { icon: '⏱️', value: '4h20',   label: 'Lead Time for Changes', level: 'HIGH',   color: 'var(--accent-green)',  badgeBg: 'var(--accent-green-bg)' },
    { icon: '📉', value: '18%',    label: 'Change Failure Rate',   level: 'MEDIUM', color: 'var(--accent-orange)', badgeBg: 'var(--accent-orange-bg)' },
    { icon: '🔧', value: '45min',  label: 'MTTR',                  level: 'ELITE',  color: 'var(--accent-green)',  badgeBg: 'var(--accent-green-bg)' },
  ];

  activities = [
    { color: 'var(--accent-green)',  title: 'Build #132 — pfe-app-test — SUCCESS',        meta: 'il y a 2h · kubectl rollout OK' },
    { color: 'var(--accent-orange)', title: 'Incident #45 — Tests cassés — NOTIFY_ONLY',  meta: 'il y a 3h · Judge Agent Claude' },
    { color: 'var(--accent-red)',    title: 'CVE-2024-1234 HIGH — eclipse-temurin:17',    meta: 'il y a 5h · Trivy scan' },
    { color: 'var(--accent-green)',  title: 'Quality Gate SonarQube — PASSED',            meta: 'il y a 5h · Coverage 74%' },
    { color: 'var(--accent-primary)',title: 'DB_HOST corrigé — kubectl set env',          meta: 'il y a 6h · K8s pod Running' },
  ];

  chatMessages: { role: string; content: string }[] = [
    { role: 'ai', content: "Bonjour Souhaiel ! 3 incidents actifs · Build #132 OK · Score risque 62/100. Comment puis-je t'aider ?" }
  ];

  chatSuggestions = ['Score risque', 'Pods K8s', 'CVE Trivy', 'DORA', 'Incidents'];

  private chatReplies: Record<string, string> = {
    'score risque': 'pfe-app-test : 62/100 MEDIUM\npfe-platform : 91/100 LOW\nScore = Jenkins 40% + SonarQube 30% + Trivy 20% + OWASP 10%',
    'pods k8s':     '4/4 pods Running :\n• frontend :30002 ✓\n• backend :30001 ✓\n• app-test :30003 ✓\n• postgres ClusterIP ✓',
    'cve trivy':    '0 CRITICAL · 2 HIGH\n• CVE-2024-1234 eclipse-temurin (CVSS 7.5)\n• CVE-2024-5678 alpine:3.18 (CVSS 7.1)',
    'dora':         'Deployment: 3.2/j (ELITE)\nLead Time: 4h20 (HIGH)\nCFR: 18% (MEDIUM)\nMTTR: 45min (ELITE)',
    'incidents':    '3 incidents actifs :\n• Tests cassés → NOTIFY_ONLY\n• OWASP ZAP → OPEN\n• CVE HIGH → en attente',
  };

  constructor(private api: ApiService, public themeService: ThemeService) {}

  ngOnInit() { this.loadProjects(); }

  ngAfterViewInit() {
    setTimeout(() => this.buildHeatmap(), 100);
  }

  loadProjects() {
    this.projectsLoading = true;
    this.api.getProjects().subscribe({
      next: (data: any[]) => {
        this.projects = (data || []).map((p, i) => this.mapProject(p, i));
        this.projectsLoading = false;
        setTimeout(() => this.buildRiskRings(), 50);
      },
      error: () => { this.projects = []; this.projectsLoading = false; },
    });
  }

  private mapProject(p: any, index: number) {
    const initials = (p.name || '?').substring(0, 2).toUpperCase();
    const avatar = this.avatarPalette[index % this.avatarPalette.length];
    const score = Math.round(p.securityScore ?? 0);
    return {
      id: p.id,
      name: p.name,
      tech: `${p.cicdTool || 'jenkins'} · ${p.environment || 'dev'}`,
      initials,
      avatarBg: avatar.bg,
      avatarColor: avatar.color,
      incidents: (p.openIncidents || 0) + (p.analyzingIncidents || 0),
      buildStatus: p.status === 'healthy' ? 'SUCCESS' : 'FAILURE',
      health: score,
      riskScore: score,
      lastUpdate: p.updatedAt ? this.timeAgo(new Date(p.updatedAt).getTime()) : '—',
      riskBreakdown: [{ label: 'Score sécurité', value: score }],
    };
  }

  private timeAgo(ts: number): string {
    const diff = Date.now() - ts;
    const h = Math.floor(diff / 3600000);
    const m = Math.floor(diff / 60000);
    if (h > 24) return 'il y a ' + Math.floor(h / 24) + 'j';
    if (h > 0) return 'il y a ' + h + 'h';
    return 'il y a ' + m + 'min';
  }

  /* Resolve a CSS custom property to a concrete colour string (for Chart.js) */
  private cssVar(name: string): string {
    return getComputedStyle(document.body).getPropertyValue(name).trim();
  }

  buildRiskRings() {
    this.projects.forEach(p => {
      const canvas = document.getElementById('risk-' + p.id) as HTMLCanvasElement;
      if (!canvas || !(window as any).Chart) return;
      const ex = (window as any).Chart.getChart(canvas);
      if (ex) ex.destroy();
      const color = this.cssVar(this.getRiskCssVar(p.riskScore));
      const bg    = this.cssVar('--bg-tertiary') || '#F1F4F9';
      new (window as any).Chart(canvas, {
        type: 'doughnut',
        data: { datasets: [{ data: [p.riskScore, 100 - p.riskScore], backgroundColor: [color, bg], borderWidth: 0 }] },
        options: { responsive: false, cutout: '72%', plugins: { legend: { display: false } } }
      });
    });
  }

  buildHeatmap() {
    const days  = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
    const weeks = 8;
    const colors = [
      'var(--bg-tertiary)',
      'var(--accent-green-bg)',
      'var(--color-success)',
      'var(--accent-green)',
      'var(--accent-red)',
    ];
    const wrap = document.getElementById('heatmap');
    if (!wrap) return;
    let html = '';
    days.forEach((day, di) => {
      html += `<div class="hm-row"><span class="hm-lbl">${day}</span>`;
      for (let w = 0; w < weeks; w++) {
        const r  = Math.random();
        const ci = di >= 5 ? 0 : r < .12 ? 4 : r < .25 ? 1 : r < .55 ? 3 : 2;
        const label = ci === 4 ? 'Échec' : 'Succès';
        html += `<div class="hm-cell" style="background:${colors[ci]}" title="${label}"></div>`;
      }
      html += '</div>';
    });
    wrap.innerHTML = html;
  }

  /* Returns a CSS var string — usable in [style.color] template bindings */
  getRiskColor(score: number): string {
    if (score >= 80) return 'var(--accent-green)';
    if (score >= 60) return 'var(--accent-orange)';
    return 'var(--accent-red)';
  }

  getBarColor(val: number): string {
    if (val >= 75) return 'var(--accent-green)';
    if (val >= 50) return 'var(--accent-orange)';
    return 'var(--accent-red)';
  }

  /* Returns the CSS variable name only (for cssVar() resolution in charts) */
  private getRiskCssVar(score: number): string {
    if (score >= 80) return '--accent-green';
    if (score >= 60) return '--accent-orange';
    return '--accent-red';
  }

  toggleNotif() { this.notifOpen = !this.notifOpen; }
  toggleChat()  { this.chatOpen  = !this.chatOpen; this.unreadChat = 0; }

  toggleTheme() {
    this.themeService.toggleTheme();
    /* Rebuild chart colours after the theme class is applied */
    setTimeout(() => this.buildRiskRings(), 50);
  }

  sendSuggestion(s: string) { this.chatInput = s; this.sendChat(); }

  sendChat() {
    const q = this.chatInput.trim();
    if (!q) return;
    this.chatMessages.push({ role: 'user', content: q });
    this.chatInput = '';
    const key   = q.toLowerCase();
    const reply = this.chatReplies[key] || `Connecte le vrai endpoint n8n+Claude pour des réponses live sur "${q}".`;
    setTimeout(() => { this.chatMessages.push({ role: 'ai', content: reply }); }, 500);
  }

  exportPDF() {
    alert('📄 Export PDF — À implémenter avec jsPDF ou WeasyPrint côté NestJS backend.\n\nContenus : Score risque · Décisions IA · SonarQube · Trivy · DORA · Incidents');
  }
}
