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
} from "./chunk-6BA5PBBI.js";
import "./chunk-NJ4DWT4A.js";
import "./chunk-Y42B5JPZ.js";
import {
  CommonModule,
  DatePipe,
  NgForOf,
  NgIf,
  ɵsetClassDebugInfo,
  ɵɵStandaloneFeature,
  ɵɵadvance,
  ɵɵclassMap,
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
  ɵɵresetView,
  ɵɵrestoreView,
  ɵɵtemplate,
  ɵɵtext,
  ɵɵtextInterpolate,
  ɵɵtextInterpolate1,
  ɵɵtwoWayBindingSet,
  ɵɵtwoWayListener,
  ɵɵtwoWayProperty
} from "./chunk-ZQZUXNDQ.js";

// src/app/features/admin/admin.component.ts
function AdminComponent_div_9_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementStart(0, "div", 8);
    \u0275\u0275element(1, "div", 9);
    \u0275\u0275elementEnd();
  }
}
function AdminComponent_div_10_tr_15_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementStart(0, "tr")(1, "td", 14);
    \u0275\u0275text(2, "Aucun utilisateur");
    \u0275\u0275elementEnd()();
  }
}
function AdminComponent_div_10_tr_16_Template(rf, ctx) {
  if (rf & 1) {
    const _r1 = \u0275\u0275getCurrentView();
    \u0275\u0275elementStart(0, "tr")(1, "td")(2, "div", 15)(3, "div", 16);
    \u0275\u0275text(4);
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(5, "span", 17);
    \u0275\u0275text(6);
    \u0275\u0275elementEnd()()();
    \u0275\u0275elementStart(7, "td");
    \u0275\u0275text(8);
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(9, "td")(10, "span", 18);
    \u0275\u0275text(11);
    \u0275\u0275elementEnd()();
    \u0275\u0275elementStart(12, "td", 19);
    \u0275\u0275text(13);
    \u0275\u0275pipe(14, "date");
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(15, "td")(16, "button", 20);
    \u0275\u0275listener("click", function AdminComponent_div_10_tr_16_Template_button_click_16_listener() {
      const u_r2 = \u0275\u0275restoreView(_r1).$implicit;
      const ctx_r2 = \u0275\u0275nextContext(2);
      return \u0275\u0275resetView(ctx_r2.deleteUser(u_r2));
    });
    \u0275\u0275text(17, " Supprimer ");
    \u0275\u0275elementEnd()()();
  }
  if (rf & 2) {
    const u_r2 = ctx.$implicit;
    \u0275\u0275advance(4);
    \u0275\u0275textInterpolate(u_r2.username == null ? null : u_r2.username.substring(0, 2).toUpperCase());
    \u0275\u0275advance(2);
    \u0275\u0275textInterpolate(u_r2.username);
    \u0275\u0275advance(2);
    \u0275\u0275textInterpolate(u_r2.email);
    \u0275\u0275advance(2);
    \u0275\u0275classMap(u_r2.role === "ADMIN" ? "high" : "info");
    \u0275\u0275advance();
    \u0275\u0275textInterpolate(u_r2.role);
    \u0275\u0275advance(2);
    \u0275\u0275textInterpolate1(" ", \u0275\u0275pipeBind2(14, 8, u_r2.createdAt, "dd/MM/yyyy"), " ");
    \u0275\u0275advance(3);
    \u0275\u0275property("disabled", u_r2.role === "ADMIN");
  }
}
function AdminComponent_div_10_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementStart(0, "div", 10)(1, "table", 11)(2, "thead")(3, "tr")(4, "th");
    \u0275\u0275text(5, "Utilisateur");
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(6, "th");
    \u0275\u0275text(7, "Email");
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(8, "th");
    \u0275\u0275text(9, "R\xF4le");
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(10, "th");
    \u0275\u0275text(11, "Cr\xE9\xE9 le");
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(12, "th");
    \u0275\u0275text(13, "Actions");
    \u0275\u0275elementEnd()()();
    \u0275\u0275elementStart(14, "tbody");
    \u0275\u0275template(15, AdminComponent_div_10_tr_15_Template, 3, 0, "tr", 12)(16, AdminComponent_div_10_tr_16_Template, 18, 11, "tr", 13);
    \u0275\u0275elementEnd()()();
  }
  if (rf & 2) {
    const ctx_r2 = \u0275\u0275nextContext();
    \u0275\u0275advance(15);
    \u0275\u0275property("ngIf", ctx_r2.users.length === 0);
    \u0275\u0275advance();
    \u0275\u0275property("ngForOf", ctx_r2.users);
  }
}
function AdminComponent_div_11_Template(rf, ctx) {
  if (rf & 1) {
    const _r4 = \u0275\u0275getCurrentView();
    \u0275\u0275elementStart(0, "div", 21);
    \u0275\u0275listener("click", function AdminComponent_div_11_Template_div_click_0_listener() {
      \u0275\u0275restoreView(_r4);
      const ctx_r2 = \u0275\u0275nextContext();
      return \u0275\u0275resetView(ctx_r2.showModal = false);
    });
    \u0275\u0275elementStart(1, "div", 22);
    \u0275\u0275listener("click", function AdminComponent_div_11_Template_div_click_1_listener($event) {
      \u0275\u0275restoreView(_r4);
      return \u0275\u0275resetView($event.stopPropagation());
    });
    \u0275\u0275elementStart(2, "div", 23)(3, "span", 24);
    \u0275\u0275text(4, "Nouvel utilisateur");
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(5, "button", 25);
    \u0275\u0275listener("click", function AdminComponent_div_11_Template_button_click_5_listener() {
      \u0275\u0275restoreView(_r4);
      const ctx_r2 = \u0275\u0275nextContext();
      return \u0275\u0275resetView(ctx_r2.showModal = false);
    });
    \u0275\u0275text(6, "\u2715");
    \u0275\u0275elementEnd()();
    \u0275\u0275elementStart(7, "div", 26)(8, "label", 27);
    \u0275\u0275text(9, "Nom d'utilisateur *");
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(10, "input", 28);
    \u0275\u0275twoWayListener("ngModelChange", function AdminComponent_div_11_Template_input_ngModelChange_10_listener($event) {
      \u0275\u0275restoreView(_r4);
      const ctx_r2 = \u0275\u0275nextContext();
      \u0275\u0275twoWayBindingSet(ctx_r2.newUser.username, $event) || (ctx_r2.newUser.username = $event);
      return \u0275\u0275resetView($event);
    });
    \u0275\u0275elementEnd()();
    \u0275\u0275elementStart(11, "div", 26)(12, "label", 27);
    \u0275\u0275text(13, "Email *");
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(14, "input", 29);
    \u0275\u0275twoWayListener("ngModelChange", function AdminComponent_div_11_Template_input_ngModelChange_14_listener($event) {
      \u0275\u0275restoreView(_r4);
      const ctx_r2 = \u0275\u0275nextContext();
      \u0275\u0275twoWayBindingSet(ctx_r2.newUser.email, $event) || (ctx_r2.newUser.email = $event);
      return \u0275\u0275resetView($event);
    });
    \u0275\u0275elementEnd()();
    \u0275\u0275elementStart(15, "div", 26)(16, "label", 27);
    \u0275\u0275text(17, "Mot de passe *");
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(18, "input", 30);
    \u0275\u0275twoWayListener("ngModelChange", function AdminComponent_div_11_Template_input_ngModelChange_18_listener($event) {
      \u0275\u0275restoreView(_r4);
      const ctx_r2 = \u0275\u0275nextContext();
      \u0275\u0275twoWayBindingSet(ctx_r2.newUser.password, $event) || (ctx_r2.newUser.password = $event);
      return \u0275\u0275resetView($event);
    });
    \u0275\u0275elementEnd()();
    \u0275\u0275elementStart(19, "div", 26)(20, "label", 27);
    \u0275\u0275text(21, "R\xF4le");
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(22, "select", 31);
    \u0275\u0275twoWayListener("ngModelChange", function AdminComponent_div_11_Template_select_ngModelChange_22_listener($event) {
      \u0275\u0275restoreView(_r4);
      const ctx_r2 = \u0275\u0275nextContext();
      \u0275\u0275twoWayBindingSet(ctx_r2.newUser.role, $event) || (ctx_r2.newUser.role = $event);
      return \u0275\u0275resetView($event);
    });
    \u0275\u0275elementStart(23, "option", 32);
    \u0275\u0275text(24, "USER");
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(25, "option", 33);
    \u0275\u0275text(26, "ADMIN");
    \u0275\u0275elementEnd()()();
    \u0275\u0275elementStart(27, "div", 34)(28, "button", 35);
    \u0275\u0275listener("click", function AdminComponent_div_11_Template_button_click_28_listener() {
      \u0275\u0275restoreView(_r4);
      const ctx_r2 = \u0275\u0275nextContext();
      return \u0275\u0275resetView(ctx_r2.showModal = false);
    });
    \u0275\u0275text(29, "Annuler");
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(30, "button", 36);
    \u0275\u0275listener("click", function AdminComponent_div_11_Template_button_click_30_listener() {
      \u0275\u0275restoreView(_r4);
      const ctx_r2 = \u0275\u0275nextContext();
      return \u0275\u0275resetView(ctx_r2.createUser());
    });
    \u0275\u0275text(31, " Cr\xE9er ");
    \u0275\u0275elementEnd()()()();
  }
  if (rf & 2) {
    const ctx_r2 = \u0275\u0275nextContext();
    \u0275\u0275advance(10);
    \u0275\u0275twoWayProperty("ngModel", ctx_r2.newUser.username);
    \u0275\u0275advance(4);
    \u0275\u0275twoWayProperty("ngModel", ctx_r2.newUser.email);
    \u0275\u0275advance(4);
    \u0275\u0275twoWayProperty("ngModel", ctx_r2.newUser.password);
    \u0275\u0275advance(4);
    \u0275\u0275twoWayProperty("ngModel", ctx_r2.newUser.role);
    \u0275\u0275advance(8);
    \u0275\u0275property("disabled", !ctx_r2.newUser.username || !ctx_r2.newUser.email || !ctx_r2.newUser.password);
  }
}
var AdminComponent = class _AdminComponent {
  constructor(api, toast) {
    this.api = api;
    this.toast = toast;
    this.users = [];
    this.loading = false;
    this.showModal = false;
    this.newUser = { username: "", email: "", password: "", role: "USER" };
  }
  ngOnInit() {
    this.load();
  }
  load() {
    this.loading = true;
    this.api.getUsers().subscribe({
      next: (u) => {
        this.users = u;
        this.loading = false;
      },
      error: () => {
        this.loading = false;
      }
    });
  }
  createUser() {
    this.api.createUser(this.newUser).subscribe({
      next: () => {
        this.toast.success("Utilisateur cr\xE9\xE9", this.newUser.username);
        this.showModal = false;
        this.newUser = { username: "", email: "", password: "", role: "USER" };
        this.load();
      },
      error: () => this.toast.error("Erreur", "Impossible de cr\xE9er l'utilisateur")
    });
  }
  deleteUser(u) {
    if (!confirm(`Supprimer l'utilisateur "${u.username}" ?`))
      return;
    this.api.deleteUser(u.id).subscribe({
      next: () => {
        this.toast.success("Utilisateur supprim\xE9");
        this.load();
      },
      error: () => this.toast.error("Erreur", "Impossible de supprimer l'utilisateur")
    });
  }
  static {
    this.\u0275fac = function AdminComponent_Factory(t) {
      return new (t || _AdminComponent)(\u0275\u0275directiveInject(ApiService), \u0275\u0275directiveInject(ToastService));
    };
  }
  static {
    this.\u0275cmp = /* @__PURE__ */ \u0275\u0275defineComponent({ type: _AdminComponent, selectors: [["app-admin"]], standalone: true, features: [\u0275\u0275StandaloneFeature], decls: 12, vars: 3, consts: [[1, "page-container"], [1, "page-header", 2, "display", "flex", "align-items", "center", "justify-content", "space-between"], [1, "page-title"], [1, "page-subtitle"], [1, "btn", "btn-primary", 3, "click"], ["class", "loading-overlay", 4, "ngIf"], ["class", "card", "style", "padding:0;overflow:hidden;", 4, "ngIf"], ["class", "modal-overlay", 3, "click", 4, "ngIf"], [1, "loading-overlay"], [1, "spinner"], [1, "card", 2, "padding", "0", "overflow", "hidden"], [1, "data-table"], [4, "ngIf"], [4, "ngFor", "ngForOf"], ["colspan", "5", 2, "text-align", "center", "padding", "40px", "color", "var(--text-faint)"], [2, "display", "flex", "align-items", "center", "gap", "8px"], [1, "user-av"], [2, "font-weight", "500", "color", "var(--text-primary)"], [1, "badge"], [2, "font-family", "var(--font-mono)", "font-size", "11px"], [1, "btn", "btn-danger", "btn-sm", 3, "click", "disabled"], [1, "modal-overlay", 3, "click"], [1, "modal", 3, "click"], [1, "modal-header"], [1, "card-title"], [1, "btn", "btn-secondary", "btn-sm", 3, "click"], [1, "form-group"], [1, "form-label"], ["placeholder", "username", 1, "form-control", 3, "ngModelChange", "ngModel"], ["type", "email", "placeholder", "user@vermeg.com", 1, "form-control", 3, "ngModelChange", "ngModel"], ["type", "password", "placeholder", "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022", 1, "form-control", 3, "ngModelChange", "ngModel"], [1, "form-control", 3, "ngModelChange", "ngModel"], ["value", "USER"], ["value", "ADMIN"], [2, "display", "flex", "gap", "8px", "justify-content", "flex-end", "margin-top", "20px"], [1, "btn", "btn-secondary", 3, "click"], [1, "btn", "btn-primary", 3, "click", "disabled"]], template: function AdminComponent_Template(rf, ctx) {
      if (rf & 1) {
        \u0275\u0275elementStart(0, "div", 0)(1, "div", 1)(2, "div")(3, "h1", 2);
        \u0275\u0275text(4, "// administration");
        \u0275\u0275elementEnd();
        \u0275\u0275elementStart(5, "p", 3);
        \u0275\u0275text(6, "Gestion des utilisateurs de la plateforme");
        \u0275\u0275elementEnd()();
        \u0275\u0275elementStart(7, "button", 4);
        \u0275\u0275listener("click", function AdminComponent_Template_button_click_7_listener() {
          return ctx.showModal = true;
        });
        \u0275\u0275text(8, "+ Nouvel utilisateur");
        \u0275\u0275elementEnd()();
        \u0275\u0275template(9, AdminComponent_div_9_Template, 2, 0, "div", 5)(10, AdminComponent_div_10_Template, 17, 2, "div", 6)(11, AdminComponent_div_11_Template, 32, 5, "div", 7);
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
    }, dependencies: [CommonModule, NgForOf, NgIf, DatePipe, FormsModule, NgSelectOption, \u0275NgSelectMultipleOption, DefaultValueAccessor, SelectControlValueAccessor, NgControlStatus, NgModel], styles: ["\n\n.user-av[_ngcontent-%COMP%] {\n  width: 30px;\n  height: 30px;\n  border-radius: 50%;\n  background: var(--accent-blue-bg);\n  border: 1px solid var(--accent-blue);\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  font-size: 10px;\n  font-weight: 700;\n  color: var(--accent-blue);\n  font-family: var(--font-mono);\n}\n.modal-overlay[_ngcontent-%COMP%] {\n  position: fixed;\n  inset: 0;\n  background: rgba(0, 0, 0, 0.6);\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  z-index: 500;\n}\n.modal[_ngcontent-%COMP%] {\n  background: var(--bg-secondary);\n  border: 1px solid var(--border);\n  border-radius: var(--radius-lg);\n  padding: 24px;\n  width: 400px;\n}\n.modal-header[_ngcontent-%COMP%] {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  margin-bottom: 20px;\n}\n/*# sourceMappingURL=admin.component.css.map */"] });
  }
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && \u0275setClassDebugInfo(AdminComponent, { className: "AdminComponent", filePath: "src/app/features/admin/admin.component.ts", lineNumber: 141 });
})();
export {
  AdminComponent
};
//# sourceMappingURL=chunk-E4J5SHQG.js.map
