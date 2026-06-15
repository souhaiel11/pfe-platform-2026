import {
  AuthService
} from "./chunk-DFFATVLZ.js";
import {
  ApiService
} from "./chunk-MYQKSWHM.js";
import "./chunk-R3YGZVM2.js";
import {
  NavigationEnd,
  Router,
  RouterLink,
  RouterLinkActive,
  RouterModule,
  RouterOutlet
} from "./chunk-YSFKJPFE.js";
import "./chunk-V6V525UE.js";
import {
  CommonModule,
  NgIf,
  filter,
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
  ɵɵtextInterpolate
} from "./chunk-SQ7ZQLOA.js";

// src/app/shared/layout/layout.component.ts
function LayoutComponent_span_22_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementStart(0, "span", 38);
    \u0275\u0275text(1);
    \u0275\u0275elementEnd();
  }
  if (rf & 2) {
    const ctx_r0 = \u0275\u0275nextContext();
    \u0275\u0275advance();
    \u0275\u0275textInterpolate(ctx_r0.openCount);
  }
}
function LayoutComponent_a_34_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementStart(0, "a", 39);
    \u0275\u0275element(1, "i", 40);
    \u0275\u0275text(2, " Admin");
    \u0275\u0275elementEnd();
  }
}
var LayoutComponent = class _LayoutComponent {
  constructor(auth, api, router) {
    this.auth = auth;
    this.api = api;
    this.router = router;
    this.openCount = 0;
    this.notifCount = 0;
    this.pageTitle = "Vue d'ensemble";
    this.isDark = true;
    this.pageTitles = {
      "/dashboard": "Vue d'ensemble",
      "/projects": "Projets",
      "/incidents": "Incidents",
      "/analysis": "Agents IA",
      "/notifications": "Notifications",
      "/settings": "Param\xE8tres",
      "/admin": "Administration"
    };
  }
  ngOnInit() {
    this.loadCounts();
    this.router.events.pipe(filter((e) => e instanceof NavigationEnd)).subscribe((e) => {
      const path2 = "/" + e.urlAfterRedirects.split("/")[1];
      this.pageTitle = this.pageTitles[path2] || "DevSecOps IA";
    });
    const path = "/" + this.router.url.split("/")[1];
    this.pageTitle = this.pageTitles[path] || "DevSecOps IA";
  }
  loadCounts() {
    this.api.getIncidents({ status: "OPEN", size: 1 }).subscribe((r) => {
      this.openCount = r.totalElements || r.length || 0;
    });
    this.api.getNotifications().subscribe((n) => {
      this.notifCount = n.filter((x) => !x.read).length;
    });
  }
  logout() {
    this.auth.logout();
  }
  get currentUser() {
    return this.auth.currentUser;
  }
  get isAdmin() {
    return this.auth.isAdmin;
  }
  get userInitials() {
    const u = this.auth.currentUser;
    if (!u)
      return "SA";
    return (u.username || u.email || "U").substring(0, 2).toUpperCase();
  }
  static {
    this.\u0275fac = function LayoutComponent_Factory(t) {
      return new (t || _LayoutComponent)(\u0275\u0275directiveInject(AuthService), \u0275\u0275directiveInject(ApiService), \u0275\u0275directiveInject(Router));
    };
  }
  static {
    this.\u0275cmp = /* @__PURE__ */ \u0275\u0275defineComponent({ type: _LayoutComponent, selectors: [["app-layout"]], standalone: true, features: [\u0275\u0275StandaloneFeature], decls: 58, vars: 7, consts: [[1, "app-shell"], [1, "sidebar"], [1, "sb-logo"], [1, "logo-mark"], [1, "logo-title"], [1, "logo-sub"], [1, "sb-nav"], [1, "nav-section"], ["routerLink", "/dashboard", "routerLinkActive", "active", 1, "nav-item"], [1, "ti", "ti-layout-dashboard"], ["routerLink", "/projects", "routerLinkActive", "active", 1, "nav-item"], [1, "ti", "ti-folder"], ["routerLink", "/incidents", "routerLinkActive", "active", 1, "nav-item"], [1, "ti", "ti-alert-triangle"], ["class", "nav-badge red", 4, "ngIf"], ["routerLink", "/analysis", "routerLinkActive", "active", 1, "nav-item"], [1, "ti", "ti-robot"], ["routerLink", "/notifications", "routerLinkActive", "active", 1, "nav-item"], [1, "ti", "ti-bell"], ["routerLink", "/settings", "routerLinkActive", "active", 1, "nav-item"], [1, "ti", "ti-settings"], ["class", "nav-item", "routerLink", "/admin", "routerLinkActive", "active", 4, "ngIf"], [1, "sb-footer"], [1, "user-row"], [1, "user-av"], [1, "user-info"], [1, "user-name"], [1, "user-role"], [1, "logout-btn", 3, "click"], [1, "ti", "ti-logout"], [1, "main-content"], [1, "topbar"], [1, "topbar-title"], [1, "topbar-right"], [1, "live-badge"], [1, "live-dot"], [1, "uav"], [1, "page-wrap"], [1, "nav-badge", "red"], ["routerLink", "/admin", "routerLinkActive", "active", 1, "nav-item"], [1, "ti", "ti-shield"]], template: function LayoutComponent_Template(rf, ctx) {
      if (rf & 1) {
        \u0275\u0275elementStart(0, "div", 0)(1, "aside", 1)(2, "div", 2)(3, "div", 3);
        \u0275\u0275text(4, "D");
        \u0275\u0275elementEnd();
        \u0275\u0275elementStart(5, "div")(6, "div", 4);
        \u0275\u0275text(7, "DevSecOps AI");
        \u0275\u0275elementEnd();
        \u0275\u0275elementStart(8, "div", 5);
        \u0275\u0275text(9, "Vermeg \xB7 PFE 2026");
        \u0275\u0275elementEnd()()();
        \u0275\u0275elementStart(10, "nav", 6)(11, "div", 7);
        \u0275\u0275text(12, "Plateforme");
        \u0275\u0275elementEnd();
        \u0275\u0275elementStart(13, "a", 8);
        \u0275\u0275element(14, "i", 9);
        \u0275\u0275text(15, " Dashboard");
        \u0275\u0275elementEnd();
        \u0275\u0275elementStart(16, "a", 10);
        \u0275\u0275element(17, "i", 11);
        \u0275\u0275text(18, " Projets");
        \u0275\u0275elementEnd();
        \u0275\u0275elementStart(19, "a", 12);
        \u0275\u0275element(20, "i", 13);
        \u0275\u0275text(21, " Incidents");
        \u0275\u0275template(22, LayoutComponent_span_22_Template, 2, 1, "span", 14);
        \u0275\u0275elementEnd();
        \u0275\u0275elementStart(23, "a", 15);
        \u0275\u0275element(24, "i", 16);
        \u0275\u0275text(25, " Agents IA");
        \u0275\u0275elementEnd();
        \u0275\u0275elementStart(26, "div", 7);
        \u0275\u0275text(27, "Syst\xE8me");
        \u0275\u0275elementEnd();
        \u0275\u0275elementStart(28, "a", 17);
        \u0275\u0275element(29, "i", 18);
        \u0275\u0275text(30, " Notifications");
        \u0275\u0275elementEnd();
        \u0275\u0275elementStart(31, "a", 19);
        \u0275\u0275element(32, "i", 20);
        \u0275\u0275text(33, " Param\xE8tres");
        \u0275\u0275elementEnd();
        \u0275\u0275template(34, LayoutComponent_a_34_Template, 3, 0, "a", 21);
        \u0275\u0275elementEnd();
        \u0275\u0275elementStart(35, "div", 22)(36, "div", 23)(37, "div", 24);
        \u0275\u0275text(38);
        \u0275\u0275elementEnd();
        \u0275\u0275elementStart(39, "div", 25)(40, "div", 26);
        \u0275\u0275text(41);
        \u0275\u0275elementEnd();
        \u0275\u0275elementStart(42, "div", 27);
        \u0275\u0275text(43);
        \u0275\u0275elementEnd()();
        \u0275\u0275elementStart(44, "button", 28);
        \u0275\u0275listener("click", function LayoutComponent_Template_button_click_44_listener() {
          return ctx.logout();
        });
        \u0275\u0275element(45, "i", 29);
        \u0275\u0275elementEnd()()()();
        \u0275\u0275elementStart(46, "div", 30)(47, "header", 31)(48, "div", 32);
        \u0275\u0275text(49);
        \u0275\u0275elementEnd();
        \u0275\u0275elementStart(50, "div", 33)(51, "div", 34);
        \u0275\u0275element(52, "span", 35);
        \u0275\u0275text(53, " LIVE");
        \u0275\u0275elementEnd();
        \u0275\u0275elementStart(54, "div", 36);
        \u0275\u0275text(55);
        \u0275\u0275elementEnd()()();
        \u0275\u0275elementStart(56, "div", 37);
        \u0275\u0275element(57, "router-outlet");
        \u0275\u0275elementEnd()()();
      }
      if (rf & 2) {
        \u0275\u0275advance(22);
        \u0275\u0275property("ngIf", ctx.openCount > 0);
        \u0275\u0275advance(12);
        \u0275\u0275property("ngIf", ctx.isAdmin);
        \u0275\u0275advance(4);
        \u0275\u0275textInterpolate(ctx.userInitials);
        \u0275\u0275advance(3);
        \u0275\u0275textInterpolate(ctx.currentUser == null ? null : ctx.currentUser.username);
        \u0275\u0275advance(2);
        \u0275\u0275textInterpolate(ctx.currentUser == null ? null : ctx.currentUser.role);
        \u0275\u0275advance(6);
        \u0275\u0275textInterpolate(ctx.pageTitle);
        \u0275\u0275advance(6);
        \u0275\u0275textInterpolate(ctx.userInitials);
      }
    }, dependencies: [CommonModule, NgIf, RouterModule, RouterOutlet, RouterLink, RouterLinkActive], styles: ['\n\n[_nghost-%COMP%] {\n  display: block;\n}\n.app-shell[_ngcontent-%COMP%] {\n  display: flex;\n  min-height: 100vh;\n  background: #0d1117;\n  color: #e6edf3;\n  font-family: "JetBrains Mono", monospace;\n}\n.sidebar[_ngcontent-%COMP%] {\n  width: 210px;\n  background: #161b22;\n  border-right: 1px solid #30363d;\n  display: flex;\n  flex-direction: column;\n  position: fixed;\n  top: 0;\n  left: 0;\n  bottom: 0;\n  z-index: 100;\n}\n.sb-logo[_ngcontent-%COMP%] {\n  display: flex;\n  align-items: center;\n  gap: 9px;\n  padding: 13px 11px;\n  border-bottom: 1px solid #30363d;\n}\n.logo-mark[_ngcontent-%COMP%] {\n  width: 26px;\n  height: 26px;\n  background: #58a6ff;\n  border-radius: 6px;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  color: #fff;\n  font-weight: 700;\n  font-size: 12px;\n}\n.logo-title[_ngcontent-%COMP%] {\n  font-size: 12px;\n  font-weight: 600;\n  color: #e6edf3;\n}\n.logo-sub[_ngcontent-%COMP%] {\n  font-size: 9px;\n  color: #8b949e;\n}\n.sb-nav[_ngcontent-%COMP%] {\n  flex: 1;\n  padding: 5px 0;\n  overflow-y: auto;\n}\n.nav-section[_ngcontent-%COMP%] {\n  padding: 7px 10px 2px;\n  font-size: 9px;\n  color: #484f58;\n  text-transform: uppercase;\n  letter-spacing: 0.7px;\n  font-weight: 600;\n}\n.nav-item[_ngcontent-%COMP%] {\n  display: flex;\n  align-items: center;\n  gap: 7px;\n  padding: 6px 10px;\n  font-size: 11px;\n  color: #8b949e;\n  text-decoration: none;\n  border-right: 2px solid transparent;\n  transition: all 0.12s;\n}\n.nav-item[_ngcontent-%COMP%]   i[_ngcontent-%COMP%] {\n  font-size: 13px;\n  width: 14px;\n}\n.nav-item[_ngcontent-%COMP%]:hover {\n  background: #21262d;\n  color: #e6edf3;\n}\n.nav-item.active[_ngcontent-%COMP%] {\n  background: #0c1c2e;\n  color: #58a6ff;\n  border-right-color: #58a6ff;\n}\n.nav-badge[_ngcontent-%COMP%] {\n  margin-left: auto;\n  border-radius: 8px;\n  padding: 1px 5px;\n  font-size: 9px;\n  font-weight: 700;\n}\n.nav-badge.red[_ngcontent-%COMP%] {\n  background: #2d1117;\n  color: #f85149;\n}\n.sb-footer[_ngcontent-%COMP%] {\n  padding: 9px;\n  border-top: 1px solid #30363d;\n}\n.user-row[_ngcontent-%COMP%] {\n  display: flex;\n  align-items: center;\n  gap: 7px;\n}\n.user-av[_ngcontent-%COMP%] {\n  width: 26px;\n  height: 26px;\n  background: #0c1c2e;\n  border-radius: 50%;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  font-size: 10px;\n  font-weight: 700;\n  color: #58a6ff;\n}\n.user-info[_ngcontent-%COMP%] {\n  flex: 1;\n  min-width: 0;\n}\n.user-name[_ngcontent-%COMP%] {\n  font-size: 11px;\n  color: #e6edf3;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n.user-role[_ngcontent-%COMP%] {\n  font-size: 9px;\n  color: #8b949e;\n}\n.logout-btn[_ngcontent-%COMP%] {\n  background: none;\n  border: 1px solid #30363d;\n  border-radius: 5px;\n  color: #8b949e;\n  cursor: pointer;\n  padding: 4px 6px;\n  font-size: 12px;\n}\n.logout-btn[_ngcontent-%COMP%]:hover {\n  border-color: #f85149;\n  color: #f85149;\n}\n.main-content[_ngcontent-%COMP%] {\n  margin-left: 210px;\n  flex: 1;\n  display: flex;\n  flex-direction: column;\n  min-height: 100vh;\n}\n.topbar[_ngcontent-%COMP%] {\n  height: 44px;\n  background: #161b22;\n  border-bottom: 1px solid #30363d;\n  display: flex;\n  align-items: center;\n  padding: 0 16px;\n  gap: 10px;\n  position: sticky;\n  top: 0;\n  z-index: 50;\n}\n.topbar-title[_ngcontent-%COMP%] {\n  font-size: 13px;\n  font-weight: 600;\n  flex: 1;\n  color: #e6edf3;\n}\n.topbar-right[_ngcontent-%COMP%] {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n}\n.live-badge[_ngcontent-%COMP%] {\n  display: flex;\n  align-items: center;\n  gap: 5px;\n  padding: 3px 9px;\n  background: #0d2119;\n  border: 1px solid #3fb950;\n  border-radius: 12px;\n  font-size: 10px;\n  font-weight: 700;\n  color: #3fb950;\n}\n.live-dot[_ngcontent-%COMP%] {\n  width: 6px;\n  height: 6px;\n  background: #3fb950;\n  border-radius: 50%;\n  animation: _ngcontent-%COMP%_pulse 1.5s infinite;\n}\n@keyframes _ngcontent-%COMP%_pulse {\n  0%, 100% {\n    opacity: 1;\n  }\n  50% {\n    opacity: 0.4;\n  }\n}\n.uav[_ngcontent-%COMP%] {\n  width: 28px;\n  height: 28px;\n  background: #0c1c2e;\n  border-radius: 50%;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  font-size: 10px;\n  font-weight: 700;\n  color: #58a6ff;\n}\n.page-wrap[_ngcontent-%COMP%] {\n  flex: 1;\n  overflow: auto;\n}\n/*# sourceMappingURL=layout.component.css.map */'] });
  }
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && \u0275setClassDebugInfo(LayoutComponent, { className: "LayoutComponent", filePath: "src/app/shared/layout/layout.component.ts", lineNumber: 91 });
})();
export {
  LayoutComponent
};
//# sourceMappingURL=chunk-SPDWOSKU.js.map
