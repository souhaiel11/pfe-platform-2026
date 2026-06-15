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
  ApiService
} from "./chunk-N6PMSE62.js";
import {
  environment
} from "./chunk-R3YGZVM2.js";
import {
  NavigationEnd,
  Router,
  RouterLink,
  RouterLinkActive,
  RouterModule,
  RouterOutlet
} from "./chunk-CX7S5RF6.js";
import {
  HttpClient
} from "./chunk-Y42B5JPZ.js";
import {
  BehaviorSubject,
  CommonModule,
  DatePipe,
  NgForOf,
  NgIf,
  filter,
  ɵsetClassDebugInfo,
  ɵɵStandaloneFeature,
  ɵɵadvance,
  ɵɵclassProp,
  ɵɵdefineComponent,
  ɵɵdefineInjectable,
  ɵɵdirectiveInject,
  ɵɵelement,
  ɵɵelementEnd,
  ɵɵelementStart,
  ɵɵgetCurrentView,
  ɵɵinject,
  ɵɵlistener,
  ɵɵloadQuery,
  ɵɵnextContext,
  ɵɵpipe,
  ɵɵpipeBind2,
  ɵɵproperty,
  ɵɵqueryRefresh,
  ɵɵresetView,
  ɵɵrestoreView,
  ɵɵtemplate,
  ɵɵtext,
  ɵɵtextInterpolate,
  ɵɵtextInterpolate1,
  ɵɵtwoWayBindingSet,
  ɵɵtwoWayListener,
  ɵɵtwoWayProperty,
  ɵɵviewQuery
} from "./chunk-ZQZUXNDQ.js";

// src/app/core/services/chat.service.ts
var ChatService = class _ChatService {
  constructor(http) {
    this.http = http;
    this.isOpenSubject = new BehaviorSubject(false);
    this.messagesSubject = new BehaviorSubject([]);
    this.loadingSubject = new BehaviorSubject(false);
    this.isOpen$ = this.isOpenSubject.asObservable();
    this.messages$ = this.messagesSubject.asObservable();
    this.loading$ = this.loadingSubject.asObservable();
    this.webhookUrl = `${environment.n8nUrl}/webhook/chat-agent`;
    this.defaultProjectId = environment.defaultProjectId;
  }
  toggle() {
    const opening = !this.isOpenSubject.value;
    this.isOpenSubject.next(opening);
    if (opening && this.messagesSubject.value.length === 0) {
      this.addMessage("assistant", "\u{1F44B} Bonjour ! Je suis votre assistant DevSecOps IA.\nPosez-moi une question sur vos incidents, corrections ou projets.");
    }
  }
  close() {
    this.isOpenSubject.next(false);
  }
  sendMessage(question, projectId) {
    if (!question.trim() || this.loadingSubject.value)
      return;
    this.addMessage("user", question);
    this.loadingSubject.next(true);
    this.http.post(this.webhookUrl, {
      question: question.trim(),
      projectId: projectId || this.defaultProjectId
    }).subscribe({
      next: (res) => {
        this.addMessage("assistant", res.answer || "R\xE9ponse re\xE7ue.");
        this.loadingSubject.next(false);
      },
      error: () => {
        this.addMessage("assistant", "\u26A0\uFE0F Impossible de contacter l'agent IA. V\xE9rifiez que le workflow n8n est actif.");
        this.loadingSubject.next(false);
      }
    });
  }
  clearHistory() {
    this.messagesSubject.next([]);
  }
  addMessage(role, content) {
    const current = this.messagesSubject.value;
    this.messagesSubject.next([...current, { role, content, timestamp: /* @__PURE__ */ new Date() }]);
  }
  static {
    this.\u0275fac = function ChatService_Factory(t) {
      return new (t || _ChatService)(\u0275\u0275inject(HttpClient));
    };
  }
  static {
    this.\u0275prov = /* @__PURE__ */ \u0275\u0275defineInjectable({ token: _ChatService, factory: _ChatService.\u0275fac, providedIn: "root" });
  }
};

