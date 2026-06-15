import {
  DefaultValueAccessor,
  FormsModule,
  NgControlStatus,
  NgModel
} from "./chunk-QSDSVPEE.js";
import {
  ApiService
} from "./chunk-MYQKSWHM.js";
import "./chunk-R3YGZVM2.js";
import {
  RouterLink,
  RouterModule
} from "./chunk-YSFKJPFE.js";
import "./chunk-V6V525UE.js";
import {
  CommonModule,
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
  ɵɵproperty,
  ɵɵpureFunction0,
  ɵɵpureFunction1,
  ɵɵresetView,
  ɵɵrestoreView,
  ɵɵstyleProp,
  ɵɵtemplate,
  ɵɵtext,
  ɵɵtextInterpolate,
  ɵɵtextInterpolate1,
  ɵɵtextInterpolate2,
  ɵɵtwoWayBindingSet,
  ɵɵtwoWayListener,
  ɵɵtwoWayProperty
} from "./chunk-SQ7ZQLOA.js";

// src/app/features/dashboard/dashboard.component.ts
var _c0 = () => ({ standalone: true });
var _c1 = (a0) => ["/projects", a0];
function DashboardComponent_span_16_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementStart(0, "span", 69);
    \u0275\u0275text(1);
    \u0275\u0275elementEnd();
  }
  if (rf & 2) {
    const ctx_r0 = \u0275\u0275nextContext();
    \u0275\u0275advance();
    \u0275\u0275textInterpolate(ctx_r0.notifications.length);
  }
}
function DashboardComponent_i_20_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275element(0, "i", 70);
  }
}
function DashboardComponent_i_21_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275element(0, "i", 71);
  }
}
function DashboardComponent_div_31_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementStart(0, "div", 72);
    \u0275\u0275element(1, "div", 73);
    \u0275\u0275elementStart(2, "div")(3, "div", 74);
    \u0275\u0275text(4);
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(5, "div", 75);
    \u0275\u0275text(6);
    \u0275\u0275elementEnd()()();
  }
  if (rf & 2) {
    const n_r2 = ctx.$implicit;
    \u0275\u0275classMap(n_r2.level);
    \u0275\u0275advance(4);
    \u0275\u0275textInterpolate(n_r2.title);
    \u0275\u0275advance(2);
    \u0275\u0275textInterpolate(n_r2.meta);
  }
}
function DashboardComponent_div_34_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementStart(0, "div", 76)(1, "div", 77);
    \u0275\u0275element(2, "i");
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(3, "div", 78)(4, "div", 79);
    \u0275\u0275text(5);
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(6, "div", 80);
    \u0275\u0275text(7);
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(8, "div", 81);
    \u0275\u0275text(9);
    \u0275\u0275elementEnd()()();
  }
  if (rf & 2) {
    const k_r3 = ctx.$implicit;
    \u0275\u0275classMap(k_r3.color);
    \u0275\u0275advance(2);
    \u0275\u0275classMap("ti " + k_r3.icon);
    \u0275\u0275advance(3);
    \u0275\u0275textInterpolate(k_r3.value);
    \u0275\u0275advance(2);
    \u0275\u0275textInterpolate(k_r3.label);
    \u0275\u0275advance(2);
    \u0275\u0275textInterpolate(k_r3.sub);
  }
}
function DashboardComponent_div_41_div_14_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementStart(0, "div", 92)(1, "span", 93);
    \u0275\u0275text(2);
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(3, "div", 94);
    \u0275\u0275element(4, "div", 95);
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(5, "span", 96);
    \u0275\u0275text(6);
    \u0275\u0275elementEnd()();
  }
  if (rf & 2) {
    const r_r4 = ctx.$implicit;
    const ctx_r0 = \u0275\u0275nextContext(2);
    \u0275\u0275advance(2);
    \u0275\u0275textInterpolate(r_r4.label);
    \u0275\u0275advance(2);
    \u0275\u0275styleProp("width", r_r4.value + "%")("background", ctx_r0.getBarColor(r_r4.value));
    \u0275\u0275advance();
    \u0275\u0275styleProp("color", ctx_r0.getBarColor(r_r4.value));
    \u0275\u0275advance();
    \u0275\u0275textInterpolate(r_r4.value);
  }
}
function DashboardComponent_div_41_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementStart(0, "div", 82)(1, "div", 83)(2, "div", 84);
    \u0275\u0275text(3);
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(4, "div")(5, "div", 85);
    \u0275\u0275text(6);
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(7, "div", 86);
    \u0275\u0275text(8);
    \u0275\u0275elementEnd()()();
    \u0275\u0275elementStart(9, "div", 87);
    \u0275\u0275element(10, "canvas", 88);
    \u0275\u0275elementStart(11, "div", 89);
    \u0275\u0275text(12);
    \u0275\u0275elementEnd()();
    \u0275\u0275elementStart(13, "div", 90);
    \u0275\u0275template(14, DashboardComponent_div_41_div_14_Template, 7, 8, "div", 91);
    \u0275\u0275elementEnd()();
  }
  if (rf & 2) {
    const p_r5 = ctx.$implicit;
    const ctx_r0 = \u0275\u0275nextContext();
    \u0275\u0275advance(2);
    \u0275\u0275styleProp("background", p_r5.avatarBg)("color", p_r5.avatarColor);
    \u0275\u0275advance();
    \u0275\u0275textInterpolate(p_r5.initials);
    \u0275\u0275advance(3);
    \u0275\u0275textInterpolate(p_r5.name);
    \u0275\u0275advance(2);
    \u0275\u0275textInterpolate(p_r5.tech);
    \u0275\u0275advance(2);
    \u0275\u0275property("id", "risk-" + p_r5.id);
    \u0275\u0275advance();
    \u0275\u0275styleProp("color", ctx_r0.getRiskColor(p_r5.riskScore));
    \u0275\u0275advance();
    \u0275\u0275textInterpolate1(" ", p_r5.riskScore, " ");
    \u0275\u0275advance(2);
    \u0275\u0275property("ngForOf", p_r5.riskBreakdown);
  }
}
function DashboardComponent_a_63_span_12_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementStart(0, "span", 116);
    \u0275\u0275text(1);
    \u0275\u0275elementEnd();
  }
  if (rf & 2) {
    const p_r6 = \u0275\u0275nextContext().$implicit;
    \u0275\u0275advance();
    \u0275\u0275textInterpolate2("", p_r6.incidents, " incident", p_r6.incidents > 1 ? "s" : "", "");
  }
}
function DashboardComponent_a_63_span_13_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementStart(0, "span", 117);
    \u0275\u0275text(1, "0 incidents");
    \u0275\u0275elementEnd();
  }
}
function DashboardComponent_a_63_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementStart(0, "a", 97)(1, "div", 98)(2, "div", 99);
    \u0275\u0275text(3);
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(4, "div", 100)(5, "div", 101);
    \u0275\u0275text(6);
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(7, "div", 102);
    \u0275\u0275text(8);
    \u0275\u0275elementEnd()();
    \u0275\u0275elementStart(9, "span", 103);
    \u0275\u0275text(10);
    \u0275\u0275elementEnd()();
    \u0275\u0275elementStart(11, "div", 104);
    \u0275\u0275template(12, DashboardComponent_a_63_span_12_Template, 2, 2, "span", 105)(13, DashboardComponent_a_63_span_13_Template, 2, 0, "span", 106);
    \u0275\u0275elementStart(14, "span", 107);
    \u0275\u0275text(15);
    \u0275\u0275elementEnd()();
    \u0275\u0275elementStart(16, "div", 108);
    \u0275\u0275element(17, "canvas", 109);
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(18, "div", 110);
    \u0275\u0275element(19, "div", 111);
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(20, "div", 112)(21, "span");
    \u0275\u0275text(22, "Sant\xE9 globale");
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(23, "span", 113);
    \u0275\u0275text(24);
    \u0275\u0275elementEnd()();
    \u0275\u0275elementStart(25, "div", 114)(26, "span");
    \u0275\u0275text(27);
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(28, "span", 115);
    \u0275\u0275text(29);
    \u0275\u0275elementEnd()()();
  }
  if (rf & 2) {
    const p_r6 = ctx.$implicit;
    const ctx_r0 = \u0275\u0275nextContext();
    \u0275\u0275property("routerLink", \u0275\u0275pureFunction1(28, _c1, p_r6.id));
    \u0275\u0275advance(2);
    \u0275\u0275styleProp("background", p_r6.avatarBg)("color", p_r6.avatarColor);
    \u0275\u0275advance();
    \u0275\u0275textInterpolate(p_r6.initials);
    \u0275\u0275advance(3);
    \u0275\u0275textInterpolate(p_r6.name);
    \u0275\u0275advance(2);
    \u0275\u0275textInterpolate(p_r6.tech);
    \u0275\u0275advance();
    \u0275\u0275classMap(p_r6.lastDecision.toLowerCase());
    \u0275\u0275advance();
    \u0275\u0275textInterpolate(p_r6.lastDecision);
    \u0275\u0275advance(2);
    \u0275\u0275property("ngIf", p_r6.incidents > 0);
    \u0275\u0275advance();
    \u0275\u0275property("ngIf", p_r6.incidents === 0);
    \u0275\u0275advance();
    \u0275\u0275classMap(p_r6.buildStatus === "SUCCESS" ? "green" : "red");
    \u0275\u0275advance();
    \u0275\u0275textInterpolate1("Build ", p_r6.buildStatus, "");
    \u0275\u0275advance(2);
    \u0275\u0275property("id", "spark-" + p_r6.id);
    \u0275\u0275advance(2);
    \u0275\u0275styleProp("width", p_r6.health + "%")("background", ctx_r0.getBarColor(p_r6.health));
    \u0275\u0275advance(4);
    \u0275\u0275styleProp("color", ctx_r0.getBarColor(p_r6.health));
    \u0275\u0275advance();
    \u0275\u0275textInterpolate1("", p_r6.health, "%");
    \u0275\u0275advance(3);
    \u0275\u0275textInterpolate(p_r6.lastUpdate);
    \u0275\u0275advance();
    \u0275\u0275styleProp("color", ctx_r0.getRiskColor(p_r6.riskScore));
    \u0275\u0275advance();
    \u0275\u0275textInterpolate1("Risque : ", p_r6.riskScore, "/100");
  }
}
function DashboardComponent_div_70_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementStart(0, "div", 118)(1, "div", 119);
    \u0275\u0275text(2);
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(3, "div", 120);
    \u0275\u0275text(4);
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(5, "div", 121);
    \u0275\u0275text(6);
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(7, "span", 122);
    \u0275\u0275text(8);
    \u0275\u0275elementEnd()();
  }
  if (rf & 2) {
    const d_r7 = ctx.$implicit;
    \u0275\u0275advance(2);
    \u0275\u0275textInterpolate(d_r7.icon);
    \u0275\u0275advance();
    \u0275\u0275styleProp("color", d_r7.color);
    \u0275\u0275advance();
    \u0275\u0275textInterpolate(d_r7.value);
    \u0275\u0275advance(2);
    \u0275\u0275textInterpolate(d_r7.label);
    \u0275\u0275advance();
    \u0275\u0275styleProp("background", d_r7.badgeBg)("color", d_r7.color);
    \u0275\u0275advance();
    \u0275\u0275textInterpolate(d_r7.level);
  }
}
function DashboardComponent_div_76_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementStart(0, "div", 123);
    \u0275\u0275element(1, "div", 124);
    \u0275\u0275elementStart(2, "div", 125)(3, "div", 126);
    \u0275\u0275text(4);
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(5, "div", 127);
    \u0275\u0275text(6);
    \u0275\u0275elementEnd()()();
  }
  if (rf & 2) {
    const a_r8 = ctx.$implicit;
    \u0275\u0275advance();
    \u0275\u0275styleProp("background", a_r8.color);
    \u0275\u0275advance(3);
    \u0275\u0275textInterpolate(a_r8.title);
    \u0275\u0275advance(2);
    \u0275\u0275textInterpolate(a_r8.meta);
  }
}
function DashboardComponent_div_77_Template(rf, ctx) {
  if (rf & 1) {
    const _r9 = \u0275\u0275getCurrentView();
    \u0275\u0275elementStart(0, "div", 128)(1, "div", 129);
    \u0275\u0275element(2, "i", 130);
    \u0275\u0275elementStart(3, "div")(4, "div", 131);
    \u0275\u0275text(5, "\u26A0\uFE0F Pr\xE9diction IA \u2014 Risque d\xE9tect\xE9");
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(6, "div", 132);
    \u0275\u0275text(7, "Le Judge Agent pr\xE9dit ");
    \u0275\u0275elementStart(8, "strong");
    \u0275\u0275text(9, "73% de probabilit\xE9 d'incident");
    \u0275\u0275elementEnd();
    \u0275\u0275text(10, " dans les 48h sur ");
    \u0275\u0275elementStart(11, "strong");
    \u0275\u0275text(12, "pfe-app-test");
    \u0275\u0275elementEnd();
    \u0275\u0275text(13, " \u2014 2 CVE HIGH non corrig\xE9es.");
    \u0275\u0275elementEnd()()();
    \u0275\u0275elementStart(14, "div", 133)(15, "a", 134);
    \u0275\u0275text(16, "Voir l'analyse");
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(17, "button", 19);
    \u0275\u0275listener("click", function DashboardComponent_div_77_Template_button_click_17_listener() {
      \u0275\u0275restoreView(_r9);
      const ctx_r0 = \u0275\u0275nextContext();
      return \u0275\u0275resetView(ctx_r0.showPrediction = false);
    });
    \u0275\u0275element(18, "i", 20);
    \u0275\u0275elementEnd()()();
  }
}
function DashboardComponent_span_80_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementStart(0, "span", 135);
    \u0275\u0275text(1);
    \u0275\u0275elementEnd();
  }
  if (rf & 2) {
    const ctx_r0 = \u0275\u0275nextContext();
    \u0275\u0275advance();
    \u0275\u0275textInterpolate(ctx_r0.unreadChat);
  }
}
function DashboardComponent_div_91_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementStart(0, "div", 136);
    \u0275\u0275text(1);
    \u0275\u0275elementEnd();
  }
  if (rf & 2) {
    const m_r10 = ctx.$implicit;
    \u0275\u0275classMap(m_r10.role);
    \u0275\u0275advance();
    \u0275\u0275textInterpolate1(" ", m_r10.content, " ");
  }
}
function DashboardComponent_button_93_Template(rf, ctx) {
  if (rf & 1) {
    const _r11 = \u0275\u0275getCurrentView();
    \u0275\u0275elementStart(0, "button", 137);
    \u0275\u0275listener("click", function DashboardComponent_button_93_Template_button_click_0_listener() {
      const s_r12 = \u0275\u0275restoreView(_r11).$implicit;
      const ctx_r0 = \u0275\u0275nextContext();
      return \u0275\u0275resetView(ctx_r0.sendSuggestion(s_r12));
    });
    \u0275\u0275text(1);
    \u0275\u0275elementEnd();
  }
  if (rf & 2) {
    const s_r12 = ctx.$implicit;
    \u0275\u0275advance();
    \u0275\u0275textInterpolate(s_r12);
  }
}
var DashboardComponent = class _DashboardComponent {
  constructor(api) {
    this.api = api;
    this.isDark = true;
    this.notifOpen = false;
    this.chatOpen = false;
    this.chatInput = "";
    this.unreadChat = 1;
    this.showPrediction = true;
    this.notifications = [
      { level: "error", title: "CRITICAL \u2014 Pod app-test CrashLoopBackOff", meta: "il y a 6h \xB7 Corrig\xE9 \u2192 DB_HOST=postgres" },
      { level: "warn", title: "WARN \u2014 2 CVE HIGH Trivy \xB7 eclipse-temurin", meta: "il y a 5h \xB7 Patch recommand\xE9" },
      { level: "info", title: "INFO \u2014 Build #132 SUCCESS \xB7 Deploy K8s OK", meta: "il y a 2h \xB7 main-132 d\xE9ploy\xE9" }
    ];
    this.kpis = [
      { label: "Incidents actifs", value: "3", sub: "+2 depuis hier", icon: "ti-alert-circle", color: "red" },
      { label: "Builds r\xE9ussis", value: "12", sub: "aujourd'hui", icon: "ti-circle-check", color: "green" },
      { label: "D\xE9cisions IA", value: "7", sub: "cette semaine", icon: "ti-robot", color: "blue" },
      { label: "CVE HIGH", value: "2", sub: "en attente", icon: "ti-shield-exclamation", color: "orange" }
    ];
    this.projects = [
      {
        id: "54192eca-43da-4d8f-9b49-30c143983fdd",
        name: "pfe-app-test",
        tech: "Spring Boot \xB7 Jenkins \xB7 K8s",
        initials: "AT",
        avatarBg: "#0c1c2e",
        avatarColor: "#58a6ff",
        incidents: 2,
        buildStatus: "SUCCESS",
        health: 78,
        riskScore: 62,
        lastDecision: "NOTIFY_ONLY",
        lastUpdate: "il y a 2h",
        sparkData: [78, 82, 75, 70, 85, 79, 78],
        riskBreakdown: [
          { label: "Jenkins", value: 80 },
          { label: "SonarQube", value: 74 },
          { label: "Trivy", value: 45 },
          { label: "OWASP", value: 60 }
        ]
      },
      {
        id: "1b16b8d5-8115-4a79-9558-00486a460cc8",
        name: "pfe-devsecops-platform",
        tech: "Angular \xB7 NestJS \xB7 PostgreSQL",
        initials: "PF",
        avatarBg: "#1a1a2e",
        avatarColor: "#bc8cff",
        incidents: 0,
        buildStatus: "SUCCESS",
        health: 94,
        riskScore: 91,
        lastDecision: "AUTO_FIX",
        lastUpdate: "il y a 5h",
        sparkData: [90, 92, 88, 94, 93, 95, 94],
        riskBreakdown: [
          { label: "Jenkins", value: 96 },
          { label: "SonarQube", value: 88 },
          { label: "Trivy", value: 90 },
          { label: "OWASP", value: 89 }
        ]
      }
    ];
    this.doraMetrics = [
      { icon: "\u{1F680}", value: "3.2/j", label: "Deployment Frequency", level: "ELITE", color: "#3fb950", badgeBg: "#0d2119" },
      { icon: "\u23F1\uFE0F", value: "4h20", label: "Lead Time for Changes", level: "HIGH", color: "#3fb950", badgeBg: "#0d2119" },
      { icon: "\u{1F4C9}", value: "18%", label: "Change Failure Rate", level: "MEDIUM", color: "#d29922", badgeBg: "#271d0a" },
      { icon: "\u{1F527}", value: "45min", label: "MTTR", level: "ELITE", color: "#3fb950", badgeBg: "#0d2119" }
    ];
    this.activities = [
      { color: "#3fb950", title: "Build #132 \u2014 pfe-app-test \u2014 SUCCESS", meta: "il y a 2h \xB7 kubectl rollout OK" },
      { color: "#d29922", title: "Incident #45 \u2014 Tests cass\xE9s \u2014 NOTIFY_ONLY", meta: "il y a 3h \xB7 Judge Agent Claude" },
      { color: "#f85149", title: "CVE-2024-1234 HIGH \u2014 eclipse-temurin:17", meta: "il y a 5h \xB7 Trivy scan" },
      { color: "#3fb950", title: "Quality Gate SonarQube \u2014 PASSED", meta: "il y a 5h \xB7 Coverage 74%" },
      { color: "#58a6ff", title: "DB_HOST corrig\xE9 \u2014 kubectl set env", meta: "il y a 6h \xB7 K8s pod Running" }
    ];
    this.chatMessages = [
      { role: "ai", content: "Bonjour Souhaiel ! 3 incidents actifs \xB7 Build #132 OK \xB7 Score risque 62/100. Comment puis-je t'aider ?" }
    ];
    this.chatSuggestions = ["Score risque", "Pods K8s", "CVE Trivy", "DORA", "Incidents"];
    this.chatReplies = {
      "score risque": "pfe-app-test : 62/100 MEDIUM\npfe-platform : 91/100 LOW\nScore = Jenkins 40% + SonarQube 30% + Trivy 20% + OWASP 10%",
      "pods k8s": "4/4 pods Running :\n\u2022 frontend :30002 \u2713\n\u2022 backend :30001 \u2713\n\u2022 app-test :30003 \u2713\n\u2022 postgres ClusterIP \u2713",
      "cve trivy": "0 CRITICAL \xB7 2 HIGH\n\u2022 CVE-2024-1234 eclipse-temurin (CVSS 7.5)\n\u2022 CVE-2024-5678 alpine:3.18 (CVSS 7.1)",
      "dora": "Deployment: 3.2/j (ELITE)\nLead Time: 4h20 (HIGH)\nCFR: 18% (MEDIUM)\nMTTR: 45min (ELITE)",
      "incidents": "3 incidents actifs :\n\u2022 Tests cass\xE9s \u2192 NOTIFY_ONLY\n\u2022 OWASP ZAP \u2192 OPEN\n\u2022 CVE HIGH \u2192 en attente"
    };
  }
  ngOnInit() {
  }
  ngAfterViewInit() {
    setTimeout(() => {
      this.buildHeatmap();
      this.buildSparklines();
      this.buildRiskRings();
    }, 100);
  }
  buildRiskRings() {
    this.projects.forEach((p) => {
      const canvas = document.getElementById("risk-" + p.id);
      if (!canvas || !window.Chart)
        return;
      const color = this.getRiskColor(p.riskScore);
      const bg = this.isDark ? "#21262d" : "#f0f2f4";
      new window.Chart(canvas, {
        type: "doughnut",
        data: { datasets: [{ data: [p.riskScore, 100 - p.riskScore], backgroundColor: [color, bg], borderWidth: 0 }] },
        options: { responsive: false, cutout: "72%", plugins: { legend: { display: false } } }
      });
    });
  }
  buildSparklines() {
    this.projects.forEach((p) => {
      const canvas = document.getElementById("spark-" + p.id);
      if (!canvas || !window.Chart)
        return;
      new window.Chart(canvas, {
        type: "line",
        data: {
          labels: p.sparkData.map((_, i) => i),
          datasets: [{ data: p.sparkData, borderColor: "#3fb950", borderWidth: 1.5, pointRadius: 0, fill: true, backgroundColor: "rgba(63,185,80,.15)", tension: 0.4 }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { display: false }, y: { display: false } } }
      });
    });
  }
  buildHeatmap() {
    const days = ["L", "M", "M", "J", "V", "S", "D"];
    const weeks = 8;
    const colors = ["#21262d", "#0d2119", "#26a641", "#3fb950", "#f85149"];
    const wrap = document.getElementById("heatmap");
    if (!wrap)
      return;
    let html = "";
    days.forEach((day, di) => {
      html += `<div class="hm-row"><span class="hm-lbl">${day}</span>`;
      for (let w = 0; w < weeks; w++) {
        const r = Math.random();
        let ci = di >= 5 ? 0 : r < 0.12 ? 4 : r < 0.25 ? 1 : r < 0.55 ? 3 : 2;
        html += `<div class="hm-cell" style="background:${colors[ci]}" title="${colors[ci] === "#f85149" ? "\xC9chec" : "Succ\xE8s"}"></div>`;
      }
      html += "</div>";
    });
    wrap.innerHTML = html;
  }
  getRiskColor(score) {
    if (score >= 80)
      return "#3fb950";
    if (score >= 60)
      return "#d29922";
    return "#f85149";
  }
  getBarColor(val) {
    if (val >= 75)
      return "#3fb950";
    if (val >= 50)
      return "#d29922";
    return "#f85149";
  }
  toggleNotif() {
    this.notifOpen = !this.notifOpen;
  }
  toggleChat() {
    this.chatOpen = !this.chatOpen;
    this.unreadChat = 0;
  }
  toggleTheme() {
    this.isDark = !this.isDark;
  }
  sendSuggestion(s) {
    this.chatInput = s;
    this.sendChat();
  }
  sendChat() {
    const q = this.chatInput.trim();
    if (!q)
      return;
    this.chatMessages.push({ role: "user", content: q });
    this.chatInput = "";
    const key = q.toLowerCase();
    const reply = this.chatReplies[key] || `Connecte le vrai endpoint n8n+Claude pour des r\xE9ponses live sur "${q}".`;
    setTimeout(() => {
      this.chatMessages.push({ role: "ai", content: reply });
    }, 500);
  }
  exportPDF() {
    alert("\u{1F4C4} Export PDF \u2014 \xC0 impl\xE9menter avec jsPDF ou WeasyPrint c\xF4t\xE9 NestJS backend.\n\nContenus : Score risque \xB7 D\xE9cisions IA \xB7 SonarQube \xB7 Trivy \xB7 DORA \xB7 Incidents");
  }
  static {
    this.\u0275fac = function DashboardComponent_Factory(t) {
      return new (t || _DashboardComponent)(\u0275\u0275directiveInject(ApiService));
    };
  }
  static {
    this.\u0275cmp = /* @__PURE__ */ \u0275\u0275defineComponent({ type: _DashboardComponent, selectors: [["app-dashboard"]], standalone: true, features: [\u0275\u0275StandaloneFeature], decls: 98, vars: 21, consts: [[1, "dashboard"], [1, "topbar"], [1, "topbar-left"], [1, "logo-mark"], [1, "logo-title"], [1, "logo-sub"], [1, "topbar-right"], [1, "live-badge"], [1, "live-dot"], [1, "icon-btn", "notif-btn", 3, "click"], [1, "ti", "ti-bell"], ["class", "notif-count", 4, "ngIf"], [1, "icon-btn", 3, "click"], [1, "ti", "ti-file-type-pdf"], ["class", "ti ti-sun", 4, "ngIf"], ["class", "ti ti-moon", 4, "ngIf"], [1, "user-av"], [1, "notif-panel"], [1, "notif-header"], [1, "close-btn", 3, "click"], [1, "ti", "ti-x"], [1, "notif-list"], ["class", "notif-item", 3, "class", 4, "ngFor", "ngForOf"], [1, "content"], [1, "kpi-grid"], ["class", "kpi-card", 3, "class", 4, "ngFor", "ngForOf"], [1, "two-col", 2, "margin-bottom", "20px"], [1, "card"], [1, "card-title"], [1, "ti", "ti-shield-half"], [1, "risk-list"], ["class", "risk-item", 4, "ngFor", "ngForOf"], [1, "ti", "ti-calendar-stats"], ["id", "heatmap", 1, "heatmap-wrap"], [1, "heatmap-legend"], [1, "hm-swatch", 2, "background", "#21262d", "border", "1px solid #30363d"], [1, "hm-swatch", 2, "background", "#0d2119"], [1, "hm-swatch", 2, "background", "#26a641"], [1, "hm-swatch", 2, "background", "#3fb950"], [1, "hm-swatch", 2, "background", "#f85149"], [1, "section-title"], [1, "ti", "ti-folder"], [1, "section-count"], [1, "proj-grid"], ["class", "proj-card", 3, "routerLink", 4, "ngFor", "ngForOf"], [1, "two-col"], [1, "ti", "ti-chart-bar"], [1, "dora-grid"], ["class", "dora-card", 4, "ngFor", "ngForOf"], [1, "ti", "ti-activity"], [1, "activity-list"], ["class", "activity-item", 4, "ngFor", "ngForOf"], ["class", "pred-banner", 4, "ngIf"], [1, "chat-fab", 3, "click"], [1, "ti", "ti-message-chatbot"], ["class", "fab-badge", 4, "ngIf"], [1, "chat-popup"], [1, "cp-header"], [1, "cp-title"], [1, "ti", "ti-robot"], [1, "online-dot"], ["id", "cp-msgs", 1, "cp-messages"], ["class", "cp-msg ai", 3, "class", 4, "ngFor", "ngForOf"], [1, "cp-suggestions"], ["class", "cp-sug", 3, "click", 4, "ngFor", "ngForOf"], [1, "cp-input-row"], ["placeholder", "Question...", 1, "cp-input", 3, "ngModelChange", "keydown.enter", "ngModel", "ngModelOptions"], [1, "cp-send", 3, "click"], [1, "ti", "ti-send"], [1, "notif-count"], [1, "ti", "ti-sun"], [1, "ti", "ti-moon"], [1, "notif-item"], [1, "notif-dot"], [1, "notif-title"], [1, "notif-meta"], [1, "kpi-card"], [1, "kpi-icon"], [1, "kpi-body"], [1, "kpi-val"], [1, "kpi-label"], [1, "kpi-sub"], [1, "risk-item"], [1, "risk-proj-info"], [1, "risk-av"], [1, "risk-name"], [1, "risk-tech"], [1, "risk-ring-wrap"], ["width", "70", "height", "70", 3, "id"], [1, "risk-center-txt"], [1, "risk-breakdown"], ["class", "rb-row", 4, "ngFor", "ngForOf"], [1, "rb-row"], [1, "rb-lbl"], [1, "rb-bar-bg"], [1, "rb-bar"], [1, "rb-val"], [1, "proj-card", 3, "routerLink"], [1, "proj-card-header"], [1, "proj-av"], [1, "proj-info"], [1, "proj-name"], [1, "proj-tech"], [1, "decision-badge"], [1, "proj-pills"], ["class", "pill red", 4, "ngIf"], ["class", "pill green", 4, "ngIf"], [1, "pill"], [1, "proj-sparkline"], ["height", "30", 3, "id"], [1, "health-bar-wrap"], [1, "health-bar"], [1, "health-label"], [2, "font-weight", "600"], [1, "proj-footer"], [1, "risk-badge"], [1, "pill", "red"], [1, "pill", "green"], [1, "dora-card"], [1, "dora-icon"], [1, "dora-val"], [1, "dora-label"], [1, "dora-badge"], [1, "activity-item"], [1, "act-dot"], [1, "act-body"], [1, "act-title"], [1, "act-meta"], [1, "pred-banner"], [1, "pred-left"], [1, "ti", "ti-brain", "pred-icon"], [1, "pred-title"], [1, "pred-desc"], [1, "pred-right"], ["routerLink", "/prediction", 1, "pred-btn"], [1, "fab-badge"], [1, "cp-msg", "ai"], [1, "cp-sug", 3, "click"]], template: function DashboardComponent_Template(rf, ctx) {
      if (rf & 1) {
        \u0275\u0275elementStart(0, "div", 0)(1, "div", 1)(2, "div", 2)(3, "div", 3);
        \u0275\u0275text(4, "D");
        \u0275\u0275elementEnd();
        \u0275\u0275elementStart(5, "div")(6, "div", 4);
        \u0275\u0275text(7, "DevSecOps AI");
        \u0275\u0275elementEnd();
        \u0275\u0275elementStart(8, "div", 5);
        \u0275\u0275text(9, "Vermeg \xB7 PFE 2026");
        \u0275\u0275elementEnd()()();
        \u0275\u0275elementStart(10, "div", 6)(11, "div", 7);
        \u0275\u0275element(12, "span", 8);
        \u0275\u0275text(13, " LIVE ");
        \u0275\u0275elementEnd();
        \u0275\u0275elementStart(14, "button", 9);
        \u0275\u0275listener("click", function DashboardComponent_Template_button_click_14_listener() {
          return ctx.toggleNotif();
        });
        \u0275\u0275element(15, "i", 10);
        \u0275\u0275template(16, DashboardComponent_span_16_Template, 2, 1, "span", 11);
        \u0275\u0275elementEnd();
        \u0275\u0275elementStart(17, "button", 12);
        \u0275\u0275listener("click", function DashboardComponent_Template_button_click_17_listener() {
          return ctx.exportPDF();
        });
        \u0275\u0275element(18, "i", 13);
        \u0275\u0275elementEnd();
        \u0275\u0275elementStart(19, "button", 12);
        \u0275\u0275listener("click", function DashboardComponent_Template_button_click_19_listener() {
          return ctx.toggleTheme();
        });
        \u0275\u0275template(20, DashboardComponent_i_20_Template, 1, 0, "i", 14)(21, DashboardComponent_i_21_Template, 1, 0, "i", 15);
        \u0275\u0275elementEnd();
        \u0275\u0275elementStart(22, "div", 16);
        \u0275\u0275text(23, "SA");
        \u0275\u0275elementEnd()()();
        \u0275\u0275elementStart(24, "div", 17)(25, "div", 18)(26, "span");
        \u0275\u0275text(27, "Notifications");
        \u0275\u0275elementEnd();
        \u0275\u0275elementStart(28, "button", 19);
        \u0275\u0275listener("click", function DashboardComponent_Template_button_click_28_listener() {
          return ctx.toggleNotif();
        });
        \u0275\u0275element(29, "i", 20);
        \u0275\u0275elementEnd()();
        \u0275\u0275elementStart(30, "div", 21);
        \u0275\u0275template(31, DashboardComponent_div_31_Template, 7, 4, "div", 22);
        \u0275\u0275elementEnd()();
        \u0275\u0275elementStart(32, "div", 23)(33, "div", 24);
        \u0275\u0275template(34, DashboardComponent_div_34_Template, 10, 7, "div", 25);
        \u0275\u0275elementEnd();
        \u0275\u0275elementStart(35, "div", 26)(36, "div", 27)(37, "div", 28);
        \u0275\u0275element(38, "i", 29);
        \u0275\u0275text(39, " Score de risque global ");
        \u0275\u0275elementEnd();
        \u0275\u0275elementStart(40, "div", 30);
        \u0275\u0275template(41, DashboardComponent_div_41_Template, 15, 12, "div", 31);
        \u0275\u0275elementEnd()();
        \u0275\u0275elementStart(42, "div", 27)(43, "div", 28);
        \u0275\u0275element(44, "i", 32);
        \u0275\u0275text(45, " Heatmap builds \u2014 8 semaines ");
        \u0275\u0275elementEnd();
        \u0275\u0275element(46, "div", 33);
        \u0275\u0275elementStart(47, "div", 34)(48, "span");
        \u0275\u0275text(49, "Moins");
        \u0275\u0275elementEnd();
        \u0275\u0275element(50, "div", 35)(51, "div", 36)(52, "div", 37)(53, "div", 38)(54, "div", 39);
        \u0275\u0275elementStart(55, "span");
        \u0275\u0275text(56, "\xC9chec");
        \u0275\u0275elementEnd()()()();
        \u0275\u0275elementStart(57, "div", 40);
        \u0275\u0275element(58, "i", 41);
        \u0275\u0275text(59, " Projets surveill\xE9s ");
        \u0275\u0275elementStart(60, "span", 42);
        \u0275\u0275text(61);
        \u0275\u0275elementEnd()();
        \u0275\u0275elementStart(62, "div", 43);
        \u0275\u0275template(63, DashboardComponent_a_63_Template, 30, 30, "a", 44);
        \u0275\u0275elementEnd();
        \u0275\u0275elementStart(64, "div", 45)(65, "div", 27)(66, "div", 28);
        \u0275\u0275element(67, "i", 46);
        \u0275\u0275text(68, " M\xE9triques DORA ");
        \u0275\u0275elementEnd();
        \u0275\u0275elementStart(69, "div", 47);
        \u0275\u0275template(70, DashboardComponent_div_70_Template, 9, 10, "div", 48);
        \u0275\u0275elementEnd()();
        \u0275\u0275elementStart(71, "div", 27)(72, "div", 28);
        \u0275\u0275element(73, "i", 49);
        \u0275\u0275text(74, " Activit\xE9 r\xE9cente ");
        \u0275\u0275elementEnd();
        \u0275\u0275elementStart(75, "div", 50);
        \u0275\u0275template(76, DashboardComponent_div_76_Template, 7, 4, "div", 51);
        \u0275\u0275elementEnd()()();
        \u0275\u0275template(77, DashboardComponent_div_77_Template, 19, 0, "div", 52);
        \u0275\u0275elementEnd();
        \u0275\u0275elementStart(78, "div", 53);
        \u0275\u0275listener("click", function DashboardComponent_Template_div_click_78_listener() {
          return ctx.toggleChat();
        });
        \u0275\u0275element(79, "i", 54);
        \u0275\u0275template(80, DashboardComponent_span_80_Template, 2, 1, "span", 55);
        \u0275\u0275elementEnd();
        \u0275\u0275elementStart(81, "div", 56)(82, "div", 57)(83, "div", 58);
        \u0275\u0275element(84, "i", 59);
        \u0275\u0275text(85, " DevSecOps AI");
        \u0275\u0275elementEnd();
        \u0275\u0275elementStart(86, "span", 60);
        \u0275\u0275text(87, "\u25CF En ligne");
        \u0275\u0275elementEnd();
        \u0275\u0275elementStart(88, "button", 19);
        \u0275\u0275listener("click", function DashboardComponent_Template_button_click_88_listener() {
          return ctx.toggleChat();
        });
        \u0275\u0275element(89, "i", 20);
        \u0275\u0275elementEnd()();
        \u0275\u0275elementStart(90, "div", 61);
        \u0275\u0275template(91, DashboardComponent_div_91_Template, 2, 3, "div", 62);
        \u0275\u0275elementEnd();
        \u0275\u0275elementStart(92, "div", 63);
        \u0275\u0275template(93, DashboardComponent_button_93_Template, 2, 1, "button", 64);
        \u0275\u0275elementEnd();
        \u0275\u0275elementStart(94, "div", 65)(95, "input", 66);
        \u0275\u0275twoWayListener("ngModelChange", function DashboardComponent_Template_input_ngModelChange_95_listener($event) {
          \u0275\u0275twoWayBindingSet(ctx.chatInput, $event) || (ctx.chatInput = $event);
          return $event;
        });
        \u0275\u0275listener("keydown.enter", function DashboardComponent_Template_input_keydown_enter_95_listener() {
          return ctx.sendChat();
        });
        \u0275\u0275elementEnd();
        \u0275\u0275elementStart(96, "button", 67);
        \u0275\u0275listener("click", function DashboardComponent_Template_button_click_96_listener() {
          return ctx.sendChat();
        });
        \u0275\u0275element(97, "i", 68);
        \u0275\u0275elementEnd()()()();
      }
      if (rf & 2) {
        \u0275\u0275advance(16);
        \u0275\u0275property("ngIf", ctx.notifications.length);
        \u0275\u0275advance(4);
        \u0275\u0275property("ngIf", ctx.isDark);
        \u0275\u0275advance();
        \u0275\u0275property("ngIf", !ctx.isDark);
        \u0275\u0275advance(3);
        \u0275\u0275classProp("open", ctx.notifOpen);
        \u0275\u0275advance(7);
        \u0275\u0275property("ngForOf", ctx.notifications);
        \u0275\u0275advance(3);
        \u0275\u0275property("ngForOf", ctx.kpis);
        \u0275\u0275advance(7);
        \u0275\u0275property("ngForOf", ctx.projects);
        \u0275\u0275advance(20);
        \u0275\u0275textInterpolate(ctx.projects.length);
        \u0275\u0275advance(2);
        \u0275\u0275property("ngForOf", ctx.projects);
        \u0275\u0275advance(7);
        \u0275\u0275property("ngForOf", ctx.doraMetrics);
        \u0275\u0275advance(6);
        \u0275\u0275property("ngForOf", ctx.activities);
        \u0275\u0275advance();
        \u0275\u0275property("ngIf", ctx.showPrediction);
        \u0275\u0275advance(3);
        \u0275\u0275property("ngIf", ctx.unreadChat);
        \u0275\u0275advance();
        \u0275\u0275classProp("open", ctx.chatOpen);
        \u0275\u0275advance(10);
        \u0275\u0275property("ngForOf", ctx.chatMessages);
        \u0275\u0275advance(2);
        \u0275\u0275property("ngForOf", ctx.chatSuggestions);
        \u0275\u0275advance(2);
        \u0275\u0275twoWayProperty("ngModel", ctx.chatInput);
        \u0275\u0275property("ngModelOptions", \u0275\u0275pureFunction0(20, _c0));
      }
    }, dependencies: [CommonModule, NgForOf, NgIf, RouterModule, RouterLink, FormsModule, DefaultValueAccessor, NgControlStatus, NgModel], styles: ['\n\n[_nghost-%COMP%] {\n  display: block;\n}\n.dashboard[_ngcontent-%COMP%] {\n  min-height: 100vh;\n  background: var(--bg, #0d1117);\n  color: var(--text, #e6edf3);\n  font-family:\n    "JetBrains Mono",\n    "Fira Code",\n    monospace;\n  position: relative;\n}\n.topbar[_ngcontent-%COMP%] {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  padding: 12px 20px;\n  background: var(--bg2, #161b22);\n  border-bottom: 1px solid var(--border, #30363d);\n  position: sticky;\n  top: 0;\n  z-index: 50;\n}\n.topbar-left[_ngcontent-%COMP%] {\n  display: flex;\n  align-items: center;\n  gap: 10px;\n}\n.logo-mark[_ngcontent-%COMP%] {\n  width: 28px;\n  height: 28px;\n  background: var(--blue, #58a6ff);\n  border-radius: 6px;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  color: #fff;\n  font-weight: 700;\n  font-size: 13px;\n}\n.logo-title[_ngcontent-%COMP%] {\n  font-size: 13px;\n  font-weight: 600;\n}\n.logo-sub[_ngcontent-%COMP%] {\n  font-size: 9px;\n  color: var(--text2, #8b949e);\n}\n.topbar-right[_ngcontent-%COMP%] {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n}\n.live-badge[_ngcontent-%COMP%] {\n  display: flex;\n  align-items: center;\n  gap: 5px;\n  padding: 3px 9px;\n  background: #0d2119;\n  border: 1px solid #3fb950;\n  border-radius: 12px;\n  font-size: 10px;\n  font-weight: 700;\n  color: #3fb950;\n}\n.live-dot[_ngcontent-%COMP%] {\n  width: 6px;\n  height: 6px;\n  background: #3fb950;\n  border-radius: 50%;\n  animation: _ngcontent-%COMP%_pulse 1.5s infinite;\n}\n@keyframes _ngcontent-%COMP%_pulse {\n  0%, 100% {\n    opacity: 1;\n  }\n  50% {\n    opacity: 0.4;\n  }\n}\n.icon-btn[_ngcontent-%COMP%] {\n  width: 30px;\n  height: 30px;\n  background: var(--bg3, #21262d);\n  border: 1px solid var(--border, #30363d);\n  border-radius: 6px;\n  color: var(--text2, #8b949e);\n  cursor: pointer;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  font-size: 14px;\n  position: relative;\n}\n.icon-btn[_ngcontent-%COMP%]:hover {\n  color: var(--text, #e6edf3);\n}\n.notif-count[_ngcontent-%COMP%] {\n  position: absolute;\n  top: -4px;\n  right: -4px;\n  background: #f85149;\n  color: #fff;\n  border-radius: 50%;\n  width: 14px;\n  height: 14px;\n  font-size: 8px;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  font-weight: 700;\n}\n.user-av[_ngcontent-%COMP%] {\n  width: 28px;\n  height: 28px;\n  background: var(--blue-bg, #0c1c2e);\n  border-radius: 50%;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  font-size: 10px;\n  font-weight: 700;\n  color: var(--blue, #58a6ff);\n}\n.close-btn[_ngcontent-%COMP%] {\n  background: none;\n  border: none;\n  color: var(--text2, #8b949e);\n  cursor: pointer;\n  font-size: 13px;\n}\n.notif-panel[_ngcontent-%COMP%] {\n  position: fixed;\n  top: 50px;\n  right: 20px;\n  width: 290px;\n  background: var(--bg2, #161b22);\n  border: 1px solid var(--border, #30363d);\n  border-radius: 10px;\n  z-index: 100;\n  display: none;\n}\n.notif-panel.open[_ngcontent-%COMP%] {\n  display: block;\n}\n.notif-header[_ngcontent-%COMP%] {\n  display: flex;\n  justify-content: space-between;\n  align-items: center;\n  padding: 10px 14px;\n  border-bottom: 1px solid var(--border, #30363d);\n  font-size: 12px;\n  font-weight: 600;\n}\n.notif-item[_ngcontent-%COMP%] {\n  display: flex;\n  align-items: flex-start;\n  gap: 8px;\n  padding: 9px 14px;\n  border-bottom: 1px solid var(--border, #30363d);\n}\n.notif-item[_ngcontent-%COMP%]:last-child {\n  border: none;\n}\n.notif-dot[_ngcontent-%COMP%] {\n  width: 7px;\n  height: 7px;\n  border-radius: 50%;\n  flex-shrink: 0;\n  margin-top: 3px;\n}\n.notif-item.error[_ngcontent-%COMP%]   .notif-dot[_ngcontent-%COMP%] {\n  background: #f85149;\n}\n.notif-item.warn[_ngcontent-%COMP%]   .notif-dot[_ngcontent-%COMP%] {\n  background: #d29922;\n}\n.notif-item.info[_ngcontent-%COMP%]   .notif-dot[_ngcontent-%COMP%] {\n  background: #58a6ff;\n}\n.notif-title[_ngcontent-%COMP%] {\n  font-size: 11px;\n  font-weight: 500;\n}\n.notif-meta[_ngcontent-%COMP%] {\n  font-size: 9px;\n  color: var(--text2, #8b949e);\n  margin-top: 2px;\n}\n.content[_ngcontent-%COMP%] {\n  padding: 18px 20px;\n}\n.kpi-grid[_ngcontent-%COMP%] {\n  display: grid;\n  grid-template-columns: repeat(4, 1fr);\n  gap: 10px;\n  margin-bottom: 18px;\n}\n.kpi-card[_ngcontent-%COMP%] {\n  background: var(--bg2, #161b22);\n  border: 1px solid var(--border, #30363d);\n  border-radius: 8px;\n  padding: 12px 14px;\n  display: flex;\n  align-items: center;\n  gap: 12px;\n}\n.kpi-icon[_ngcontent-%COMP%] {\n  font-size: 20px;\n}\n.kpi-val[_ngcontent-%COMP%] {\n  font-size: 22px;\n  font-weight: 700;\n  line-height: 1;\n}\n.kpi-label[_ngcontent-%COMP%] {\n  font-size: 10px;\n  color: var(--text2, #8b949e);\n  margin-top: 2px;\n}\n.kpi-sub[_ngcontent-%COMP%] {\n  font-size: 9px;\n  color: var(--text2, #8b949e);\n  margin-top: 1px;\n}\n.kpi-card.red[_ngcontent-%COMP%]   .kpi-icon[_ngcontent-%COMP%], .kpi-card.red[_ngcontent-%COMP%]   .kpi-val[_ngcontent-%COMP%] {\n  color: #f85149;\n}\n.kpi-card.green[_ngcontent-%COMP%]   .kpi-icon[_ngcontent-%COMP%], .kpi-card.green[_ngcontent-%COMP%]   .kpi-val[_ngcontent-%COMP%] {\n  color: #3fb950;\n}\n.kpi-card.blue[_ngcontent-%COMP%]   .kpi-icon[_ngcontent-%COMP%], .kpi-card.blue[_ngcontent-%COMP%]   .kpi-val[_ngcontent-%COMP%] {\n  color: #58a6ff;\n}\n.kpi-card.orange[_ngcontent-%COMP%]   .kpi-icon[_ngcontent-%COMP%], .kpi-card.orange[_ngcontent-%COMP%]   .kpi-val[_ngcontent-%COMP%] {\n  color: #d29922;\n}\n.two-col[_ngcontent-%COMP%] {\n  display: grid;\n  grid-template-columns: 1fr 1fr;\n  gap: 14px;\n  margin-bottom: 18px;\n}\n.card[_ngcontent-%COMP%] {\n  background: var(--bg2, #161b22);\n  border: 1px solid var(--border, #30363d);\n  border-radius: 8px;\n  padding: 14px;\n}\n.card-title[_ngcontent-%COMP%] {\n  display: flex;\n  align-items: center;\n  gap: 6px;\n  font-size: 11px;\n  font-weight: 600;\n  color: var(--text2, #8b949e);\n  text-transform: uppercase;\n  letter-spacing: 0.5px;\n  margin-bottom: 12px;\n}\n.card-title[_ngcontent-%COMP%]   i[_ngcontent-%COMP%] {\n  font-size: 13px;\n}\n.risk-list[_ngcontent-%COMP%] {\n  display: flex;\n  flex-direction: column;\n  gap: 14px;\n}\n.risk-item[_ngcontent-%COMP%] {\n  display: flex;\n  align-items: center;\n  gap: 12px;\n}\n.risk-proj-info[_ngcontent-%COMP%] {\n  display: flex;\n  align-items: center;\n  gap: 7px;\n  min-width: 130px;\n}\n.risk-av[_ngcontent-%COMP%] {\n  width: 28px;\n  height: 28px;\n  border-radius: 6px;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  font-weight: 700;\n  font-size: 10px;\n  flex-shrink: 0;\n}\n.risk-name[_ngcontent-%COMP%] {\n  font-size: 11px;\n  font-weight: 600;\n}\n.risk-tech[_ngcontent-%COMP%] {\n  font-size: 9px;\n  color: var(--text2, #8b949e);\n}\n.risk-ring-wrap[_ngcontent-%COMP%] {\n  position: relative;\n  width: 70px;\n  height: 70px;\n  flex-shrink: 0;\n}\n.risk-center-txt[_ngcontent-%COMP%] {\n  position: absolute;\n  top: 50%;\n  left: 50%;\n  transform: translate(-50%, -50%);\n  font-size: 14px;\n  font-weight: 700;\n}\n.risk-breakdown[_ngcontent-%COMP%] {\n  flex: 1;\n  display: flex;\n  flex-direction: column;\n  gap: 4px;\n}\n.rb-row[_ngcontent-%COMP%] {\n  display: flex;\n  align-items: center;\n  gap: 6px;\n  font-size: 9px;\n}\n.rb-lbl[_ngcontent-%COMP%] {\n  width: 65px;\n  color: var(--text2, #8b949e);\n}\n.rb-bar-bg[_ngcontent-%COMP%] {\n  flex: 1;\n  height: 3px;\n  background: var(--bg3, #21262d);\n  border-radius: 2px;\n  overflow: hidden;\n}\n.rb-bar[_ngcontent-%COMP%] {\n  height: 100%;\n  border-radius: 2px;\n  transition: width 0.4s;\n}\n.rb-val[_ngcontent-%COMP%] {\n  width: 22px;\n  text-align: right;\n  font-weight: 600;\n  font-size: 9px;\n}\n.heatmap-wrap[_ngcontent-%COMP%] {\n  margin-bottom: 8px;\n}\n.heatmap-legend[_ngcontent-%COMP%] {\n  display: flex;\n  align-items: center;\n  gap: 4px;\n  font-size: 9px;\n  color: var(--text2, #8b949e);\n}\n.hm-swatch[_ngcontent-%COMP%] {\n  width: 10px;\n  height: 10px;\n  border-radius: 2px;\n}\n.hm-row[_ngcontent-%COMP%] {\n  display: flex;\n  align-items: center;\n  gap: 2px;\n  margin-bottom: 2px;\n}\n.hm-lbl[_ngcontent-%COMP%] {\n  width: 18px;\n  font-size: 8px;\n  color: var(--text2, #8b949e);\n  text-align: right;\n}\n.hm-cell[_ngcontent-%COMP%] {\n  width: 12px;\n  height: 12px;\n  border-radius: 2px;\n  cursor: pointer;\n  transition: opacity 0.1s;\n}\n.hm-cell[_ngcontent-%COMP%]:hover {\n  opacity: 0.7;\n}\n.section-title[_ngcontent-%COMP%] {\n  display: flex;\n  align-items: center;\n  gap: 6px;\n  font-size: 11px;\n  font-weight: 600;\n  color: var(--text2, #8b949e);\n  text-transform: uppercase;\n  letter-spacing: 0.5px;\n  margin-bottom: 10px;\n}\n.section-count[_ngcontent-%COMP%] {\n  background: var(--bg3, #21262d);\n  border-radius: 8px;\n  padding: 1px 6px;\n  font-size: 9px;\n}\n.proj-grid[_ngcontent-%COMP%] {\n  display: grid;\n  grid-template-columns: repeat(2, 1fr);\n  gap: 12px;\n  margin-bottom: 18px;\n}\n.proj-card[_ngcontent-%COMP%] {\n  background: var(--bg2, #161b22);\n  border: 1px solid var(--border, #30363d);\n  border-radius: 10px;\n  padding: 14px;\n  cursor: pointer;\n  transition: all 0.15s;\n  text-decoration: none;\n  color: inherit;\n  display: block;\n}\n.proj-card[_ngcontent-%COMP%]:hover {\n  border-color: #58a6ff;\n  transform: translateY(-2px);\n  box-shadow: 0 4px 16px rgba(88, 166, 255, 0.1);\n}\n.proj-card-header[_ngcontent-%COMP%] {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  margin-bottom: 10px;\n}\n.proj-av[_ngcontent-%COMP%] {\n  width: 32px;\n  height: 32px;\n  border-radius: 7px;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  font-weight: 700;\n  font-size: 11px;\n  flex-shrink: 0;\n}\n.proj-info[_ngcontent-%COMP%] {\n  flex: 1;\n}\n.proj-name[_ngcontent-%COMP%] {\n  font-size: 12px;\n  font-weight: 600;\n}\n.proj-tech[_ngcontent-%COMP%] {\n  font-size: 9px;\n  color: var(--text2, #8b949e);\n  margin-top: 1px;\n}\n.decision-badge[_ngcontent-%COMP%] {\n  padding: 2px 7px;\n  border-radius: 4px;\n  font-size: 9px;\n  font-weight: 700;\n}\n.decision-badge.notify_only[_ngcontent-%COMP%], .decision-badge.notify[_ngcontent-%COMP%] {\n  background: #271d0a;\n  color: #d29922;\n}\n.decision-badge.auto_fix[_ngcontent-%COMP%], .decision-badge.autofix[_ngcontent-%COMP%] {\n  background: #0d2119;\n  color: #3fb950;\n}\n.decision-badge.block[_ngcontent-%COMP%] {\n  background: #2d1117;\n  color: #f85149;\n}\n.proj-pills[_ngcontent-%COMP%] {\n  display: flex;\n  gap: 5px;\n  flex-wrap: wrap;\n  margin-bottom: 8px;\n}\n.pill[_ngcontent-%COMP%] {\n  padding: 2px 6px;\n  border-radius: 8px;\n  font-size: 9px;\n  font-weight: 600;\n}\n.pill.red[_ngcontent-%COMP%] {\n  background: #2d1117;\n  color: #f85149;\n}\n.pill.green[_ngcontent-%COMP%] {\n  background: #0d2119;\n  color: #3fb950;\n}\n.pill.orange[_ngcontent-%COMP%] {\n  background: #271d0a;\n  color: #d29922;\n}\n.proj-sparkline[_ngcontent-%COMP%] {\n  height: 30px;\n  margin: 6px 0;\n}\n.health-bar-wrap[_ngcontent-%COMP%] {\n  height: 3px;\n  background: var(--bg3, #21262d);\n  border-radius: 2px;\n  overflow: hidden;\n}\n.health-bar[_ngcontent-%COMP%] {\n  height: 100%;\n  border-radius: 2px;\n  transition: width 0.4s;\n}\n.health-label[_ngcontent-%COMP%] {\n  display: flex;\n  justify-content: space-between;\n  margin-top: 3px;\n  font-size: 9px;\n  color: var(--text2, #8b949e);\n}\n.proj-footer[_ngcontent-%COMP%] {\n  display: flex;\n  justify-content: space-between;\n  align-items: center;\n  margin-top: 8px;\n  font-size: 9px;\n  color: var(--text2, #8b949e);\n}\n.risk-badge[_ngcontent-%COMP%] {\n  font-weight: 600;\n}\n.dora-grid[_ngcontent-%COMP%] {\n  display: grid;\n  grid-template-columns: repeat(2, 1fr);\n  gap: 8px;\n}\n.dora-card[_ngcontent-%COMP%] {\n  background: var(--bg3, #21262d);\n  border: 1px solid var(--border, #30363d);\n  border-radius: 7px;\n  padding: 10px;\n  text-align: center;\n}\n.dora-icon[_ngcontent-%COMP%] {\n  font-size: 18px;\n  margin-bottom: 4px;\n}\n.dora-val[_ngcontent-%COMP%] {\n  font-size: 16px;\n  font-weight: 700;\n  margin-bottom: 2px;\n}\n.dora-label[_ngcontent-%COMP%] {\n  font-size: 9px;\n  color: var(--text2, #8b949e);\n  line-height: 1.3;\n  margin-bottom: 4px;\n}\n.dora-badge[_ngcontent-%COMP%] {\n  display: inline-block;\n  padding: 2px 7px;\n  border-radius: 8px;\n  font-size: 8px;\n  font-weight: 700;\n}\n.activity-list[_ngcontent-%COMP%] {\n  display: flex;\n  flex-direction: column;\n  gap: 6px;\n}\n.activity-item[_ngcontent-%COMP%] {\n  display: flex;\n  align-items: flex-start;\n  gap: 8px;\n  padding: 7px 9px;\n  background: var(--bg3, #21262d);\n  border-radius: 5px;\n}\n.act-dot[_ngcontent-%COMP%] {\n  width: 6px;\n  height: 6px;\n  border-radius: 50%;\n  flex-shrink: 0;\n  margin-top: 3px;\n}\n.act-title[_ngcontent-%COMP%] {\n  font-size: 11px;\n  font-weight: 500;\n}\n.act-meta[_ngcontent-%COMP%] {\n  font-size: 9px;\n  color: var(--text2, #8b949e);\n  margin-top: 2px;\n}\n.pred-banner[_ngcontent-%COMP%] {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 12px;\n  background: #1e1433;\n  border: 1px solid #bc8cff;\n  border-radius: 8px;\n  padding: 12px 16px;\n}\n.pred-left[_ngcontent-%COMP%] {\n  display: flex;\n  align-items: center;\n  gap: 12px;\n}\n.pred-icon[_ngcontent-%COMP%] {\n  font-size: 22px;\n  color: #bc8cff;\n}\n.pred-title[_ngcontent-%COMP%] {\n  font-size: 12px;\n  font-weight: 600;\n  color: #bc8cff;\n  margin-bottom: 3px;\n}\n.pred-desc[_ngcontent-%COMP%] {\n  font-size: 11px;\n  color: var(--text2, #8b949e);\n}\n.pred-right[_ngcontent-%COMP%] {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n}\n.pred-btn[_ngcontent-%COMP%] {\n  padding: 6px 12px;\n  background: #bc8cff;\n  border-radius: 6px;\n  color: #fff;\n  font-size: 11px;\n  font-weight: 600;\n  text-decoration: none;\n}\n.chat-fab[_ngcontent-%COMP%] {\n  position: fixed;\n  bottom: 20px;\n  right: 20px;\n  width: 44px;\n  height: 44px;\n  background: #58a6ff;\n  border-radius: 50%;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  cursor: pointer;\n  z-index: 100;\n  box-shadow: 0 4px 14px rgba(88, 166, 255, 0.4);\n  font-size: 20px;\n  color: #fff;\n}\n.fab-badge[_ngcontent-%COMP%] {\n  position: absolute;\n  top: -3px;\n  right: -3px;\n  background: #f85149;\n  color: #fff;\n  border-radius: 50%;\n  width: 16px;\n  height: 16px;\n  font-size: 9px;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  font-weight: 700;\n}\n.chat-popup[_ngcontent-%COMP%] {\n  position: fixed;\n  bottom: 72px;\n  right: 20px;\n  width: 310px;\n  background: var(--bg2, #161b22);\n  border: 1px solid var(--border, #30363d);\n  border-radius: 12px;\n  z-index: 99;\n  display: none;\n  flex-direction: column;\n  max-height: 400px;\n}\n.chat-popup.open[_ngcontent-%COMP%] {\n  display: flex;\n}\n.cp-header[_ngcontent-%COMP%] {\n  display: flex;\n  align-items: center;\n  gap: 7px;\n  padding: 10px 12px;\n  border-bottom: 1px solid var(--border, #30363d);\n  font-size: 12px;\n  font-weight: 600;\n}\n.cp-title[_ngcontent-%COMP%] {\n  display: flex;\n  align-items: center;\n  gap: 5px;\n  flex: 1;\n}\n.online-dot[_ngcontent-%COMP%] {\n  font-size: 9px;\n  color: #3fb950;\n  margin-left: auto;\n}\n.cp-messages[_ngcontent-%COMP%] {\n  flex: 1;\n  overflow-y: auto;\n  padding: 10px;\n  display: flex;\n  flex-direction: column;\n  gap: 6px;\n}\n.cp-msg[_ngcontent-%COMP%] {\n  font-size: 11px;\n  padding: 7px 9px;\n  border-radius: 8px;\n  line-height: 1.4;\n  max-width: 90%;\n}\n.cp-msg.ai[_ngcontent-%COMP%] {\n  background: var(--bg3, #21262d);\n  border: 1px solid var(--border, #30363d);\n  align-self: flex-start;\n}\n.cp-msg.user[_ngcontent-%COMP%] {\n  background: #58a6ff;\n  color: #fff;\n  align-self: flex-end;\n}\n.cp-suggestions[_ngcontent-%COMP%] {\n  display: flex;\n  gap: 4px;\n  padding: 6px 9px;\n  flex-wrap: wrap;\n  border-top: 1px solid var(--border, #30363d);\n}\n.cp-sug[_ngcontent-%COMP%] {\n  padding: 3px 7px;\n  background: var(--bg3, #21262d);\n  border: 1px solid var(--border, #30363d);\n  border-radius: 10px;\n  font-size: 9px;\n  color: var(--text2, #8b949e);\n  cursor: pointer;\n}\n.cp-sug[_ngcontent-%COMP%]:hover {\n  color: var(--text, #e6edf3);\n}\n.cp-input-row[_ngcontent-%COMP%] {\n  display: flex;\n  gap: 6px;\n  padding: 8px 10px;\n  border-top: 1px solid var(--border, #30363d);\n}\n.cp-input[_ngcontent-%COMP%] {\n  flex: 1;\n  padding: 6px 9px;\n  background: var(--bg3, #21262d);\n  border: 1px solid var(--border, #30363d);\n  border-radius: 6px;\n  color: var(--text, #e6edf3);\n  font-size: 11px;\n  outline: none;\n  font-family: inherit;\n}\n.cp-input[_ngcontent-%COMP%]:focus {\n  border-color: #58a6ff;\n}\n.cp-send[_ngcontent-%COMP%] {\n  padding: 6px 10px;\n  background: #58a6ff;\n  border: none;\n  border-radius: 6px;\n  color: #fff;\n  font-size: 12px;\n  cursor: pointer;\n}\n/*# sourceMappingURL=dashboard.component.css.map */'] });
  }
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && \u0275setClassDebugInfo(DashboardComponent, { className: "DashboardComponent", filePath: "src/app/features/dashboard/dashboard.component.ts", lineNumber: 422 });
})();
export {
  DashboardComponent
};
//# sourceMappingURL=chunk-FKCQIORZ.js.map
