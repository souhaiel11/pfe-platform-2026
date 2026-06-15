import {
  ToastService
} from "./chunk-RAVY26A2.js";
import {
  ApiService
} from "./chunk-KCUC5JBH.js";
import "./chunk-R3YGZVM2.js";
import {
  RouterLink,
  RouterModule
} from "./chunk-CX7S5RF6.js";
import "./chunk-Y42B5JPZ.js";
import {
  CommonModule,
  DecimalPipe,
  NgForOf,
  NgIf,
  ɵsetClassDebugInfo,
  ɵɵStandaloneFeature,
  ɵɵadvance,
  ɵɵclassMapInterpolate1,
  ɵɵdefineComponent,
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
  ɵɵpureFunction0,
  ɵɵpureFunction1,
  ɵɵstyleProp,
  ɵɵtemplate,
  ɵɵtext,
  ɵɵtextInterpolate,
  ɵɵtextInterpolate1
} from "./chunk-ZQZUXNDQ.js";

// src/app/features/projects/project-detail.component.ts
var _c0 = () => ["/incidents"];
var _c1 = (a0) => ({ projectId: a0 });
function ProjectDetailComponent_div_7_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementStart(0, "div", 8);
    \u0275\u0275element(1, "div", 9);
    \u0275\u0275text(2, " Sant\xE9 : ");
    \u0275\u0275elementStart(3, "strong");
    \u0275\u0275text(4);
    \u0275\u0275pipe(5, "number");
    \u0275\u0275elementEnd()();
  }
  if (rf & 2) {
    const ctx_r0 = \u0275\u0275nextContext();
    \u0275\u0275advance(3);
    \u0275\u0275styleProp("color", ctx_r0.getHealthColor(ctx_r0.project.healthScore));
    \u0275\u0275advance();
    \u0275\u0275textInterpolate1(" ", \u0275\u0275pipeBind2(5, 3, ctx_r0.project.healthScore, "1.0-0"), "% ");
  }
}
function ProjectDetailComponent_div_8_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementStart(0, "div", 10);
    \u0275\u0275element(1, "div", 11);
    \u0275\u0275elementEnd();
  }
}
function ProjectDetailComponent_ng_container_9_tr_28_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementStart(0, "tr")(1, "td", 28);
    \u0275\u0275text(2);
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(3, "td", 29);
    \u0275\u0275text(4);
    \u0275\u0275elementEnd()();
  }
  if (rf & 2) {
    const info_r2 = ctx.$implicit;
    \u0275\u0275advance(2);
    \u0275\u0275textInterpolate(info_r2.label);
    \u0275\u0275advance(2);
    \u0275\u0275textInterpolate(info_r2.value);
  }
}
function ProjectDetailComponent_ng_container_9_div_35_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementStart(0, "div", 30)(1, "span");
    \u0275\u0275text(2);
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(3, "span", 31);
    \u0275\u0275text(4);
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(5, "span");
    \u0275\u0275text(6);
    \u0275\u0275elementEnd()();
  }
  if (rf & 2) {
    const inc_r3 = ctx.$implicit;
    \u0275\u0275advance();
    \u0275\u0275classMapInterpolate1("badge ", inc_r3.severity == null ? null : inc_r3.severity.toLowerCase(), "");
    \u0275\u0275advance();
    \u0275\u0275textInterpolate(inc_r3.severity);
    \u0275\u0275advance(2);
    \u0275\u0275textInterpolate1(" ", inc_r3.title || inc_r3.sourceType, " ");
    \u0275\u0275advance();
    \u0275\u0275classMapInterpolate1("badge ", inc_r3.status == null ? null : inc_r3.status.toLowerCase(), "");
    \u0275\u0275advance();
    \u0275\u0275textInterpolate(inc_r3.status);
  }
}
function ProjectDetailComponent_ng_container_9_div_36_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementStart(0, "div", 32)(1, "div", 33);
    \u0275\u0275text(2, "Aucun incident");
    \u0275\u0275elementEnd()();
  }
}
function ProjectDetailComponent_ng_container_9_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementContainerStart(0);
    \u0275\u0275elementStart(1, "div", 12)(2, "div", 13)(3, "div", 14);
    \u0275\u0275text(4, "Incidents ouverts");
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(5, "div", 15);
    \u0275\u0275text(6);
    \u0275\u0275elementEnd()();
    \u0275\u0275elementStart(7, "div", 16)(8, "div", 14);
    \u0275\u0275text(9, "En analyse");
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(10, "div", 15);
    \u0275\u0275text(11);
    \u0275\u0275elementEnd()();
    \u0275\u0275elementStart(12, "div", 17)(13, "div", 14);
    \u0275\u0275text(14, "Corrections propos\xE9es");
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(15, "div", 15);
    \u0275\u0275text(16);
    \u0275\u0275elementEnd()();
    \u0275\u0275elementStart(17, "div", 18)(18, "div", 14);
    \u0275\u0275text(19, "R\xE9solus");
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(20, "div", 15);
    \u0275\u0275text(21);
    \u0275\u0275elementEnd()()();
    \u0275\u0275elementStart(22, "div", 19)(23, "div", 20)(24, "div", 21)(25, "span", 22);
    \u0275\u0275text(26, "Informations");
    \u0275\u0275elementEnd()();
    \u0275\u0275elementStart(27, "table", 23);
    \u0275\u0275template(28, ProjectDetailComponent_ng_container_9_tr_28_Template, 5, 2, "tr", 24);
    \u0275\u0275elementEnd()();
    \u0275\u0275elementStart(29, "div", 20)(30, "div", 21)(31, "span", 22);
    \u0275\u0275text(32, "Incidents r\xE9cents");
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(33, "a", 25);
    \u0275\u0275text(34, "Voir tous \u2192");
    \u0275\u0275elementEnd()();
    \u0275\u0275template(35, ProjectDetailComponent_ng_container_9_div_35_Template, 7, 9, "div", 26)(36, ProjectDetailComponent_ng_container_9_div_36_Template, 3, 0, "div", 27);
    \u0275\u0275elementEnd()();
    \u0275\u0275elementContainerEnd();
  }
  if (rf & 2) {
    const ctx_r0 = \u0275\u0275nextContext();
    \u0275\u0275advance(6);
    \u0275\u0275textInterpolate(ctx_r0.project.openIncidents || 0);
    \u0275\u0275advance(5);
    \u0275\u0275textInterpolate(ctx_r0.project.analyzingIncidents || 0);
    \u0275\u0275advance(5);
    \u0275\u0275textInterpolate(ctx_r0.project.proposedIncidents || 0);
    \u0275\u0275advance(5);
    \u0275\u0275textInterpolate(ctx_r0.project.resolvedIncidents || 0);
    \u0275\u0275advance(7);
    \u0275\u0275property("ngForOf", ctx_r0.getInfoRows());
    \u0275\u0275advance(5);
    \u0275\u0275property("routerLink", \u0275\u0275pureFunction0(9, _c0))("queryParams", \u0275\u0275pureFunction1(10, _c1, ctx_r0.project.id));
    \u0275\u0275advance(2);
    \u0275\u0275property("ngForOf", ctx_r0.incidents.slice(0, 6));
    \u0275\u0275advance();
    \u0275\u0275property("ngIf", ctx_r0.incidents.length === 0);
  }
}
var ProjectDetailComponent = class _ProjectDetailComponent {
  constructor(api, toast) {
    this.api = api;
    this.toast = toast;
    this.project = null;
    this.incidents = [];
    this.loading = true;
  }
  ngOnInit() {
    this.api.getProject(this.id).subscribe({
      next: (p) => {
        this.project = p;
        this.loading = false;
        this.loadIncidents();
      },
      error: () => {
        this.toast.error("Erreur", "Projet introuvable");
        this.loading = false;
      }
    });
  }
  loadIncidents() {
    this.api.getIncidents({ projectId: this.id, size: 10 }).subscribe((r) => {
      this.incidents = r.content || r;
    });
  }
  getInfoRows() {
    if (!this.project)
      return [];
    return [
      { label: "ID", value: this.project.id },
      { label: "Cr\xE9\xE9 le", value: new Date(this.project.createdAt).toLocaleDateString("fr-FR") },
      { label: "Cl\xE9 Sonar", value: this.project.sonarKey || "\u2014" },
      { label: "Description", value: this.project.description || "\u2014" }
    ];
  }
  getHealthColor(score) {
    if (score >= 80)
      return "var(--accent-green)";
    if (score >= 60)
      return "var(--accent-orange)";
    return "var(--accent-red)";
  }
  static {
    this.\u0275fac = function ProjectDetailComponent_Factory(t) {
      return new (t || _ProjectDetailComponent)(\u0275\u0275directiveInject(ApiService), \u0275\u0275directiveInject(ToastService));
    };
  }
  static {
    this.\u0275cmp = /* @__PURE__ */ \u0275\u0275defineComponent({ type: _ProjectDetailComponent, selectors: [["app-project-detail"]], inputs: { id: "id" }, standalone: true, features: [\u0275\u0275StandaloneFeature], decls: 10, vars: 4, consts: [[1, "page-container"], [1, "page-header"], ["routerLink", "/projects", 2, "font-size", "12px", "color", "var(--text-muted)"], [2, "display", "flex", "align-items", "center", "justify-content", "space-between", "margin-top", "8px"], [1, "page-title"], ["class", "live-indicator", 4, "ngIf"], ["class", "loading-overlay", 4, "ngIf"], [4, "ngIf"], [1, "live-indicator"], [1, "live-dot"], [1, "loading-overlay"], [1, "spinner"], [1, "kpi-grid", 2, "margin-bottom", "16px"], [1, "kpi-card", "red"], [1, "kpi-label"], [1, "kpi-value"], [1, "kpi-card", "blue"], [1, "kpi-card", "orange"], [1, "kpi-card", "green"], [1, "grid-2"], [1, "card"], [1, "card-header"], [1, "card-title"], [2, "width", "100%"], [4, "ngFor", "ngForOf"], [1, "btn", "btn-secondary", "btn-sm", 3, "routerLink", "queryParams"], ["class", "inc-row", 4, "ngFor", "ngForOf"], ["class", "empty-state", "style", "padding:20px;", 4, "ngIf"], [2, "font-size", "11px", "color", "var(--text-faint)", "padding", "7px 0", "width", "40%"], [2, "font-size", "12px", "color", "var(--text-secondary)", "font-family", "var(--font-mono)"], [1, "inc-row"], [2, "flex", "1", "font-size", "11px", "color", "var(--text-secondary)", "overflow", "hidden", "text-overflow", "ellipsis", "white-space", "nowrap"], [1, "empty-state", 2, "padding", "20px"], [1, "empty-title"]], template: function ProjectDetailComponent_Template(rf, ctx) {
      if (rf & 1) {
        \u0275\u0275elementStart(0, "div", 0)(1, "div", 1)(2, "a", 2);
        \u0275\u0275text(3, "\u2190 Retour aux projets");
        \u0275\u0275elementEnd();
        \u0275\u0275elementStart(4, "div", 3)(5, "h1", 4);
        \u0275\u0275text(6);
        \u0275\u0275elementEnd();
        \u0275\u0275template(7, ProjectDetailComponent_div_7_Template, 6, 6, "div", 5);
        \u0275\u0275elementEnd()();
        \u0275\u0275template(8, ProjectDetailComponent_div_8_Template, 2, 0, "div", 6)(9, ProjectDetailComponent_ng_container_9_Template, 37, 12, "ng-container", 7);
        \u0275\u0275elementEnd();
      }
      if (rf & 2) {
        \u0275\u0275advance(6);
        \u0275\u0275textInterpolate1("// ", (ctx.project == null ? null : ctx.project.name) || "Projet", "");
        \u0275\u0275advance();
        \u0275\u0275property("ngIf", ctx.project);
        \u0275\u0275advance();
        \u0275\u0275property("ngIf", ctx.loading);
        \u0275\u0275advance();
        \u0275\u0275property("ngIf", ctx.project && !ctx.loading);
      }
    }, dependencies: [CommonModule, NgForOf, NgIf, DecimalPipe, RouterModule, RouterLink], styles: ["\n\n.inc-row[_ngcontent-%COMP%] {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  padding: 8px 0;\n  border-bottom: 1px solid var(--border);\n}\n.inc-row[_ngcontent-%COMP%]:last-child {\n  border-bottom: none;\n}\n/*# sourceMappingURL=project-detail.component.css.map */"] });
  }
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && \u0275setClassDebugInfo(ProjectDetailComponent, { className: "ProjectDetailComponent", filePath: "src/app/features/projects/project-detail.component.ts", lineNumber: 93 });
})();
export {
  ProjectDetailComponent
};
//# sourceMappingURL=chunk-C7JJKQ4G.js.map