// src/app/shared/chat-widget/chat-widget.component.ts
var _c0 = ["messagesContainer"];
function ChatWidgetComponent_div_19_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementStart(0, "div", 21)(1, "div", 22)(2, "pre", 23);
    \u0275\u0275text(3);
    \u0275\u0275elementEnd();
    \u0275\u0275elementStart(4, "div", 24);
    \u0275\u0275text(5);
    \u0275\u0275pipe(6, "date");
    \u0275\u0275elementEnd()()();
  }
  if (rf & 2) {
    const msg_r2 = ctx.$implicit;
    \u0275\u0275classProp("user", msg_r2.role === "user");
    \u0275\u0275advance();
    \u0275\u0275classProp("user-bubble", msg_r2.role === "user");
    \u0275\u0275advance(2);
    \u0275\u0275textInterpolate(msg_r2.content);
    \u0275\u0275advance(2);
    \u0275\u0275textInterpolate(\u0275\u0275pipeBind2(6, 6, msg_r2.timestamp, "HH:mm"));
  }
}
function ChatWidgetComponent_div_20_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementStart(0, "div", 21)(1, "div", 22)(2, "div", 25);
    \u0275\u0275element(3, "span")(4, "span")(5, "span");
    \u0275\u0275elementEnd()()();
  }
}
function ChatWidgetComponent_div_21_button_1_Template(rf, ctx) {
  if (rf & 1) {
    const _r3 = \u0275\u0275getCurrentView();
    \u0275\u0275elementStart(0, "button", 28);
    \u0275\u0275listener("click", function ChatWidgetComponent_div_21_button_1_Template_button_click_0_listener() {
      const s_r4 = \u0275\u0275restoreView(_r3).$implicit;
      const ctx_r4 = \u0275\u0275nextContext(2);
      return \u0275\u0275resetView(ctx_r4.send(s_r4));
    });
    \u0275\u0275text(1);
    \u0275\u0275elementEnd();
  }
  if (rf & 2) {
    const s_r4 = ctx.$implicit;
    \u0275\u0275advance();
    \u0275\u0275textInterpolate1(" ", s_r4, " ");
  }
}
function ChatWidgetComponent_div_21_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementStart(0, "div", 26);
    \u0275\u0275template(1, ChatWidgetComponent_div_21_button_1_Template, 2, 1, "button", 27);
    \u0275\u0275elementEnd();
  }
  if (rf & 2) {
    const ctx_r4 = \u0275\u0275nextContext();
    \u0275\u0275advance();
    \u0275\u0275property("ngForOf", ctx_r4.suggestions);
  }
}
function ChatWidgetComponent_span_27_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementStart(0, "span");
    \u0275\u0275text(1, "\u{1F4AC}");
    \u0275\u0275elementEnd();
  }
}
function ChatWidgetComponent_span_28_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementStart(0, "span");
    \u0275\u0275text(1, "\u2715");
    \u0275\u0275elementEnd();
  }
}
var ChatWidgetComponent = class _ChatWidgetComponent {
  // FIX: Only inject ChatService — no direct HttpClient here
  constructor(chatService) {
    this.chatService = chatService;
    this.messages = [];
    this.loading = false;
    this.isOpen = false;
    this.inputText = "";
    this.suggestions = [
      "Incidents en cours ?",
      "Derni\xE8res corrections ?",
      "Sant\xE9 du projet ?",
      "Incidents Jenkins ?"
    ];
    this.subs = [];
  }
  ngOnInit() {
    this.subs.push(this.chatService.isOpen$.subscribe((v) => this.isOpen = v), this.chatService.messages$.subscribe((m) => {
      this.messages = m;
      setTimeout(() => this.scrollToBottom(), 50);
    }), this.chatService.loading$.subscribe((v) => this.loading = v));
  }
  toggle() {
    this.chatService.toggle();
  }
  close() {
    this.chatService.close();
  }
  clearChat() {
    this.chatService.clearHistory();
  }
  send(text) {
    const q = text || this.inputText.trim();
    if (!q)
      return;
    this.inputText = "";
    this.chatService.sendMessage(q);
  }
  onKeydown(event) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      this.send();
    }
  }
  scrollToBottom() {
    if (this.container?.nativeElement) {
      this.container.nativeElement.scrollTop = this.container.nativeElement.scrollHeight;
    }
  }
  ngOnDestroy() {
    this.subs.forEach((s) => s.unsubscribe());
  }
  static {
    this.\u0275fac = function ChatWidgetComponent_Factory(t) {
      return new (t || _ChatWidgetComponent)(\u0275\u0275directiveInject(ChatService));
    };
  }
  static {
    this.\u0275cmp = /* @__PURE__ */ \u0275\u0275defineComponent({ type: _ChatWidgetComponent, selectors: [["app-chat-widget"]], viewQuery: function ChatWidgetComponent_Query(rf, ctx) {
      if (rf & 1) {
        \u0275\u0275viewQuery(_c0, 5);
      }
      if (rf & 2) {
        let _t;
        \u0275\u0275queryRefresh(_t = \u0275\u0275loadQuery()) && (ctx.container = _t.first);
      }
    }, standalone: true, features: [\u0275\u0275StandaloneFeature], decls: 29, vars: 12, consts: [["messagesContainer", ""], [1, "chat-wrapper"], [1, "chat-panel"], [1, "chat-header"], [1, "chat-agent-info"], [1, "agent-avatar"], [1, "agent-name"], [1, "agent-status"], [1, "status-dot"], [2, "display", "flex", "gap", "6px"], ["title", "Effacer", 1, "header-btn", 3, "click"], ["title", "Fermer", 1, "header-btn", 3, "click"], [1, "chat-messages"], ["class", "message", 3, "user", 4, "ngFor", "ngForOf"], ["class", "message", 4, "ngIf"], ["class", "suggestions", 4, "ngIf"], [1, "chat-input-area"], ["placeholder", "Posez votre question...", 1, "chat-input", 3, "ngModelChange", "keydown", "ngModel", "disabled"], [1, "send-btn", 3, "click", "disabled"], [1, "chat-fab", 3, "click"], [4, "ngIf"], [1, "message"], [1, "message-bubble"], [1, "message-content"], [1, "message-time"], [1, "typing-indicator"], [1, "suggestions"], ["class", "suggestion-chip", 3, "click", 4, "ngFor", "ngForOf"], [1, "suggestion-chip", 3, "click"]], template: function ChatWidgetComponent_Template(rf, ctx) {
      if (rf & 1) {
        const _r1 = \u0275\u0275getCurrentView();
        \u0275\u0275elementStart(0, "div", 1)(1, "div", 2)(2, "div", 3)(3, "div", 4)(4, "div", 5);
        \u0275\u0275text(5, "IA");
        \u0275\u0275elementEnd();
        \u0275\u0275elementStart(6, "div")(7, "div", 6);
        \u0275\u0275text(8, "Assistant DevSecOps");
        \u0275\u0275elementEnd();
        \u0275\u0275elementStart(9, "div", 7);
        \u0275\u0275element(10, "span", 8);
        \u0275\u0275text(11, " En ligne ");
        \u0275\u0275elementEnd()()();
        \u0275\u0275elementStart(12, "div", 9)(13, "button", 10);
        \u0275\u0275listener("click", function ChatWidgetComponent_Template_button_click_13_listener() {
          \u0275\u0275restoreView(_r1);
          return \u0275\u0275resetView(ctx.clearChat());
        });
        \u0275\u0275text(14, "\u21BA");
        \u0275\u0275elementEnd();
        \u0275\u0275elementStart(15, "button", 11);
        \u0275\u0275listener("click", function ChatWidgetComponent_Template_button_click_15_listener() {
          \u0275\u0275restoreView(_r1);
          return \u0275\u0275resetView(ctx.close());
        });
        \u0275\u0275text(16, "\u2715");
        \u0275\u0275elementEnd()()();
        \u0275\u0275elementStart(17, "div", 12, 0);
        \u0275\u0275template(19, ChatWidgetComponent_div_19_Template, 7, 9, "div", 13)(20, ChatWidgetComponent_div_20_Template, 6, 0, "div", 14);
        \u0275\u0275elementEnd();
        \u0275\u0275template(21, ChatWidgetComponent_div_21_Template, 2, 1, "div", 15);
        \u0275\u0275elementStart(22, "div", 16)(23, "input", 17);
        \u0275\u0275twoWayListener("ngModelChange", function ChatWidgetComponent_Template_input_ngModelChange_23_listener($event) {
          \u0275\u0275restoreView(_r1);
          \u0275\u0275twoWayBindingSet(ctx.inputText, $event) || (ctx.inputText = $event);
          return \u0275\u0275resetView($event);
        });
        \u0275\u0275listener("keydown", function ChatWidgetComponent_Template_input_keydown_23_listener($event) {
          \u0275\u0275restoreView(_r1);
          return \u0275\u0275resetView(ctx.onKeydown($event));
        });
        \u0275\u0275elementEnd();
        \u0275\u0275elementStart(24, "button", 18);
        \u0275\u0275listener("click", function ChatWidgetComponent_Template_button_click_24_listener() {
          \u0275\u0275restoreView(_r1);
          return \u0275\u0275resetView(ctx.send());
        });
        \u0275\u0275text(25, " \u25B6 ");
        \u0275\u0275elementEnd()()();
        \u0275\u0275elementStart(26, "button", 19);
        \u0275\u0275listener("click", function ChatWidgetComponent_Template_button_click_26_listener() {
          \u0275\u0275restoreView(_r1);
          return \u0275\u0275resetView(ctx.toggle());
        });
        \u0275\u0275template(27, ChatWidgetComponent_span_27_Template, 2, 0, "span", 20)(28, ChatWidgetComponent_span_28_Template, 2, 0, "span", 20);
        \u0275\u0275elementEnd()();
      }
      if (rf & 2) {
        \u0275\u0275advance();
        \u0275\u0275classProp("open", ctx.isOpen);
        \u0275\u0275advance(18);
        \u0275\u0275property("ngForOf", ctx.messages);
        \u0275\u0275advance();
        \u0275\u0275property("ngIf", ctx.loading);
        \u0275\u0275advance();
        \u0275\u0275property("ngIf", ctx.messages.length <= 1 && !ctx.loading);
        \u0275\u0275advance(2);
        \u0275\u0275twoWayProperty("ngModel", ctx.inputText);
        \u0275\u0275property("disabled", ctx.loading);
        \u0275\u0275advance();
        \u0275\u0275property("disabled", !ctx.inputText.trim() || ctx.loading);
        \u0275\u0275advance(2);
        \u0275\u0275classProp("open", ctx.isOpen);
        \u0275\u0275advance();
        \u0275\u0275property("ngIf", !ctx.isOpen);
        \u0275\u0275advance();
        \u0275\u0275property("ngIf", ctx.isOpen);
      }
    }, dependencies: [CommonModule, NgForOf, NgIf, DatePipe, FormsModule, DefaultValueAccessor, NgControlStatus, NgModel], styles: ["\n\n.chat-wrapper[_ngcontent-%COMP%] {\n  position: fixed;\n  bottom: 24px;\n  right: 24px;\n  z-index: 1000;\n}\n.chat-fab[_ngcontent-%COMP%] {\n  width: 52px;\n  height: 52px;\n  border-radius: 50%;\n  background: var(--accent-blue);\n  border: none;\n  color: #080c14;\n  font-size: 20px;\n  cursor: pointer;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  margin-left: auto;\n  box-shadow: 0 0 0 4px rgba(56, 189, 248, 0.1333333333);\n  transition: all 0.2s;\n}\n.chat-fab[_ngcontent-%COMP%]:hover {\n  transform: scale(1.05);\n}\n.chat-fab.open[_ngcontent-%COMP%] {\n  background: var(--bg-secondary);\n  color: var(--text-secondary);\n  border: 1px solid var(--border);\n}\n.chat-panel[_ngcontent-%COMP%] {\n  position: absolute;\n  bottom: 64px;\n  right: 0;\n  width: 360px;\n  height: 520px;\n  background: var(--bg-secondary);\n  border: 1px solid var(--border);\n  border-radius: var(--radius-lg);\n  display: flex;\n  flex-direction: column;\n  overflow: hidden;\n  transform: scale(0.9) translateY(20px);\n  opacity: 0;\n  pointer-events: none;\n  transition: all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);\n  transform-origin: bottom right;\n}\n.chat-panel.open[_ngcontent-%COMP%] {\n  transform: scale(1) translateY(0);\n  opacity: 1;\n  pointer-events: all;\n}\n.chat-header[_ngcontent-%COMP%] {\n  padding: 14px 16px;\n  border-bottom: 1px solid var(--border);\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  flex-shrink: 0;\n}\n.chat-agent-info[_ngcontent-%COMP%] {\n  display: flex;\n  align-items: center;\n  gap: 10px;\n}\n.agent-avatar[_ngcontent-%COMP%] {\n  width: 34px;\n  height: 34px;\n  border-radius: 50%;\n  background: var(--accent-blue-bg);\n  border: 1px solid var(--accent-blue);\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  font-size: 10px;\n  font-weight: 700;\n  color: var(--accent-blue);\n  font-family: var(--font-mono);\n}\n.agent-name[_ngcontent-%COMP%] {\n  font-size: 13px;\n  font-weight: 600;\n  color: var(--text-primary);\n}\n.agent-status[_ngcontent-%COMP%] {\n  display: flex;\n  align-items: center;\n  gap: 4px;\n  font-size: 10px;\n  color: var(--accent-green);\n}\n.status-dot[_ngcontent-%COMP%] {\n  width: 5px;\n  height: 5px;\n  border-radius: 50%;\n  background: var(--accent-green);\n  animation: pulse-live 2s infinite;\n}\n.header-btn[_ngcontent-%COMP%] {\n  background: transparent;\n  border: 1px solid var(--border);\n  border-radius: var(--radius-sm);\n  color: var(--text-muted);\n  padding: 4px 8px;\n  cursor: pointer;\n  font-size: 12px;\n  transition: all 0.15s;\n}\n.header-btn[_ngcontent-%COMP%]:hover {\n  border-color: var(--border-light);\n  color: var(--text-secondary);\n}\n.chat-messages[_ngcontent-%COMP%] {\n  flex: 1;\n  overflow-y: auto;\n  padding: 16px;\n  display: flex;\n  flex-direction: column;\n  gap: 12px;\n}\n.message[_ngcontent-%COMP%] {\n  display: flex;\n}\n.message.user[_ngcontent-%COMP%] {\n  justify-content: flex-end;\n}\n.message-bubble[_ngcontent-%COMP%] {\n  max-width: 80%;\n  background: var(--bg-tertiary);\n  border: 1px solid var(--border);\n  border-radius: var(--radius-md);\n  padding: 10px 12px;\n}\n.user-bubble[_ngcontent-%COMP%] {\n  background: var(--accent-blue-bg);\n  border-color: var(--accent-blue);\n}\n.message-content[_ngcontent-%COMP%] {\n  font-size: 12px;\n  color: var(--text-primary);\n  white-space: pre-wrap;\n  font-family: var(--font-sans);\n  line-height: 1.5;\n  margin: 0;\n}\n.user-bubble[_ngcontent-%COMP%]   .message-content[_ngcontent-%COMP%] {\n  color: var(--accent-blue);\n}\n.message-time[_ngcontent-%COMP%] {\n  font-size: 10px;\n  color: var(--text-faint);\n  margin-top: 4px;\n  font-family: var(--font-mono);\n}\n.typing-indicator[_ngcontent-%COMP%] {\n  display: flex;\n  gap: 4px;\n  padding: 4px 0;\n}\n.typing-indicator[_ngcontent-%COMP%]   span[_ngcontent-%COMP%] {\n  width: 6px;\n  height: 6px;\n  border-radius: 50%;\n  background: var(--accent-blue);\n  animation: _ngcontent-%COMP%_typing 1.4s infinite;\n}\n.typing-indicator[_ngcontent-%COMP%]   span[_ngcontent-%COMP%]:nth-child(2) {\n  animation-delay: 0.2s;\n}\n.typing-indicator[_ngcontent-%COMP%]   span[_ngcontent-%COMP%]:nth-child(3) {\n  animation-delay: 0.4s;\n}\n@keyframes _ngcontent-%COMP%_typing {\n  0%, 60%, 100% {\n    transform: translateY(0);\n    opacity: 0.4;\n  }\n  30% {\n    transform: translateY(-4px);\n    opacity: 1;\n  }\n}\n.suggestions[_ngcontent-%COMP%] {\n  padding: 8px 12px;\n  display: flex;\n  flex-wrap: wrap;\n  gap: 6px;\n}\n.suggestion-chip[_ngcontent-%COMP%] {\n  background: var(--bg-tertiary);\n  border: 1px solid var(--border);\n  border-radius: 20px;\n  color: var(--text-secondary);\n  font-size: 11px;\n  padding: 4px 10px;\n  cursor: pointer;\n  transition: all 0.15s;\n}\n.suggestion-chip[_ngcontent-%COMP%]:hover {\n  border-color: var(--accent-blue);\n  color: var(--accent-blue);\n  background: var(--accent-blue-bg);\n}\n.chat-input-area[_ngcontent-%COMP%] {\n  padding: 12px;\n  border-top: 1px solid var(--border);\n  display: flex;\n  gap: 8px;\n  flex-shrink: 0;\n}\n.chat-input[_ngcontent-%COMP%] {\n  flex: 1;\n  background: var(--bg-tertiary);\n  border: 1px solid var(--border);\n  border-radius: var(--radius-md);\n  color: var(--text-primary);\n  padding: 9px 12px;\n  font-size: 12px;\n  font-family: var(--font-sans);\n  outline: none;\n  transition: border-color 0.15s;\n}\n.chat-input[_ngcontent-%COMP%]:focus {\n  border-color: var(--accent-blue);\n}\n.chat-input[_ngcontent-%COMP%]::placeholder {\n  color: var(--text-faint);\n}\n.chat-input[_ngcontent-%COMP%]:disabled {\n  opacity: 0.5;\n}\n.send-btn[_ngcontent-%COMP%] {\n  background: var(--accent-blue);\n  border: none;\n  border-radius: var(--radius-md);\n  color: #080c14;\n  padding: 9px 14px;\n  cursor: pointer;\n  font-size: 14px;\n  transition: all 0.15s;\n}\n.send-btn[_ngcontent-%COMP%]:hover:not(:disabled) {\n  filter: brightness(1.1);\n}\n.send-btn[_ngcontent-%COMP%]:disabled {\n  opacity: 0.4;\n  cursor: not-allowed;\n}\n/*# sourceMappingURL=chat-widget.component.css.map */"] });
  }
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && \u0275setClassDebugInfo(ChatWidgetComponent, { className: "ChatWidgetComponent", filePath: "src/app/shared/chat-widget/chat-widget.component.ts", lineNumber: 319 });
})();

