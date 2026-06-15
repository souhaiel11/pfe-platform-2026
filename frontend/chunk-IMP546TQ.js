import {
  ToastService
} from "./chunk-RAVY26A2.js";
import {
  ApiService
} from "./chunk-SVQEMZLJ.js";
import "./chunk-NJ4DWT4A.js";
import {
  RouterLink,
  RouterModule
} from "./chunk-CX7S5RF6.js";
import "./chunk-Y42B5JPZ.js";
import {
  CommonModule,
  DatePipe,
  DecimalPipe,
  JsonPipe,
  NgForOf,
  NgIf,
  ɵsetClassDebugInfo,
  ɵɵStandaloneFeature,
  ɵɵadvance,
  ɵɵclassMap,
  ɵɵclassMapInterpolate1,
  ɵɵdefineComponent,
  ɵɵdirectiveInject,
  ɵɵelement,
  ɵɵelementContainerEnd,
  ɵɵelementContainerStart,
  ɵɵelementEnd,
  ɵɵelementStart,
  ɵɵgetCurrentView,
  ɵɵlistener,
  ɵɵnextContext,
  ɵɵpipe,
  ɵɵpipeBind1,
  ɵɵpipeBind2,
  ɵɵproperty,
  ɵɵresetView,
  ɵɵrestoreView,
  ɵɵstyleMapInterpolate1,
  ɵɵstyleProp,
  ɵɵtemplate,
  ɵɵtext,
  ɵɵtextInterpolate,
  ɵɵtextInterpolate1,
  ɵɵtextInterpolate2
} from "./chunk-ZQZUXNDQ.js";

