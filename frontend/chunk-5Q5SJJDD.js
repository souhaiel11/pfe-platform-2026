import {
  ToastService
} from "./chunk-RAVY26A2.js";
import {
  ApiService
} from "./chunk-KCUC5JBH.js";
import {
  environment
} from "./chunk-R3YGZVM2.js";
import {
  RouterLink,
  RouterModule
} from "./chunk-CX7S5RF6.js";
import "./chunk-Y42B5JPZ.js";
import {
  CommonModule,
  DatePipe,
  DecimalPipe,
  NgForOf,
  NgIf,
  Subject,
  __spreadProps,
  __spreadValues,
  ɵsetClassDebugInfo,
  ɵɵStandaloneFeature,
  ɵɵadvance,
  ɵɵclassMapInterpolate1,
  ɵɵclassProp,
  ɵɵdefineComponent,
  ɵɵdefineInjectable,
  ɵɵdirectiveInject,
  ɵɵelement,
  ɵɵelementContainerEnd,
  ɵɵelementContainerStart,
  ɵɵelementEnd,
  ɵɵelementStart,
  ɵɵnextContext,
  ɵɵpipe,
  ɵɵpipeBind2,
  ɵɵproperty,
  ɵɵpureFunction1,
  ɵɵstyleProp,
  ɵɵtemplate,
  ɵɵtext,
  ɵɵtextInterpolate,
  ɵɵtextInterpolate1,
  ɵɵtextInterpolate2,
  ɵɵtextInterpolate3
} from "./chunk-ZQZUXNDQ.js";

// src/app/core/services/websocket.service.ts
var WebSocketService = class _WebSocketService {
  constructor() {
    this.ws = null;
    this.incidentUpdatesSubject = new Subject();
    this.incidentUpdates$ = this.incidentUpdatesSubject.asObservable();
  }
  connect() {
    if (this.ws?.readyState === WebSocket.OPEN)
      return;
    try {
      this.ws = new WebSocket(environment.wsUrl);
      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.incidentUpdatesSubject.next(data);
        } catch {
        }
      };
      this.ws.onerror = () => {
      };
      this.ws.onclose = () => setTimeout(() => this.connect(), 5e3);
    } catch {
    }
  }
  disconnect() {
    this.ws?.close();
    this.ws = null;
  }
  ngOnDestroy() {
    this.disconnect();
  }
  static {
    this.\u0275fac = function WebSocketService_Factory(t) {
      return new (t || _WebSocketService)();
    };
  }
  static {
    this.\u0275prov = /* @__PURE__ */ \u0275\u0275defineInjectable({ token: _WebSocketService, factory: _WebSocketService.\u0275fac, providedIn: "root" });
  }
};

