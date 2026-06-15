import {
  BehaviorSubject,
  ɵɵdefineInjectable
} from "./chunk-SQ7ZQLOA.js";

// src/app/core/services/toast.service.ts
var ToastService = class _ToastService {
  constructor() {
    this.toastsSubject = new BehaviorSubject([]);
    this.toasts$ = this.toastsSubject.asObservable();
  }
  success(title, message) {
    this.add("success", title, message);
  }
  error(title, message) {
    this.add("error", title, message);
  }
  info(title, message) {
    this.add("info", title, message);
  }
  warning(title, message) {
    this.add("warning", title, message);
  }
  add(type, title, message) {
    const id = Date.now().toString();
    const toast = { id, type, title, message };
    this.toastsSubject.next([...this.toastsSubject.value, toast]);
    setTimeout(() => this.remove(id), 4e3);
  }
  remove(id) {
    this.toastsSubject.next(this.toastsSubject.value.filter((t) => t.id !== id));
  }
  static {
    this.\u0275fac = function ToastService_Factory(t) {
      return new (t || _ToastService)();
    };
  }
  static {
    this.\u0275prov = /* @__PURE__ */ \u0275\u0275defineInjectable({ token: _ToastService, factory: _ToastService.\u0275fac, providedIn: "root" });
  }
};

export {
  ToastService
};
//# sourceMappingURL=chunk-ASB3VJLN.js.map