// src/app/features/incidents/incident-detail.component.ts
function IncidentDetailComponent_div_6_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementStart(0, "div", 6);
    \u0275\u0275element(1, "div", 7);
    \u0275\u0275elementStart(2, "span");
    \u0275\u0275text(3, "Chargement...");
    \u0275\u0275elementEnd()();
  }
}
function IncidentDetailComponent_ng_container_7_button_17_Template(rf, ctx) {
  if (rf & 1) {
    const _r2 = \u0275\u0275getCurrentView();
    \u0275\u0275elementStart(0, "button", 23);
    \u0275\u0275listener("click", function IncidentDetailComponent_ng_container_7_button_17_Template_button_click_0_listener() {
      \u0275\u0275restoreView(_r2);
      const ctx_r2 = \u0275\u0275nextContext(2);
      return \u0275\u0275resetView(ctx_r2.applyCorrection());
    });
    \u0275\u0275text(1, " \u2713 Appliquer correction ");
    \u0275\u0275elementEnd();
  }
}
function IncidentDetailComponent_ng_container_7_button_18_Template(rf, ctx) {
  if (rf & 1) {
    const _r4 = \u0275\u0275getCurrentView();
    \u0275\u0275elementStart(0, "button", 21);
    \u0275\u0275listener("click", function IncidentDetailComponent_ng_container_7_button_18_Template_button_click_0_listener() {
      \u0275\u0275restoreView(_r4);
      const ctx_r2 = \u0275\u0275nextContext(2);
      return \u0275\u0275resetView(ctx_r2.resolveIncident());
    });
    \u0275\u0275text(1, " R\xE9soudre ");
    \u0275\u0275elementEnd();
  }
}
function IncidentDetailComponent_ng_container_7_div_19_div_4_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementStart(0, "div", 27)(1, "div", 28)(2, "div", 29)(3, "span", 30);
    \u0275\u0275text(4);
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(5, "span", 20);
    \u0275\u0275text(6);
    \u0275\u0275elementEnd()();
    \u0275\u0275elementStart(7, "div", 31)(8, "div", 32);
    \u0275\u0275element(9, "div");
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(10, "span", 33);
    \u0275\u0275text(11);
    \u0275\u0275pipe(12, "number");
    \u0275\u0275elementEnd()()();
    \u0275\u0275elementStart(13, "div", 34);
    \u0275\u0275text(14);
    \u0275\u0275elementEnd()();
  }
  if (rf & 2) {
    const r_r5 = ctx.$implicit;
    const ctx_r2 = \u0275\u0275nextContext(3);
    \u0275\u0275advance(3);
    \u0275\u0275styleProp("color", ctx_r2.getAgentColor(r_r5.agentType))("background", ctx_r2.getAgentColor(r_r5.agentType) + "11");
    \u0275\u0275advance();
    \u0275\u0275textInterpolate1(" ", ctx_r2.getAgentIcon(r_r5.agentType), " ");
    \u0275\u0275advance(2);
    \u0275\u0275textInterpolate(ctx_r2.getAgentLabel(r_r5.agentType));
    \u0275\u0275advance(3);
    \u0275\u0275styleProp("width", (r_r5.confidence || 0) * 100 + "%")("background", ctx_r2.getAgentColor(r_r5.agentType));
    \u0275\u0275advance(2);
    \u0275\u0275textInterpolate1(" ", \u0275\u0275pipeBind2(12, 12, (r_r5.confidence || 0) * 100, "1.0-0"), "% ");
    \u0275\u0275advance(3);
    \u0275\u0275textInterpolate(r_r5.analysis || r_r5.content);
  }
}
function IncidentDetailComponent_ng_container_7_div_19_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementStart(0, "div")(1, "h3", 24);
    \u0275\u0275text(2, " Rapports des agents IA ");
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(3, "div", 25);
    \u0275\u0275template(4, IncidentDetailComponent_ng_container_7_div_19_div_4_Template, 15, 15, "div", 26);
    \u0275\u0275elementEnd()();
  }
  if (rf & 2) {
    const ctx_r2 = \u0275\u0275nextContext(2);
    \u0275\u0275advance(4);
    \u0275\u0275property("ngForOf", ctx_r2.reports);
  }
}
function IncidentDetailComponent_ng_container_7_div_20_div_8_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementStart(0, "div", 38)(1, "div", 39);
    \u0275\u0275text(2, " CORRECTION PROPOS\xC9E ");
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(3, "pre", 40);
    \u0275\u0275text(4);
    \u0275\u0275elementEnd()();
  }
  if (rf & 2) {
    const ctx_r2 = \u0275\u0275nextContext(3);
    \u0275\u0275advance(4);
    \u0275\u0275textInterpolate(ctx_r2.decision.proposedFix);
  }
}
function IncidentDetailComponent_ng_container_7_div_20_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementStart(0, "div", 35)(1, "div", 19)(2, "span", 20);
    \u0275\u0275text(3, "D\xE9cision du Judge Agent");
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(4, "span", 36);
    \u0275\u0275text(5);
    \u0275\u0275elementEnd()();
    \u0275\u0275elementStart(6, "div", 34);
    \u0275\u0275text(7);
    \u0275\u0275elementEnd();
    \u0275\u0275template(8, IncidentDetailComponent_ng_container_7_div_20_div_8_Template, 5, 1, "div", 37);
    \u0275\u0275elementEnd();
  }
  if (rf & 2) {
    const ctx_r2 = \u0275\u0275nextContext(2);
    \u0275\u0275advance(4);
    \u0275\u0275classMap(ctx_r2.decision.action === "APPROVE" ? "info" : "high");
    \u0275\u0275advance();
    \u0275\u0275textInterpolate1(" ", ctx_r2.decision.action, " ");
    \u0275\u0275advance(2);
    \u0275\u0275textInterpolate(ctx_r2.decision.reasoning);
    \u0275\u0275advance();
    \u0275\u0275property("ngIf", ctx_r2.decision.proposedFix);
  }
}
function IncidentDetailComponent_ng_container_7_pre_27_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementStart(0, "pre", 40);
    \u0275\u0275text(1);
    \u0275\u0275pipe(2, "json");
    \u0275\u0275elementEnd();
  }
  if (rf & 2) {
    const ctx_r2 = \u0275\u0275nextContext(2);
    \u0275\u0275advance();
    \u0275\u0275textInterpolate(\u0275\u0275pipeBind1(2, 1, ctx_r2.incident));
  }
}
function IncidentDetailComponent_ng_container_7_Template(rf, ctx) {
  if (rf & 1) {
    const _r1 = \u0275\u0275getCurrentView();
    \u0275\u0275elementContainerStart(0);
    \u0275\u0275elementStart(1, "div", 8)(2, "div", 9)(3, "div")(4, "div", 10);
    \u0275\u0275text(5);
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(6, "h2", 11);
    \u0275\u0275text(7);
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(8, "div", 12)(9, "span");
    \u0275\u0275text(10);
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(11, "span");
    \u0275\u0275text(12);
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(13, "span", 13);
    \u0275\u0275text(14);
    \u0275\u0275pipe(15, "date");
    \u0275\u0275elementEnd()()();
    \u0275\u0275elementStart(16, "div", 14);
    \u0275\u0275template(17, IncidentDetailComponent_ng_container_7_button_17_Template, 2, 0, "button", 15)(18, IncidentDetailComponent_ng_container_7_button_18_Template, 2, 0, "button", 16);
    \u0275\u0275elementEnd()()();
    \u0275\u0275template(19, IncidentDetailComponent_ng_container_7_div_19_Template, 5, 1, "div", 5)(20, IncidentDetailComponent_ng_container_7_div_20_Template, 9, 5, "div", 17);
    \u0275\u0275elementStart(21, "div", 18)(22, "div", 19)(23, "span", 20);
    \u0275\u0275text(24, "Donn\xE9es brutes");
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(25, "button", 21);
    \u0275\u0275listener("click", function IncidentDetailComponent_ng_container_7_Template_button_click_25_listener() {
      \u0275\u0275restoreView(_r1);
      const ctx_r2 = \u0275\u0275nextContext();
      return \u0275\u0275resetView(ctx_r2.showRaw = !ctx_r2.showRaw);
    });
    \u0275\u0275text(26);
    \u0275\u0275elementEnd()();
    \u0275\u0275template(27, IncidentDetailComponent_ng_container_7_pre_27_Template, 3, 3, "pre", 22);
    \u0275\u0275elementEnd();
    \u0275\u0275elementContainerEnd();
  }
  if (rf & 2) {
    const ctx_r2 = \u0275\u0275nextContext();
    \u0275\u0275advance();
    \u0275\u0275styleMapInterpolate1("margin-bottom:16px;border-left:3px solid ", ctx_r2.getSeverityColor(ctx_r2.incident.severity), ";");
    \u0275\u0275advance(4);
    \u0275\u0275textInterpolate1(" ", ctx_r2.incident.incidentId, " ");
    \u0275\u0275advance(2);
    \u0275\u0275textInterpolate1(" ", ctx_r2.incident.title || "Incident " + ctx_r2.incident.sourceType, " ");
    \u0275\u0275advance(2);
    \u0275\u0275classMapInterpolate1("badge ", ctx_r2.incident.severity == null ? null : ctx_r2.incident.severity.toLowerCase(), "");
    \u0275\u0275advance();
    \u0275\u0275textInterpolate(ctx_r2.incident.severity);
    \u0275\u0275advance();
    \u0275\u0275classMapInterpolate1("badge ", ctx_r2.incident.status == null ? null : ctx_r2.incident.status.toLowerCase(), "");
    \u0275\u0275advance();
    \u0275\u0275textInterpolate(ctx_r2.incident.status);
    \u0275\u0275advance(2);
    \u0275\u0275textInterpolate2(" ", ctx_r2.incident.sourceType, " \xB7 ", \u0275\u0275pipeBind2(15, 21, ctx_r2.incident.createdAt, "dd/MM/yyyy HH:mm"), " ");
    \u0275\u0275advance(3);
    \u0275\u0275property("ngIf", ctx_r2.incident.status === "CORRECTION_PROPOSED");
    \u0275\u0275advance();
    \u0275\u0275property("ngIf", ctx_r2.incident.status !== "RESOLVED" && ctx_r2.incident.status !== "CLOSED");
    \u0275\u0275advance();
    \u0275\u0275property("ngIf", ctx_r2.reports.length > 0);
    \u0275\u0275advance();
    \u0275\u0275property("ngIf", ctx_r2.decision);
    \u0275\u0275advance(6);
    \u0275\u0275textInterpolate1(" ", ctx_r2.showRaw ? "Masquer" : "Afficher", " ");
    \u0275\u0275advance();
    \u0275\u0275property("ngIf", ctx_r2.showRaw);
  }
}
var IncidentDetailComponent = class _IncidentDetailComponent {
  constructor(api, toast) {
    this.api = api;
    this.toast = toast;
    this.incident = null;
    this.reports = [];
    this.decision = null;
    this.loading = true;
    this.showRaw = false;
  }
  ngOnInit() {
    this.load();
  }
  load() {
    this.loading = true;
    this.api.getIncident(this.id).subscribe({
      next: (inc) => {
        this.incident = inc;
        this.reports = inc.agentReports || [];
        this.decision = inc.decision || null;
        this.loading = false;
      },
      error: () => {
        this.toast.error("Erreur", "Incident introuvable");
        this.loading = false;
      }
    });
  }
  applyCorrection() {
    this.api.updateIncidentStatus(this.id, "CORRECTION_APPLIED").subscribe({
      next: () => {
        this.toast.success("Correction appliqu\xE9e");
        this.load();
      },
      error: () => this.toast.error("Erreur", "Impossible d'appliquer la correction")
    });
  }
  resolveIncident() {
    this.api.updateIncidentStatus(this.id, "RESOLVED").subscribe({
      next: () => {
        this.toast.success("Incident r\xE9solu");
        this.load();
      },
      error: () => this.toast.error("Erreur", "Impossible de r\xE9soudre l'incident")
    });
  }
  getSeverityColor(s) {
    const map = {
      CRITICAL: "var(--accent-red)",
      HIGH: "var(--accent-red)",
      MEDIUM: "var(--accent-orange)",
      LOW: "var(--accent-green)"
    };
    return map[s] || "var(--border)";
  }
  getAgentColor(t) {
    const map = {
      ROOT_CAUSE: "#38bdf8",
      SECURITY: "#e24b4a",
      REMEDIATION: "#22c55e",
      JUDGE: "#f59e0b"
    };
    return map[t] || "#7ba8c8";
  }
  getAgentIcon(t) {
    const map = { ROOT_CAUSE: "\u25C8", SECURITY: "\u2B21", REMEDIATION: "\u25C6", JUDGE: "\u25A3" };
    return map[t] || "\u25C9";
  }
  getAgentLabel(t) {
    const map = {
      ROOT_CAUSE: "Root Cause Analysis",
      SECURITY: "Security Risk",
      REMEDIATION: "Remediation",
      JUDGE: "Judge Agent"
    };
    return map[t] || t;
  }
  static {
    this.\u0275fac = function IncidentDetailComponent_Factory(t) {
      return new (t || _IncidentDetailComponent)(\u0275\u0275directiveInject(ApiService), \u0275\u0275directiveInject(ToastService));
    };
  }
  static {
    this.\u0275cmp = /* @__PURE__ */ \u0275\u0275defineComponent({ type: _IncidentDetailComponent, selectors: [["app-incident-detail"]], inputs: { id: "id" }, standalone: true, features: [\u0275\u0275StandaloneFeature], decls: 8, vars: 2, consts: [[1, "page-container"], [1, "page-header"], ["routerLink", "/incidents", 2, "font-size", "12px", "color", "var(--text-muted)"], [1, "page-title", 2, "margin-top", "8px"], ["class", "loading-overlay", 4, "ngIf"], [4, "ngIf"], [1, "loading-overlay"], [1, "spinner"], [1, "card"], [2, "display", "flex", "align-items", "flex-start", "justify-content", "space-between", "gap", "16px"], [2, "font-family", "var(--font-mono)", "font-size", "11px", "color", "var(--text-muted)", "margin-bottom", "6px"], [2, "font-size", "16px", "color", "var(--text-primary)", "margin-bottom", "8px"], [2, "display", "flex", "gap", "8px", "flex-wrap", "wrap"], [2, "font-size", "11px", "color", "var(--text-muted)", "font-family", "var(--font-mono)"], [2, "display", "flex", "gap", "8px", "flex-shrink", "0"], ["class", "btn btn-success btn-sm", 3, "click", 4, "ngIf"], ["class", "btn btn-secondary btn-sm", 3, "click", 4, "ngIf"], ["class", "card decision-card", 4, "ngIf"], [1, "card", 2, "margin-top", "16px"], [1, "card-header"], [1, "card-title"], [1, "btn", "btn-secondary", "btn-sm", 3, "click"], ["class", "code-block", 4, "ngIf"], [1, "btn", "btn-success", "btn-sm", 3, "click"], [2, "font-size", "12px", "color", "var(--text-muted)", "letter-spacing", "1px", "text-transform", "uppercase", "font-family", "var(--font-mono)", "margin-bottom", "12px"], [2, "display", "grid", "grid-template-columns", "repeat(auto-fit,minmax(280px,1fr))", "gap", "12px", "margin-bottom", "16px"], ["class", "card agent-report-card", 4, "ngFor", "ngForOf"], [1, "card", "agent-report-card"], [1, "card-header", 2, "margin-bottom", "12px"], [2, "display", "flex", "align-items", "center", "gap", "8px"], [1, "agent-badge"], [2, "display", "flex", "align-items", "center", "gap", "4px"], [1, "confidence-bar"], [2, "font-size", "10px", "color", "var(--text-muted)", "font-family", "var(--font-mono)"], [1, "report-content"], [1, "card", "decision-card"], [1, "badge"], ["style", "margin-top:12px;", 4, "ngIf"], [2, "margin-top", "12px"], [2, "font-size", "10px", "color", "var(--text-faint)", "margin-bottom", "6px", "font-family", "var(--font-mono)"], [1, "code-block"]], template: function IncidentDetailComponent_Template(rf, ctx) {
      if (rf & 1) {
        \u0275\u0275elementStart(0, "div", 0)(1, "div", 1)(2, "a", 2);
        \u0275\u0275text(3, "\u2190 Retour aux incidents");
        \u0275\u0275elementEnd();
        \u0275\u0275elementStart(4, "h1", 3);
        \u0275\u0275text(5, "// incident_detail");
        \u0275\u0275elementEnd()();
        \u0275\u0275template(6, IncidentDetailComponent_div_6_Template, 4, 0, "div", 4)(7, IncidentDetailComponent_ng_container_7_Template, 28, 24, "ng-container", 5);
        \u0275\u0275elementEnd();
      }
      if (rf & 2) {
        \u0275\u0275advance(6);
        \u0275\u0275property("ngIf", ctx.loading);
        \u0275\u0275advance();
        \u0275\u0275property("ngIf", ctx.incident && !ctx.loading);
      }
    }, dependencies: [CommonModule, NgForOf, NgIf, JsonPipe, DecimalPipe, DatePipe, RouterModule, RouterLink], styles: ["\n\n.agent-badge[_ngcontent-%COMP%] {\n  width: 28px;\n  height: 28px;\n  border-radius: var(--radius-sm);\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  font-size: 14px;\n  flex-shrink: 0;\n}\n.confidence-bar[_ngcontent-%COMP%] {\n  width: 60px;\n  height: 3px;\n  background: var(--border);\n  border-radius: 2px;\n  overflow: hidden;\n}\n.confidence-bar[_ngcontent-%COMP%]   div[_ngcontent-%COMP%] {\n  height: 100%;\n  border-radius: 2px;\n  transition: width 0.8s ease;\n}\n.report-content[_ngcontent-%COMP%] {\n  font-size: 12px;\n  color: var(--text-secondary);\n  line-height: 1.6;\n  white-space: pre-wrap;\n}\n.decision-card[_ngcontent-%COMP%] {\n  border-left: 3px solid var(--accent-orange);\n}\n.code-block[_ngcontent-%COMP%] {\n  background: var(--bg-primary);\n  border: 1px solid var(--border);\n  border-radius: var(--radius-md);\n  padding: 12px;\n  font-family: var(--font-mono);\n  font-size: 11px;\n  color: var(--text-secondary);\n  overflow-x: auto;\n  white-space: pre-wrap;\n}\n/*# sourceMappingURL=incident-detail.component.css.map */"] });
  }
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && \u0275setClassDebugInfo(IncidentDetailComponent, { className: "IncidentDetailComponent", filePath: "src/app/features/incidents/incident-detail.component.ts", lineNumber: 152 });
})();
export {
  IncidentDetailComponent
};
//# sourceMappingURL=chunk-IMP546TQ.js.map
