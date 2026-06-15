import {
  environment
} from "./chunk-R3YGZVM2.js";
import {
  Router
} from "./chunk-YSFKJPFE.js";
import {
  HttpClient
} from "./chunk-V6V525UE.js";
import {
  BehaviorSubject,
  tap,
  ɵɵdefineInjectable,
  ɵɵinject
} from "./chunk-SQ7ZQLOA.js";

// src/app/core/services/auth.service.ts
var AuthService = class _AuthService {
  constructor(http, router) {
    this.http = http;
    this.router = router;
    this.userSubject = new BehaviorSubject(JSON.parse(localStorage.getItem("user") || "null"));
    this.user$ = this.userSubject.asObservable();
  }
  login(email, password) {
    return this.http.post(`${environment.apiUrl}/auth/login`, { email, password }).pipe(tap((res) => {
      localStorage.setItem("token", res.token);
      localStorage.setItem("user", JSON.stringify(res.user));
      this.userSubject.next(res.user);
    }));
  }
  logout() {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    this.userSubject.next(null);
    this.router.navigate(["/login"]);
  }
  get currentUser() {
    return this.userSubject.value;
  }
  get isLoggedIn() {
    return !!localStorage.getItem("token");
  }
  get isAdmin() {
    return this.currentUser?.role === "admin";
  }
  static {
    this.\u0275fac = function AuthService_Factory(t) {
      return new (t || _AuthService)(\u0275\u0275inject(HttpClient), \u0275\u0275inject(Router));
    };
  }
  static {
    this.\u0275prov = /* @__PURE__ */ \u0275\u0275defineInjectable({ token: _AuthService, factory: _AuthService.\u0275fac, providedIn: "root" });
  }
};

export {
  AuthService
};
//# sourceMappingURL=chunk-DFFATVLZ.js.map
