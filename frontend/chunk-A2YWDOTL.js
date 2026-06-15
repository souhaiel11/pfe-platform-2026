import {
  DefaultValueAccessor,
  FormsModule,
  NgControlStatus,
  NgModel
} from "./chunk-H2D3GIUD.js";
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
  DatePipe,
  DecimalPipe,
  NgForOf,
  NgIf,
  ɵsetClassDebugInfo,
  ɵɵStandaloneFeature,
  ɵɵadvance,
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
  ɵɵtwoWayBindingSet,
  ɵɵtwoWayListener,
  ɵɵtwoWayProperty
} from "./chunk-ZQZUXNDQ.js";

// src/app/features/projects/projects.component.ts
var _c0 = (a0) => ["/projects", a0];
function ProjectsComponent_div_9_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementStart(0, "div", 8);
    \u0275\u0275element(1, "div", 9);
    \u0275\u0275elementStart(2, "span");
    \u0275\u0275text(3, "Chargement...");
    \u0275\u0275elementEnd()();
  }
}
function ProjectsComponent_div_10_div_1_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementStart(0, "div", 13)(1, "div", 14);
    \u0275\u0275text(2, "\u25E7");
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(3, "div", 15);
    \u0275\u0275text(4, "Aucun projet");
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(5, "div", 16);
    \u0275\u0275text(6, "Cr\xE9ez votre premier projet pour commencer");
    \u0275\u0275elementEnd()();
  }
}
function ProjectsComponent_div_10_div_2_Template(rf, ctx) {
  if (rf & 1) {
    const _r1 = \u0275\u0275getCurrentView();
    \u0275\u0275elementStart(0, "div", 17)(1, "div", 18)(2, "div", 19);
    \u0275\u0275text(3);
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(4, "div", 20)(5, "div", 21);
    \u0275\u0275text(6);
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(7, "div", 22);
    \u0275\u0275text(8);
    \u0275\u0275elementEnd()();
    \u0275\u0275elementStart(9, "div", 23);
    \u0275\u0275text(10);
    \u0275\u0275pipe(11, "number");
    \u0275\u0275elementEnd()();
    \u0275\u0275elementStart(12, "div", 24)(13, "div", 25)(14, "div", 26);
    \u0275\u0275text(15);
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(16, "div", 27);
    \u0275\u0275text(17, "ouverts");
    \u0275\u0275elementEnd()();
    \u0275\u0275elementStart(18, "div", 25)(19, "div", 28);
    \u0275\u0275text(20);
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(21, "div", 27);
    \u0275\u0275text(22, "analyse");
    \u0275\u0275elementEnd()();
    \u0275\u0275elementStart(23, "div", 25)(24, "div", 29);
    \u0275\u0275text(25);
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(26, "div", 27);
    \u0275\u0275text(27, "r\xE9solus");
    \u0275\u0275elementEnd()()();
    \u0275\u0275elementStart(28, "div", 30)(29, "div", 31);
    \u0275\u0275element(30, "div");
    \u0275\u0275elementEnd()();
    \u0275\u0275elementStart(31, "div", 32)(32, "span", 33);
    \u0275\u0275text(33);
    \u0275\u0275pipe(34, "date");
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(35, "div", 34)(36, "a", 35);
    \u0275\u0275text(37, "Voir \u2192");
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(38, "button", 36);
    \u0275\u0275listener("click", function ProjectsComponent_div_10_div_2_Template_button_click_38_listener() {
      const p_r2 = \u0275\u0275restoreView(_r1).$implicit;
      const ctx_r2 = \u0275\u0275nextContext(2);
      return \u0275\u0275resetView(ctx_r2.confirmDelete(p_r2));
    });
    \u0275\u0275text(39, "\u2715");
    \u0275\u0275elementEnd()()()();
  }
  if (rf & 2) {
    const p_r2 = ctx.$implicit;
    const ctx_r2 = \u0275\u0275nextContext(2);
    \u0275\u0275advance(2);
    \u0275\u0275styleProp("border-color", ctx_r2.getHealthColor(p_r2.healthScore));
    \u0275\u0275advance();
    \u0275\u0275textInterpolate1(" ", p_r2.name == null ? null : p_r2.name.substring(0, 2).toUpperCase(), " ");
    \u0275\u0275advance(3);
    \u0275\u0275textInterpolate(p_r2.name);
    \u0275\u0275advance(2);
    \u0275\u0275textInterpolate1("", p_r2.id == null ? null : p_r2.id.substring(0, 8), "...");
    \u0275\u0275advance();
    \u0275\u0275styleProp("color", ctx_r2.getHealthColor(p_r2.healthScore))("background", ctx_r2.getHealthColor(p_r2.healthScore) + "11");
    \u0275\u0275advance();
    \u0275\u0275textInterpolate1(" ", \u0275\u0275pipeBind2(11, 19, p_r2.healthScore, "1.0-0"), "% ");
    \u0275\u0275advance(5);
    \u0275\u0275textInterpolate(p_r2.openIncidents || 0);
    \u0275\u0275advance(5);
    \u0275\u0275textInterpolate(p_r2.analyzingIncidents || 0);
    \u0275\u0275advance(5);
    \u0275\u0275textInterpolate(p_r2.resolvedIncidents || 0);
    \u0275\u0275advance(5);
    \u0275\u0275styleProp("width", (p_r2.healthScore || 0) + "%")("background", ctx_r2.getHealthColor(p_r2.healthScore));
    \u0275\u0275advance(3);
    \u0275\u0275textInterpolate1(" Cr\xE9\xE9 le ", \u0275\u0275pipeBind2(34, 22, p_r2.createdAt, "dd/MM/yyyy"), " ");
    \u0275\u0275advance(3);
    \u0275\u0275property("routerLink", \u0275\u0275pureFunction1(25, _c0, p_r2.id));
  }
}
function ProjectsComponent_div_10_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementStart(0, "div", 10);
    \u0275\u0275template(1, ProjectsComponent_div_10_div_1_Template, 7, 0, "div", 11)(2, ProjectsComponent_div_10_div_2_Template, 40, 27, "div", 12);
    \u0275\u0275elementEnd();
  }
  if (rf & 2) {
    const ctx_r2 = \u0275\u0275nextContext();
    \u0275\u0275advance();
    \u0275\u0275property("ngIf", ctx_r2.projects.length === 0);
    \u0275\u0275advance();
    \u0275\u0275property("ngForOf", ctx_r2.projects);
  }
}
function ProjectsComponent_div_11_Template(rf, ctx) {
  if (rf & 1) {
    const _r4 = \u0275\u0275getCurrentView();
    \u0275\u0275elementStart(0, "div", 37);
    \u0275\u0275listener("click", function ProjectsComponent_div_11_Template_div_click_0_listener() {
      \u0275\u0275restoreView(_r4);
      const ctx_r2 = \u0275\u0275nextContext();
      return \u0275\u0275resetView(ctx_r2.showModal = false);
    });
    \u0275\u0275elementStart(1, "div", 38);
    \u0275\u0275listener("click", function ProjectsComponent_div_11_Template_div_click_1_listener($event) {
      \u0275\u0275restoreView(_r4);
      return \u0275\u0275resetView($event.stopPropagation());
    });
    \u0275\u0275elementStart(2, "div", 39)(3, "span", 40);
    \u0275\u0275text(4, "Nouveau projet");
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(5, "button", 41);
    \u0275\u0275listener("click", function ProjectsComponent_div_11_Template_button_click_5_listener() {
      \u0275\u0275restoreView(_r4);
      const ctx_r2 = \u0275\u0275nextContext();
      return \u0275\u0275resetView(ctx_r2.showModal = false);
    });
    \u0275\u0275text(6, "\u2715");
    \u0275\u0275elementEnd()();
    \u0275\u0275elementStart(7, "div", 42)(8, "label", 43);
    \u0275\u0275text(9, "Nom du projet *");
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(10, "input", 44);
    \u0275\u0275twoWayListener("ngModelChange", function ProjectsComponent_div_11_Template_input_ngModelChange_10_listener($event) {
      \u0275\u0275restoreView(_r4);
      const ctx_r2 = \u0275\u0275nextContext();
      \u0275\u0275twoWayBindingSet(ctx_r2.newProject.name, $event) || (ctx_r2.newProject.name = $event);
      return \u0275\u0275resetView($event);
    });
    \u0275\u0275elementEnd()();
    \u0275\u0275elementStart(11, "div", 42)(12, "label", 43);
    \u0275\u0275text(13, "Description");
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(14, "input", 45);
    \u0275\u0275twoWayListener("ngModelChange", function ProjectsComponent_div_11_Template_input_ngModelChange_14_listener($event) {
      \u0275\u0275restoreView(_r4);
      const ctx_r2 = \u0275\u0275nextContext();
      \u0275\u0275twoWayBindingSet(ctx_r2.newProject.description, $event) || (ctx_r2.newProject.description = $event);
      return \u0275\u0275resetView($event);
    });
    \u0275\u0275elementEnd()();
    \u0275\u0275elementStart(15, "div", 42)(16, "label", 43);
    \u0275\u0275text(17, "Cl\xE9 SonarQube");
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(18, "input", 46);
    \u0275\u0275twoWayListener("ngModelChange", function ProjectsComponent_div_11_Template_input_ngModelChange_18_listener($event) {
      \u0275\u0275restoreView(_r4);
      const ctx_r2 = \u0275\u0275nextContext();
      \u0275\u0275twoWayBindingSet(ctx_r2.newProject.sonarKey, $event) || (ctx_r2.newProject.sonarKey = $event);
      return \u0275\u0275resetView($event);
    });
    \u0275\u0275elementEnd()();
    \u0275\u0275elementStart(19, "div", 42)(20, "label", 43);
    \u0275\u0275text(21, "GitHub Repository");
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(22, "input", 47);
    \u0275\u0275twoWayListener("ngModelChange", function ProjectsComponent_div_11_Template_input_ngModelChange_22_listener($event) {
      \u0275\u0275restoreView(_r4);
      const ctx_r2 = \u0275\u0275nextContext();
      \u0275\u0275twoWayBindingSet(ctx_r2.newProject.githubRepo, $event) || (ctx_r2.newProject.githubRepo = $event);
      return \u0275\u0275resetView($event);
    });
    \u0275\u0275elementEnd()();
    \u0275\u0275elementStart(23, "div", 42)(24, "label", 43);
    \u0275\u0275text(25, "Jenkins Job Name");
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(26, "input", 48);
    \u0275\u0275twoWayListener("ngModelChange", function ProjectsComponent_div_11_Template_input_ngModelChange_26_listener($event) {
      \u0275\u0275restoreView(_r4);
      const ctx_r2 = \u0275\u0275nextContext();
      \u0275\u0275twoWayBindingSet(ctx_r2.newProject.jenkinsJobName, $event) || (ctx_r2.newProject.jenkinsJobName = $event);
      return \u0275\u0275resetView($event);
    });
    \u0275\u0275elementEnd()();
    \u0275\u0275elementStart(27, "div", 49)(28, "button", 50);
    \u0275\u0275listener("click", function ProjectsComponent_div_11_Template_button_click_28_listener() {
      \u0275\u0275restoreView(_r4);
      const ctx_r2 = \u0275\u0275nextContext();
      return \u0275\u0275resetView(ctx_r2.showModal = false);
    });
    \u0275\u0275text(29, "Annuler");
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(30, "button", 51);
    \u0275\u0275listener("click", function ProjectsComponent_div_11_Template_button_click_30_listener() {
      \u0275\u0275restoreView(_r4);
      const ctx_r2 = \u0275\u0275nextContext();
      return \u0275\u0275resetView(ctx_r2.createProject());
    });
    \u0275\u0275text(31, " Cr\xE9er le projet ");
    \u0275\u0275elementEnd()()()();
  }
  if (rf & 2) {
    const ctx_r2 = \u0275\u0275nextContext();
    \u0275\u0275advance(10);
    \u0275\u0275twoWayProperty("ngModel", ctx_r2.newProject.name);
    \u0275\u0275advance(4);
    \u0275\u0275twoWayProperty("ngModel", ctx_r2.newProject.description);
    \u0275\u0275advance(4);
    \u0275\u0275twoWayProperty("ngModel", ctx_r2.newProject.sonarKey);
    \u0275\u0275advance(4);
    \u0275\u0275twoWayProperty("ngModel", ctx_r2.newProject.githubRepo);
    \u0275\u0275advance(4);
    \u0275\u0275twoWayProperty("ngModel", ctx_r2.newProject.jenkinsJobName);
    \u0275\u0275advance(4);
    \u0275\u0275property("disabled", !ctx_r2.newProject.name);
  }
}
var ProjectsComponent = class _ProjectsComponent {
  constructor(api, toast) {
    this.api = api;
    this.toast = toast;
    this.projects = [];
    this.loading = false;
    this.showModal = false;
    this.newProject = { name: "", description: "", sonarKey: "", githubRepo: "", jenkinsJobName: "" };
  }
  ngOnInit() {
    this.load();
  }
  load() {
    this.loading = true;
    this.api.getProjects().subscribe({
      next: (p) => {
        this.projects = p;
        this.loading = false;
      },
      error: () => {
        this.toast.error("Erreur", "Impossible de charger les projets");
        this.loading = false;
      }
    });
  }
  createProject() {
    if (!this.newProject.name)
      return;
    this.api.createProject(this.newProject).subscribe({
      next: () => {
        this.toast.success("Projet cr\xE9\xE9", this.newProject.name);
        this.showModal = false;
        this.newProject = { name: "", description: "", sonarKey: "", githubRepo: "", jenkinsJobName: "" };
        this.load();
      },
      error: () => this.toast.error("Erreur", "Impossible de cr\xE9er le projet")
    });
  }
  confirmDelete(p) {
    if (!confirm(`Supprimer le projet "${p.name}" ?`))
      return;
    this.api.deleteProject(p.id).subscribe({
      next: () => {
        this.toast.success("Projet supprim\xE9");
        this.load();
      },
      error: () => this.toast.error("Erreur", "Impossible de supprimer le projet")
    });
  }
  getHealthColor(score) {
    if (score >= 80)
      return "var(--accent-green)";
    if (score >= 60)
      return "var(--accent-orange)";
    return "var(--accent-red)";
  }
  static {
    this.\u0275fac = function ProjectsComponent_Factory(t) {
      return new (t || _ProjectsComponent)(\u0275\u0275directiveInject(ApiService), \u0275\u0275directiveInject(ToastService));
    };
  }
  static {
    this.\u0275cmp = /* @__PURE__ */ \u0275\u0275defineComponent({ type: _ProjectsComponent, selectors: [["app-projects"]], standalone: true, features: [\u0275\u0275StandaloneFeature], decls: 12, vars: 3, consts: [[1, "page-container"], [1, "page-header", 2, "display", "flex", "align-items", "center", "justify-content", "space-between"], [1, "page-title"], [1, "page-subtitle"], [1, "btn", "btn-primary", 3, "click"], ["class", "loading-overlay", 4, "ngIf"], ["class", "projects-grid", 4, "ngIf"], ["class", "modal-overlay", 3, "click", 4, "ngIf"], [1, "loading-overlay"], [1, "spinner"], [1, "projects-grid"], ["class", "empty-state", "style", "grid-column:1/-1;", 4, "ngIf"], ["class", "project-card", 4, "ngFor", "ngForOf"], [1, "empty-state", 2, "grid-column", "1/-1"], [1, "empty-icon"], [1, "empty-title"], [1, "empty-sub"], [1, "project-card"], [1, "project-card-header"], [1, "project-avatar"], [2, "flex", "1", "min-width", "0"], [1, "project-name"], [1, "project-id"], [1, "health-badge"], [1, "project-stats"], [1, "stat"], [1, "stat-val", "red"], [1, "stat-label"], [1, "stat-val", "orange"], [1, "stat-val", "green"], [1, "health-bar-wrap"], [1, "health-bar"], [1, "project-footer"], [2, "font-size", "10px", "color", "var(--text-faint)", "font-family", "var(--font-mono)"], [2, "display", "flex", "gap", "6px"], [1, "btn", "btn-secondary", "btn-sm", 3, "routerLink"], [1, "btn", "btn-danger", "btn-sm", 3, "click"], [1, "modal-overlay", 3, "click"], [1, "modal", 3, "click"], [1, "modal-header"], [1, "card-title"], [1, "btn", "btn-secondary", "btn-sm", 3, "click"], [1, "form-group"], [1, "form-label"], ["placeholder", "ex: PFE-VERMEG", 1, "form-control", 3, "ngModelChange", "ngModel"], ["placeholder", "Description optionnelle", 1, "form-control", 3, "ngModelChange", "ngModel"], ["placeholder", "ex: equipe1-3arctic1-2425", 1, "form-control", 3, "ngModelChange", "ngModel"], ["placeholder", "ex: souhaiel11/pfe-devsecops-2026", 1, "form-control", 3, "ngModelChange", "ngModel"], ["placeholder", "ex: pfe-devsecops-pipeline", 1, "form-control", 3, "ngModelChange", "ngModel"], [2, "display", "flex", "gap", "8px", "justify-content", "flex-end", "margin-top", "20px"], [1, "btn", "btn-secondary", 3, "click"], [1, "btn", "btn-primary", 3, "click", "disabled"]], template: function ProjectsComponent_Template(rf, ctx) {
      if (rf & 1) {
        \u0275\u0275elementStart(0, "div", 0)(1, "div", 1)(2, "div")(3, "h1", 2);
        \u0275\u0275text(4, "// projets");
        \u0275\u0275elementEnd();
        \u0275\u0275elementStart(5, "p", 3);
        \u0275\u0275text(6, "Gestion des projets sous surveillance DevSecOps IA");
        \u0275\u0275elementEnd()();
        \u0275\u0275elementStart(7, "button", 4);
        \u0275\u0275listener("click", function ProjectsComponent_Template_button_click_7_listener() {
          return ctx.showModal = true;
        });
        \u0275\u0275text(8, "+ Nouveau projet");
        \u0275\u0275elementEnd()();
        \u0275\u0275template(9, ProjectsComponent_div_9_Template, 4, 0, "div", 5)(10, ProjectsComponent_div_10_Template, 3, 2, "div", 6)(11, ProjectsComponent_div_11_Template, 32, 6, "div", 7);
        \u0275\u0275elementEnd();
      }
      if (rf & 2) {
        \u0275\u0275advance(9);
        \u0275\u0275property("ngIf", ctx.loading);
        \u0275\u0275advance();
        \u0275\u0275property("ngIf", !ctx.loading);
        \u0275\u0275advance();
        \u0275\u0275property("ngIf", ctx.showModal);
      }
    }, dependencies: [CommonModule, NgForOf, NgIf, DecimalPipe, DatePipe, RouterModule, RouterLink, FormsModule, DefaultValueAccessor, NgControlStatus, NgModel], styles: ["\n\n.projects-grid[_ngcontent-%COMP%] {\n  display: grid;\n  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));\n  gap: 16px;\n}\n.project-card[_ngcontent-%COMP%] {\n  background: var(--bg-secondary);\n  border: 1px solid var(--border);\n  border-radius: var(--radius-lg);\n  padding: 18px;\n  transition: border-color 0.2s;\n}\n.project-card[_ngcontent-%COMP%]:hover {\n  border-color: var(--border-light);\n}\n.project-card-header[_ngcontent-%COMP%] {\n  display: flex;\n  align-items: center;\n  gap: 10px;\n  margin-bottom: 14px;\n}\n.project-avatar[_ngcontent-%COMP%] {\n  width: 36px;\n  height: 36px;\n  border-radius: var(--radius-md);\n  background: var(--bg-tertiary);\n  border: 1px solid;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  font-size: 12px;\n  font-weight: 700;\n  font-family: var(--font-mono);\n  color: var(--text-secondary);\n  flex-shrink: 0;\n}\n.project-name[_ngcontent-%COMP%] {\n  font-size: 13px;\n  font-weight: 600;\n  color: var(--text-primary);\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n.project-id[_ngcontent-%COMP%] {\n  font-size: 10px;\n  color: var(--text-faint);\n  font-family: var(--font-mono);\n}\n.health-badge[_ngcontent-%COMP%] {\n  font-size: 12px;\n  font-weight: 700;\n  padding: 4px 8px;\n  border-radius: var(--radius-sm);\n  font-family: var(--font-mono);\n  flex-shrink: 0;\n}\n.project-stats[_ngcontent-%COMP%] {\n  display: flex;\n  gap: 12px;\n  margin-bottom: 12px;\n}\n.stat[_ngcontent-%COMP%] {\n  text-align: center;\n  flex: 1;\n}\n.stat-val[_ngcontent-%COMP%] {\n  font-size: 20px;\n  font-weight: 700;\n  font-family: var(--font-mono);\n}\n.stat-val.red[_ngcontent-%COMP%] {\n  color: var(--accent-red);\n}\n.stat-val.orange[_ngcontent-%COMP%] {\n  color: var(--accent-orange);\n}\n.stat-val.green[_ngcontent-%COMP%] {\n  color: var(--accent-green);\n}\n.stat-label[_ngcontent-%COMP%] {\n  font-size: 9px;\n  color: var(--text-faint);\n  text-transform: uppercase;\n  letter-spacing: 0.5px;\n}\n.health-bar-wrap[_ngcontent-%COMP%] {\n  margin-bottom: 12px;\n}\n.health-bar[_ngcontent-%COMP%] {\n  height: 3px;\n  background: var(--border);\n  border-radius: 2px;\n  overflow: hidden;\n}\n.health-bar[_ngcontent-%COMP%]   div[_ngcontent-%COMP%] {\n  height: 100%;\n  border-radius: 2px;\n  transition: width 0.8s ease;\n}\n.project-footer[_ngcontent-%COMP%] {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n}\n.modal-overlay[_ngcontent-%COMP%] {\n  position: fixed;\n  inset: 0;\n  background: rgba(0, 0, 0, 0.6);\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  z-index: 500;\n}\n.modal[_ngcontent-%COMP%] {\n  background: var(--bg-secondary);\n  border: 1px solid var(--border);\n  border-radius: var(--radius-lg);\n  padding: 24px;\n  width: 420px;\n}\n.modal-header[_ngcontent-%COMP%] {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  margin-bottom: 20px;\n}\n/*# sourceMappingURL=projects.component.css.map */"] });
  }
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && \u0275setClassDebugInfo(ProjectsComponent, { className: "ProjectsComponent", filePath: "src/app/features/projects/projects.component.ts", lineNumber: 246 });
})();
export {
  ProjectsComponent
};
//# sourceMappingURL=chunk-A2YWDOTL.js.map