// src/app/features/dashboard/dashboard.component.ts
var _c0 = (a0) => ["/projects", a0];
function DashboardComponent_div_6_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementStart(0, "div", 6);
    \u0275\u0275element(1, "div", 7);
    \u0275\u0275elementStart(2, "span");
    \u0275\u0275text(3, "Chargement des donn\xE9es...");
    \u0275\u0275elementEnd()();
  }
}
function DashboardComponent_ng_container_7_div_52_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementStart(0, "div", 34)(1, "div", 35);
    \u0275\u0275text(2, "\u25E7");
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(3, "div", 36);
    \u0275\u0275text(4, "Aucun projet");
    \u0275\u0275elementEnd()();
  }
}
function DashboardComponent_ng_container_7_div_53_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementStart(0, "div", 37);
    \u0275\u0275element(1, "div", 38);
    \u0275\u0275elementStart(2, "div", 39)(3, "a", 40);
    \u0275\u0275text(4);
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(5, "div", 41);
    \u0275\u0275text(6);
    \u0275\u0275elementEnd()();
    \u0275\u0275elementStart(7, "div", 31)(8, "div", 42);
    \u0275\u0275text(9);
    \u0275\u0275pipe(10, "number");
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(11, "div", 43);
    \u0275\u0275text(12, "sant\xE9");
    \u0275\u0275elementEnd()()();
  }
  if (rf & 2) {
    const p_r1 = ctx.$implicit;
    const ctx_r1 = \u0275\u0275nextContext(2);
    \u0275\u0275advance();
    \u0275\u0275styleProp("background", ctx_r1.getHealthColor(p_r1.healthScore));
    \u0275\u0275advance(2);
    \u0275\u0275property("routerLink", \u0275\u0275pureFunction1(11, _c0, p_r1.id));
    \u0275\u0275advance();
    \u0275\u0275textInterpolate(p_r1.name);
    \u0275\u0275advance(2);
    \u0275\u0275textInterpolate1("", p_r1.openIncidents, " incidents ouverts");
    \u0275\u0275advance(2);
    \u0275\u0275styleProp("color", ctx_r1.getHealthColor(p_r1.healthScore));
    \u0275\u0275advance();
    \u0275\u0275textInterpolate1(" ", \u0275\u0275pipeBind2(10, 8, p_r1.healthScore, "1.0-0"), "% ");
  }
}
function DashboardComponent_ng_container_7_div_61_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementStart(0, "div", 34)(1, "div", 35);
    \u0275\u0275text(2, "\u{1F4E1}");
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(3, "div", 36);
    \u0275\u0275text(4, "En attente d'\xE9v\xE9nements");
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(5, "div", 44);
    \u0275\u0275text(6, "Les incidents s'afficheront ici");
    \u0275\u0275elementEnd()();
  }
}
function DashboardComponent_ng_container_7_div_62_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementStart(0, "div", 45)(1, "span");
    \u0275\u0275text(2);
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(3, "div", 39)(4, "div", 46);
    \u0275\u0275text(5);
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(6, "div", 47);
    \u0275\u0275text(7);
    \u0275\u0275pipe(8, "date");
    \u0275\u0275elementEnd()();
    \u0275\u0275elementStart(9, "span");
    \u0275\u0275text(10);
    \u0275\u0275elementEnd()();
  }
  if (rf & 2) {
    const e_r3 = ctx.$implicit;
    \u0275\u0275advance();
    \u0275\u0275classMapInterpolate1("badge ", e_r3.severity == null ? null : e_r3.severity.toLowerCase(), "");
    \u0275\u0275advance();
    \u0275\u0275textInterpolate(e_r3.severity);
    \u0275\u0275advance(3);
    \u0275\u0275textInterpolate(e_r3.title);
    \u0275\u0275advance(2);
    \u0275\u0275textInterpolate2("", e_r3.projectName, " \xB7 ", \u0275\u0275pipeBind2(8, 11, e_r3.timestamp, "HH:mm:ss"), "");
    \u0275\u0275advance(2);
    \u0275\u0275classMapInterpolate1("badge ", e_r3.status == null ? null : e_r3.status.toLowerCase(), "");
    \u0275\u0275advance();
    \u0275\u0275textInterpolate(e_r3.status);
  }
}
function DashboardComponent_ng_container_7_div_63_div_5_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementStart(0, "div", 51)(1, "div", 52)(2, "span", 53);
    \u0275\u0275text(3);
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(4, "span", 54);
    \u0275\u0275text(5);
    \u0275\u0275elementEnd()();
    \u0275\u0275elementStart(6, "div", 55);
    \u0275\u0275text(7);
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(8, "div", 56);
    \u0275\u0275element(9, "div", 57);
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(10, "div", 58);
    \u0275\u0275text(11);
    \u0275\u0275elementEnd()();
  }
  if (rf & 2) {
    const a_r4 = ctx.$implicit;
    \u0275\u0275advance(2);
    \u0275\u0275styleProp("color", a_r4.color)("background", a_r4.color + "11");
    \u0275\u0275advance();
    \u0275\u0275textInterpolate(a_r4.icon);
    \u0275\u0275advance(2);
    \u0275\u0275textInterpolate(a_r4.name);
    \u0275\u0275advance();
    \u0275\u0275styleProp("color", a_r4.color);
    \u0275\u0275advance();
    \u0275\u0275textInterpolate1("", a_r4.score, "%");
    \u0275\u0275advance(2);
    \u0275\u0275styleProp("width", a_r4.score + "%")("background", a_r4.color);
    \u0275\u0275advance(2);
    \u0275\u0275textInterpolate1("", a_r4.count, " analyses");
  }
}
function DashboardComponent_ng_container_7_div_63_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementStart(0, "div", 48)(1, "div", 19)(2, "span", 20);
    \u0275\u0275text(3, "Performance des agents IA");
    \u0275\u0275elementEnd()();
    \u0275\u0275elementStart(4, "div", 49);
    \u0275\u0275template(5, DashboardComponent_ng_container_7_div_63_div_5_Template, 12, 14, "div", 50);
    \u0275\u0275elementEnd()();
  }
  if (rf & 2) {
    const ctx_r1 = \u0275\u0275nextContext(2);
    \u0275\u0275advance(5);
    \u0275\u0275property("ngForOf", ctx_r1.agentStats);
  }
}
function DashboardComponent_ng_container_7_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementContainerStart(0);
    \u0275\u0275elementStart(1, "div", 8)(2, "div", 9)(3, "div", 10);
    \u0275\u0275text(4, "Projets actifs");
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(5, "div", 11);
    \u0275\u0275text(6);
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(7, "div", 12);
    \u0275\u0275text(8, "Sous surveillance IA");
    \u0275\u0275elementEnd()();
    \u0275\u0275elementStart(9, "div", 13)(10, "div", 10);
    \u0275\u0275text(11, "Incidents ouverts");
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(12, "div", 11);
    \u0275\u0275text(13);
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(14, "div", 12);
    \u0275\u0275text(15, "En cours de traitement");
    \u0275\u0275elementEnd()();
    \u0275\u0275elementStart(16, "div", 14)(17, "div", 10);
    \u0275\u0275text(18, "Incidents critiques");
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(19, "div", 11);
    \u0275\u0275text(20);
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(21, "div", 12);
    \u0275\u0275text(22, "Attention imm\xE9diate requise");
    \u0275\u0275elementEnd()();
    \u0275\u0275elementStart(23, "div", 15)(24, "div", 10);
    \u0275\u0275text(25, "Corrections IA");
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(26, "div", 11);
    \u0275\u0275text(27);
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(28, "div", 12);
    \u0275\u0275text(29, "Pull Requests cr\xE9\xE9es");
    \u0275\u0275elementEnd()();
    \u0275\u0275elementStart(30, "div", 16)(31, "div", 10);
    \u0275\u0275text(32, "Temps \xE9conomis\xE9");
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(33, "div", 11);
    \u0275\u0275text(34);
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(35, "div", 12);
    \u0275\u0275text(36, "Ce mois-ci");
    \u0275\u0275elementEnd()();
    \u0275\u0275elementStart(37, "div", 9)(38, "div", 10);
    \u0275\u0275text(39, "Score sant\xE9 moyen");
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(40, "div", 11);
    \u0275\u0275text(41);
    \u0275\u0275pipe(42, "number");
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(43, "div", 12);
    \u0275\u0275text(44, "Tous projets confondus");
    \u0275\u0275elementEnd()()();
    \u0275\u0275elementStart(45, "div", 17)(46, "div", 18)(47, "div", 19)(48, "span", 20);
    \u0275\u0275text(49, "Projets");
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(50, "a", 21);
    \u0275\u0275text(51, "Voir tous \u2192");
    \u0275\u0275elementEnd()();
    \u0275\u0275template(52, DashboardComponent_ng_container_7_div_52_Template, 5, 0, "div", 22)(53, DashboardComponent_ng_container_7_div_53_Template, 13, 13, "div", 23);
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(54, "div", 18)(55, "div", 19)(56, "span", 20);
    \u0275\u0275text(57, "Flux temps r\xE9el");
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(58, "div", 24);
    \u0275\u0275element(59, "div", 25);
    \u0275\u0275text(60, " Live ");
    \u0275\u0275elementEnd()();
    \u0275\u0275template(61, DashboardComponent_ng_container_7_div_61_Template, 7, 0, "div", 22)(62, DashboardComponent_ng_container_7_div_62_Template, 11, 14, "div", 26);
    \u0275\u0275elementEnd()();
    \u0275\u0275template(63, DashboardComponent_ng_container_7_div_63_Template, 6, 1, "div", 27);
    \u0275\u0275elementStart(64, "div", 28)(65, "div")(66, "div", 29);
    \u0275\u0275text(67, "Impact de la plateforme ce mois");
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(68, "div", 30);
    \u0275\u0275text(69);
    \u0275\u0275elementEnd()();
    \u0275\u0275elementStart(70, "div", 31)(71, "div", 32);
    \u0275\u0275text(72);
    \u0275\u0275pipe(73, "number");
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(74, "div", 33);
    \u0275\u0275text(75, "score qualit\xE9 global");
    \u0275\u0275elementEnd()()();
    \u0275\u0275elementContainerEnd();
  }
  if (rf & 2) {
    const ctx_r1 = \u0275\u0275nextContext();
    \u0275\u0275advance(6);
    \u0275\u0275textInterpolate(ctx_r1.stats.totalProjects);
    \u0275\u0275advance(3);
    \u0275\u0275classProp("pulse-critical", ctx_r1.stats.openIncidents > 10);
    \u0275\u0275advance(4);
    \u0275\u0275textInterpolate(ctx_r1.stats.openIncidents);
    \u0275\u0275advance(7);
    \u0275\u0275textInterpolate(ctx_r1.stats.criticalIncidents);
    \u0275\u0275advance(7);
    \u0275\u0275textInterpolate(ctx_r1.stats.totalCorrections);
    \u0275\u0275advance(7);
    \u0275\u0275textInterpolate1("", ctx_r1.stats.timeSavedHours, "h");
    \u0275\u0275advance(7);
    \u0275\u0275textInterpolate1("", \u0275\u0275pipeBind2(42, 17, ctx_r1.stats.avgHealthScore, "1.0-0"), "%");
    \u0275\u0275advance(11);
    \u0275\u0275property("ngIf", ctx_r1.projects.length === 0);
    \u0275\u0275advance();
    \u0275\u0275property("ngForOf", ctx_r1.projects.slice(0, 5));
    \u0275\u0275advance(8);
    \u0275\u0275property("ngIf", ctx_r1.liveEvents.length === 0);
    \u0275\u0275advance();
    \u0275\u0275property("ngForOf", ctx_r1.liveEvents.slice(0, 7));
    \u0275\u0275advance();
    \u0275\u0275property("ngIf", ctx_r1.agentStats);
    \u0275\u0275advance(6);
    \u0275\u0275textInterpolate3(" ", ctx_r1.stats.totalCorrections, " corrections automatiques \xB7 ", ctx_r1.stats.timeSavedHours, "h \xE9conomis\xE9es \xB7 ", ctx_r1.stats.criticalIncidents, " failles d\xE9tect\xE9es avant production ");
    \u0275\u0275advance(3);
    \u0275\u0275textInterpolate1("", \u0275\u0275pipeBind2(73, 20, ctx_r1.stats.avgHealthScore, "1.0-0"), "%");
  }
}
var DashboardComponent = class _DashboardComponent {
  constructor(api, ws, toast) {
    this.api = api;
    this.ws = ws;
    this.toast = toast;
    this.stats = null;
    this.projects = [];
    this.liveEvents = [];
    this.agentStats = [];
    this.subs = [];
  }
  ngOnInit() {
    this.loadData();
    this.ws.connect();
    this.subs.push(this.ws.incidentUpdates$.subscribe((event) => {
      this.liveEvents.unshift(__spreadProps(__spreadValues({}, event), { timestamp: /* @__PURE__ */ new Date() }));
      if (this.liveEvents.length > 20)
        this.liveEvents.pop();
      if (event.severity === "CRITICAL" || event.severity === "HIGH") {
        this.toast.error("Nouvel incident", event.title || "Incident d\xE9tect\xE9");
      }
      this.loadData();
    }));
  }
  loadData() {
    this.api.getGlobalStats().subscribe((s) => {
      this.stats = {
        totalProjects: s.totalProjects || 0,
        openIncidents: s.totalBugs || 0,
        criticalIncidents: s.criticalBugs || 0,
        totalCorrections: s.fixedBugs || 0,
        timeSavedHours: Math.round((s.fixedBugs || 0) * 0.5),
        avgHealthScore: s.avgSecurityScore || 0
      };
      if (s.projects) {
        this.projects = s.projects.map((p) => __spreadProps(__spreadValues({}, p), {
          healthScore: p.securityScore || 0,
          openIncidents: 0
        }));
      }
    });
    this.agentStats = [
      { name: "Root Cause", icon: "\u25C8", color: "#38bdf8", score: 92, count: 0 },
      { name: "Security Risk", icon: "\u2B21", color: "#e24b4a", score: 88, count: 0 },
      { name: "Remediation", icon: "\u25C6", color: "#22c55e", score: 85, count: 0 },
      { name: "Judge Agent", icon: "\u25A3", color: "#f59e0b", score: 96, count: 0 }
    ];
  }
  getHealthColor(score) {
    if (score >= 80)
      return "var(--accent-green)";
    if (score >= 60)
      return "var(--accent-orange)";
    return "var(--accent-red)";
  }
  ngOnDestroy() {
    this.subs.forEach((s) => s.unsubscribe());
  }
  static {
    this.\u0275fac = function DashboardComponent_Factory(t) {
      return new (t || _DashboardComponent)(\u0275\u0275directiveInject(ApiService), \u0275\u0275directiveInject(WebSocketService), \u0275\u0275directiveInject(ToastService));
    };
  }
  static {
    this.\u0275cmp = /* @__PURE__ */ \u0275\u0275defineComponent({ type: _DashboardComponent, selectors: [["app-dashboard"]], standalone: true, features: [\u0275\u0275StandaloneFeature], decls: 8, vars: 2, consts: [[1, "page-container"], [1, "page-header"], [1, "page-title"], [1, "page-subtitle"], ["class", "loading-overlay", 4, "ngIf"], [4, "ngIf"], [1, "loading-overlay"], [1, "spinner"], [1, "kpi-grid"], [1, "kpi-card", "blue"], [1, "kpi-label"], [1, "kpi-value"], [1, "kpi-sub"], [1, "kpi-card", "red"], [1, "kpi-card", "orange"], [1, "kpi-card", "green"], [1, "kpi-card", "purple"], [1, "grid-2", 2, "margin-bottom", "16px"], [1, "card"], [1, "card-header"], [1, "card-title"], ["routerLink", "/projects", 1, "btn", "btn-secondary", "btn-sm"], ["class", "empty-state", "style", "padding:24px;", 4, "ngIf"], ["class", "project-row", 4, "ngFor", "ngForOf"], [1, "live-indicator"], [1, "live-dot"], ["class", "event-row", 4, "ngFor", "ngForOf"], ["class", "card", "style", "margin-bottom:16px;", 4, "ngIf"], [1, "roi-banner"], [1, "roi-title"], [1, "roi-desc"], [2, "text-align", "right"], [1, "roi-score"], [2, "font-size", "11px", "color", "var(--text-muted)"], [1, "empty-state", 2, "padding", "24px"], [1, "empty-icon"], [1, "empty-title"], [1, "project-row"], [1, "health-dot"], [2, "flex", "1", "min-width", "0"], [1, "project-name", 3, "routerLink"], [1, "project-meta"], [1, "health-score"], [2, "font-size", "9px", "color", "var(--text-faint)"], [1, "empty-sub"], [1, "event-row"], [1, "event-title"], [1, "event-meta"], [1, "card", 2, "margin-bottom", "16px"], [2, "display", "grid", "grid-template-columns", "repeat(4,1fr)", "gap", "16px"], ["class", "agent-card", 4, "ngFor", "ngForOf"], [1, "agent-card"], [1, "agent-header"], [1, "agent-icon"], [1, "agent-name"], [1, "agent-score"], [1, "agent-bar"], [1, "agent-fill"], [1, "agent-meta"]], template: function DashboardComponent_Template(rf, ctx) {
      if (rf & 1) {
        \u0275\u0275elementStart(0, "div", 0)(1, "div", 1)(2, "h1", 2);
        \u0275\u0275text(3, "// vue_ensemble");
        \u0275\u0275elementEnd();
        \u0275\u0275elementStart(4, "p", 3);
        \u0275\u0275text(5, "\xC9tat global de la plateforme DevSecOps IA \u2014 Vermeg");
        \u0275\u0275elementEnd()();
        \u0275\u0275template(6, DashboardComponent_div_6_Template, 4, 0, "div", 4)(7, DashboardComponent_ng_container_7_Template, 76, 23, "ng-container", 5);
        \u0275\u0275elementEnd();
      }
      if (rf & 2) {
        \u0275\u0275advance(6);
        \u0275\u0275property("ngIf", !ctx.stats);
        \u0275\u0275advance();
        \u0275\u0275property("ngIf", ctx.stats);
      }
    }, dependencies: [CommonModule, NgForOf, NgIf, DecimalPipe, DatePipe, RouterModule, RouterLink], styles: ["\n\n.project-row[_ngcontent-%COMP%] {\n  display: flex;\n  align-items: center;\n  gap: 10px;\n  padding: 10px 0;\n  border-bottom: 1px solid var(--border);\n}\n.project-row[_ngcontent-%COMP%]:last-child {\n  border-bottom: none;\n}\n.health-dot[_ngcontent-%COMP%] {\n  width: 7px;\n  height: 7px;\n  border-radius: 50%;\n  flex-shrink: 0;\n}\n.project-name[_ngcontent-%COMP%] {\n  font-size: 12px;\n  font-weight: 500;\n  color: var(--text-secondary);\n  text-decoration: none;\n  display: block;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n.project-name[_ngcontent-%COMP%]:hover {\n  color: var(--accent-blue);\n}\n.project-meta[_ngcontent-%COMP%] {\n  font-size: 10px;\n  color: var(--text-faint);\n}\n.health-score[_ngcontent-%COMP%] {\n  font-size: 15px;\n  font-weight: 700;\n  font-family: var(--font-mono);\n}\n.event-row[_ngcontent-%COMP%] {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  padding: 8px 0;\n  border-bottom: 1px solid var(--border);\n}\n.event-row[_ngcontent-%COMP%]:last-child {\n  border-bottom: none;\n}\n.event-title[_ngcontent-%COMP%] {\n  font-size: 11px;\n  font-weight: 500;\n  color: var(--text-secondary);\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n.event-meta[_ngcontent-%COMP%] {\n  font-size: 10px;\n  color: var(--text-faint);\n  font-family: var(--font-mono);\n}\n.agent-card[_ngcontent-%COMP%] {\n  display: flex;\n  flex-direction: column;\n  gap: 8px;\n}\n.agent-header[_ngcontent-%COMP%] {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n}\n.agent-icon[_ngcontent-%COMP%] {\n  width: 28px;\n  height: 28px;\n  border-radius: var(--radius-sm);\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  font-size: 14px;\n  flex-shrink: 0;\n}\n.agent-name[_ngcontent-%COMP%] {\n  font-size: 11px;\n  color: var(--text-muted);\n  font-family: var(--font-mono);\n}\n.agent-score[_ngcontent-%COMP%] {\n  font-size: 22px;\n  font-weight: 700;\n  font-family: var(--font-mono);\n}\n.agent-bar[_ngcontent-%COMP%] {\n  height: 3px;\n  background: var(--border);\n  border-radius: 2px;\n  overflow: hidden;\n}\n.agent-fill[_ngcontent-%COMP%] {\n  height: 100%;\n  border-radius: 2px;\n  transition: width 0.8s ease;\n}\n.agent-meta[_ngcontent-%COMP%] {\n  font-size: 10px;\n  color: var(--text-faint);\n}\n.roi-banner[_ngcontent-%COMP%] {\n  background: var(--bg-secondary);\n  border: 1px solid var(--border);\n  border-left: 3px solid var(--accent-blue);\n  border-radius: var(--radius-lg);\n  padding: 20px 24px;\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n}\n.roi-title[_ngcontent-%COMP%] {\n  font-size: 14px;\n  font-weight: 600;\n  color: var(--text-primary);\n  margin-bottom: 4px;\n  font-family: var(--font-mono);\n}\n.roi-desc[_ngcontent-%COMP%] {\n  font-size: 12px;\n  color: var(--text-muted);\n}\n.roi-score[_ngcontent-%COMP%] {\n  font-size: 32px;\n  font-weight: 700;\n  color: var(--accent-blue);\n  font-family: var(--font-mono);\n}\n/*# sourceMappingURL=dashboard.component.css.map */"] });
  }
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && \u0275setClassDebugInfo(DashboardComponent, { className: "DashboardComponent", filePath: "src/app/features/dashboard/dashboard.component.ts", lineNumber: 276 });
})();
export {
  DashboardComponent
};
//# sourceMappingURL=chunk-5Q5SJJDD.js.map
