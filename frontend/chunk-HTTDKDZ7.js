import {
  AuthService
} from "./chunk-PZDRYTLS.js";
import {
  DefaultValueAccessor,
  FormsModule,
  NgControlStatus,
  NgModel
} from "./chunk-H2D3GIUD.js";
import {
  ToastService
} from "./chunk-RAVY26A2.js";
import "./chunk-R3YGZVM2.js";
import {
  Router
} from "./chunk-CX7S5RF6.js";
import "./chunk-Y42B5JPZ.js";
import {
  CommonModule,
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
  ɵɵlistener,
  ɵɵnextContext,
  ɵɵproperty,
  ɵɵtemplate,
  ɵɵtext,
  ɵɵtextInterpolate,
  ɵɵtwoWayBindingSet,
  ɵɵtwoWayListener,
  ɵɵtwoWayProperty
} from "./chunk-ZQZUXNDQ.js";

// src/app/features/auth/login.component.ts
function LoginComponent_div_10_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementStart(0, "div", 22)(1, "span", 23);
    \u0275\u0275text(2);
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(3, "div")(4, "div", 24);
    \u0275\u0275text(5);
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(6, "div", 25);
    \u0275\u0275text(7);
    \u0275\u0275elementEnd()()();
  }
  if (rf & 2) {
    const f_r1 = ctx.$implicit;
    \u0275\u0275advance(2);
    \u0275\u0275textInterpolate(f_r1.icon);
    \u0275\u0275advance(3);
    \u0275\u0275textInterpolate(f_r1.title);
    \u0275\u0275advance(2);
    \u0275\u0275textInterpolate(f_r1.desc);
  }
}
function LoginComponent_span_29_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275element(0, "span", 26);
  }
}
function LoginComponent_span_30_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementStart(0, "span");
    \u0275\u0275text(1, "Se connecter \u2192");
    \u0275\u0275elementEnd();
  }
}
function LoginComponent_div_31_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementStart(0, "div", 27);
    \u0275\u0275text(1);
    \u0275\u0275elementEnd();
  }
  if (rf & 2) {
    const ctx_r1 = \u0275\u0275nextContext();
    \u0275\u0275advance();
    \u0275\u0275textInterpolate(ctx_r1.error);
  }
}
var LoginComponent = class _LoginComponent {
  constructor(auth, router, toast) {
    this.auth = auth;
    this.router = router;
    this.toast = toast;
    this.email = "";
    this.password = "";
    this.loading = false;
    this.error = "";
    this.features = [
      { icon: "\u25C8", title: "Analyse IA automatique", desc: "4 agents sp\xE9cialis\xE9s analysent chaque incident en parall\xE8le" },
      { icon: "\u2B21", title: "D\xE9tection s\xE9curit\xE9", desc: "Trivy + SonarQube int\xE9gr\xE9s dans le pipeline CI/CD" },
      { icon: "\u25C6", title: "Corrections automatiques", desc: "Pull Requests GitHub cr\xE9\xE9es automatiquement par l'IA" },
      { icon: "\u25C9", title: "Monitoring temps r\xE9el", desc: "Dashboard live avec WebSocket et alertes instantan\xE9es" }
    ];
  }
  login() {
    if (!this.email || !this.password) {
      this.error = "Veuillez remplir tous les champs.";
      return;
    }
    this.loading = true;
    this.error = "";
    this.auth.login(this.email, this.password).subscribe({
      next: () => {
        this.toast.success("Connexion r\xE9ussie", `Bienvenue !`);
        this.router.navigate(["/dashboard"]);
      },
      error: (err) => {
        this.loading = false;
        this.error = err.status === 401 ? "Email ou mot de passe incorrect." : "Erreur de connexion au serveur.";
      }
    });
  }
  static {
    this.\u0275fac = function LoginComponent_Factory(t) {
      return new (t || _LoginComponent)(\u0275\u0275directiveInject(AuthService), \u0275\u0275directiveInject(Router), \u0275\u0275directiveInject(ToastService));
    };
  }
  static {
    this.\u0275cmp = /* @__PURE__ */ \u0275\u0275defineComponent({ type: _LoginComponent, selectors: [["app-login"]], standalone: true, features: [\u0275\u0275StandaloneFeature], decls: 32, vars: 7, consts: [[1, "login-shell"], [1, "login-left"], [1, "brand"], [1, "brand-icon"], [1, "brand-name"], [1, "brand-sub"], [1, "feature-list"], ["class", "feature", 4, "ngFor", "ngForOf"], [1, "brand-footer"], [1, "login-right"], [1, "login-card"], [1, "login-header"], [1, "login-title"], [1, "login-sub"], [1, "form-group"], [1, "form-label"], ["placeholder", "admin@devsecops.local", 1, "form-control", 3, "ngModelChange", "keydown.enter", "ngModel"], ["type", "password", "placeholder", "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022", 1, "form-control", 3, "ngModelChange", "keydown.enter", "ngModel"], [1, "btn", "btn-primary", 2, "width", "100%", "justify-content", "center", "padding", "10px", 3, "click", "disabled"], ["class", "spinner", "style", "width:14px;height:14px;border-width:1.5px;", 4, "ngIf"], [4, "ngIf"], ["class", "login-error", 4, "ngIf"], [1, "feature"], [1, "feature-icon"], [1, "feature-title"], [1, "feature-desc"], [1, "spinner", 2, "width", "14px", "height", "14px", "border-width", "1.5px"], [1, "login-error"]], template: function LoginComponent_Template(rf, ctx) {
      if (rf & 1) {
        \u0275\u0275elementStart(0, "div", 0)(1, "div", 1)(2, "div", 2)(3, "div", 3);
        \u0275\u0275text(4, "\u2B21");
        \u0275\u0275elementEnd();
        \u0275\u0275elementStart(5, "div", 4);
        \u0275\u0275text(6, "DevSecOps IA");
        \u0275\u0275elementEnd();
        \u0275\u0275elementStart(7, "div", 5);
        \u0275\u0275text(8, "Plateforme d'orchestration intelligente");
        \u0275\u0275elementEnd()();
        \u0275\u0275elementStart(9, "div", 6);
        \u0275\u0275template(10, LoginComponent_div_10_Template, 8, 3, "div", 7);
        \u0275\u0275elementEnd();
        \u0275\u0275elementStart(11, "div", 8);
        \u0275\u0275text(12, "Vermeg \xB7 ESPRIT \xB7 2024\u20132025");
        \u0275\u0275elementEnd()();
        \u0275\u0275elementStart(13, "div", 9)(14, "div", 10)(15, "div", 11)(16, "div", 12);
        \u0275\u0275text(17, "Connexion");
        \u0275\u0275elementEnd();
        \u0275\u0275elementStart(18, "div", 13);
        \u0275\u0275text(19, "Acc\xE9dez \xE0 la plateforme DevSecOps");
        \u0275\u0275elementEnd()();
        \u0275\u0275elementStart(20, "div", 14)(21, "label", 15);
        \u0275\u0275text(22, "Email");
        \u0275\u0275elementEnd();
        \u0275\u0275elementStart(23, "input", 16);
        \u0275\u0275twoWayListener("ngModelChange", function LoginComponent_Template_input_ngModelChange_23_listener($event) {
          \u0275\u0275twoWayBindingSet(ctx.email, $event) || (ctx.email = $event);
          return $event;
        });
        \u0275\u0275listener("keydown.enter", function LoginComponent_Template_input_keydown_enter_23_listener() {
          return ctx.login();
        });
        \u0275\u0275elementEnd()();
        \u0275\u0275elementStart(24, "div", 14)(25, "label", 15);
        \u0275\u0275text(26, "Mot de passe");
        \u0275\u0275elementEnd();
        \u0275\u0275elementStart(27, "input", 17);
        \u0275\u0275twoWayListener("ngModelChange", function LoginComponent_Template_input_ngModelChange_27_listener($event) {
          \u0275\u0275twoWayBindingSet(ctx.password, $event) || (ctx.password = $event);
          return $event;
        });
        \u0275\u0275listener("keydown.enter", function LoginComponent_Template_input_keydown_enter_27_listener() {
          return ctx.login();
        });
        \u0275\u0275elementEnd()();
        \u0275\u0275elementStart(28, "button", 18);
        \u0275\u0275listener("click", function LoginComponent_Template_button_click_28_listener() {
          return ctx.login();
        });
        \u0275\u0275template(29, LoginComponent_span_29_Template, 1, 0, "span", 19)(30, LoginComponent_span_30_Template, 2, 0, "span", 20);
        \u0275\u0275elementEnd();
        \u0275\u0275template(31, LoginComponent_div_31_Template, 2, 1, "div", 21);
        \u0275\u0275elementEnd()()();
      }
      if (rf & 2) {
        \u0275\u0275advance(10);
        \u0275\u0275property("ngForOf", ctx.features);
        \u0275\u0275advance(13);
        \u0275\u0275twoWayProperty("ngModel", ctx.email);
        \u0275\u0275advance(4);
        \u0275\u0275twoWayProperty("ngModel", ctx.password);
        \u0275\u0275advance();
        \u0275\u0275property("disabled", ctx.loading);
        \u0275\u0275advance();
        \u0275\u0275property("ngIf", ctx.loading);
        \u0275\u0275advance();
        \u0275\u0275property("ngIf", !ctx.loading);
        \u0275\u0275advance();
        \u0275\u0275property("ngIf", ctx.error);
      }
    }, dependencies: [CommonModule, NgForOf, NgIf, FormsModule, DefaultValueAccessor, NgControlStatus, NgModel], styles: ["\n\n.login-shell[_ngcontent-%COMP%] {\n  display: flex;\n  height: 100vh;\n  background: var(--bg-primary);\n}\n.login-left[_ngcontent-%COMP%] {\n  width: 420px;\n  background: var(--bg-secondary);\n  border-right: 1px solid var(--border);\n  padding: 48px 40px;\n  display: flex;\n  flex-direction: column;\n}\n.brand[_ngcontent-%COMP%] {\n  margin-bottom: 48px;\n}\n.brand-icon[_ngcontent-%COMP%] {\n  font-size: 36px;\n  color: var(--accent-blue);\n  margin-bottom: 12px;\n}\n.brand-name[_ngcontent-%COMP%] {\n  font-size: 22px;\n  font-weight: 700;\n  color: var(--text-primary);\n  font-family: var(--font-mono);\n  letter-spacing: 2px;\n  text-transform: uppercase;\n}\n.brand-sub[_ngcontent-%COMP%] {\n  font-size: 12px;\n  color: var(--text-muted);\n  margin-top: 4px;\n}\n.feature-list[_ngcontent-%COMP%] {\n  display: flex;\n  flex-direction: column;\n  gap: 24px;\n  flex: 1;\n}\n.feature[_ngcontent-%COMP%] {\n  display: flex;\n  gap: 14px;\n  align-items: flex-start;\n}\n.feature-icon[_ngcontent-%COMP%] {\n  font-size: 20px;\n  width: 36px;\n  height: 36px;\n  background: var(--bg-hover);\n  border: 1px solid var(--border);\n  border-radius: var(--radius-md);\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  flex-shrink: 0;\n}\n.feature-title[_ngcontent-%COMP%] {\n  font-size: 13px;\n  font-weight: 600;\n  color: var(--text-primary);\n  margin-bottom: 3px;\n}\n.feature-desc[_ngcontent-%COMP%] {\n  font-size: 11px;\n  color: var(--text-muted);\n  line-height: 1.4;\n}\n.brand-footer[_ngcontent-%COMP%] {\n  font-size: 11px;\n  color: var(--text-faint);\n  font-family: var(--font-mono);\n}\n.login-right[_ngcontent-%COMP%] {\n  flex: 1;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n}\n.login-card[_ngcontent-%COMP%] {\n  width: 380px;\n  background: var(--bg-secondary);\n  border: 1px solid var(--border);\n  border-radius: var(--radius-lg);\n  padding: 36px;\n}\n.login-header[_ngcontent-%COMP%] {\n  margin-bottom: 28px;\n}\n.login-title[_ngcontent-%COMP%] {\n  font-size: 20px;\n  font-weight: 700;\n  color: var(--text-primary);\n  font-family: var(--font-mono);\n}\n.login-sub[_ngcontent-%COMP%] {\n  font-size: 12px;\n  color: var(--text-muted);\n  margin-top: 4px;\n}\n.login-error[_ngcontent-%COMP%] {\n  margin-top: 12px;\n  padding: 10px 12px;\n  background: var(--accent-red-bg);\n  border: 1px solid var(--accent-red);\n  border-radius: var(--radius-md);\n  color: var(--accent-red);\n  font-size: 12px;\n}\n/*# sourceMappingURL=login.component.css.map */"] });
  }
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && \u0275setClassDebugInfo(LoginComponent, { className: "LoginComponent", filePath: "src/app/features/auth/login.component.ts", lineNumber: 78 });
})();
export {
  LoginComponent
};
//# sourceMappingURL=chunk-HTTDKDZ7.js.map
