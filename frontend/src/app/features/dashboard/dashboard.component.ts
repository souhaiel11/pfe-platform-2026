import { Component, OnInit, OnDestroy, AfterViewInit, ElementRef, ViewChildren, QueryList } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/services/api.service';

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
            <i class="ti ti-sun" *ngIf="isDark"></i>
            <i class="ti ti-moon" *ngIf="!isDark"></i>
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
            <div class="risk-list">
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
              <div class="hm-swatch" style="background:#21262d;border:1px solid #30363d"></div>
              <div class="hm-swatch" style="background:#0d2119"></div>
              <div class="hm-swatch" style="background:#26a641"></div>
              <div class="hm-swatch" style="background:#3fb950"></div>
              <div class="hm-swatch" style="background:#f85149"></div>
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
        <div class="proj-grid">
          <a class="proj-card" *ngFor="let p of projects" [routerLink]="['/projects', p.id]">
            <div class="proj-card-header">
              <div class="proj-av" [style.background]="p.avatarBg" [style.color]="p.avatarColor">{{p.initials}}</div>
              <div class="proj-info">
                <div class="proj-name">{{p.name}}</div>
                <div class="proj-tech">{{p.tech}}</div>
              </div>
              <span class="decision-badge" [class]="p.lastDecision.toLowerCase()">{{p.lastDecision}}</span>
            </div>
            <div class="proj-pills">
              <span class="pill red" *ngIf="p.incidents > 0">{{p.incidents}} incident{{p.incidents > 1 ? 's' : ''}}</span>
              <span class="pill green" *ngIf="p.incidents === 0">0 incidents</span>
              <span class="pill" [class]="p.buildStatus === 'SUCCESS' ? 'green' : 'red'">Build {{p.buildStatus}}</span>
            </div>
            <div class="proj-sparkline">
              <canvas [id]="'spark-' + p.id" height="30"></canvas>
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
      background: var(--bg, #0d1117);
      color: var(--text, #e6edf3);
      font-family: 'JetBrains Mono', 'Fira Code', monospace;
      position: relative;
    }

    /* TOPBAR */
    .topbar {
      display: flex; align-items: center; justify-content: space-between;
      padding: 12px 20px; background: var(--bg2, #161b22);
      border-bottom: 1px solid var(--border, #30363d);
      position: sticky; top: 0; z-index: 50;
    }
    .topbar-left { display: flex; align-items: center; gap: 10px; }
    .logo-mark { width: 28px; height: 28px; background: var(--blue, #58a6ff); border-radius: 6px; display: flex; align-items: center; justify-content: center; color: #fff; font-weight: 700; font-size: 13px; }
    .logo-title { font-size: 13px; font-weight: 600; }
    .logo-sub { font-size: 9px; color: var(--text2, #8b949e); }
    .topbar-right { display: flex; align-items: center; gap: 8px; }
    .live-badge { display: flex; align-items: center; gap: 5px; padding: 3px 9px; background: #0d2119; border: 1px solid #3fb950; border-radius: 12px; font-size: 10px; font-weight: 700; color: #3fb950; }
    .live-dot { width: 6px; height: 6px; background: #3fb950; border-radius: 50%; animation: pulse 1.5s infinite; }
    @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }
    .icon-btn { width: 30px; height: 30px; background: var(--bg3, #21262d); border: 1px solid var(--border, #30363d); border-radius: 6px; color: var(--text2, #8b949e); cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 14px; position: relative; }
    .icon-btn:hover { color: var(--text, #e6edf3); }
    .notif-count { position: absolute; top: -4px; right: -4px; background: #f85149; color: #fff; border-radius: 50%; width: 14px; height: 14px; font-size: 8px; display: flex; align-items: center; justify-content: center; font-weight: 700; }
    .user-av { width: 28px; height: 28px; background: var(--blue-bg, #0c1c2e); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 700; color: var(--blue, #58a6ff); }
    .close-btn { background: none; border: none; color: var(--text2, #8b949e); cursor: pointer; font-size: 13px; }

    /* NOTIF */
    .notif-panel { position: fixed; top: 50px; right: 20px; width: 290px; background: var(--bg2, #161b22); border: 1px solid var(--border, #30363d); border-radius: 10px; z-index: 100; display: none; }
    .notif-panel.open { display: block; }
    .notif-header { display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; border-bottom: 1px solid var(--border, #30363d); font-size: 12px; font-weight: 600; }
    .notif-item { display: flex; align-items: flex-start; gap: 8px; padding: 9px 14px; border-bottom: 1px solid var(--border, #30363d); }
    .notif-item:last-child { border: none; }
    .notif-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; margin-top: 3px; }
    .notif-item.error .notif-dot { background: #f85149; }
    .notif-item.warn .notif-dot { background: #d29922; }
    .notif-item.info .notif-dot { background: #58a6ff; }
    .notif-title { font-size: 11px; font-weight: 500; }
    .notif-meta { font-size: 9px; color: var(--text2, #8b949e); margin-top: 2px; }

    /* CONTENT */
    .content { padding: 18px 20px; }

    /* KPIs */
    .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 18px; }
    .kpi-card { background: var(--bg2, #161b22); border: 1px solid var(--border, #30363d); border-radius: 8px; padding: 12px 14px; display: flex; align-items: center; gap: 12px; }
    .kpi-icon { font-size: 20px; }
    .kpi-val { font-size: 22px; font-weight: 700; line-height: 1; }
    .kpi-label { font-size: 10px; color: var(--text2, #8b949e); margin-top: 2px; }
    .kpi-sub { font-size: 9px; color: var(--text2, #8b949e); margin-top: 1px; }
    .kpi-card.red .kpi-icon, .kpi-card.red .kpi-val { color: #f85149; }
    .kpi-card.green .kpi-icon, .kpi-card.green .kpi-val { color: #3fb950; }
    .kpi-card.blue .kpi-icon, .kpi-card.blue .kpi-val { color: #58a6ff; }
    .kpi-card.orange .kpi-icon, .kpi-card.orange .kpi-val { color: #d29922; }

    /* TWO COL */
    .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 18px; }

    /* CARD */
    .card { background: var(--bg2, #161b22); border: 1px solid var(--border, #30363d); border-radius: 8px; padding: 14px; }
    .card-title { display: flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 600; color: var(--text2, #8b949e); text-transform: uppercase; letter-spacing: .5px; margin-bottom: 12px; }
    .card-title i { font-size: 13px; }

    /* RISK */
    .risk-list { display: flex; flex-direction: column; gap: 14px; }
    .risk-item { display: flex; align-items: center; gap: 12px; }
    .risk-proj-info { display: flex; align-items: center; gap: 7px; min-width: 130px; }
    .risk-av { width: 28px; height: 28px; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 10px; flex-shrink: 0; }
    .risk-name { font-size: 11px; font-weight: 600; }
    .risk-tech { font-size: 9px; color: var(--text2, #8b949e); }
    .risk-ring-wrap { position: relative; width: 70px; height: 70px; flex-shrink: 0; }
    .risk-center-txt { position: absolute; top: 50%; left: 50%; transform: translate(-50%,-50%); font-size: 14px; font-weight: 700; }
    .risk-breakdown { flex: 1; display: flex; flex-direction: column; gap: 4px; }
    .rb-row { display: flex; align-items: center; gap: 6px; font-size: 9px; }
    .rb-lbl { width: 65px; color: var(--text2, #8b949e); }
    .rb-bar-bg { flex: 1; height: 3px; background: var(--bg3, #21262d); border-radius: 2px; overflow: hidden; }
    .rb-bar { height: 100%; border-radius: 2px; transition: width .4s; }
    .rb-val { width: 22px; text-align: right; font-weight: 600; font-size: 9px; }

    /* HEATMAP */
    .heatmap-wrap { margin-bottom: 8px; }
    .heatmap-legend { display: flex; align-items: center; gap: 4px; font-size: 9px; color: var(--text2, #8b949e); }
    .hm-swatch { width: 10px; height: 10px; border-radius: 2px; }
    .hm-row { display: flex; align-items: center; gap: 2px; margin-bottom: 2px; }
    .hm-lbl { width: 18px; font-size: 8px; color: var(--text2, #8b949e); text-align: right; }
    .hm-cell { width: 12px; height: 12px; border-radius: 2px; cursor: pointer; transition: opacity .1s; }
    .hm-cell:hover { opacity: .7; }

    /* SECTION TITLE */
    .section-title { display: flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 600; color: var(--text2, #8b949e); text-transform: uppercase; letter-spacing: .5px; margin-bottom: 10px; }
    .section-count { background: var(--bg3, #21262d); border-radius: 8px; padding: 1px 6px; font-size: 9px; }

    /* PROJ CARDS */
    .proj-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-bottom: 18px; }
    .proj-card { background: var(--bg2, #161b22); border: 1px solid var(--border, #30363d); border-radius: 10px; padding: 14px; cursor: pointer; transition: all .15s; text-decoration: none; color: inherit; display: block; }
    .proj-card:hover { border-color: #58a6ff; transform: translateY(-2px); box-shadow: 0 4px 16px rgba(88,166,255,.1); }
    .proj-card-header { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
    .proj-av { width: 32px; height: 32px; border-radius: 7px; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 11px; flex-shrink: 0; }
    .proj-info { flex: 1; }
    .proj-name { font-size: 12px; font-weight: 600; }
    .proj-tech { font-size: 9px; color: var(--text2, #8b949e); margin-top: 1px; }
    .decision-badge { padding: 2px 7px; border-radius: 4px; font-size: 9px; font-weight: 700; }
    .decision-badge.notify_only, .decision-badge.notify { background: #271d0a; color: #d29922; }
    .decision-badge.auto_fix, .decision-badge.autofix { background: #0d2119; color: #3fb950; }
    .decision-badge.block { background: #2d1117; color: #f85149; }
    .proj-pills { display: flex; gap: 5px; flex-wrap: wrap; margin-bottom: 8px; }
    .pill { padding: 2px 6px; border-radius: 8px; font-size: 9px; font-weight: 600; }
    .pill.red { background: #2d1117; color: #f85149; }
    .pill.green { background: #0d2119; color: #3fb950; }
    .pill.orange { background: #271d0a; color: #d29922; }
    .proj-sparkline { height: 30px; margin: 6px 0; }
    .health-bar-wrap { height: 3px; background: var(--bg3, #21262d); border-radius: 2px; overflow: hidden; }
    .health-bar { height: 100%; border-radius: 2px; transition: width .4s; }
    .health-label { display: flex; justify-content: space-between; margin-top: 3px; font-size: 9px; color: var(--text2, #8b949e); }
    .proj-footer { display: flex; justify-content: space-between; align-items: center; margin-top: 8px; font-size: 9px; color: var(--text2, #8b949e); }
    .risk-badge { font-weight: 600; }

    /* DORA */
    .dora-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
    .dora-card { background: var(--bg3, #21262d); border: 1px solid var(--border, #30363d); border-radius: 7px; padding: 10px; text-align: center; }
    .dora-icon { font-size: 18px; margin-bottom: 4px; }
    .dora-val { font-size: 16px; font-weight: 700; margin-bottom: 2px; }
    .dora-label { font-size: 9px; color: var(--text2, #8b949e); line-height: 1.3; margin-bottom: 4px; }
    .dora-badge { display: inline-block; padding: 2px 7px; border-radius: 8px; font-size: 8px; font-weight: 700; }

    /* ACTIVITY */
    .activity-list { display: flex; flex-direction: column; gap: 6px; }
    .activity-item { display: flex; align-items: flex-start; gap: 8px; padding: 7px 9px; background: var(--bg3, #21262d); border-radius: 5px; }
    .act-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; margin-top: 3px; }
    .act-title { font-size: 11px; font-weight: 500; }
    .act-meta { font-size: 9px; color: var(--text2, #8b949e); margin-top: 2px; }

    /* PREDICTION BANNER */
    .pred-banner { display: flex; align-items: center; justify-content: space-between; gap: 12px; background: #1e1433; border: 1px solid #bc8cff; border-radius: 8px; padding: 12px 16px; }
    .pred-left { display: flex; align-items: center; gap: 12px; }
    .pred-icon { font-size: 22px; color: #bc8cff; }
    .pred-title { font-size: 12px; font-weight: 600; color: #bc8cff; margin-bottom: 3px; }
    .pred-desc { font-size: 11px; color: var(--text2, #8b949e); }
    .pred-right { display: flex; align-items: center; gap: 8px; }
    .pred-btn { padding: 6px 12px; background: #bc8cff; border-radius: 6px; color: #fff; font-size: 11px; font-weight: 600; text-decoration: none; }

    /* CHAT FAB */
    .chat-fab { position: fixed; bottom: 20px; right: 20px; width: 44px; height: 44px; background: #58a6ff; border-radius: 50%; display: flex; align-items: center; justify-content: center; cursor: pointer; z-index: 100; box-shadow: 0 4px 14px rgba(88,166,255,.4); font-size: 20px; color: #fff; }
    .fab-badge { position: absolute; top: -3px; right: -3px; background: #f85149; color: #fff; border-radius: 50%; width: 16px; height: 16px; font-size: 9px; display: flex; align-items: center; justify-content: center; font-weight: 700; }

    /* CHAT POPUP */
    .chat-popup { position: fixed; bottom: 72px; right: 20px; width: 310px; background: var(--bg2, #161b22); border: 1px solid var(--border, #30363d); border-radius: 12px; z-index: 99; display: none; flex-direction: column; max-height: 400px; }
    .chat-popup.open { display: flex; }
    .cp-header { display: flex; align-items: center; gap: 7px; padding: 10px 12px; border-bottom: 1px solid var(--border, #30363d); font-size: 12px; font-weight: 600; }
    .cp-title { display: flex; align-items: center; gap: 5px; flex: 1; }
    .online-dot { font-size: 9px; color: #3fb950; margin-left: auto; }
    .cp-messages { flex: 1; overflow-y: auto; padding: 10px; display: flex; flex-direction: column; gap: 6px; }
    .cp-msg { font-size: 11px; padding: 7px 9px; border-radius: 8px; line-height: 1.4; max-width: 90%; }
    .cp-msg.ai { background: var(--bg3, #21262d); border: 1px solid var(--border, #30363d); align-self: flex-start; }
    .cp-msg.user { background: #58a6ff; color: #fff; align-self: flex-end; }
    .cp-suggestions { display: flex; gap: 4px; padding: 6px 9px; flex-wrap: wrap; border-top: 1px solid var(--border, #30363d); }
    .cp-sug { padding: 3px 7px; background: var(--bg3, #21262d); border: 1px solid var(--border, #30363d); border-radius: 10px; font-size: 9px; color: var(--text2, #8b949e); cursor: pointer; }
    .cp-sug:hover { color: var(--text, #e6edf3); }
    .cp-input-row { display: flex; gap: 6px; padding: 8px 10px; border-top: 1px solid var(--border, #30363d); }
    .cp-input { flex: 1; padding: 6px 9px; background: var(--bg3, #21262d); border: 1px solid var(--border, #30363d); border-radius: 6px; color: var(--text, #e6edf3); font-size: 11px; outline: none; font-family: inherit; }
    .cp-input:focus { border-color: #58a6ff; }
    .cp-send { padding: 6px 10px; background: #58a6ff; border: none; border-radius: 6px; color: #fff; font-size: 12px; cursor: pointer; }
  `]
})
export class DashboardComponent implements OnInit, AfterViewInit {

  isDark = true;
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
    { label: 'Incidents actifs', value: '3', sub: '+2 depuis hier', icon: 'ti-alert-circle', color: 'red' },
    { label: 'Builds réussis', value: '12', sub: "aujourd'hui", icon: 'ti-circle-check', color: 'green' },
    { label: 'Décisions IA', value: '7', sub: 'cette semaine', icon: 'ti-robot', color: 'blue' },
    { label: 'CVE HIGH', value: '2', sub: 'en attente', icon: 'ti-shield-exclamation', color: 'orange' },
  ];

  projects = [
    {
      id: '54192eca-43da-4d8f-9b49-30c143983fdd',
      name: 'pfe-app-test',
      tech: 'Spring Boot · Jenkins · K8s',
      initials: 'AT',
      avatarBg: '#0c1c2e',
      avatarColor: '#58a6ff',
      incidents: 2,
      buildStatus: 'SUCCESS',
      health: 78,
      riskScore: 62,
      lastDecision: 'NOTIFY_ONLY',
      lastUpdate: 'il y a 2h',
      sparkData: [78, 82, 75, 70, 85, 79, 78],
      riskBreakdown: [
        { label: 'Jenkins', value: 80 },
        { label: 'SonarQube', value: 74 },
        { label: 'Trivy', value: 45 },
        { label: 'OWASP', value: 60 },
      ]
    },
    {
      id: '1b16b8d5-8115-4a79-9558-00486a460cc8',
      name: 'pfe-devsecops-platform',
      tech: 'Angular · NestJS · PostgreSQL',
      initials: 'PF',
      avatarBg: '#1a1a2e',
      avatarColor: '#bc8cff',
      incidents: 0,
      buildStatus: 'SUCCESS',
      health: 94,
      riskScore: 91,
      lastDecision: 'AUTO_FIX',
      lastUpdate: 'il y a 5h',
      sparkData: [90, 92, 88, 94, 93, 95, 94],
      riskBreakdown: [
        { label: 'Jenkins', value: 96 },
        { label: 'SonarQube', value: 88 },
        { label: 'Trivy', value: 90 },
        { label: 'OWASP', value: 89 },
      ]
    }
  ];

  doraMetrics = [
    { icon: '🚀', value: '3.2/j', label: 'Deployment Frequency', level: 'ELITE', color: '#3fb950', badgeBg: '#0d2119' },
    { icon: '⏱️', value: '4h20', label: 'Lead Time for Changes', level: 'HIGH', color: '#3fb950', badgeBg: '#0d2119' },
    { icon: '📉', value: '18%', label: 'Change Failure Rate', level: 'MEDIUM', color: '#d29922', badgeBg: '#271d0a' },
    { icon: '🔧', value: '45min', label: 'MTTR', level: 'ELITE', color: '#3fb950', badgeBg: '#0d2119' },
  ];

  activities = [
    { color: '#3fb950', title: 'Build #132 — pfe-app-test — SUCCESS', meta: 'il y a 2h · kubectl rollout OK' },
    { color: '#d29922', title: 'Incident #45 — Tests cassés — NOTIFY_ONLY', meta: 'il y a 3h · Judge Agent Claude' },
    { color: '#f85149', title: 'CVE-2024-1234 HIGH — eclipse-temurin:17', meta: 'il y a 5h · Trivy scan' },
    { color: '#3fb950', title: 'Quality Gate SonarQube — PASSED', meta: 'il y a 5h · Coverage 74%' },
    { color: '#58a6ff', title: 'DB_HOST corrigé — kubectl set env', meta: 'il y a 6h · K8s pod Running' },
  ];

  chatMessages: { role: string; content: string }[] = [
    { role: 'ai', content: 'Bonjour Souhaiel ! 3 incidents actifs · Build #132 OK · Score risque 62/100. Comment puis-je t\'aider ?' }
  ];

  chatSuggestions = ['Score risque', 'Pods K8s', 'CVE Trivy', 'DORA', 'Incidents'];

  private chatReplies: Record<string, string> = {
    'score risque': 'pfe-app-test : 62/100 MEDIUM\npfe-platform : 91/100 LOW\nScore = Jenkins 40% + SonarQube 30% + Trivy 20% + OWASP 10%',
    'pods k8s': '4/4 pods Running :\n• frontend :30002 ✓\n• backend :30001 ✓\n• app-test :30003 ✓\n• postgres ClusterIP ✓',
    'cve trivy': '0 CRITICAL · 2 HIGH\n• CVE-2024-1234 eclipse-temurin (CVSS 7.5)\n• CVE-2024-5678 alpine:3.18 (CVSS 7.1)',
    'dora': 'Deployment: 3.2/j (ELITE)\nLead Time: 4h20 (HIGH)\nCFR: 18% (MEDIUM)\nMTTR: 45min (ELITE)',
    'incidents': '3 incidents actifs :\n• Tests cassés → NOTIFY_ONLY\n• OWASP ZAP → OPEN\n• CVE HIGH → en attente',
  };

  constructor(private api: ApiService) {}

  ngOnInit() {
    // Charger données réelles depuis le backend NestJS
    // this.api.get('/api/projects').subscribe(projects => this.projects = projects);
    // this.api.get('/api/decisions').subscribe(...);
  }

  ngAfterViewInit() {
    setTimeout(() => {
      this.buildHeatmap();
      this.buildSparklines();
      this.buildRiskRings();
    }, 100);
  }

  buildRiskRings() {
    this.projects.forEach(p => {
      const canvas = document.getElementById('risk-' + p.id) as HTMLCanvasElement;
      if (!canvas || !(window as any).Chart) return;
      const ex = (window as any).Chart.getChart(canvas);
      if (ex) ex.destroy();
      const color = this.getRiskColor(p.riskScore);
      const bg = this.isDark ? '#21262d' : '#f0f2f4';
      new (window as any).Chart(canvas, {
        type: 'doughnut',
        data: { datasets: [{ data: [p.riskScore, 100 - p.riskScore], backgroundColor: [color, bg], borderWidth: 0 }] },
        options: { responsive: false, cutout: '72%', plugins: { legend: { display: false } } }
      });
    });
  }

  buildSparklines() {
    this.projects.forEach(p => {
      const canvas = document.getElementById('spark-' + p.id) as HTMLCanvasElement;
      if (!canvas || !(window as any).Chart) return;
      const ex = (window as any).Chart.getChart(canvas);
      if (ex) ex.destroy();
      new (window as any).Chart(canvas, {
        type: 'line',
        data: {
          labels: p.sparkData.map((_, i) => i),
          datasets: [{ data: p.sparkData, borderColor: '#3fb950', borderWidth: 1.5, pointRadius: 0, fill: true, backgroundColor: 'rgba(63,185,80,.15)', tension: .4 }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { display: false }, y: { display: false } } }
      });
    });
  }

  buildHeatmap() {
    const days = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
    const weeks = 8;
    const colors = ['#21262d', '#0d2119', '#26a641', '#3fb950', '#f85149'];
    const wrap = document.getElementById('heatmap');
    if (!wrap) return;
    let html = '';
    days.forEach((day, di) => {
      html += `<div class="hm-row"><span class="hm-lbl">${day}</span>`;
      for (let w = 0; w < weeks; w++) {
        const r = Math.random();
        let ci = di >= 5 ? 0 : r < .12 ? 4 : r < .25 ? 1 : r < .55 ? 3 : 2;
        html += `<div class="hm-cell" style="background:${colors[ci]}" title="${colors[ci] === '#f85149' ? 'Échec' : 'Succès'}"></div>`;
      }
      html += '</div>';
    });
    wrap.innerHTML = html;
  }

  getRiskColor(score: number): string {
    if (score >= 80) return '#3fb950';
    if (score >= 60) return '#d29922';
    return '#f85149';
  }

  getBarColor(val: number): string {
    if (val >= 75) return '#3fb950';
    if (val >= 50) return '#d29922';
    return '#f85149';
  }

  toggleNotif() { this.notifOpen = !this.notifOpen; }
  toggleChat() { this.chatOpen = !this.chatOpen; this.unreadChat = 0; }
  toggleTheme() { this.isDark = !this.isDark; }

  sendSuggestion(s: string) {
    this.chatInput = s;
    this.sendChat();
  }

  sendChat() {
    const q = this.chatInput.trim();
    if (!q) return;
    this.chatMessages.push({ role: 'user', content: q });
    this.chatInput = '';
    const key = q.toLowerCase();
    const reply = this.chatReplies[key] || `Connecte le vrai endpoint n8n+Claude pour des réponses live sur "${q}".`;
    setTimeout(() => {
      this.chatMessages.push({ role: 'ai', content: reply });
    }, 500);
  }

  exportPDF() {
    alert('📄 Export PDF — À implémenter avec jsPDF ou WeasyPrint côté NestJS backend.\n\nContenus : Score risque · Décisions IA · SonarQube · Trivy · DORA · Incidents');
  }
}