// src/app/shared/layout/layout.component.ts
function LayoutComponent_span_25_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementStart(0, "span", 30);
    \u0275\u0275text(1);
    \u0275\u0275elementEnd();
  }
  if (rf & 2) {
    const ctx_r0 = \u0275\u0275nextContext();
    \u0275\u0275advance();
    \u0275\u0275textInterpolate(ctx_r0.openCount);
  }
}
function LayoutComponent_span_38_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementStart(0, "span", 31);
    \u0275\u0275text(1);
    \u0275\u0275elementEnd();
  }
  if (rf & 2) {
    const ctx_r0 = \u0275\u0275nextContext();
    \u0275\u0275advance();
    \u0275\u0275textInterpolate(ctx_r0.notifCount);
  }
}
function LayoutComponent_a_43_Template(rf, ctx) {
  if (rf & 1) {
    \u0275\u0275elementStart(0, "a", 32)(1, "span", 9);
    \u0275\u0275text(2, "\u25A3");
    \u0275\u0275elementEnd();
    \u0275\u0275text(3, " Admin ");
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
    this.pageTitle = "Dashboard";
    this.pageTitles = {
      "/dashboard": "Vue d'ensemble",
      "/projects": "Projets",
      "/incidents": "Incidents",
      "/analysis": "Analyses IA",
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
      return "U";
    return (u.username || u.email || "U").substring(0, 2).toUpperCase();
  }
  static {
    this.\u0275fac = function LayoutComponent_Factory(t) {
      return new (t || _LayoutComponent)(\u0275\u0275directiveInject(AuthService), \u0275\u0275directiveInject(ApiService), \u0275\u0275directiveInject(Router));
    };
  }
  static {
    this.\u0275cmp = /* @__PURE__ */ \u0275\u0275defineComponent({ type: _LayoutComponent, selectors: [["app-layout"]], standalone: true, features: [\u0275\u0275StandaloneFeature], decls: 64, vars: 7, consts: [[1, "app-shell"], [1, "sidebar"], [1, "sidebar-logo"], [1, "logo-icon"], [1, "logo-name"], [1, "logo-sub"], [1, "sidebar-nav"], [1, "nav-section"], ["routerLink", "/dashboard", "routerLinkActive", "active", 1, "nav-item"], [1, "nav-icon"], ["routerLink", "/projects", "routerLinkActive", "active", 1, "nav-item"], ["routerLink", "/incidents", "routerLinkActive", "active", 1, "nav-item"], ["class", "nav-badge", 4, "ngIf"], [1, "nav-section", 2, "margin-top", "16px"], ["routerLink", "/analysis", "routerLinkActive", "active", 1, "nav-item"], ["routerLink", "/notifications", "routerLinkActive", "active", 1, "nav-item"], ["class", "nav-badge warn", 4, "ngIf"], ["routerLink", "/settings", "routerLinkActive", "active", 1, "nav-item"], ["class", "nav-item", "routerLink", "/admin", "routerLinkActive", "active", 4, "ngIf"], [1, "sidebar-footer"], [1, "user-info"], [1, "user-avatar"], [1, "user-name"], [1, "user-role"], ["title", "D\xE9connexion", 1, "logout-btn", 3, "click"], [1, "main-content"], [1, "topbar"], [1, "topbar-title"], [1, "live-indicator"], [1, "live-dot"], [1, "nav-badge"], [1, "nav-badge", "warn"], ["routerLink", "/admin", "routerLinkActive", "active", 1, "nav-item"]], template: function LayoutComponent_Template(rf, ctx) {
      if (rf & 1) {
        \u0275\u0275elementStart(0, "div", 0)(1, "aside", 1)(2, "div", 2)(3, "div", 3);
        \u0275\u0275text(4, "\u2B21");
        \u0275\u0275elementEnd();
        \u0275\u0275elementStart(5, "div")(6, "div", 4);
        \u0275\u0275text(7, "DevSecOps");
        \u0275\u0275elementEnd();
        \u0275\u0275elementStart(8, "div", 5);
        \u0275\u0275text(9, "AI Platform \xB7 Vermeg");
        \u0275\u0275elementEnd()()();
        \u0275\u0275elementStart(10, "nav", 6)(11, "div", 7);
        \u0275\u0275text(12, "Principal");
        \u0275\u0275elementEnd();
        \u0275\u0275elementStart(13, "a", 8)(14, "span", 9);
        \u0275\u0275text(15, "\u25C8");
        \u0275\u0275elementEnd();
        \u0275\u0275text(16, " Dashboard ");
        \u0275\u0275elementEnd();
        \u0275\u0275elementStart(17, "a", 10)(18, "span", 9);
        \u0275\u0275text(19, "\u25E7");
        \u0275\u0275elementEnd();
        \u0275\u0275text(20, " Projets ");
        \u0275\u0275elementEnd();
        \u0275\u0275elementStart(21, "a", 11)(22, "span", 9);
        \u0275\u0275text(23, "\u2B21");
        \u0275\u0275elementEnd();
        \u0275\u0275text(24, " Incidents ");
        \u0275\u0275template(25, LayoutComponent_span_25_Template, 2, 1, "span", 12);
        \u0275\u0275elementEnd();
        \u0275\u0275elementStart(26, "div", 13);
        \u0275\u0275text(27, "Agents IA");
        \u0275\u0275elementEnd();
        \u0275\u0275elementStart(28, "a", 14)(29, "span", 9);
        \u0275\u0275text(30, "\u25C6");
        \u0275\u0275elementEnd();
        \u0275\u0275text(31, " Analyses ");
        \u0275\u0275elementEnd();
        \u0275\u0275elementStart(32, "div", 13);
        \u0275\u0275text(33, "Syst\xE8me");
        \u0275\u0275elementEnd();
        \u0275\u0275elementStart(34, "a", 15)(35, "span", 9);
        \u0275\u0275text(36, "\u25C9");
        \u0275\u0275elementEnd();
        \u0275\u0275text(37, " Notifications ");
        \u0275\u0275template(38, LayoutComponent_span_38_Template, 2, 1, "span", 16);
        \u0275\u0275elementEnd();
        \u0275\u0275elementStart(39, "a", 17)(40, "span", 9);
        \u0275\u0275text(41, "\u25CE");
        \u0275\u0275elementEnd();
        \u0275\u0275text(42, " Param\xE8tres ");
        \u0275\u0275elementEnd();
        \u0275\u0275template(43, LayoutComponent_a_43_Template, 4, 0, "a", 18);
        \u0275\u0275elementEnd();
        \u0275\u0275elementStart(44, "div", 19)(45, "div", 20)(46, "div", 21);
        \u0275\u0275text(47);
        \u0275\u0275elementEnd();
        \u0275\u0275elementStart(48, "div")(49, "div", 22);
        \u0275\u0275text(50);
        \u0275\u0275elementEnd();
        \u0275\u0275elementStart(51, "div", 23);
        \u0275\u0275text(52);
        \u0275\u0275elementEnd()()();
        \u0275\u0275elementStart(53, "button", 24);
        \u0275\u0275listener("click", function LayoutComponent_Template_button_click_53_listener() {
          return ctx.logout();
        });
        \u0275\u0275text(54, "\u23FB");
        \u0275\u0275elementEnd()()();
        \u0275\u0275elementStart(55, "div", 25)(56, "header", 26)(57, "span", 27);
        \u0275\u0275text(58);
        \u0275\u0275elementEnd();
        \u0275\u0275elementStart(59, "div", 28);
        \u0275\u0275element(60, "div", 29);
        \u0275\u0275text(61, " Temps r\xE9el ");
        \u0275\u0275elementEnd()();
        \u0275\u0275element(62, "router-outlet");
        \u0275\u0275elementEnd()();
        \u0275\u0275element(63, "app-chat-widget");
      }
      if (rf & 2) {
        \u0275\u0275advance(25);
        \u0275\u0275property("ngIf", ctx.openCount > 0);
        \u0275\u0275advance(13);
        \u0275\u0275property("ngIf", ctx.notifCount > 0);
        \u0275\u0275advance(5);
        \u0275\u0275property("ngIf", ctx.isAdmin);
        \u0275\u0275advance(4);
        \u0275\u0275textInterpolate(ctx.userInitials);
        \u0275\u0275advance(3);
        \u0275\u0275textInterpolate(ctx.currentUser == null ? null : ctx.currentUser.username);
        \u0275\u0275advance(2);
        \u0275\u0275textInterpolate(ctx.currentUser == null ? null : ctx.currentUser.role);
        \u0275\u0275advance(6);
        \u0275\u0275textInterpolate(ctx.pageTitle);
      }
    }, dependencies: [CommonModule, NgIf, RouterModule, RouterOutlet, RouterLink, RouterLinkActive, ChatWidgetComponent], styles: ["\n\n.sidebar[_ngcontent-%COMP%] {\n  position: fixed;\n  top: 0;\n  left: 0;\n  bottom: 0;\n  width: var(--sidebar-width);\n  background: var(--bg-secondary);\n  border-right: 1px solid var(--border);\n  display: flex;\n  flex-direction: column;\n  z-index: 100;\n}\n.sidebar-logo[_ngcontent-%COMP%] {\n  display: flex;\n  align-items: center;\n  gap: 10px;\n  padding: 18px 16px;\n  border-bottom: 1px solid var(--border);\n}\n.logo-icon[_ngcontent-%COMP%] {\n  font-size: 20px;\n  color: var(--accent-blue);\n}\n.logo-name[_ngcontent-%COMP%] {\n  font-size: 13px;\n  font-weight: 700;\n  color: var(--accent-blue);\n  letter-spacing: 2px;\n  text-transform: uppercase;\n  font-family: var(--font-mono);\n}\n.logo-sub[_ngcontent-%COMP%] {\n  font-size: 9px;\n  color: var(--text-faint);\n  letter-spacing: 0.5px;\n}\n.sidebar-nav[_ngcontent-%COMP%] {\n  flex: 1;\n  padding: 12px 8px;\n  overflow-y: auto;\n}\n.nav-section[_ngcontent-%COMP%] {\n  font-size: 9px;\n  color: var(--text-faint);\n  letter-spacing: 2px;\n  text-transform: uppercase;\n  padding: 4px 10px;\n  margin-bottom: 4px;\n  font-family: var(--font-mono);\n}\n.nav-item[_ngcontent-%COMP%] {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  padding: 8px 10px;\n  border-radius: var(--radius-md);\n  font-size: 12px;\n  color: var(--text-muted);\n  cursor: pointer;\n  margin-bottom: 2px;\n  transition: all 0.15s;\n  text-decoration: none;\n  font-family: var(--font-sans);\n}\n.nav-item[_ngcontent-%COMP%]:hover {\n  background: var(--bg-hover);\n  color: var(--text-secondary);\n  text-decoration: none;\n}\n.nav-item.active[_ngcontent-%COMP%] {\n  background: var(--bg-hover);\n  color: var(--accent-blue);\n  border-left: 2px solid var(--accent-blue);\n  padding-left: 8px;\n}\n.nav-icon[_ngcontent-%COMP%] {\n  font-size: 13px;\n  width: 16px;\n  text-align: center;\n  flex-shrink: 0;\n}\n.nav-badge[_ngcontent-%COMP%] {\n  margin-left: auto;\n  background: var(--accent-red-bg);\n  color: var(--accent-red);\n  font-size: 9px;\n  font-weight: 700;\n  padding: 2px 6px;\n  border-radius: 10px;\n  font-family: var(--font-mono);\n}\n.nav-badge.warn[_ngcontent-%COMP%] {\n  background: var(--accent-orange-bg);\n  color: var(--accent-orange);\n}\n.sidebar-footer[_ngcontent-%COMP%] {\n  padding: 12px 16px;\n  border-top: 1px solid var(--border);\n  display: flex;\n  align-items: center;\n  gap: 10px;\n}\n.user-info[_ngcontent-%COMP%] {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  flex: 1;\n  min-width: 0;\n}\n.user-avatar[_ngcontent-%COMP%] {\n  width: 30px;\n  height: 30px;\n  border-radius: 50%;\n  background: var(--accent-blue-bg);\n  border: 1px solid var(--accent-blue);\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  font-size: 11px;\n  font-weight: 700;\n  color: var(--accent-blue);\n  flex-shrink: 0;\n  font-family: var(--font-mono);\n}\n.user-name[_ngcontent-%COMP%] {\n  font-size: 12px;\n  color: var(--text-secondary);\n  font-weight: 500;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n.user-role[_ngcontent-%COMP%] {\n  font-size: 10px;\n  color: var(--text-faint);\n  font-family: var(--font-mono);\n}\n.logout-btn[_ngcontent-%COMP%] {\n  background: transparent;\n  border: 1px solid var(--border);\n  border-radius: var(--radius-md);\n  color: var(--text-muted);\n  padding: 6px 8px;\n  cursor: pointer;\n  font-size: 14px;\n  transition: all 0.15s;\n}\n.logout-btn[_ngcontent-%COMP%]:hover {\n  border-color: var(--accent-red);\n  color: var(--accent-red);\n  background: var(--accent-red-bg);\n}\n/*# sourceMappingURL=layout.component.css.map */"] });
  }
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && \u0275setClassDebugInfo(LayoutComponent, { className: "LayoutComponent", filePath: "src/app/shared/layout/layout.component.ts", lineNumber: 239 });
})();
export {
  LayoutComponent
};
//# sourceMappingURL=chunk-5WQG5HTO.js.map
