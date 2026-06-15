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
  ɵɵclassMap,
  ɵɵclassMapInterpolate1,
  ɵɵclassProp,
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
  ɵɵpipeBind2,
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
  ɵɵtextInterpolate2
} from "./chunk-ZQZUXNDQ.js";

// src/app/features/projects/project-detail.component.ts
var _c0 = () => ["/incidents"];
var _c1 = (a0) => ({ projectId: a0 });
function ProjectDetailComponent_div_4_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementStart(0, "div", 6)(1, "div", 7)(2, "div", 8);
    \u0275\u0275text(3);
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(4, "div")(5, "h1", 9);
    \u0275\u0275text(6);
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(7, "p", 10);
    \u0275\u0275text(8);
    \u0275\u0275elementEnd()()();
    \u0275\u0275elementStart(9, "div", 11)(10, "div", 12)(11, "span", 13);
    \u0275\u0275text(12);
    \u0275\u0275pipe(13, "number");
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(14, "span", 14);
    \u0275\u0275text(15, "Sant\xE9");
    \u0275\u0275elementEnd()()()();
  }
  if (rf & 2) {
    const ctx_r0 = \u0275\u0275nextContext();
    \u0275\u0275advance(2);
    \u0275\u0275styleProp("border-color", ctx_r0.getHealthColor(ctx_r0.project.healthScore));
    \u0275\u0275advance();
    \u0275\u0275textInterpolate1(" ", ctx_r0.project.name == null ? null : ctx_r0.project.name.substring(0, 2).toUpperCase(), " ");
    \u0275\u0275advance(3);
    \u0275\u0275textInterpolate1("// ", ctx_r0.project.name, "");
    \u0275\u0275advance(2);
    \u0275\u0275textInterpolate(ctx_r0.project.description || "Projet DevSecOps sous surveillance IA");
    \u0275\u0275advance(2);
    \u0275\u0275styleProp("--health-color", ctx_r0.getHealthColor(ctx_r0.project.healthScore));
    \u0275\u0275advance(2);
    \u0275\u0275textInterpolate1("", \u0275\u0275pipeBind2(13, 8, ctx_r0.project.healthScore, "1.0-0"), "%");
  }
}
function ProjectDetailComponent_div_5_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementStart(0, "div", 15);
    \u0275\u0275element(1, "div", 16);
    \u0275\u0275elementEnd();
  }
}
function ProjectDetailComponent_ng_container_6_div_37_div_1_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementStart(0, "div", 30)(1, "div", 31);
    \u0275\u0275text(2, "\u{1F916}");
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(3, "div", 32);
    \u0275\u0275text(4, "Aucun rapport IA disponible");
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(5, "div", 33);
    \u0275\u0275text(6, "Lancez un build Jenkins pour g\xE9n\xE9rer un rapport");
    \u0275\u0275elementEnd()();
  }
}
function ProjectDetailComponent_ng_container_6_div_37_div_2_div_30_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementStart(0, "div", 67)(1, "div", 54)(2, "span", 55);
    \u0275\u0275text(3, "\u274C");
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(4, "span", 56);
    \u0275\u0275text(5, "ERREURS D\xC9TECT\xC9ES");
    \u0275\u0275elementEnd()();
    \u0275\u0275elementStart(6, "div", 68)(7, "p");
    \u0275\u0275text(8);
    \u0275\u0275elementEnd()()();
  }
  if (rf & 2) {
    const ctx_r0 = \u0275\u0275nextContext(4);
    \u0275\u0275advance(8);
    \u0275\u0275textInterpolate(ctx_r0.rp.errors);
  }
}
function ProjectDetailComponent_ng_container_6_div_37_div_2_div_31_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementStart(0, "div", 69)(1, "div", 54)(2, "span", 55);
    \u0275\u0275text(3, "\u{1F916}");
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(4, "span", 56);
    \u0275\u0275text(5, "CE QUE LES AGENTS IA ONT FAIT");
    \u0275\u0275elementEnd()();
    \u0275\u0275elementStart(6, "div", 58)(7, "p");
    \u0275\u0275text(8);
    \u0275\u0275elementEnd()()();
  }
  if (rf & 2) {
    const ctx_r0 = \u0275\u0275nextContext(4);
    \u0275\u0275advance(8);
    \u0275\u0275textInterpolate(ctx_r0.rp.agentActions);
  }
}
function ProjectDetailComponent_ng_container_6_div_37_div_2_div_32_div_9_div_1_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementStart(0, "div", 77)(1, "span", 78);
    \u0275\u0275text(2, "\u26A0");
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(3, "span");
    \u0275\u0275text(4);
    \u0275\u0275elementEnd()();
  }
  if (rf & 2) {
    const issue_r4 = ctx.$implicit;
    \u0275\u0275advance(4);
    \u0275\u0275textInterpolate(issue_r4);
  }
}
function ProjectDetailComponent_ng_container_6_div_37_div_2_div_32_div_9_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementStart(0, "div", 75);
    \u0275\u0275template(1, ProjectDetailComponent_ng_container_6_div_37_div_2_div_32_div_9_div_1_Template, 5, 1, "div", 76);
    \u0275\u0275elementEnd();
  }
  if (rf & 2) {
    const ctx_r0 = \u0275\u0275nextContext(5);
    \u0275\u0275advance();
    \u0275\u0275property("ngForOf", ctx_r0.rawSecurity.securityIssues);
  }
}
function ProjectDetailComponent_ng_container_6_div_37_div_2_div_32_div_10_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementStart(0, "div", 79)(1, "span", 80);
    \u0275\u0275text(2, "Recommandation s\xE9curit\xE9 :");
    \u0275\u0275elementEnd();
    \u0275\u0275text(3);
    \u0275\u0275elementEnd();
  }
  if (rf & 2) {
    const ctx_r0 = \u0275\u0275nextContext(5);
    \u0275\u0275advance(3);
    \u0275\u0275textInterpolate1(" ", ctx_r0.rawSecurity.secRecommendation, " ");
  }
}
function ProjectDetailComponent_ng_container_6_div_37_div_2_div_32_div_11_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementStart(0, "div", 81)(1, "span");
    \u0275\u0275text(2);
    \u0275\u0275elementEnd()();
  }
  if (rf & 2) {
    const ctx_r0 = \u0275\u0275nextContext(5);
    \u0275\u0275advance();
    \u0275\u0275classMap(ctx_r0.rawSecurity.safeToApply ? "safe-yes" : "safe-no");
    \u0275\u0275advance();
    \u0275\u0275textInterpolate1(" ", ctx_r0.rawSecurity.safeToApply ? "\u2705 Application s\xFBre" : "\u{1F6AB} Application risqu\xE9e", " ");
  }
}
function ProjectDetailComponent_ng_container_6_div_37_div_2_div_32_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementStart(0, "div", 70)(1, "div", 54)(2, "span", 55);
    \u0275\u0275text(3, "\u{1F512}");
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(4, "span", 56);
    \u0275\u0275text(5, "ANALYSE S\xC9CURIT\xC9");
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(6, "span", 71);
    \u0275\u0275text(7);
    \u0275\u0275elementEnd()();
    \u0275\u0275elementStart(8, "div", 58);
    \u0275\u0275template(9, ProjectDetailComponent_ng_container_6_div_37_div_2_div_32_div_9_Template, 2, 1, "div", 72)(10, ProjectDetailComponent_ng_container_6_div_37_div_2_div_32_div_10_Template, 4, 1, "div", 73)(11, ProjectDetailComponent_ng_container_6_div_37_div_2_div_32_div_11_Template, 3, 3, "div", 74);
    \u0275\u0275elementEnd()();
  }
  if (rf & 2) {
    const ctx_r0 = \u0275\u0275nextContext(4);
    \u0275\u0275advance(6);
    \u0275\u0275styleProp("color", ctx_r0.getSecurityColor(ctx_r0.rawSecurity.riskLevel))("background", ctx_r0.getSecurityColor(ctx_r0.rawSecurity.riskLevel) + "18");
    \u0275\u0275advance();
    \u0275\u0275textInterpolate1(" ", ctx_r0.rawSecurity.riskLevel || "N/A", " ");
    \u0275\u0275advance(2);
    \u0275\u0275property("ngIf", ctx_r0.rawSecurity.securityIssues == null ? null : ctx_r0.rawSecurity.securityIssues.length);
    \u0275\u0275advance();
    \u0275\u0275property("ngIf", ctx_r0.rawSecurity.secRecommendation);
    \u0275\u0275advance();
    \u0275\u0275property("ngIf", ctx_r0.rawSecurity.safeToApply !== void 0);
  }
}
function ProjectDetailComponent_ng_container_6_div_37_div_2_div_33_p_10_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementStart(0, "p", 87);
    \u0275\u0275text(1);
    \u0275\u0275elementEnd();
  }
  if (rf & 2) {
    const ctx_r0 = \u0275\u0275nextContext(5);
    \u0275\u0275advance();
    \u0275\u0275textInterpolate1(" ", ctx_r0.rawRemediation.fixDescription, " ");
  }
}
function ProjectDetailComponent_ng_container_6_div_37_div_2_div_33_div_11_div_1_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementStart(0, "div", 90)(1, "span", 91);
    \u0275\u0275text(2);
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(3, "span");
    \u0275\u0275text(4);
    \u0275\u0275elementEnd()();
  }
  if (rf & 2) {
    const step_r5 = ctx.$implicit;
    const i_r6 = ctx.index;
    \u0275\u0275advance(2);
    \u0275\u0275textInterpolate(i_r6 + 1);
    \u0275\u0275advance(2);
    \u0275\u0275textInterpolate(step_r5);
  }
}
function ProjectDetailComponent_ng_container_6_div_37_div_2_div_33_div_11_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementStart(0, "div", 88);
    \u0275\u0275template(1, ProjectDetailComponent_ng_container_6_div_37_div_2_div_33_div_11_div_1_Template, 5, 2, "div", 89);
    \u0275\u0275elementEnd();
  }
  if (rf & 2) {
    const ctx_r0 = \u0275\u0275nextContext(5);
    \u0275\u0275advance();
    \u0275\u0275property("ngForOf", ctx_r0.rawRemediation.fixSteps);
  }
}
function ProjectDetailComponent_ng_container_6_div_37_div_2_div_33_div_12_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementStart(0, "div", 92)(1, "span");
    \u0275\u0275text(2);
    \u0275\u0275elementEnd()();
  }
  if (rf & 2) {
    const ctx_r0 = \u0275\u0275nextContext(5);
    \u0275\u0275advance();
    \u0275\u0275classMap(ctx_r0.rawRemediation.autoFixable ? "autofix-yes" : "autofix-no");
    \u0275\u0275advance();
    \u0275\u0275textInterpolate1(" ", ctx_r0.rawRemediation.autoFixable ? "\u{1F916} Correction automatique possible" : "\u{1F468}\u200D\u{1F4BB} Correction manuelle requise", " ");
  }
}
function ProjectDetailComponent_ng_container_6_div_37_div_2_div_33_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementStart(0, "div", 82)(1, "div", 54)(2, "span", 55);
    \u0275\u0275text(3, "\u{1F527}");
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(4, "span", 56);
    \u0275\u0275text(5, "PLAN DE REM\xC9DIATION");
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(6, "span", 83);
    \u0275\u0275text(7);
    \u0275\u0275pipe(8, "number");
    \u0275\u0275elementEnd()();
    \u0275\u0275elementStart(9, "div", 58);
    \u0275\u0275template(10, ProjectDetailComponent_ng_container_6_div_37_div_2_div_33_p_10_Template, 2, 1, "p", 84)(11, ProjectDetailComponent_ng_container_6_div_37_div_2_div_33_div_11_Template, 2, 1, "div", 85)(12, ProjectDetailComponent_ng_container_6_div_37_div_2_div_33_div_12_Template, 3, 3, "div", 86);
    \u0275\u0275elementEnd()();
  }
  if (rf & 2) {
    const ctx_r0 = \u0275\u0275nextContext(4);
    \u0275\u0275advance(7);
    \u0275\u0275textInterpolate1(" Confiance IA : ", \u0275\u0275pipeBind2(8, 4, (ctx_r0.rawRemediation.confidence || 0) * 100, "1.0-0"), "% ");
    \u0275\u0275advance(3);
    \u0275\u0275property("ngIf", ctx_r0.rawRemediation.fixDescription);
    \u0275\u0275advance();
    \u0275\u0275property("ngIf", ctx_r0.rawRemediation.fixSteps == null ? null : ctx_r0.rawRemediation.fixSteps.length);
    \u0275\u0275advance();
    \u0275\u0275property("ngIf", ctx_r0.rawRemediation.autoFixable !== void 0);
  }
}
function ProjectDetailComponent_ng_container_6_div_37_div_2_span_40_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementStart(0, "span", 93);
    \u0275\u0275text(1);
    \u0275\u0275elementEnd();
  }
  if (rf & 2) {
    const ctx_r0 = \u0275\u0275nextContext(4);
    \u0275\u0275advance();
    \u0275\u0275textInterpolate2(" ", ctx_r0.checkedTasks, "/", ctx_r0.devTasks.length, " compl\xE9t\xE9es ");
  }
}
function ProjectDetailComponent_ng_container_6_div_37_div_2_div_42_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementStart(0, "div", 94)(1, "span", 95);
    \u0275\u0275text(2);
    \u0275\u0275elementEnd()();
  }
  if (rf & 2) {
    const ctx_r0 = \u0275\u0275nextContext(4);
    \u0275\u0275advance(2);
    \u0275\u0275textInterpolate(ctx_r0.rp.developerActions || "Aucune action requise");
  }
}
function ProjectDetailComponent_ng_container_6_div_37_div_2_div_43_div_1_span_2_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementStart(0, "span");
    \u0275\u0275text(1, "\u2713");
    \u0275\u0275elementEnd();
  }
}
function ProjectDetailComponent_ng_container_6_div_37_div_2_div_43_div_1_span_6_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementStart(0, "span", 103);
    \u0275\u0275text(1);
    \u0275\u0275elementEnd();
  }
  if (rf & 2) {
    const task_r9 = \u0275\u0275nextContext().$implicit;
    \u0275\u0275classMap("priority-" + task_r9.priority.toLowerCase());
    \u0275\u0275advance();
    \u0275\u0275textInterpolate1(" ", task_r9.priority, " ");
  }
}
function ProjectDetailComponent_ng_container_6_div_37_div_2_div_43_div_1_Template(rf, ctx) {
  if (rf & 1) {
    const _r7 = \u0275\u0275getCurrentView();
    \u0275\u0275elementStart(0, "div", 98);
    \u0275\u0275listener("click", function ProjectDetailComponent_ng_container_6_div_37_div_2_div_43_div_1_Template_div_click_0_listener() {
      const i_r8 = \u0275\u0275restoreView(_r7).index;
      const ctx_r0 = \u0275\u0275nextContext(5);
      return \u0275\u0275resetView(ctx_r0.toggleTask(i_r8));
    });
    \u0275\u0275elementStart(1, "div", 99);
    \u0275\u0275template(2, ProjectDetailComponent_ng_container_6_div_37_div_2_div_43_div_1_span_2_Template, 2, 0, "span", 5);
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(3, "div", 100)(4, "span", 101);
    \u0275\u0275text(5);
    \u0275\u0275elementEnd();
    \u0275\u0275template(6, ProjectDetailComponent_ng_container_6_div_37_div_2_div_43_div_1_span_6_Template, 2, 3, "span", 102);
    \u0275\u0275elementEnd()();
  }
  if (rf & 2) {
    const task_r9 = ctx.$implicit;
    \u0275\u0275classProp("checked", task_r9.done);
    \u0275\u0275advance();
    \u0275\u0275classProp("checked", task_r9.done);
    \u0275\u0275advance();
    \u0275\u0275property("ngIf", task_r9.done);
    \u0275\u0275advance(2);
    \u0275\u0275classProp("done", task_r9.done);
    \u0275\u0275advance();
    \u0275\u0275textInterpolate(task_r9.text);
    \u0275\u0275advance();
    \u0275\u0275property("ngIf", task_r9.priority);
  }
}
function ProjectDetailComponent_ng_container_6_div_37_div_2_div_43_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementStart(0, "div", 96);
    \u0275\u0275template(1, ProjectDetailComponent_ng_container_6_div_37_div_2_div_43_div_1_Template, 7, 9, "div", 97);
    \u0275\u0275elementEnd();
  }
  if (rf & 2) {
    const ctx_r0 = \u0275\u0275nextContext(4);
    \u0275\u0275advance();
    \u0275\u0275property("ngForOf", ctx_r0.devTasks);
  }
}
function ProjectDetailComponent_ng_container_6_div_37_div_2_div_44_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementStart(0, "div", 104)(1, "div", 105);
    \u0275\u0275element(2, "div");
    \u0275\u0275elementEnd()();
  }
  if (rf & 2) {
    const ctx_r0 = \u0275\u0275nextContext(4);
    \u0275\u0275advance(2);
    \u0275\u0275styleProp("width", ctx_r0.checkedTasks / ctx_r0.devTasks.length * 100 + "%");
  }
}
function ProjectDetailComponent_ng_container_6_div_37_div_2_div_45_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementStart(0, "div", 106)(1, "div", 54)(2, "span", 55);
    \u0275\u0275text(3, "\u{1F4A1}");
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(4, "span", 56);
    \u0275\u0275text(5, "RECOMMANDATIONS");
    \u0275\u0275elementEnd()();
    \u0275\u0275elementStart(6, "div", 58)(7, "p");
    \u0275\u0275text(8);
    \u0275\u0275elementEnd()()();
  }
  if (rf & 2) {
    const ctx_r0 = \u0275\u0275nextContext(4);
    \u0275\u0275advance(8);
    \u0275\u0275textInterpolate(ctx_r0.rp.recommendations);
  }
}
function ProjectDetailComponent_ng_container_6_div_37_div_2_div_46_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementStart(0, "div", 107)(1, "div", 54)(2, "span", 55);
    \u0275\u0275text(3, "\u{1F4DD}");
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(4, "span", 56);
    \u0275\u0275text(5, "RAISON DE LA D\xC9CISION");
    \u0275\u0275elementEnd()();
    \u0275\u0275elementStart(6, "div", 58)(7, "p", 108);
    \u0275\u0275text(8);
    \u0275\u0275elementEnd()()();
  }
  if (rf & 2) {
    const ctx_r0 = \u0275\u0275nextContext(4);
    \u0275\u0275advance(8);
    \u0275\u0275textInterpolate(ctx_r0.rp.reason);
  }
}
function ProjectDetailComponent_ng_container_6_div_37_div_2_Template(rf, ctx) {
  if (rf & 1) {
    const _r3 = \u0275\u0275getCurrentView();
    \u0275\u0275elementStart(0, "div", 34)(1, "div", 35)(2, "div", 36)(3, "div", 37);
    \u0275\u0275text(4);
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(5, "div", 38);
    \u0275\u0275text(6, "RAPPORT DEVSECOPS IA");
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(7, "div", 39)(8, "span");
    \u0275\u0275text(9);
    \u0275\u0275pipe(10, "date");
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(11, "span", 40);
    \u0275\u0275text(12, "\xB7");
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(13, "span");
    \u0275\u0275text(14);
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(15, "span", 40);
    \u0275\u0275text(16, "\xB7");
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(17, "span");
    \u0275\u0275text(18);
    \u0275\u0275elementEnd()()();
    \u0275\u0275elementStart(19, "div", 41)(20, "div", 42);
    \u0275\u0275text(21);
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(22, "div", 43)(23, "div", 44);
    \u0275\u0275element(24, "div", 45);
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(25, "span", 46);
    \u0275\u0275text(26);
    \u0275\u0275elementEnd()();
    \u0275\u0275elementStart(27, "div", 47);
    \u0275\u0275text(28);
    \u0275\u0275elementEnd()()();
    \u0275\u0275elementStart(29, "div", 48);
    \u0275\u0275template(30, ProjectDetailComponent_ng_container_6_div_37_div_2_div_30_Template, 9, 1, "div", 49)(31, ProjectDetailComponent_ng_container_6_div_37_div_2_div_31_Template, 9, 1, "div", 50)(32, ProjectDetailComponent_ng_container_6_div_37_div_2_div_32_Template, 12, 8, "div", 51)(33, ProjectDetailComponent_ng_container_6_div_37_div_2_div_33_Template, 13, 7, "div", 52);
    \u0275\u0275elementStart(34, "div", 53)(35, "div", 54)(36, "span", 55);
    \u0275\u0275text(37, "\u{1F468}\u200D\u{1F4BB}");
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(38, "span", 56);
    \u0275\u0275text(39, "CE QUE LE D\xC9VELOPPEUR DOIT FAIRE");
    \u0275\u0275elementEnd();
    \u0275\u0275template(40, ProjectDetailComponent_ng_container_6_div_37_div_2_span_40_Template, 2, 2, "span", 57);
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(41, "div", 58);
    \u0275\u0275template(42, ProjectDetailComponent_ng_container_6_div_37_div_2_div_42_Template, 3, 1, "div", 59)(43, ProjectDetailComponent_ng_container_6_div_37_div_2_div_43_Template, 2, 1, "div", 60)(44, ProjectDetailComponent_ng_container_6_div_37_div_2_div_44_Template, 3, 2, "div", 61);
    \u0275\u0275elementEnd()();
    \u0275\u0275template(45, ProjectDetailComponent_ng_container_6_div_37_div_2_div_45_Template, 9, 1, "div", 62)(46, ProjectDetailComponent_ng_container_6_div_37_div_2_div_46_Template, 9, 1, "div", 63);
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(47, "div", 64)(48, "span", 65);
    \u0275\u0275text(49);
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(50, "button", 66);
    \u0275\u0275listener("click", function ProjectDetailComponent_ng_container_6_div_37_div_2_Template_button_click_50_listener() {
      \u0275\u0275restoreView(_r3);
      const ctx_r0 = \u0275\u0275nextContext(3);
      return \u0275\u0275resetView(ctx_r0.copyReport());
    });
    \u0275\u0275text(51, "\u{1F4CB} Copier le rapport");
    \u0275\u0275elementEnd()()();
  }
  if (rf & 2) {
    const ctx_r0 = \u0275\u0275nextContext(3);
    \u0275\u0275advance();
    \u0275\u0275classProp("block", ctx_r0.rp.decision === "BLOCK")("autofix", ctx_r0.rp.decision === "AUTO_FIX")("notify", ctx_r0.rp.decision === "NOTIFY_ONLY");
    \u0275\u0275advance(3);
    \u0275\u0275textInterpolate1("Build #", ctx_r0.rp.build || "?", "");
    \u0275\u0275advance(5);
    \u0275\u0275textInterpolate(\u0275\u0275pipeBind2(10, 37, ctx_r0.latestReport.createdAt, "dd/MM/yyyy HH:mm"));
    \u0275\u0275advance(5);
    \u0275\u0275textInterpolate(ctx_r0.rp.job || "N/A");
    \u0275\u0275advance(4);
    \u0275\u0275textInterpolate(ctx_r0.rp.branch || "N/A");
    \u0275\u0275advance(2);
    \u0275\u0275styleProp("color", ctx_r0.getDecisionColor(ctx_r0.rp.decision))("border-color", ctx_r0.getDecisionColor(ctx_r0.rp.decision))("background", ctx_r0.getDecisionColor(ctx_r0.rp.decision) + "18");
    \u0275\u0275advance();
    \u0275\u0275textInterpolate1(" ", ctx_r0.rp.decision || "N/A", " ");
    \u0275\u0275advance(3);
    \u0275\u0275styleProp("width", ctx_r0.rp.confidence || "0%")("background", ctx_r0.getDecisionColor(ctx_r0.rp.decision));
    \u0275\u0275advance(2);
    \u0275\u0275textInterpolate1("Confiance : ", ctx_r0.rp.confidence || "0%", "");
    \u0275\u0275advance();
    \u0275\u0275styleProp("color", ctx_r0.getSecurityColor(ctx_r0.rp.security));
    \u0275\u0275advance();
    \u0275\u0275textInterpolate1(" \u{1F512} ", ctx_r0.rp.security || "UNKNOWN", " ");
    \u0275\u0275advance(2);
    \u0275\u0275property("ngIf", ctx_r0.rp.errors);
    \u0275\u0275advance();
    \u0275\u0275property("ngIf", ctx_r0.rp.agentActions);
    \u0275\u0275advance();
    \u0275\u0275property("ngIf", ctx_r0.rawSecurity);
    \u0275\u0275advance();
    \u0275\u0275property("ngIf", ctx_r0.rawRemediation);
    \u0275\u0275advance(7);
    \u0275\u0275property("ngIf", ctx_r0.devTasks.length);
    \u0275\u0275advance(2);
    \u0275\u0275property("ngIf", ctx_r0.devTasks.length === 0);
    \u0275\u0275advance();
    \u0275\u0275property("ngIf", ctx_r0.devTasks.length > 0);
    \u0275\u0275advance();
    \u0275\u0275property("ngIf", ctx_r0.devTasks.length > 0);
    \u0275\u0275advance();
    \u0275\u0275property("ngIf", ctx_r0.rp.recommendations);
    \u0275\u0275advance();
    \u0275\u0275property("ngIf", ctx_r0.rp.reason);
    \u0275\u0275advance(3);
    \u0275\u0275textInterpolate2(" G\xE9n\xE9r\xE9 par Claude claude-opus-4-5 (Judge) + llama3.2:3b (Agents) \xB7 Score s\xE9curit\xE9: ", ctx_r0.latestReport.securityScore, "% \xB7 Risque: ", ctx_r0.latestReport.riskLevel, " ");
  }
}
function ProjectDetailComponent_ng_container_6_div_37_div_3_div_4_Template(rf, ctx) {
  if (rf & 1) {
    const _r10 = \u0275\u0275getCurrentView();
    \u0275\u0275elementStart(0, "div", 113);
    \u0275\u0275listener("click", function ProjectDetailComponent_ng_container_6_div_37_div_3_div_4_Template_div_click_0_listener() {
      const r_r11 = \u0275\u0275restoreView(_r10).$implicit;
      const ctx_r0 = \u0275\u0275nextContext(4);
      return \u0275\u0275resetView(ctx_r0.selectReport(r_r11));
    });
    \u0275\u0275elementStart(1, "div", 114);
    \u0275\u0275text(2);
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(3, "div", 115);
    \u0275\u0275text(4);
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(5, "div", 116);
    \u0275\u0275text(6);
    \u0275\u0275pipe(7, "date");
    \u0275\u0275elementEnd()();
  }
  if (rf & 2) {
    const r_r11 = ctx.$implicit;
    const ctx_r0 = \u0275\u0275nextContext(4);
    \u0275\u0275classProp("active", (ctx_r0.latestReport == null ? null : ctx_r0.latestReport.id) === r_r11.id);
    \u0275\u0275advance(2);
    \u0275\u0275textInterpolate1("Build #", ctx_r0.parseReport(r_r11.aiSummary).build || "?", "");
    \u0275\u0275advance();
    \u0275\u0275styleProp("color", ctx_r0.getDecisionColor(ctx_r0.parseReport(r_r11.aiSummary).decision));
    \u0275\u0275advance();
    \u0275\u0275textInterpolate1(" ", ctx_r0.parseReport(r_r11.aiSummary).decision || "N/A", " ");
    \u0275\u0275advance(2);
    \u0275\u0275textInterpolate(\u0275\u0275pipeBind2(7, 7, r_r11.createdAt, "dd/MM HH:mm"));
  }
}
function ProjectDetailComponent_ng_container_6_div_37_div_3_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementStart(0, "div", 109)(1, "div", 110);
    \u0275\u0275text(2, "\u{1F4CA} Historique des rapports");
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(3, "div", 111);
    \u0275\u0275template(4, ProjectDetailComponent_ng_container_6_div_37_div_3_div_4_Template, 8, 10, "div", 112);
    \u0275\u0275elementEnd()();
  }
  if (rf & 2) {
    const ctx_r0 = \u0275\u0275nextContext(3);
    \u0275\u0275advance(4);
    \u0275\u0275property("ngForOf", ctx_r0.allReports);
  }
}
function ProjectDetailComponent_ng_container_6_div_37_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementStart(0, "div");
    \u0275\u0275template(1, ProjectDetailComponent_ng_container_6_div_37_div_1_Template, 7, 0, "div", 27)(2, ProjectDetailComponent_ng_container_6_div_37_div_2_Template, 52, 40, "div", 28)(3, ProjectDetailComponent_ng_container_6_div_37_div_3_Template, 5, 1, "div", 29);
    \u0275\u0275elementEnd();
  }
  if (rf & 2) {
    const ctx_r0 = \u0275\u0275nextContext(2);
    \u0275\u0275advance();
    \u0275\u0275property("ngIf", !ctx_r0.latestReport);
    \u0275\u0275advance();
    \u0275\u0275property("ngIf", ctx_r0.latestReport);
    \u0275\u0275advance();
    \u0275\u0275property("ngIf", ctx_r0.allReports.length > 1);
  }
}
function ProjectDetailComponent_ng_container_6_div_38_div_7_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementStart(0, "div", 123)(1, "div", 32);
    \u0275\u0275text(2, "Aucun incident");
    \u0275\u0275elementEnd()();
  }
}
function ProjectDetailComponent_ng_container_6_div_38_div_8_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementStart(0, "div", 124)(1, "span");
    \u0275\u0275text(2);
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(3, "span", 125);
    \u0275\u0275text(4);
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(5, "span");
    \u0275\u0275text(6);
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(7, "span", 65);
    \u0275\u0275text(8);
    \u0275\u0275pipe(9, "date");
    \u0275\u0275elementEnd()();
  }
  if (rf & 2) {
    const inc_r12 = ctx.$implicit;
    \u0275\u0275advance();
    \u0275\u0275classMapInterpolate1("badge ", inc_r12.severity == null ? null : inc_r12.severity.toLowerCase(), "");
    \u0275\u0275advance();
    \u0275\u0275textInterpolate(inc_r12.severity);
    \u0275\u0275advance(2);
    \u0275\u0275textInterpolate1(" ", inc_r12.title || inc_r12.sourceType, " ");
    \u0275\u0275advance();
    \u0275\u0275classMapInterpolate1("badge ", inc_r12.status == null ? null : inc_r12.status.toLowerCase(), "");
    \u0275\u0275advance();
    \u0275\u0275textInterpolate(inc_r12.status);
    \u0275\u0275advance(2);
    \u0275\u0275textInterpolate1(" ", \u0275\u0275pipeBind2(9, 10, inc_r12.createdAt, "dd/MM HH:mm"), " ");
  }
}
function ProjectDetailComponent_ng_container_6_div_38_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementStart(0, "div")(1, "div", 117)(2, "div", 118)(3, "span", 119);
    \u0275\u0275text(4, "Incidents du projet");
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(5, "a", 120);
    \u0275\u0275text(6, "Voir tous \u2192");
    \u0275\u0275elementEnd()();
    \u0275\u0275template(7, ProjectDetailComponent_ng_container_6_div_38_div_7_Template, 3, 0, "div", 121)(8, ProjectDetailComponent_ng_container_6_div_38_div_8_Template, 10, 13, "div", 122);
    \u0275\u0275elementEnd()();
  }
  if (rf & 2) {
    const ctx_r0 = \u0275\u0275nextContext(2);
    \u0275\u0275advance(5);
    \u0275\u0275property("routerLink", \u0275\u0275pureFunction0(4, _c0))("queryParams", \u0275\u0275pureFunction1(5, _c1, ctx_r0.project.id));
    \u0275\u0275advance(2);
    \u0275\u0275property("ngIf", ctx_r0.incidents.length === 0);
    \u0275\u0275advance();
    \u0275\u0275property("ngForOf", ctx_r0.incidents);
  }
}
function ProjectDetailComponent_ng_container_6_div_39_tr_6_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementStart(0, "tr")(1, "td", 128);
    \u0275\u0275text(2);
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(3, "td", 129);
    \u0275\u0275text(4);
    \u0275\u0275elementEnd()();
  }
  if (rf & 2) {
    const info_r13 = ctx.$implicit;
    \u0275\u0275advance(2);
    \u0275\u0275textInterpolate(info_r13.label);
    \u0275\u0275advance(2);
    \u0275\u0275textInterpolate(info_r13.value);
  }
}
function ProjectDetailComponent_ng_container_6_div_39_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementStart(0, "div")(1, "div", 117)(2, "div", 118)(3, "span", 119);
    \u0275\u0275text(4, "Informations du projet");
    \u0275\u0275elementEnd()();
    \u0275\u0275elementStart(5, "table", 126);
    \u0275\u0275template(6, ProjectDetailComponent_ng_container_6_div_39_tr_6_Template, 5, 2, "tr", 127);
    \u0275\u0275elementEnd()()();
  }
  if (rf & 2) {
    const ctx_r0 = \u0275\u0275nextContext(2);
    \u0275\u0275advance(6);
    \u0275\u0275property("ngForOf", ctx_r0.getInfoRows());
  }
}
function ProjectDetailComponent_ng_container_6_Template(rf, ctx) {
  if (rf & 1) {
    const _r2 = \u0275\u0275getCurrentView();
    \u0275\u0275elementContainerStart(0);
    \u0275\u0275elementStart(1, "div", 17)(2, "div", 18)(3, "div", 19);
    \u0275\u0275text(4, "\u{1F534}");
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(5, "div", 20);
    \u0275\u0275text(6);
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(7, "div", 21);
    \u0275\u0275text(8, "Incidents ouverts");
    \u0275\u0275elementEnd()();
    \u0275\u0275elementStart(9, "div", 22)(10, "div", 19);
    \u0275\u0275text(11, "\u{1F535}");
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(12, "div", 20);
    \u0275\u0275text(13);
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(14, "div", 21);
    \u0275\u0275text(15, "En analyse IA");
    \u0275\u0275elementEnd()();
    \u0275\u0275elementStart(16, "div", 23)(17, "div", 19);
    \u0275\u0275text(18, "\u{1F7E1}");
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(19, "div", 20);
    \u0275\u0275text(20);
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(21, "div", 21);
    \u0275\u0275text(22, "Corrections propos\xE9es");
    \u0275\u0275elementEnd()();
    \u0275\u0275elementStart(23, "div", 24)(24, "div", 19);
    \u0275\u0275text(25, "\u{1F7E2}");
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(26, "div", 20);
    \u0275\u0275text(27);
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(28, "div", 21);
    \u0275\u0275text(29, "R\xE9solus");
    \u0275\u0275elementEnd()()();
    \u0275\u0275elementStart(30, "div", 25)(31, "button", 26);
    \u0275\u0275listener("click", function ProjectDetailComponent_ng_container_6_Template_button_click_31_listener() {
      \u0275\u0275restoreView(_r2);
      const ctx_r0 = \u0275\u0275nextContext();
      return \u0275\u0275resetView(ctx_r0.activeTab = "rapport");
    });
    \u0275\u0275text(32, " \u{1F916} Rapport IA ");
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(33, "button", 26);
    \u0275\u0275listener("click", function ProjectDetailComponent_ng_container_6_Template_button_click_33_listener() {
      \u0275\u0275restoreView(_r2);
      const ctx_r0 = \u0275\u0275nextContext();
      return \u0275\u0275resetView(ctx_r0.activeTab = "incidents");
    });
    \u0275\u0275text(34, " \u{1F6A8} Incidents ");
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(35, "button", 26);
    \u0275\u0275listener("click", function ProjectDetailComponent_ng_container_6_Template_button_click_35_listener() {
      \u0275\u0275restoreView(_r2);
      const ctx_r0 = \u0275\u0275nextContext();
      return \u0275\u0275resetView(ctx_r0.activeTab = "info");
    });
    \u0275\u0275text(36, " \u2139\uFE0F Informations ");
    \u0275\u0275elementEnd()();
    \u0275\u0275template(37, ProjectDetailComponent_ng_container_6_div_37_Template, 4, 3, "div", 5)(38, ProjectDetailComponent_ng_container_6_div_38_Template, 9, 7, "div", 5)(39, ProjectDetailComponent_ng_container_6_div_39_Template, 7, 1, "div", 5);
    \u0275\u0275elementContainerEnd();
  }
  if (rf & 2) {
    const ctx_r0 = \u0275\u0275nextContext();
    \u0275\u0275advance(6);
    \u0275\u0275textInterpolate(ctx_r0.project.openIncidents || 0);
    \u0275\u0275advance(7);
    \u0275\u0275textInterpolate(ctx_r0.project.analyzingIncidents || 0);
    \u0275\u0275advance(7);
    \u0275\u0275textInterpolate(ctx_r0.project.proposedIncidents || 0);
    \u0275\u0275advance(7);
    \u0275\u0275textInterpolate(ctx_r0.project.resolvedIncidents || 0);
    \u0275\u0275advance(4);
    \u0275\u0275classProp("active", ctx_r0.activeTab === "rapport");
    \u0275\u0275advance(2);
    \u0275\u0275classProp("active", ctx_r0.activeTab === "incidents");
    \u0275\u0275advance(2);
    \u0275\u0275classProp("active", ctx_r0.activeTab === "info");
    \u0275\u0275advance(2);
    \u0275\u0275property("ngIf", ctx_r0.activeTab === "rapport");
    \u0275\u0275advance();
    \u0275\u0275property("ngIf", ctx_r0.activeTab === "incidents");
    \u0275\u0275advance();
    \u0275\u0275property("ngIf", ctx_r0.activeTab === "info");
  }
}
var ProjectDetailComponent = class _ProjectDetailComponent {
  constructor(api, toast) {
    this.api = api;
    this.toast = toast;
    this.project = null;
    this.incidents = [];
    this.allReports = [];
    this.latestReport = null;
    this.loading = true;
    this.activeTab = "rapport";
    this.rp = {};
    this.rawSecurity = null;
    this.rawRemediation = null;
    this.devTasks = [];
    this.checkedTasks = 0;
  }
  ngOnInit() {
    this.api.getProject(this.id).subscribe({
      next: (p) => {
        this.project = p;
        this.loading = false;
        this.loadIncidents();
        this.loadReports();
      },
      error: () => {
        this.toast.error("Erreur", "Projet introuvable");
        this.loading = false;
      }
    });
  }
  loadIncidents() {
    this.api.getIncidents({ projectId: this.id, size: 20 }).subscribe((r) => {
      this.incidents = r.content || r;
    });
  }
  loadReports() {
    this.api.getDecisions({ projectId: this.id }).subscribe({
      next: (r) => {
        const list = Array.isArray(r) ? r : [];
        this.allReports = list.filter((x) => x.type === "combined").sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        if (this.allReports.length > 0) {
          this.selectReport(this.allReports[0]);
        }
      },
      error: () => {
      }
    });
  }
  selectReport(r) {
    this.latestReport = r;
    this.rp = this.parseReport(r.aiSummary);
    this.rawSecurity = r.rawData?.security || null;
    this.rawRemediation = r.rawData?.remediation || null;
    this.devTasks = this.parseDevTasks(this.rp.developerActions);
    this.checkedTasks = 0;
  }
  parseReport(summary) {
    if (!summary)
      return {};
    const p = {};
    summary.split(" | ").forEach((part) => {
      part = part.trim();
      const buildMatch = part.match(/^Build #(\d+)$/);
      if (buildMatch) {
        p["build"] = buildMatch[1];
        return;
      }
      if (part.startsWith("RAPPORT"))
        return;
      const idx = part.indexOf(":");
      if (idx > 0) {
        const key = part.substring(0, idx).trim();
        const val = part.substring(idx + 1).trim();
        if (key === "Job")
          p["job"] = val;
        else if (key === "Branche")
          p["branch"] = val;
        else if (key === "DECISION")
          p["decision"] = val;
        else if (key === "Confiance") {
          const raw = parseFloat(val);
          p["confidence"] = isNaN(raw) ? val : raw > 1 ? raw / 100 + "%" : Math.round(raw * 100) + "%";
        } else if (key === "Raison")
          p["reason"] = val;
        else if (key === "ERREURS")
          p["errors"] = val;
        else if (key === "AGENTS IA")
          p["agentActions"] = val;
        else if (key === "DEVELOPPEUR")
          p["developerActions"] = val;
        else if (key === "SECURITE")
          p["security"] = val;
        else if (key === "RECOMMANDATIONS")
          p["recommendations"] = val;
      }
    });
    return p;
  }
  parseDevTasks(raw) {
    if (!raw)
      return [];
    const cleaned = raw.replace(/^\[|\]$/g, "");
    const matches = cleaned.match(/\d+\.\s[^0-9]+/g) || [];
    if (matches.length > 0) {
      return matches.map((m) => {
        const priorityMatch = m.match(/\[(HAUTE|MOYENNE|BASSE)\]/i);
        const priority = priorityMatch ? priorityMatch[1].toUpperCase() : null;
        const text = m.replace(/\[.*?\]/g, "").replace(/^\d+\.\s*/, "").trim().replace(/\.$/, "");
        return { text, priority, done: false };
      });
    }
    return [{ text: cleaned, priority: null, done: false }];
  }
  toggleTask(i) {
    this.devTasks[i].done = !this.devTasks[i].done;
    this.checkedTasks = this.devTasks.filter((t) => t.done).length;
  }
  copyReport() {
    const text = this.latestReport?.aiSummary || "";
    navigator.clipboard.writeText(text).then(() => {
      this.toast.success("Copi\xE9", "Rapport copi\xE9 dans le presse-papiers");
    });
  }
  getInfoRows() {
    if (!this.project)
      return [];
    return [
      { label: "ID", value: this.project.id },
      { label: "Cr\xE9\xE9 le", value: new Date(this.project.createdAt).toLocaleDateString("fr-FR") },
      { label: "Cl\xE9 SonarQube", value: this.project.sonarKey || "\u2014" },
      { label: "GitHub Repo", value: this.project.githubRepo || "\u2014" },
      { label: "Jenkins Job", value: this.project.jenkinsJobName || "\u2014" },
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
  getDecisionColor(decision) {
    if (!decision)
      return "var(--accent-blue)";
    if (decision === "AUTO_FIX")
      return "var(--accent-green)";
    if (decision === "BLOCK")
      return "var(--accent-red)";
    return "var(--accent-orange)";
  }
  getSecurityColor(level) {
    if (!level)
      return "var(--text-muted)";
    const l = level.trim().toUpperCase();
    if (l === "CRITICAL")
      return "var(--accent-red)";
    if (l === "HIGH")
      return "var(--accent-orange)";
    if (l === "MEDIUM")
      return "var(--accent-yellow, #f59e0b)";
    return "var(--accent-green)";
  }
  static {
    this.\u0275fac = function ProjectDetailComponent_Factory(t) {
      return new (t || _ProjectDetailComponent)(\u0275\u0275directiveInject(ApiService), \u0275\u0275directiveInject(ToastService));
    };
  }
  static {
    this.\u0275cmp = /* @__PURE__ */ \u0275\u0275defineComponent({ type: _ProjectDetailComponent, selectors: [["app-project-detail"]], inputs: { id: "id" }, standalone: true, features: [\u0275\u0275StandaloneFeature], decls: 7, vars: 3, consts: [[1, "page-container"], [1, "page-header"], ["routerLink", "/projects", 1, "back-link"], ["class", "header-row", 4, "ngIf"], ["class", "loading-overlay", 4, "ngIf"], [4, "ngIf"], [1, "header-row"], [1, "header-left"], [1, "project-avatar"], [1, "page-title"], [1, "page-subtitle"], [1, "header-right"], [1, "health-ring"], [1, "health-value"], [1, "health-label"], [1, "loading-overlay"], [1, "spinner"], [1, "kpi-grid"], [1, "kpi-card", "red"], [1, "kpi-icon"], [1, "kpi-value"], [1, "kpi-label"], [1, "kpi-card", "blue"], [1, "kpi-card", "orange"], [1, "kpi-card", "green"], [1, "tabs-row"], [1, "tab-btn", 3, "click"], ["class", "empty-state", 4, "ngIf"], ["class", "rapport-container", 4, "ngIf"], ["class", "history-section", 4, "ngIf"], [1, "empty-state"], [1, "empty-icon"], [1, "empty-title"], [1, "empty-sub"], [1, "rapport-container"], [1, "rapport-hero"], [1, "rapport-hero-left"], [1, "rapport-build-tag"], [1, "rapport-title"], [1, "rapport-meta"], [1, "sep"], [1, "rapport-hero-right"], [1, "decision-badge"], [1, "confidence-display"], [1, "confidence-bar-wrap"], [1, "confidence-bar"], [1, "confidence-text"], [1, "security-level"], [1, "rapport-grid"], ["class", "rapport-section error-section", 4, "ngIf"], ["class", "rapport-section agent-section", 4, "ngIf"], ["class", "rapport-section security-section", 4, "ngIf"], ["class", "rapport-section remediation-section", 4, "ngIf"], [1, "rapport-section", "developer-section", "full-width"], [1, "section-header"], [1, "section-icon"], [1, "section-title"], ["class", "checklist-progress", 4, "ngIf"], [1, "section-body"], ["class", "no-tasks", 4, "ngIf"], ["class", "checklist", 4, "ngIf"], ["class", "progress-bar-wrap", 4, "ngIf"], ["class", "rapport-section reco-section full-width", 4, "ngIf"], ["class", "rapport-section reason-section full-width", 4, "ngIf"], [1, "rapport-footer"], [2, "font-size", "10px", "color", "var(--text-faint)", "font-family", "var(--font-mono)"], [1, "btn", "btn-secondary", "btn-sm", 3, "click"], [1, "rapport-section", "error-section"], [1, "section-body", "error-body"], [1, "rapport-section", "agent-section"], [1, "rapport-section", "security-section"], [1, "risk-pill"], ["class", "security-issues", 4, "ngIf"], ["class", "security-rec", 4, "ngIf"], ["class", "safe-badge", 4, "ngIf"], [1, "security-issues"], ["class", "issue-item", 4, "ngFor", "ngForOf"], [1, "issue-item"], [1, "issue-dot"], [1, "security-rec"], [1, "rec-label"], [1, "safe-badge"], [1, "rapport-section", "remediation-section"], [1, "confidence-pill"], ["class", "fix-description", 4, "ngIf"], ["class", "fix-steps", 4, "ngIf"], ["class", "autofix-badge", 4, "ngIf"], [1, "fix-description"], [1, "fix-steps"], ["class", "fix-step", 4, "ngFor", "ngForOf"], [1, "fix-step"], [1, "step-number"], [1, "autofix-badge"], [1, "checklist-progress"], [1, "no-tasks"], [2, "color", "var(--text-faint)"], [1, "checklist"], ["class", "checklist-item", 3, "checked", "click", 4, "ngFor", "ngForOf"], [1, "checklist-item", 3, "click"], [1, "checkbox"], [1, "task-content"], [1, "task-text"], ["class", "priority-tag", 3, "class", 4, "ngIf"], [1, "priority-tag"], [1, "progress-bar-wrap"], [1, "progress-bar"], [1, "rapport-section", "reco-section", "full-width"], [1, "rapport-section", "reason-section", "full-width"], [1, "reason-text"], [1, "history-section"], [1, "history-title"], [1, "history-list"], ["class", "history-item", 3, "active", "click", 4, "ngFor", "ngForOf"], [1, "history-item", 3, "click"], [1, "history-build"], [1, "history-decision"], [1, "history-date"], [1, "card"], [1, "card-header"], [1, "card-title"], [1, "btn", "btn-secondary", "btn-sm", 3, "routerLink", "queryParams"], ["class", "empty-state", "style", "padding:20px;", 4, "ngIf"], ["class", "inc-row", 4, "ngFor", "ngForOf"], [1, "empty-state", 2, "padding", "20px"], [1, "inc-row"], [2, "flex", "1", "font-size", "11px", "color", "var(--text-secondary)", "overflow", "hidden", "text-overflow", "ellipsis", "white-space", "nowrap"], [2, "width", "100%"], [4, "ngFor", "ngForOf"], [2, "font-size", "11px", "color", "var(--text-faint)", "padding", "8px 0", "width", "35%"], [2, "font-size", "12px", "color", "var(--text-secondary)", "font-family", "var(--font-mono)"]], template: function ProjectDetailComponent_Template(rf, ctx) {
      if (rf & 1) {
        \u0275\u0275elementStart(0, "div", 0)(1, "div", 1)(2, "a", 2);
        \u0275\u0275text(3, "\u2190 Retour aux projets");
        \u0275\u0275elementEnd();
        \u0275\u0275template(4, ProjectDetailComponent_div_4_Template, 16, 11, "div", 3);
        \u0275\u0275elementEnd();
        \u0275\u0275template(5, ProjectDetailComponent_div_5_Template, 2, 0, "div", 4)(6, ProjectDetailComponent_ng_container_6_Template, 40, 13, "ng-container", 5);
        \u0275\u0275elementEnd();
      }
      if (rf & 2) {
        \u0275\u0275advance(4);
        \u0275\u0275property("ngIf", ctx.project);
        \u0275\u0275advance();
        \u0275\u0275property("ngIf", ctx.loading);
        \u0275\u0275advance();
        \u0275\u0275property("ngIf", ctx.project && !ctx.loading);
      }
    }, dependencies: [CommonModule, NgForOf, NgIf, DecimalPipe, DatePipe, RouterModule, RouterLink], styles: ['@charset "UTF-8";\n\n\n\n.back-link[_ngcontent-%COMP%] {\n  font-size: 12px;\n  color: var(--text-muted);\n  text-decoration: none;\n}\n.back-link[_ngcontent-%COMP%]:hover {\n  color: var(--text-secondary);\n}\n.header-row[_ngcontent-%COMP%] {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  margin-top: 12px;\n  gap: 16px;\n}\n.header-left[_ngcontent-%COMP%] {\n  display: flex;\n  align-items: center;\n  gap: 14px;\n}\n.project-avatar[_ngcontent-%COMP%] {\n  width: 48px;\n  height: 48px;\n  border-radius: var(--radius-md);\n  background: var(--bg-tertiary);\n  border: 2px solid;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  font-size: 16px;\n  font-weight: 700;\n  font-family: var(--font-mono);\n  color: var(--text-secondary);\n  flex-shrink: 0;\n}\n.health-ring[_ngcontent-%COMP%] {\n  display: flex;\n  flex-direction: column;\n  align-items: center;\n  padding: 12px 20px;\n  border-radius: var(--radius-md);\n  background: var(--bg-secondary);\n  border: 1px solid var(--border);\n  border-top: 3px solid var(--health-color, var(--accent-green));\n}\n.health-value[_ngcontent-%COMP%] {\n  font-size: 22px;\n  font-weight: 700;\n  font-family: var(--font-mono);\n  color: var(--health-color, var(--accent-green));\n}\n.health-label[_ngcontent-%COMP%] {\n  font-size: 10px;\n  color: var(--text-faint);\n  text-transform: uppercase;\n  letter-spacing: 1px;\n}\n.kpi-grid[_ngcontent-%COMP%] {\n  display: grid;\n  grid-template-columns: repeat(4, 1fr);\n  gap: 12px;\n  margin-bottom: 20px;\n}\n.kpi-card[_ngcontent-%COMP%] {\n  background: var(--bg-secondary);\n  border: 1px solid var(--border);\n  border-radius: var(--radius-lg);\n  padding: 16px;\n  text-align: center;\n}\n.kpi-card.red[_ngcontent-%COMP%] {\n  border-top: 2px solid var(--accent-red);\n}\n.kpi-card.blue[_ngcontent-%COMP%] {\n  border-top: 2px solid var(--accent-blue);\n}\n.kpi-card.orange[_ngcontent-%COMP%] {\n  border-top: 2px solid var(--accent-orange);\n}\n.kpi-card.green[_ngcontent-%COMP%] {\n  border-top: 2px solid var(--accent-green);\n}\n.kpi-icon[_ngcontent-%COMP%] {\n  font-size: 18px;\n  margin-bottom: 6px;\n}\n.kpi-value[_ngcontent-%COMP%] {\n  font-size: 28px;\n  font-weight: 700;\n  font-family: var(--font-mono);\n  color: var(--text-primary);\n}\n.kpi-label[_ngcontent-%COMP%] {\n  font-size: 10px;\n  color: var(--text-faint);\n  text-transform: uppercase;\n  letter-spacing: 0.5px;\n  margin-top: 4px;\n}\n.tabs-row[_ngcontent-%COMP%] {\n  display: flex;\n  gap: 8px;\n  margin-bottom: 20px;\n  border-bottom: 1px solid var(--border);\n  padding-bottom: 0;\n}\n.tab-btn[_ngcontent-%COMP%] {\n  padding: 8px 16px;\n  font-size: 12px;\n  color: var(--text-muted);\n  background: transparent;\n  border: none;\n  border-bottom: 2px solid transparent;\n  cursor: pointer;\n  transition: all 0.15s;\n  margin-bottom: -1px;\n}\n.tab-btn[_ngcontent-%COMP%]:hover {\n  color: var(--text-secondary);\n}\n.tab-btn.active[_ngcontent-%COMP%] {\n  color: var(--accent-blue);\n  border-bottom-color: var(--accent-blue);\n  font-weight: 600;\n}\n.rapport-container[_ngcontent-%COMP%] {\n  display: flex;\n  flex-direction: column;\n  gap: 16px;\n}\n.rapport-hero[_ngcontent-%COMP%] {\n  background: var(--bg-secondary);\n  border: 1px solid var(--border);\n  border-radius: var(--radius-lg);\n  padding: 24px;\n  display: flex;\n  align-items: flex-start;\n  justify-content: space-between;\n  gap: 20px;\n}\n.rapport-hero.block[_ngcontent-%COMP%] {\n  border-left: 4px solid var(--accent-red);\n}\n.rapport-hero.autofix[_ngcontent-%COMP%] {\n  border-left: 4px solid var(--accent-green);\n}\n.rapport-hero.notify[_ngcontent-%COMP%] {\n  border-left: 4px solid var(--accent-orange);\n}\n.rapport-hero-left[_ngcontent-%COMP%] {\n  display: flex;\n  flex-direction: column;\n  gap: 6px;\n}\n.rapport-build-tag[_ngcontent-%COMP%] {\n  display: inline-block;\n  font-size: 10px;\n  font-family: var(--font-mono);\n  color: var(--accent-blue);\n  background: var(--accent-blue) 18;\n  padding: 2px 8px;\n  border-radius: 4px;\n  border: 1px solid var(--accent-blue) 44;\n}\n.rapport-title[_ngcontent-%COMP%] {\n  font-size: 18px;\n  font-weight: 700;\n  font-family: var(--font-mono);\n  color: var(--text-primary);\n}\n.rapport-meta[_ngcontent-%COMP%] {\n  display: flex;\n  gap: 8px;\n  font-size: 11px;\n  color: var(--text-faint);\n  align-items: center;\n}\n.sep[_ngcontent-%COMP%] {\n  color: var(--border-light);\n}\n.rapport-hero-right[_ngcontent-%COMP%] {\n  display: flex;\n  flex-direction: column;\n  align-items: flex-end;\n  gap: 10px;\n}\n.decision-badge[_ngcontent-%COMP%] {\n  font-size: 13px;\n  font-weight: 700;\n  padding: 6px 16px;\n  border-radius: 20px;\n  border: 1px solid;\n  font-family: var(--font-mono);\n}\n.confidence-bar-wrap[_ngcontent-%COMP%] {\n  width: 140px;\n  height: 4px;\n  background: var(--border);\n  border-radius: 2px;\n  overflow: hidden;\n}\n.confidence-bar[_ngcontent-%COMP%] {\n  height: 100%;\n  border-radius: 2px;\n  transition: width 0.8s ease;\n}\n.confidence-text[_ngcontent-%COMP%] {\n  font-size: 10px;\n  color: var(--text-faint);\n  font-family: var(--font-mono);\n}\n.confidence-display[_ngcontent-%COMP%] {\n  display: flex;\n  flex-direction: column;\n  gap: 4px;\n  align-items: flex-end;\n}\n.security-level[_ngcontent-%COMP%] {\n  font-size: 12px;\n  font-weight: 600;\n}\n.rapport-grid[_ngcontent-%COMP%] {\n  display: grid;\n  grid-template-columns: 1fr 1fr;\n  gap: 12px;\n}\n.rapport-section[_ngcontent-%COMP%] {\n  background: var(--bg-secondary);\n  border: 1px solid var(--border);\n  border-radius: var(--radius-md);\n  overflow: hidden;\n}\n.rapport-section.full-width[_ngcontent-%COMP%] {\n  grid-column: 1/-1;\n}\n.rapport-section.error-section[_ngcontent-%COMP%] {\n  border-top: 2px solid var(--accent-red);\n}\n.rapport-section.agent-section[_ngcontent-%COMP%] {\n  border-top: 2px solid var(--accent-blue);\n}\n.rapport-section.security-section[_ngcontent-%COMP%] {\n  border-top: 2px solid var(--accent-orange);\n}\n.rapport-section.remediation-section[_ngcontent-%COMP%] {\n  border-top: 2px solid var(--accent-purple, #a78bfa);\n}\n.rapport-section.developer-section[_ngcontent-%COMP%] {\n  border-top: 2px solid var(--accent-yellow, #f59e0b);\n  border-left: 3px solid var(--accent-yellow, #f59e0b);\n}\n.rapport-section.reco-section[_ngcontent-%COMP%] {\n  border-top: 2px solid var(--accent-green);\n}\n.rapport-section.reason-section[_ngcontent-%COMP%] {\n  background: var(--bg-hover);\n}\n.section-header[_ngcontent-%COMP%] {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  padding: 10px 14px;\n  border-bottom: 1px solid var(--border);\n  background: var(--bg-hover);\n}\n.section-icon[_ngcontent-%COMP%] {\n  font-size: 14px;\n}\n.section-title[_ngcontent-%COMP%] {\n  font-size: 10px;\n  font-weight: 700;\n  color: var(--text-muted);\n  letter-spacing: 1px;\n  text-transform: uppercase;\n  font-family: var(--font-mono);\n  flex: 1;\n}\n.risk-pill[_ngcontent-%COMP%] {\n  font-size: 10px;\n  font-weight: 700;\n  padding: 2px 8px;\n  border-radius: 10px;\n  font-family: var(--font-mono);\n}\n.confidence-pill[_ngcontent-%COMP%] {\n  font-size: 10px;\n  color: var(--text-faint);\n  font-family: var(--font-mono);\n}\n.checklist-progress[_ngcontent-%COMP%] {\n  font-size: 10px;\n  color: var(--accent-green);\n  font-family: var(--font-mono);\n  font-weight: 600;\n}\n.section-body[_ngcontent-%COMP%] {\n  padding: 14px;\n  font-size: 12px;\n  color: var(--text-secondary);\n  line-height: 1.7;\n}\n.error-body[_ngcontent-%COMP%] {\n  color: var(--accent-red);\n}\n.security-issues[_ngcontent-%COMP%] {\n  display: flex;\n  flex-direction: column;\n  gap: 6px;\n  margin-bottom: 10px;\n}\n.issue-item[_ngcontent-%COMP%] {\n  display: flex;\n  gap: 8px;\n  align-items: flex-start;\n  font-size: 12px;\n}\n.issue-dot[_ngcontent-%COMP%] {\n  color: var(--accent-orange);\n  flex-shrink: 0;\n}\n.security-rec[_ngcontent-%COMP%] {\n  font-size: 11px;\n  color: var(--text-faint);\n  margin-top: 8px;\n  padding-top: 8px;\n  border-top: 1px solid var(--border);\n}\n.rec-label[_ngcontent-%COMP%] {\n  font-weight: 600;\n  color: var(--text-muted);\n}\n.safe-badge[_ngcontent-%COMP%] {\n  margin-top: 8px;\n}\n.safe-yes[_ngcontent-%COMP%] {\n  font-size: 11px;\n  color: var(--accent-green);\n}\n.safe-no[_ngcontent-%COMP%] {\n  font-size: 11px;\n  color: var(--accent-red);\n}\n.fix-description[_ngcontent-%COMP%] {\n  margin-bottom: 10px;\n}\n.fix-steps[_ngcontent-%COMP%] {\n  display: flex;\n  flex-direction: column;\n  gap: 8px;\n}\n.fix-step[_ngcontent-%COMP%] {\n  display: flex;\n  gap: 10px;\n  align-items: flex-start;\n  padding: 8px;\n  background: var(--bg-hover);\n  border-radius: var(--radius-sm);\n  font-size: 12px;\n}\n.step-number[_ngcontent-%COMP%] {\n  width: 20px;\n  height: 20px;\n  border-radius: 50%;\n  background: var(--accent-purple, #a78bfa);\n  color: #000;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  font-size: 10px;\n  font-weight: 700;\n  flex-shrink: 0;\n}\n.autofix-badge[_ngcontent-%COMP%] {\n  margin-top: 10px;\n}\n.autofix-yes[_ngcontent-%COMP%] {\n  font-size: 11px;\n  color: var(--accent-green);\n}\n.autofix-no[_ngcontent-%COMP%] {\n  font-size: 11px;\n  color: var(--accent-orange);\n}\n.checklist[_ngcontent-%COMP%] {\n  display: flex;\n  flex-direction: column;\n  gap: 8px;\n}\n.checklist-item[_ngcontent-%COMP%] {\n  display: flex;\n  align-items: flex-start;\n  gap: 10px;\n  padding: 10px 12px;\n  background: var(--bg-hover);\n  border-radius: var(--radius-sm);\n  cursor: pointer;\n  border: 1px solid var(--border);\n  transition: all 0.15s;\n}\n.checklist-item[_ngcontent-%COMP%]:hover {\n  border-color: var(--border-light);\n}\n.checklist-item.checked[_ngcontent-%COMP%] {\n  opacity: 0.6;\n  background: var(--bg-tertiary);\n}\n.checkbox[_ngcontent-%COMP%] {\n  width: 18px;\n  height: 18px;\n  border: 1px solid var(--border-light);\n  border-radius: 4px;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  font-size: 11px;\n  flex-shrink: 0;\n  transition: all 0.15s;\n}\n.checkbox.checked[_ngcontent-%COMP%] {\n  background: var(--accent-green);\n  border-color: var(--accent-green);\n  color: #000;\n}\n.task-content[_ngcontent-%COMP%] {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  flex: 1;\n  flex-wrap: wrap;\n}\n.task-text[_ngcontent-%COMP%] {\n  font-size: 12px;\n  color: var(--text-secondary);\n  flex: 1;\n}\n.task-text.done[_ngcontent-%COMP%] {\n  text-decoration: line-through;\n  color: var(--text-faint);\n}\n.priority-tag[_ngcontent-%COMP%] {\n  font-size: 9px;\n  font-weight: 700;\n  padding: 2px 6px;\n  border-radius: 8px;\n  font-family: var(--font-mono);\n  text-transform: uppercase;\n}\n.priority-tag.priority-haute[_ngcontent-%COMP%] {\n  background: var(--accent-red) 22;\n  color: var(--accent-red);\n}\n.priority-tag.priority-moyenne[_ngcontent-%COMP%] {\n  background: var(--accent-orange) 22;\n  color: var(--accent-orange);\n}\n.priority-tag.priority-basse[_ngcontent-%COMP%] {\n  background: var(--accent-green) 22;\n  color: var(--accent-green);\n}\n.progress-bar-wrap[_ngcontent-%COMP%] {\n  margin-top: 12px;\n}\n.progress-bar[_ngcontent-%COMP%] {\n  height: 3px;\n  background: var(--border);\n  border-radius: 2px;\n  overflow: hidden;\n}\n.progress-bar[_ngcontent-%COMP%]   div[_ngcontent-%COMP%] {\n  height: 100%;\n  background: var(--accent-green);\n  border-radius: 2px;\n  transition: width 0.4s ease;\n}\n.reason-text[_ngcontent-%COMP%] {\n  font-family: var(--font-mono);\n  font-size: 11px;\n  color: var(--text-faint);\n}\n.rapport-footer[_ngcontent-%COMP%] {\n  display: flex;\n  justify-content: space-between;\n  align-items: center;\n  padding: 12px 16px;\n  background: var(--bg-secondary);\n  border: 1px solid var(--border);\n  border-radius: var(--radius-md);\n}\n.history-section[_ngcontent-%COMP%] {\n  margin-top: 20px;\n}\n.history-title[_ngcontent-%COMP%] {\n  font-size: 11px;\n  color: var(--text-muted);\n  font-family: var(--font-mono);\n  margin-bottom: 8px;\n  font-weight: 700;\n  text-transform: uppercase;\n  letter-spacing: 1px;\n}\n.history-list[_ngcontent-%COMP%] {\n  display: flex;\n  gap: 8px;\n  flex-wrap: wrap;\n}\n.history-item[_ngcontent-%COMP%] {\n  display: flex;\n  gap: 8px;\n  align-items: center;\n  padding: 6px 12px;\n  background: var(--bg-secondary);\n  border: 1px solid var(--border);\n  border-radius: var(--radius-md);\n  cursor: pointer;\n  font-size: 11px;\n  transition: all 0.15s;\n}\n.history-item[_ngcontent-%COMP%]:hover {\n  border-color: var(--border-light);\n}\n.history-item.active[_ngcontent-%COMP%] {\n  border-color: var(--accent-blue);\n  background: var(--accent-blue) 11;\n}\n.history-build[_ngcontent-%COMP%] {\n  font-family: var(--font-mono);\n  color: var(--text-secondary);\n}\n.history-decision[_ngcontent-%COMP%] {\n  font-weight: 700;\n  font-family: var(--font-mono);\n}\n.history-date[_ngcontent-%COMP%] {\n  color: var(--text-faint);\n  font-size: 10px;\n}\n.inc-row[_ngcontent-%COMP%] {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  padding: 8px 0;\n  border-bottom: 1px solid var(--border);\n}\n.inc-row[_ngcontent-%COMP%]:last-child {\n  border-bottom: none;\n}\n/*# sourceMappingURL=project-detail.component.css.map */'] });
  }
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && \u0275setClassDebugInfo(ProjectDetailComponent, { className: "ProjectDetailComponent", filePath: "src/app/features/projects/project-detail.component.ts", lineNumber: 545 });
})();
export {
  ProjectDetailComponent
};
//# sourceMappingURL=chunk-CYXM5RHY.js.map
