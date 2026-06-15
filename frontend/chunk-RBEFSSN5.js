import {
  DefaultValueAccessor,
  FormsModule,
  NgControlStatus,
  NgModel,
  RangeValueAccessor
} from "./chunk-QSDSVPEE.js";
import {
  ToastService
} from "./chunk-ASB3VJLN.js";
import {
  environment
} from "./chunk-R3YGZVM2.js";
import {
  CommonModule,
  NgForOf,
  ɵsetClassDebugInfo,
  ɵɵStandaloneFeature,
  ɵɵadvance,
  ɵɵclassProp,
  ɵɵdefineComponent,
  ɵɵdirectiveInject,
  ɵɵelement,
  ɵɵelementEnd,
  ɵɵelementStart,
  ɵɵlistener,
  ɵɵproperty,
  ɵɵstyleProp,
  ɵɵtemplate,
  ɵɵtext,
  ɵɵtextInterpolate,
  ɵɵtextInterpolate1,
  ɵɵtwoWayBindingSet,
  ɵɵtwoWayListener,
  ɵɵtwoWayProperty
} from "./chunk-SQ7ZQLOA.js";

// src/app/features/settings/settings.component.ts
function SettingsComponent_div_11_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementStart(0, "div", 20)(1, "div", 21);
    \u0275\u0275text(2);
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(3, "div", 22)(4, "div", 23);
    \u0275\u0275text(5);
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(6, "div", 24);
    \u0275\u0275text(7);
    \u0275\u0275elementEnd()();
    \u0275\u0275elementStart(8, "div", 25)(9, "span");
    \u0275\u0275text(10);
    \u0275\u0275elementEnd();
    \u0275\u0275text(11);
    \u0275\u0275elementEnd()();
  }
  if (rf & 2) {
    const s_r1 = ctx.$implicit;
    \u0275\u0275advance();
    \u0275\u0275styleProp("color", s_r1.color)("background", s_r1.color + "11");
    \u0275\u0275advance();
    \u0275\u0275textInterpolate1(" ", s_r1.icon, " ");
    \u0275\u0275advance(3);
    \u0275\u0275textInterpolate(s_r1.name);
    \u0275\u0275advance(2);
    \u0275\u0275textInterpolate(s_r1.url);
    \u0275\u0275advance();
    \u0275\u0275classProp("ok", s_r1.status === "ok")("err", s_r1.status === "err");
    \u0275\u0275advance(2);
    \u0275\u0275textInterpolate(s_r1.status === "ok" ? "\u25CF" : "\u25CF");
    \u0275\u0275advance();
    \u0275\u0275textInterpolate1(" ", s_r1.status === "ok" ? "Connect\xE9" : "Hors ligne", " ");
  }
}
function SettingsComponent_tr_40_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementStart(0, "tr")(1, "td", 26);
    \u0275\u0275text(2);
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(3, "td", 27);
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
var SettingsComponent = class _SettingsComponent {
  constructor(toast) {
    this.toast = toast;
    this.confidenceThreshold = 70;
    this.n8nUrl = `${environment.n8nUrl}/webhook/jenkins-event`;
    this.services = [
      { name: "Jenkins", icon: "\u2699", color: "#f59e0b", url: "http://172.31.172.61:8082", status: "ok" },
      { name: "SonarQube", icon: "\u25C8", color: "#38bdf8", url: "http://172.31.172.61:9000", status: "ok" },
      { name: "Ollama", icon: "\u25C6", color: "#22c55e", url: "http://ollama:11434", status: "ok" },
      { name: "n8n", icon: "\u2B21", color: "#a78bfa", url: "http://172.31.172.61:5678", status: "ok" },
      { name: "Nexus", icon: "\u25E7", color: "#e24b4a", url: "http://172.31.172.61:8081", status: "ok" },
      { name: "GitHub", icon: "\u25C9", color: "#c8d8e8", url: "github.com/souhaiel11/VermegPFE", status: "ok" }
    ];
    this.platformInfo = [
      { label: "Version Angular", value: "17.x (Standalone)" },
      { label: "Version Spring Boot", value: "3.1.5" },
      { label: "Version n8n", value: "2.14.2 (self-hosted)" },
      { label: "Mod\xE8le LLM", value: "llama3.2:3b via Ollama" },
      { label: "Base de donn\xE9es", value: "PostgreSQL 16" },
      { label: "Environnement", value: "WSL Ubuntu 22.04" },
      { label: "Auteur", value: "Amri Souhaiel \u2014 ESPRIT / Vermeg" }
    ];
  }
  saveConfig() {
    this.toast.success("Configuration sauvegard\xE9e", `Seuil Judge : ${this.confidenceThreshold}%`);
  }
  static {
    this.\u0275fac = function SettingsComponent_Factory(t) {
      return new (t || _SettingsComponent)(\u0275\u0275directiveInject(ToastService));
    };
  }
  static {
    this.\u0275cmp = /* @__PURE__ */ \u0275\u0275defineComponent({ type: _SettingsComponent, selectors: [["app-settings"]], standalone: true, features: [\u0275\u0275StandaloneFeature], decls: 41, vars: 6, consts: [[1, "page-container"], [1, "page-header"], [1, "page-title"], [1, "page-subtitle"], [2, "display", "flex", "flex-direction", "column", "gap", "16px", "max-width", "700px"], [1, "card"], [1, "card-header"], [1, "card-title"], ["class", "service-row", 4, "ngFor", "ngForOf"], [1, "form-group"], [1, "form-label"], ["readonly", "", 1, "form-control", 2, "font-family", "var(--font-mono)", "color", "var(--accent-blue)", 3, "value"], [2, "display", "flex", "align-items", "center", "gap", "12px"], ["type", "range", "min", "50", "max", "95", "step", "5", 2, "flex", "1", 3, "ngModelChange", "ngModel"], [2, "font-family", "var(--font-mono)", "color", "var(--accent-orange)", "min-width", "40px"], [2, "font-size", "10px", "color", "var(--text-faint)", "margin-top", "4px"], ["readonly", "", 1, "form-control", 2, "font-family", "var(--font-mono)", "font-size", "11px", 3, "value"], [1, "btn", "btn-primary", "btn-sm", 3, "click"], [2, "width", "100%"], [4, "ngFor", "ngForOf"], [1, "service-row"], [1, "service-icon"], [2, "flex", "1"], [1, "service-name"], [1, "service-url"], [1, "status-pill"], [2, "font-size", "11px", "color", "var(--text-faint)", "padding", "7px 0", "width", "40%"], [2, "font-size", "12px", "color", "var(--text-secondary)", "font-family", "var(--font-mono)"]], template: function SettingsComponent_Template(rf, ctx) {
      if (rf & 1) {
        \u0275\u0275elementStart(0, "div", 0)(1, "div", 1)(2, "h1", 2);
        \u0275\u0275text(3, "// param\xE8tres");
        \u0275\u0275elementEnd();
        \u0275\u0275elementStart(4, "p", 3);
        \u0275\u0275text(5, "Configuration de la plateforme DevSecOps IA");
        \u0275\u0275elementEnd()();
        \u0275\u0275elementStart(6, "div", 4)(7, "div", 5)(8, "div", 6)(9, "span", 7);
        \u0275\u0275text(10, "Connexions services");
        \u0275\u0275elementEnd()();
        \u0275\u0275template(11, SettingsComponent_div_11_Template, 12, 13, "div", 8);
        \u0275\u0275elementEnd();
        \u0275\u0275elementStart(12, "div", 5)(13, "div", 6)(14, "span", 7);
        \u0275\u0275text(15, "Configuration IA");
        \u0275\u0275elementEnd()();
        \u0275\u0275elementStart(16, "div", 9)(17, "label", 10);
        \u0275\u0275text(18, "Mod\xE8le Ollama");
        \u0275\u0275elementEnd();
        \u0275\u0275element(19, "input", 11);
        \u0275\u0275elementEnd();
        \u0275\u0275elementStart(20, "div", 9)(21, "label", 10);
        \u0275\u0275text(22, "Seuil de confiance Judge Agent");
        \u0275\u0275elementEnd();
        \u0275\u0275elementStart(23, "div", 12)(24, "input", 13);
        \u0275\u0275twoWayListener("ngModelChange", function SettingsComponent_Template_input_ngModelChange_24_listener($event) {
          \u0275\u0275twoWayBindingSet(ctx.confidenceThreshold, $event) || (ctx.confidenceThreshold = $event);
          return $event;
        });
        \u0275\u0275elementEnd();
        \u0275\u0275elementStart(25, "span", 14);
        \u0275\u0275text(26);
        \u0275\u0275elementEnd()();
        \u0275\u0275elementStart(27, "div", 15);
        \u0275\u0275text(28, " Seuil en dessous duquel le Judge refuse d'appliquer une correction automatiquement. ");
        \u0275\u0275elementEnd()();
        \u0275\u0275elementStart(29, "div", 9)(30, "label", 10);
        \u0275\u0275text(31, "URL Webhook n8n");
        \u0275\u0275elementEnd();
        \u0275\u0275element(32, "input", 16);
        \u0275\u0275elementEnd();
        \u0275\u0275elementStart(33, "button", 17);
        \u0275\u0275listener("click", function SettingsComponent_Template_button_click_33_listener() {
          return ctx.saveConfig();
        });
        \u0275\u0275text(34, "Sauvegarder");
        \u0275\u0275elementEnd()();
        \u0275\u0275elementStart(35, "div", 5)(36, "div", 6)(37, "span", 7);
        \u0275\u0275text(38, "Informations plateforme");
        \u0275\u0275elementEnd()();
        \u0275\u0275elementStart(39, "table", 18);
        \u0275\u0275template(40, SettingsComponent_tr_40_Template, 5, 2, "tr", 19);
        \u0275\u0275elementEnd()()()();
      }
      if (rf & 2) {
        \u0275\u0275advance(11);
        \u0275\u0275property("ngForOf", ctx.services);
        \u0275\u0275advance(8);
        \u0275\u0275property("value", "llama3.2:3b");
        \u0275\u0275advance(5);
        \u0275\u0275twoWayProperty("ngModel", ctx.confidenceThreshold);
        \u0275\u0275advance(2);
        \u0275\u0275textInterpolate1(" ", ctx.confidenceThreshold, "% ");
        \u0275\u0275advance(6);
        \u0275\u0275property("value", ctx.n8nUrl);
        \u0275\u0275advance(8);
        \u0275\u0275property("ngForOf", ctx.platformInfo);
      }
    }, dependencies: [CommonModule, NgForOf, FormsModule, DefaultValueAccessor, RangeValueAccessor, NgControlStatus, NgModel], styles: ["\n\n.service-row[_ngcontent-%COMP%] {\n  display: flex;\n  align-items: center;\n  gap: 12px;\n  padding: 12px 0;\n  border-bottom: 1px solid var(--border);\n}\n.service-row[_ngcontent-%COMP%]:last-child {\n  border-bottom: none;\n}\n.service-icon[_ngcontent-%COMP%] {\n  width: 34px;\n  height: 34px;\n  border-radius: var(--radius-md);\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  font-size: 16px;\n  flex-shrink: 0;\n}\n.service-name[_ngcontent-%COMP%] {\n  font-size: 13px;\n  font-weight: 500;\n  color: var(--text-primary);\n}\n.service-url[_ngcontent-%COMP%] {\n  font-size: 10px;\n  color: var(--text-faint);\n  font-family: var(--font-mono);\n}\n.status-pill[_ngcontent-%COMP%] {\n  font-size: 11px;\n  padding: 4px 10px;\n  border-radius: 20px;\n  border: 1px solid var(--border);\n  color: var(--text-muted);\n  display: flex;\n  align-items: center;\n  gap: 4px;\n  font-family: var(--font-mono);\n}\n.status-pill.ok[_ngcontent-%COMP%] {\n  color: var(--accent-green);\n  border-color: var(--accent-green);\n  background: var(--accent-green-bg);\n}\n.status-pill.err[_ngcontent-%COMP%] {\n  color: var(--accent-red);\n  border-color: var(--accent-red);\n  background: var(--accent-red-bg);\n}\n/*# sourceMappingURL=settings.component.css.map */"] });
  }
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && \u0275setClassDebugInfo(SettingsComponent, { className: "SettingsComponent", filePath: "src/app/features/settings/settings.component.ts", lineNumber: 129 });
})();
export {
  SettingsComponent
};
//# sourceMappingURL=chunk-RBEFSSN5.js.map
