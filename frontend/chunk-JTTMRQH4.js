import {
  DefaultValueAccessor,
  FormsModule,
  NgControlStatus,
  NgModel,
  NgSelectOption,
  SelectControlValueAccessor,
  ɵNgSelectMultipleOption
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
  NgForOf,
  NgIf,
  __spreadProps,
  __spreadValues,
  ɵsetClassDebugInfo,
  ɵɵStandaloneFeature,
  ɵɵadvance,
  ɵɵclassMapInterpolate1,
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
  ɵɵtemplate,
  ɵɵtext,
  ɵɵtextInterpolate,
  ɵɵtextInterpolate1,
  ɵɵtextInterpolate3,
  ɵɵtwoWayBindingSet,
  ɵɵtwoWayListener,
  ɵɵtwoWayProperty
} from "./chunk-ZQZUXNDQ.js";

// src/app/features/incidents/incidents.component.ts
var _c0 = (a0) => ["/incidents", a0];
function IncidentsComponent_div_53_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementStart(0, "div", 31);
    \u0275\u0275element(1, "div", 32);
    \u0275\u0275elementStart(2, "span");
    \u0275\u0275text(3, "Chargement...");
    \u0275\u0275elementEnd()();
  }
}
function IncidentsComponent_table_54_tr_18_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementStart(0, "tr")(1, "td", 36);
    \u0275\u0275text(2, " Aucun incident trouv\xE9 ");
    \u0275\u0275elementEnd()();
  }
}
function IncidentsComponent_table_54_tr_19_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementStart(0, "tr")(1, "td")(2, "span", 37);
    \u0275\u0275text(3);
    \u0275\u0275elementEnd()();
    \u0275\u0275elementStart(4, "td", 38);
    \u0275\u0275text(5);
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(6, "td")(7, "span", 39);
    \u0275\u0275text(8);
    \u0275\u0275elementEnd()();
    \u0275\u0275elementStart(9, "td")(10, "span");
    \u0275\u0275text(11);
    \u0275\u0275elementEnd()();
    \u0275\u0275elementStart(12, "td")(13, "span");
    \u0275\u0275text(14);
    \u0275\u0275elementEnd()();
    \u0275\u0275elementStart(15, "td", 40);
    \u0275\u0275text(16);
    \u0275\u0275pipe(17, "date");
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(18, "td")(19, "a", 41);
    \u0275\u0275text(20, " Voir \u2192 ");
    \u0275\u0275elementEnd()()();
  }
  if (rf & 2) {
    const inc_r1 = ctx.$implicit;
    \u0275\u0275advance(3);
    \u0275\u0275textInterpolate1(" ", inc_r1.incidentId == null ? null : inc_r1.incidentId.substring(0, 24), "... ");
    \u0275\u0275advance(2);
    \u0275\u0275textInterpolate1(" ", inc_r1.title || "Incident " + inc_r1.sourceType, " ");
    \u0275\u0275advance(3);
    \u0275\u0275textInterpolate(inc_r1.sourceType);
    \u0275\u0275advance(2);
    \u0275\u0275classMapInterpolate1("badge ", inc_r1.severity == null ? null : inc_r1.severity.toLowerCase(), "");
    \u0275\u0275advance();
    \u0275\u0275textInterpolate(inc_r1.severity);
    \u0275\u0275advance(2);
    \u0275\u0275classMapInterpolate1("badge ", inc_r1.status == null ? null : inc_r1.status.toLowerCase(), "");
    \u0275\u0275advance();
    \u0275\u0275textInterpolate(inc_r1.status);
    \u0275\u0275advance(2);
    \u0275\u0275textInterpolate1(" ", \u0275\u0275pipeBind2(17, 13, inc_r1.createdAt, "dd/MM/yy HH:mm"), " ");
    \u0275\u0275advance(3);
    \u0275\u0275property("routerLink", \u0275\u0275pureFunction1(16, _c0, inc_r1.id));
  }
}
function IncidentsComponent_table_54_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementStart(0, "table", 33)(1, "thead")(2, "tr")(3, "th");
    \u0275\u0275text(4, "Incident ID");
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(5, "th");
    \u0275\u0275text(6, "Titre");
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(7, "th");
    \u0275\u0275text(8, "Source");
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(9, "th");
    \u0275\u0275text(10, "S\xE9v\xE9rit\xE9");
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(11, "th");
    \u0275\u0275text(12, "Statut");
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(13, "th");
    \u0275\u0275text(14, "Cr\xE9\xE9 le");
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(15, "th");
    \u0275\u0275text(16, "Actions");
    \u0275\u0275elementEnd()()();
    \u0275\u0275elementStart(17, "tbody");
    \u0275\u0275template(18, IncidentsComponent_table_54_tr_18_Template, 3, 0, "tr", 34)(19, IncidentsComponent_table_54_tr_19_Template, 21, 18, "tr", 35);
    \u0275\u0275elementEnd()();
  }
  if (rf & 2) {
    const ctx_r1 = \u0275\u0275nextContext();
    \u0275\u0275advance(18);
    \u0275\u0275property("ngIf", ctx_r1.incidents.length === 0);
    \u0275\u0275advance();
    \u0275\u0275property("ngForOf", ctx_r1.incidents);
  }
}
function IncidentsComponent_div_55_Template(rf, ctx) {
  if (rf & 1) {
    const _r3 = \u0275\u0275getCurrentView();
    \u0275\u0275elementStart(0, "div", 42)(1, "span", 43);
    \u0275\u0275text(2);
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(3, "div", 44)(4, "button", 45);
    \u0275\u0275listener("click", function IncidentsComponent_div_55_Template_button_click_4_listener() {
      \u0275\u0275restoreView(_r3);
      const ctx_r1 = \u0275\u0275nextContext();
      return \u0275\u0275resetView(ctx_r1.prevPage());
    });
    \u0275\u0275text(5, "\u2190 Pr\xE9c.");
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(6, "button", 45);
    \u0275\u0275listener("click", function IncidentsComponent_div_55_Template_button_click_6_listener() {
      \u0275\u0275restoreView(_r3);
      const ctx_r1 = \u0275\u0275nextContext();
      return \u0275\u0275resetView(ctx_r1.nextPage());
    });
    \u0275\u0275text(7, "Suiv. \u2192");
    \u0275\u0275elementEnd()()();
  }
  if (rf & 2) {
    const ctx_r1 = \u0275\u0275nextContext();
    \u0275\u0275advance(2);
    \u0275\u0275textInterpolate3(" Page ", ctx_r1.page + 1, " / ", ctx_r1.totalPages, " \u2014 ", ctx_r1.total, " r\xE9sultats ");
    \u0275\u0275advance(2);
    \u0275\u0275property("disabled", ctx_r1.page === 0);
    \u0275\u0275advance(2);
    \u0275\u0275property("disabled", ctx_r1.page >= ctx_r1.totalPages - 1);
  }
}
var IncidentsComponent = class _IncidentsComponent {
  constructor(api, toast) {
    this.api = api;
    this.toast = toast;
    this.incidents = [];
    this.loading = false;
    this.total = 0;
    this.page = 0;
    this.size = 15;
    this.totalPages = 0;
    this.filters = { severity: "", status: "", source: "", search: "" };
  }
  ngOnInit() {
    this.load();
  }
  load() {
    this.loading = true;
    const params = __spreadProps(__spreadValues({}, this.filters), {
      page: this.page,
      size: this.size
    });
    this.api.getIncidents(params).subscribe({
      next: (res) => {
        this.incidents = res.content || res;
        this.total = res.totalElements || this.incidents.length;
        this.totalPages = res.totalPages || 1;
        this.loading = false;
      },
      error: () => {
        this.toast.error("Erreur", "Impossible de charger les incidents");
        this.loading = false;
      }
    });
  }
  onSearch() {
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.load(), 400);
  }
  resetFilters() {
    this.filters = { severity: "", status: "", source: "", search: "" };
    this.page = 0;
    this.load();
  }
  prevPage() {
    if (this.page > 0) {
      this.page--;
      this.load();
    }
  }
  nextPage() {
    if (this.page < this.totalPages - 1) {
      this.page++;
      this.load();
    }
  }
  static {
    this.\u0275fac = function IncidentsComponent_Factory(t) {
      return new (t || _IncidentsComponent)(\u0275\u0275directiveInject(ApiService), \u0275\u0275directiveInject(ToastService));
    };
  }
  static {
    this.\u0275cmp = /* @__PURE__ */ \u0275\u0275defineComponent({ type: _IncidentsComponent, selectors: [["app-incidents"]], standalone: true, features: [\u0275\u0275StandaloneFeature], decls: 56, vars: 8, consts: [[1, "page-container"], [1, "page-header", 2, "display", "flex", "align-items", "center", "justify-content", "space-between"], [1, "page-title"], [1, "page-subtitle"], [1, "live-indicator"], [1, "live-dot"], [1, "card", 2, "margin-bottom", "16px", "padding", "14px 20px"], [2, "display", "flex", "gap", "12px", "flex-wrap", "wrap", "align-items", "center"], [1, "form-control", 2, "width", "140px", 3, "ngModelChange", "change", "ngModel"], ["value", ""], ["value", "CRITICAL"], ["value", "HIGH"], ["value", "MEDIUM"], ["value", "LOW"], [1, "form-control", 2, "width", "180px", 3, "ngModelChange", "change", "ngModel"], ["value", "OPEN"], ["value", "ANALYZING"], ["value", "CORRECTION_PROPOSED"], ["value", "CORRECTION_APPLIED"], ["value", "RESOLVED"], ["value", "CLOSED"], ["value", "JENKINS"], ["value", "SONARQUBE"], ["value", "DOCKER"], ["value", "GITHUB"], ["placeholder", "Rechercher...", 1, "form-control", 2, "flex", "1", "min-width", "160px", 3, "ngModelChange", "input", "ngModel"], [1, "btn", "btn-secondary", "btn-sm", 3, "click"], [1, "card", 2, "padding", "0", "overflow", "hidden"], ["class", "loading-overlay", 4, "ngIf"], ["class", "data-table", 4, "ngIf"], ["style", "display:flex;align-items:center;justify-content:space-between;margin-top:12px;", 4, "ngIf"], [1, "loading-overlay"], [1, "spinner"], [1, "data-table"], [4, "ngIf"], [4, "ngFor", "ngForOf"], ["colspan", "7", 2, "text-align", "center", "padding", "40px", "color", "var(--text-faint)"], [2, "font-family", "var(--font-mono)", "font-size", "11px", "color", "var(--accent-blue)"], [2, "max-width", "220px", "overflow", "hidden", "text-overflow", "ellipsis", "white-space", "nowrap"], [1, "source-tag"], [2, "font-family", "var(--font-mono)", "font-size", "11px"], [1, "btn", "btn-secondary", "btn-sm", 3, "routerLink"], [2, "display", "flex", "align-items", "center", "justify-content", "space-between", "margin-top", "12px"], [2, "font-size", "11px", "color", "var(--text-muted)"], [2, "display", "flex", "gap", "6px"], [1, "btn", "btn-secondary", "btn-sm", 3, "click", "disabled"]], template: function IncidentsComponent_Template(rf, ctx) {
      if (rf & 1) {
        \u0275\u0275elementStart(0, "div", 0)(1, "div", 1)(2, "div")(3, "h1", 2);
        \u0275\u0275text(4, "// incidents");
        \u0275\u0275elementEnd();
        \u0275\u0275elementStart(5, "p", 3);
        \u0275\u0275text(6, "Gestion et suivi des incidents d\xE9tect\xE9s par la plateforme IA");
        \u0275\u0275elementEnd()();
        \u0275\u0275elementStart(7, "div", 4);
        \u0275\u0275element(8, "div", 5);
        \u0275\u0275text(9);
        \u0275\u0275elementEnd()();
        \u0275\u0275elementStart(10, "div", 6)(11, "div", 7)(12, "select", 8);
        \u0275\u0275twoWayListener("ngModelChange", function IncidentsComponent_Template_select_ngModelChange_12_listener($event) {
          \u0275\u0275twoWayBindingSet(ctx.filters.severity, $event) || (ctx.filters.severity = $event);
          return $event;
        });
        \u0275\u0275listener("change", function IncidentsComponent_Template_select_change_12_listener() {
          return ctx.load();
        });
        \u0275\u0275elementStart(13, "option", 9);
        \u0275\u0275text(14, "Toutes s\xE9v\xE9rit\xE9s");
        \u0275\u0275elementEnd();
        \u0275\u0275elementStart(15, "option", 10);
        \u0275\u0275text(16, "CRITICAL");
        \u0275\u0275elementEnd();
        \u0275\u0275elementStart(17, "option", 11);
        \u0275\u0275text(18, "HIGH");
        \u0275\u0275elementEnd();
        \u0275\u0275elementStart(19, "option", 12);
        \u0275\u0275text(20, "MEDIUM");
        \u0275\u0275elementEnd();
        \u0275\u0275elementStart(21, "option", 13);
        \u0275\u0275text(22, "LOW");
        \u0275\u0275elementEnd()();
        \u0275\u0275elementStart(23, "select", 14);
        \u0275\u0275twoWayListener("ngModelChange", function IncidentsComponent_Template_select_ngModelChange_23_listener($event) {
          \u0275\u0275twoWayBindingSet(ctx.filters.status, $event) || (ctx.filters.status = $event);
          return $event;
        });
        \u0275\u0275listener("change", function IncidentsComponent_Template_select_change_23_listener() {
          return ctx.load();
        });
        \u0275\u0275elementStart(24, "option", 9);
        \u0275\u0275text(25, "Tous statuts");
        \u0275\u0275elementEnd();
        \u0275\u0275elementStart(26, "option", 15);
        \u0275\u0275text(27, "OPEN");
        \u0275\u0275elementEnd();
        \u0275\u0275elementStart(28, "option", 16);
        \u0275\u0275text(29, "ANALYZING");
        \u0275\u0275elementEnd();
        \u0275\u0275elementStart(30, "option", 17);
        \u0275\u0275text(31, "CORRECTION_PROPOSED");
        \u0275\u0275elementEnd();
        \u0275\u0275elementStart(32, "option", 18);
        \u0275\u0275text(33, "CORRECTION_APPLIED");
        \u0275\u0275elementEnd();
        \u0275\u0275elementStart(34, "option", 19);
        \u0275\u0275text(35, "RESOLVED");
        \u0275\u0275elementEnd();
        \u0275\u0275elementStart(36, "option", 20);
        \u0275\u0275text(37, "CLOSED");
        \u0275\u0275elementEnd()();
        \u0275\u0275elementStart(38, "select", 8);
        \u0275\u0275twoWayListener("ngModelChange", function IncidentsComponent_Template_select_ngModelChange_38_listener($event) {
          \u0275\u0275twoWayBindingSet(ctx.filters.source, $event) || (ctx.filters.source = $event);
          return $event;
        });
        \u0275\u0275listener("change", function IncidentsComponent_Template_select_change_38_listener() {
          return ctx.load();
        });
        \u0275\u0275elementStart(39, "option", 9);
        \u0275\u0275text(40, "Toutes sources");
        \u0275\u0275elementEnd();
        \u0275\u0275elementStart(41, "option", 21);
        \u0275\u0275text(42, "JENKINS");
        \u0275\u0275elementEnd();
        \u0275\u0275elementStart(43, "option", 22);
        \u0275\u0275text(44, "SONARQUBE");
        \u0275\u0275elementEnd();
        \u0275\u0275elementStart(45, "option", 23);
        \u0275\u0275text(46, "DOCKER");
        \u0275\u0275elementEnd();
        \u0275\u0275elementStart(47, "option", 24);
        \u0275\u0275text(48, "GITHUB");
        \u0275\u0275elementEnd()();
        \u0275\u0275elementStart(49, "input", 25);
        \u0275\u0275twoWayListener("ngModelChange", function IncidentsComponent_Template_input_ngModelChange_49_listener($event) {
          \u0275\u0275twoWayBindingSet(ctx.filters.search, $event) || (ctx.filters.search = $event);
          return $event;
        });
        \u0275\u0275listener("input", function IncidentsComponent_Template_input_input_49_listener() {
          return ctx.onSearch();
        });
        \u0275\u0275elementEnd();
        \u0275\u0275elementStart(50, "button", 26);
        \u0275\u0275listener("click", function IncidentsComponent_Template_button_click_50_listener() {
          return ctx.resetFilters();
        });
        \u0275\u0275text(51, "\u21BA Reset");
        \u0275\u0275elementEnd()()();
        \u0275\u0275elementStart(52, "div", 27);
        \u0275\u0275template(53, IncidentsComponent_div_53_Template, 4, 0, "div", 28)(54, IncidentsComponent_table_54_Template, 20, 2, "table", 29);
        \u0275\u0275elementEnd();
        \u0275\u0275template(55, IncidentsComponent_div_55_Template, 8, 5, "div", 30);
        \u0275\u0275elementEnd();
      }
      if (rf & 2) {
        \u0275\u0275advance(9);
        \u0275\u0275textInterpolate1(" ", ctx.total, " incidents ");
        \u0275\u0275advance(3);
        \u0275\u0275twoWayProperty("ngModel", ctx.filters.severity);
        \u0275\u0275advance(11);
        \u0275\u0275twoWayProperty("ngModel", ctx.filters.status);
        \u0275\u0275advance(15);
        \u0275\u0275twoWayProperty("ngModel", ctx.filters.source);
        \u0275\u0275advance(11);
        \u0275\u0275twoWayProperty("ngModel", ctx.filters.search);
        \u0275\u0275advance(4);
        \u0275\u0275property("ngIf", ctx.loading);
        \u0275\u0275advance();
        \u0275\u0275property("ngIf", !ctx.loading);
        \u0275\u0275advance();
        \u0275\u0275property("ngIf", ctx.totalPages > 1);
      }
    }, dependencies: [CommonModule, NgForOf, NgIf, DatePipe, RouterModule, RouterLink, FormsModule, NgSelectOption, \u0275NgSelectMultipleOption, DefaultValueAccessor, SelectControlValueAccessor, NgControlStatus, NgModel], styles: ["\n\n.source-tag[_ngcontent-%COMP%] {\n  font-size: 10px;\n  font-family: var(--font-mono);\n  color: var(--text-muted);\n  background: var(--bg-tertiary);\n  border: 1px solid var(--border);\n  padding: 2px 7px;\n  border-radius: var(--radius-sm);\n}\n/*# sourceMappingURL=incidents.component.css.map */"] });
  }
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && \u0275setClassDebugInfo(IncidentsComponent, { className: "IncidentsComponent", filePath: "src/app/features/incidents/incidents.component.ts", lineNumber: 130 });
})();
export {
  IncidentsComponent
};
//# sourceMappingURL=chunk-JTTMRQH4.js.map
