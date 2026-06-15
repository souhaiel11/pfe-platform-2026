import {
  FormsModule
} from "./chunk-H2D3GIUD.js";
import {
  ToastService
} from "./chunk-RAVY26A2.js";
import {
  ApiService
} from "./chunk-6BA5PBBI.js";
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
  NgForOf,
  NgIf,
  ɵsetClassDebugInfo,
  ɵɵStandaloneFeature,
  ɵɵadvance,
  ɵɵclassMap,
  ɵɵclassProp,
  ɵɵdefineComponent,
  ɵɵdirectiveInject,
  ɵɵelement,
  ɵɵelementEnd,
  ɵɵelementStart,
  ɵɵgetCurrentView,
  ɵɵlistener,
  ɵɵnextContext,
  ɵɵpipe,
  ɵɵpipeBind2,
  ɵɵproperty,
  ɵɵpureFunction1,
  ɵɵresetView,
  ɵɵrestoreView,
  ɵɵstyleProp,
  ɵɵtemplate,
  ɵɵtext,
  ɵɵtextInterpolate,
  ɵɵtextInterpolate1,
  ɵɵtextInterpolate2
} from "./chunk-ZQZUXNDQ.js";

// src/app/features/analysis/analysis.component.ts
var _c0 = (a0) => ["/incidents", a0];
function AnalysisComponent_button_7_Template(rf, ctx) {
  if (rf & 1) {
    const _r1 = \u0275\u0275getCurrentView();
    \u0275\u0275elementStart(0, "button", 8);
    \u0275\u0275listener("click", function AnalysisComponent_button_7_Template_button_click_0_listener() {
      const t_r2 = \u0275\u0275restoreView(_r1).$implicit;
      const ctx_r2 = \u0275\u0275nextContext();
      ctx_r2.activeTab = t_r2.key;
      return \u0275\u0275resetView(ctx_r2.load());
    });
    \u0275\u0275elementStart(1, "span");
    \u0275\u0275text(2);
    \u0275\u0275elementEnd();
    \u0275\u0275text(3);
    \u0275\u0275elementEnd();
  }
  if (rf & 2) {
    const t_r2 = ctx.$implicit;
    const ctx_r2 = \u0275\u0275nextContext();
    \u0275\u0275styleProp("--tab-color", t_r2.color);
    \u0275\u0275classProp("active", ctx_r2.activeTab === t_r2.key);
    \u0275\u0275advance(2);
    \u0275\u0275textInterpolate(t_r2.icon);
    \u0275\u0275advance();
    \u0275\u0275textInterpolate1(" ", t_r2.label, " ");
  }
}
function AnalysisComponent_div_8_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementStart(0, "div", 9);
    \u0275\u0275element(1, "div", 10);
    \u0275\u0275elementEnd();
  }
}
function AnalysisComponent_div_9_tr_17_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementStart(0, "tr")(1, "td", 14);
    \u0275\u0275text(2, "Aucune d\xE9cision");
    \u0275\u0275elementEnd()();
  }
}
function AnalysisComponent_div_9_tr_18_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementStart(0, "tr")(1, "td", 15);
    \u0275\u0275text(2);
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(3, "td")(4, "span", 16);
    \u0275\u0275text(5);
    \u0275\u0275elementEnd()();
    \u0275\u0275elementStart(6, "td")(7, "div", 17)(8, "div", 18);
    \u0275\u0275element(9, "div");
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(10, "span", 19);
    \u0275\u0275text(11);
    \u0275\u0275pipe(12, "number");
    \u0275\u0275elementEnd()()();
    \u0275\u0275elementStart(13, "td", 20);
    \u0275\u0275text(14);
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(15, "td", 21);
    \u0275\u0275text(16);
    \u0275\u0275pipe(17, "date");
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(18, "td")(19, "a", 22);
    \u0275\u0275text(20, "\u2192");
    \u0275\u0275elementEnd()()();
  }
  if (rf & 2) {
    const d_r4 = ctx.$implicit;
    const ctx_r2 = \u0275\u0275nextContext(2);
    \u0275\u0275advance(2);
    \u0275\u0275textInterpolate1(" ", d_r4.incidentId == null ? null : d_r4.incidentId.substring(0, 20), "... ");
    \u0275\u0275advance(2);
    \u0275\u0275classMap(d_r4.action === "APPROVE" ? "info" : "high");
    \u0275\u0275advance();
    \u0275\u0275textInterpolate(d_r4.action);
    \u0275\u0275advance(4);
    \u0275\u0275styleProp("width", (d_r4.confidence || 0) * 100 + "%")("background", ctx_r2.getConfidenceColor(d_r4.confidence));
    \u0275\u0275advance(2);
    \u0275\u0275textInterpolate1(" ", \u0275\u0275pipeBind2(12, 12, (d_r4.confidence || 0) * 100, "1.0-0"), "% ");
    \u0275\u0275advance(3);
    \u0275\u0275textInterpolate1(" ", d_r4.reasoning, " ");
    \u0275\u0275advance(2);
    \u0275\u0275textInterpolate1(" ", \u0275\u0275pipeBind2(17, 15, d_r4.createdAt, "dd/MM HH:mm"), " ");
    \u0275\u0275advance(3);
    \u0275\u0275property("routerLink", \u0275\u0275pureFunction1(18, _c0, d_r4.incidentId));
  }
}
function AnalysisComponent_div_9_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementStart(0, "div")(1, "div", 11)(2, "table", 12)(3, "thead")(4, "tr")(5, "th");
    \u0275\u0275text(6, "Incident");
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(7, "th");
    \u0275\u0275text(8, "Action");
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(9, "th");
    \u0275\u0275text(10, "Confiance");
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(11, "th");
    \u0275\u0275text(12, "Raisonnement");
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(13, "th");
    \u0275\u0275text(14, "Date");
    \u0275\u0275elementEnd();
    \u0275\u0275element(15, "th");
    \u0275\u0275elementEnd()();
    \u0275\u0275elementStart(16, "tbody");
    \u0275\u0275template(17, AnalysisComponent_div_9_tr_17_Template, 3, 0, "tr", 7)(18, AnalysisComponent_div_9_tr_18_Template, 21, 20, "tr", 13);
    \u0275\u0275elementEnd()()()();
  }
  if (rf & 2) {
    const ctx_r2 = \u0275\u0275nextContext();
    \u0275\u0275advance(17);
    \u0275\u0275property("ngIf", ctx_r2.decisions.length === 0);
    \u0275\u0275advance();
    \u0275\u0275property("ngForOf", ctx_r2.decisions);
  }
}
function AnalysisComponent_div_10_div_2_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementStart(0, "div", 26)(1, "div", 27);
    \u0275\u0275text(2, "Aucun rapport");
    \u0275\u0275elementEnd()();
  }
}
function AnalysisComponent_div_10_div_3_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementStart(0, "div", 28)(1, "div", 29)(2, "span", 30);
    \u0275\u0275text(3);
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(4, "div", 17)(5, "div", 18);
    \u0275\u0275element(6, "div");
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(7, "span", 19);
    \u0275\u0275text(8);
    \u0275\u0275pipe(9, "number");
    \u0275\u0275elementEnd()()();
    \u0275\u0275elementStart(10, "div", 31);
    \u0275\u0275text(11);
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(12, "div", 32)(13, "span", 33);
    \u0275\u0275text(14);
    \u0275\u0275pipe(15, "date");
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(16, "a", 22);
    \u0275\u0275text(17, "Incident \u2192");
    \u0275\u0275elementEnd()()();
  }
  if (rf & 2) {
    const r_r5 = ctx.$implicit;
    const ctx_r2 = \u0275\u0275nextContext(2);
    \u0275\u0275advance(2);
    \u0275\u0275styleProp("color", ctx_r2.getAgentColor(r_r5.agentType))("background", ctx_r2.getAgentColor(r_r5.agentType) + "11");
    \u0275\u0275advance();
    \u0275\u0275textInterpolate2(" ", ctx_r2.getAgentIcon(r_r5.agentType), " ", ctx_r2.getAgentLabel(r_r5.agentType), " ");
    \u0275\u0275advance(3);
    \u0275\u0275styleProp("width", (r_r5.confidence || 0) * 100 + "%")("background", ctx_r2.getAgentColor(r_r5.agentType));
    \u0275\u0275advance(2);
    \u0275\u0275textInterpolate1(" ", \u0275\u0275pipeBind2(9, 14, (r_r5.confidence || 0) * 100, "1.0-0"), "% ");
    \u0275\u0275advance(3);
    \u0275\u0275textInterpolate(r_r5.analysis || r_r5.content);
    \u0275\u0275advance(3);
    \u0275\u0275textInterpolate1(" ", \u0275\u0275pipeBind2(15, 17, r_r5.createdAt, "dd/MM/yyyy HH:mm"), " ");
    \u0275\u0275advance(2);
    \u0275\u0275property("routerLink", \u0275\u0275pureFunction1(20, _c0, r_r5.incidentId));
  }
}
function AnalysisComponent_div_10_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementStart(0, "div")(1, "div", 23);
    \u0275\u0275template(2, AnalysisComponent_div_10_div_2_Template, 3, 0, "div", 24)(3, AnalysisComponent_div_10_div_3_Template, 18, 22, "div", 25);
    \u0275\u0275elementEnd()();
  }
  if (rf & 2) {
    const ctx_r2 = \u0275\u0275nextContext();
    \u0275\u0275advance(2);
    \u0275\u0275property("ngIf", ctx_r2.reports.length === 0);
    \u0275\u0275advance();
    \u0275\u0275property("ngForOf", ctx_r2.reports);
  }
}
var AnalysisComponent = class _AnalysisComponent {
  constructor(api, toast) {
    this.api = api;
    this.toast = toast;
    this.reports = [];
    this.decisions = [];
    this.loading = false;
    this.activeTab = "decisions";
    this.tabs = [
      { key: "decisions", label: "D\xE9cisions Judge", icon: "\u25A3", color: "#f59e0b" },
      { key: "ROOT_CAUSE", label: "Root Cause", icon: "\u25C8", color: "#38bdf8" },
      { key: "SECURITY", label: "Security Risk", icon: "\u2B21", color: "#e24b4a" },
      { key: "REMEDIATION", label: "Remediation", icon: "\u25C6", color: "#22c55e" }
    ];
  }
  ngOnInit() {
    this.load();
  }
  load() {
    this.loading = true;
    if (this.activeTab === "decisions") {
      this.api.getDecisions().subscribe({
        next: (d) => {
          this.decisions = d;
          this.loading = false;
        },
        error: () => {
          this.loading = false;
        }
      });
    } else {
      this.api.getReports({ agentType: this.activeTab }).subscribe({
        next: (r) => {
          this.reports = r;
          this.loading = false;
        },
        error: () => {
          this.loading = false;
        }
      });
    }
  }
  getAgentColor(t) {
    const m = { ROOT_CAUSE: "#38bdf8", SECURITY: "#e24b4a", REMEDIATION: "#22c55e", JUDGE: "#f59e0b" };
    return m[t] || "#7ba8c8";
  }
  getAgentIcon(t) {
    const m = { ROOT_CAUSE: "\u25C8", SECURITY: "\u2B21", REMEDIATION: "\u25C6", JUDGE: "\u25A3" };
    return m[t] || "\u25C9";
  }
  getAgentLabel(t) {
    const m = { ROOT_CAUSE: "Root Cause", SECURITY: "Security Risk", REMEDIATION: "Remediation", JUDGE: "Judge" };
    return m[t] || t;
  }
  getConfidenceColor(c) {
    if (c >= 0.8)
      return "var(--accent-green)";
    if (c >= 0.6)
      return "var(--accent-orange)";
    return "var(--accent-red)";
  }
  static {
    this.\u0275fac = function AnalysisComponent_Factory(t) {
      return new (t || _AnalysisComponent)(\u0275\u0275directiveInject(ApiService), \u0275\u0275directiveInject(ToastService));
    };
  }
  static {
    this.\u0275cmp = /* @__PURE__ */ \u0275\u0275defineComponent({ type: _AnalysisComponent, selectors: [["app-analysis"]], standalone: true, features: [\u0275\u0275StandaloneFeature], decls: 11, vars: 4, consts: [[1, "page-container"], [1, "page-header"], [1, "page-title"], [1, "page-subtitle"], [1, "agent-tabs", 2, "margin-bottom", "16px"], ["class", "agent-tab", 3, "active", "--tab-color", "click", 4, "ngFor", "ngForOf"], ["class", "loading-overlay", 4, "ngIf"], [4, "ngIf"], [1, "agent-tab", 3, "click"], [1, "loading-overlay"], [1, "spinner"], [1, "card", 2, "padding", "0", "overflow", "hidden"], [1, "data-table"], [4, "ngFor", "ngForOf"], ["colspan", "6", 2, "text-align", "center", "padding", "40px", "color", "var(--text-faint)"], [2, "font-family", "var(--font-mono)", "font-size", "10px", "color", "var(--accent-blue)"], [1, "badge"], [2, "display", "flex", "align-items", "center", "gap", "6px"], [1, "mini-bar"], [2, "font-size", "10px", "font-family", "var(--font-mono)", "color", "var(--text-muted)"], [2, "max-width", "200px", "overflow", "hidden", "text-overflow", "ellipsis", "white-space", "nowrap", "font-size", "11px"], [2, "font-family", "var(--font-mono)", "font-size", "10px"], [1, "btn", "btn-secondary", "btn-sm", 3, "routerLink"], [2, "display", "grid", "grid-template-columns", "repeat(auto-fill,minmax(320px,1fr))", "gap", "12px"], ["style", "grid-column:1/-1;", "class", "empty-state", 4, "ngIf"], ["class", "report-card", 4, "ngFor", "ngForOf"], [1, "empty-state", 2, "grid-column", "1/-1"], [1, "empty-title"], [1, "report-card"], [1, "report-header"], [1, "agent-pill"], [1, "report-body"], [1, "report-footer"], [2, "font-family", "var(--font-mono)", "font-size", "10px", "color", "var(--text-faint)"]], template: function AnalysisComponent_Template(rf, ctx) {
      if (rf & 1) {
        \u0275\u0275elementStart(0, "div", 0)(1, "div", 1)(2, "h1", 2);
        \u0275\u0275text(3, "// analyses_ia");
        \u0275\u0275elementEnd();
        \u0275\u0275elementStart(4, "p", 3);
        \u0275\u0275text(5, "Rapports g\xE9n\xE9r\xE9s par les agents IA \u2014 Root Cause, Security, Remediation, Judge");
        \u0275\u0275elementEnd()();
        \u0275\u0275elementStart(6, "div", 4);
        \u0275\u0275template(7, AnalysisComponent_button_7_Template, 4, 6, "button", 5);
        \u0275\u0275elementEnd();
        \u0275\u0275template(8, AnalysisComponent_div_8_Template, 2, 0, "div", 6)(9, AnalysisComponent_div_9_Template, 19, 2, "div", 7)(10, AnalysisComponent_div_10_Template, 4, 2, "div", 7);
        \u0275\u0275elementEnd();
      }
      if (rf & 2) {
        \u0275\u0275advance(7);
        \u0275\u0275property("ngForOf", ctx.tabs);
        \u0275\u0275advance();
        \u0275\u0275property("ngIf", ctx.loading);
        \u0275\u0275advance();
        \u0275\u0275property("ngIf", ctx.activeTab === "decisions" && !ctx.loading);
        \u0275\u0275advance();
        \u0275\u0275property("ngIf", ctx.activeTab !== "decisions" && !ctx.loading);
      }
    }, dependencies: [CommonModule, NgForOf, NgIf, DecimalPipe, DatePipe, RouterModule, RouterLink, FormsModule], styles: ["\n\n.agent-tabs[_ngcontent-%COMP%] {\n  display: flex;\n  gap: 8px;\n  flex-wrap: wrap;\n}\n.agent-tab[_ngcontent-%COMP%] {\n  display: flex;\n  align-items: center;\n  gap: 6px;\n  padding: 7px 14px;\n  border-radius: var(--radius-md);\n  font-size: 12px;\n  color: var(--text-muted);\n  background: var(--bg-secondary);\n  border: 1px solid var(--border);\n  cursor: pointer;\n  transition: all 0.15s;\n}\n.agent-tab[_ngcontent-%COMP%]:hover {\n  border-color: var(--border-light);\n  color: var(--text-secondary);\n}\n.agent-tab.active[_ngcontent-%COMP%] {\n  background: var(--tab-color, var(--accent-blue));\n  color: #080c14;\n  border-color: transparent;\n}\n.mini-bar[_ngcontent-%COMP%] {\n  width: 50px;\n  height: 3px;\n  background: var(--border);\n  border-radius: 2px;\n  overflow: hidden;\n}\n.mini-bar[_ngcontent-%COMP%]   div[_ngcontent-%COMP%] {\n  height: 100%;\n  border-radius: 2px;\n}\n.report-card[_ngcontent-%COMP%] {\n  background: var(--bg-secondary);\n  border: 1px solid var(--border);\n  border-radius: var(--radius-lg);\n  padding: 16px;\n  display: flex;\n  flex-direction: column;\n  gap: 10px;\n  transition: border-color 0.2s;\n}\n.report-card[_ngcontent-%COMP%]:hover {\n  border-color: var(--border-light);\n}\n.report-header[_ngcontent-%COMP%] {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n}\n.agent-pill[_ngcontent-%COMP%] {\n  font-size: 11px;\n  font-weight: 600;\n  padding: 3px 10px;\n  border-radius: 20px;\n  font-family: var(--font-mono);\n}\n.report-body[_ngcontent-%COMP%] {\n  font-size: 12px;\n  color: var(--text-secondary);\n  line-height: 1.6;\n  overflow: hidden;\n  display: -webkit-box;\n  -webkit-line-clamp: 4;\n  -webkit-box-orient: vertical;\n}\n.report-footer[_ngcontent-%COMP%] {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n}\n/*# sourceMappingURL=analysis.component.css.map */"] });
  }
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && \u0275setClassDebugInfo(AnalysisComponent, { className: "AnalysisComponent", filePath: "src/app/features/analysis/analysis.component.ts", lineNumber: 191 });
})();
export {
  AnalysisComponent
};
//# sourceMappingURL=chunk-WQOHPDIM.js.map
