import {
  ToastService
} from "./chunk-RAVY26A2.js";
import {
  ApiService
} from "./chunk-SVQEMZLJ.js";
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
  ɵɵclassMapInterpolate1,
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
  ɵɵresetView,
  ɵɵrestoreView,
  ɵɵstyleProp,
  ɵɵtemplate,
  ɵɵtext,
  ɵɵtextInterpolate,
  ɵɵtextInterpolate1
} from "./chunk-ZQZUXNDQ.js";

// src/app/features/notifications/notifications.component.ts
function NotificationsComponent_button_7_Template(rf, ctx) {
  if (rf & 1) {
    const _r1 = \u0275\u0275getCurrentView();
    \u0275\u0275elementStart(0, "button", 7);
    \u0275\u0275listener("click", function NotificationsComponent_button_7_Template_button_click_0_listener() {
      \u0275\u0275restoreView(_r1);
      const ctx_r1 = \u0275\u0275nextContext();
      return \u0275\u0275resetView(ctx_r1.markAllRead());
    });
    \u0275\u0275text(1);
    \u0275\u0275elementEnd();
  }
  if (rf & 2) {
    const ctx_r1 = \u0275\u0275nextContext();
    \u0275\u0275advance();
    \u0275\u0275textInterpolate1(" \u2713 Tout marquer comme lu (", ctx_r1.unreadCount, ") ");
  }
}
function NotificationsComponent_div_8_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementStart(0, "div", 8);
    \u0275\u0275element(1, "div", 9);
    \u0275\u0275elementEnd();
  }
}
function NotificationsComponent_div_9_div_1_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementStart(0, "div", 13)(1, "div", 14);
    \u0275\u0275text(2, "\u25C9");
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(3, "div", 15);
    \u0275\u0275text(4, "Aucune notification");
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(5, "div", 16);
    \u0275\u0275text(6, "Vous \xEAtes \xE0 jour");
    \u0275\u0275elementEnd()();
  }
}
function NotificationsComponent_div_9_div_2_Template(rf, ctx) {
  if (rf & 1) {
    const _r3 = \u0275\u0275getCurrentView();
    \u0275\u0275elementStart(0, "div", 17);
    \u0275\u0275listener("click", function NotificationsComponent_div_9_div_2_Template_div_click_0_listener() {
      const n_r4 = \u0275\u0275restoreView(_r3).$implicit;
      const ctx_r1 = \u0275\u0275nextContext(2);
      return \u0275\u0275resetView(ctx_r1.markRead(n_r4));
    });
    \u0275\u0275element(1, "div", 18);
    \u0275\u0275elementStart(2, "div", 19)(3, "div", 20);
    \u0275\u0275text(4);
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(5, "div", 21);
    \u0275\u0275text(6);
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(7, "div", 22);
    \u0275\u0275text(8);
    \u0275\u0275pipe(9, "date");
    \u0275\u0275elementEnd()();
    \u0275\u0275elementStart(10, "span");
    \u0275\u0275text(11);
    \u0275\u0275elementEnd()();
  }
  if (rf & 2) {
    const n_r4 = ctx.$implicit;
    const ctx_r1 = \u0275\u0275nextContext(2);
    \u0275\u0275classProp("unread", !n_r4.read);
    \u0275\u0275advance();
    \u0275\u0275styleProp("background", ctx_r1.getTypeColor(n_r4.type));
    \u0275\u0275advance(3);
    \u0275\u0275textInterpolate(n_r4.title);
    \u0275\u0275advance(2);
    \u0275\u0275textInterpolate(n_r4.message);
    \u0275\u0275advance(2);
    \u0275\u0275textInterpolate(\u0275\u0275pipeBind2(9, 11, n_r4.createdAt, "dd/MM/yyyy HH:mm"));
    \u0275\u0275advance(2);
    \u0275\u0275classMapInterpolate1("badge ", n_r4.type == null ? null : n_r4.type.toLowerCase(), "");
    \u0275\u0275advance();
    \u0275\u0275textInterpolate(n_r4.type);
  }
}
function NotificationsComponent_div_9_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementStart(0, "div", 10);
    \u0275\u0275template(1, NotificationsComponent_div_9_div_1_Template, 7, 0, "div", 11)(2, NotificationsComponent_div_9_div_2_Template, 12, 14, "div", 12);
    \u0275\u0275elementEnd();
  }
  if (rf & 2) {
    const ctx_r1 = \u0275\u0275nextContext();
    \u0275\u0275advance();
    \u0275\u0275property("ngIf", ctx_r1.notifications.length === 0);
    \u0275\u0275advance();
    \u0275\u0275property("ngForOf", ctx_r1.notifications);
  }
}
var NotificationsComponent = class _NotificationsComponent {
  constructor(api, toast) {
    this.api = api;
    this.toast = toast;
    this.notifications = [];
    this.loading = false;
  }
  get unreadCount() {
    return this.notifications.filter((n) => !n.read).length;
  }
  ngOnInit() {
    this.load();
  }
  load() {
    this.loading = true;
    this.api.getNotifications().subscribe({
      next: (n) => {
        this.notifications = n;
        this.loading = false;
      },
      error: () => {
        this.loading = false;
      }
    });
  }
  markRead(n) {
    if (n.read)
      return;
    this.api.markNotificationRead(n.id).subscribe(() => {
      n.read = true;
    });
  }
  markAllRead() {
    this.api.markAllRead().subscribe({
      next: () => {
        this.notifications.forEach((n) => n.read = true);
        this.toast.success("Tout marqu\xE9 comme lu");
      }
    });
  }
  getTypeColor(type) {
    const m = {
      ERROR: "var(--accent-red)",
      WARNING: "var(--accent-orange)",
      INFO: "var(--accent-blue)",
      SUCCESS: "var(--accent-green)"
    };
    return m[type] || "var(--text-muted)";
  }
  static {
    this.\u0275fac = function NotificationsComponent_Factory(t) {
      return new (t || _NotificationsComponent)(\u0275\u0275directiveInject(ApiService), \u0275\u0275directiveInject(ToastService));
    };
  }
  static {
    this.\u0275cmp = /* @__PURE__ */ \u0275\u0275defineComponent({ type: _NotificationsComponent, selectors: [["app-notifications"]], standalone: true, features: [\u0275\u0275StandaloneFeature], decls: 10, vars: 3, consts: [[1, "page-container"], [1, "page-header", 2, "display", "flex", "align-items", "center", "justify-content", "space-between"], [1, "page-title"], [1, "page-subtitle"], ["class", "btn btn-secondary btn-sm", 3, "click", 4, "ngIf"], ["class", "loading-overlay", 4, "ngIf"], ["class", "card", "style", "padding:0;overflow:hidden;", 4, "ngIf"], [1, "btn", "btn-secondary", "btn-sm", 3, "click"], [1, "loading-overlay"], [1, "spinner"], [1, "card", 2, "padding", "0", "overflow", "hidden"], ["class", "empty-state", "style", "padding:48px;", 4, "ngIf"], ["class", "notif-row", 3, "unread", "click", 4, "ngFor", "ngForOf"], [1, "empty-state", 2, "padding", "48px"], [1, "empty-icon"], [1, "empty-title"], [1, "empty-sub"], [1, "notif-row", 3, "click"], [1, "notif-dot"], [2, "flex", "1", "min-width", "0"], [1, "notif-title"], [1, "notif-message"], [1, "notif-time"]], template: function NotificationsComponent_Template(rf, ctx) {
      if (rf & 1) {
        \u0275\u0275elementStart(0, "div", 0)(1, "div", 1)(2, "div")(3, "h1", 2);
        \u0275\u0275text(4, "// notifications");
        \u0275\u0275elementEnd();
        \u0275\u0275elementStart(5, "p", 3);
        \u0275\u0275text(6, "Alertes et \xE9v\xE9nements de la plateforme");
        \u0275\u0275elementEnd()();
        \u0275\u0275template(7, NotificationsComponent_button_7_Template, 2, 1, "button", 4);
        \u0275\u0275elementEnd();
        \u0275\u0275template(8, NotificationsComponent_div_8_Template, 2, 0, "div", 5)(9, NotificationsComponent_div_9_Template, 3, 2, "div", 6);
        \u0275\u0275elementEnd();
      }
      if (rf & 2) {
        \u0275\u0275advance(7);
        \u0275\u0275property("ngIf", ctx.unreadCount > 0);
        \u0275\u0275advance();
        \u0275\u0275property("ngIf", ctx.loading);
        \u0275\u0275advance();
        \u0275\u0275property("ngIf", !ctx.loading);
      }
    }, dependencies: [CommonModule, NgForOf, NgIf, DatePipe], styles: ["\n\n.notif-row[_ngcontent-%COMP%] {\n  display: flex;\n  align-items: flex-start;\n  gap: 12px;\n  padding: 14px 20px;\n  border-bottom: 1px solid var(--border);\n  cursor: pointer;\n  transition: background 0.1s;\n}\n.notif-row[_ngcontent-%COMP%]:last-child {\n  border-bottom: none;\n}\n.notif-row[_ngcontent-%COMP%]:hover {\n  background: var(--bg-hover);\n}\n.notif-row.unread[_ngcontent-%COMP%] {\n  background: var(--accent-blue-bg);\n}\n.notif-row.unread[_ngcontent-%COMP%]:hover {\n  background: var(--bg-hover);\n}\n.notif-dot[_ngcontent-%COMP%] {\n  width: 8px;\n  height: 8px;\n  border-radius: 50%;\n  margin-top: 5px;\n  flex-shrink: 0;\n}\n.notif-title[_ngcontent-%COMP%] {\n  font-size: 13px;\n  font-weight: 500;\n  color: var(--text-primary);\n  margin-bottom: 3px;\n}\n.notif-message[_ngcontent-%COMP%] {\n  font-size: 12px;\n  color: var(--text-muted);\n  margin-bottom: 4px;\n}\n.notif-time[_ngcontent-%COMP%] {\n  font-size: 10px;\n  color: var(--text-faint);\n  font-family: var(--font-mono);\n}\n/*# sourceMappingURL=notifications.component.css.map */"] });
  }
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && \u0275setClassDebugInfo(NotificationsComponent, { className: "NotificationsComponent", filePath: "src/app/features/notifications/notifications.component.ts", lineNumber: 87 });
})();
export {
  NotificationsComponent
};
//# sourceMappingURL=chunk-IFUZ5TYO.js.map
