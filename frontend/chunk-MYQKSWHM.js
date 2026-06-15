import {
  environment
} from "./chunk-R3YGZVM2.js";
import {
  HttpClient,
  HttpParams
} from "./chunk-V6V525UE.js";
import {
  ɵɵdefineInjectable,
  ɵɵinject
} from "./chunk-SQ7ZQLOA.js";

// src/app/core/services/api.service.ts
var ApiService = class _ApiService {
  constructor(http) {
    this.http = http;
    this.base = environment.apiUrl;
  }
  // ── Dashboard ────────────────────────────────────────────
  getGlobalStats() {
    return this.http.get(`${this.base}/dashboard/global`);
  }
  getAgentStats() {
    return this.http.get(`${this.base}/dashboard/global`);
  }
  // ── Projects ─────────────────────────────────────────────
  getProjects() {
    return this.http.get(`${this.base}/projects`);
  }
  getProject(id) {
    return this.http.get(`${this.base}/projects/${id}`);
  }
  createProject(data) {
    return this.http.post(`${this.base}/projects`, data);
  }
  updateProject(id, data) {
    return this.http.put(`${this.base}/projects/${id}`, data);
  }
  deleteProject(id) {
    return this.http.delete(`${this.base}/projects/${id}`);
  }
  // ── Incidents ────────────────────────────────────────────
  getIncidents(params) {
    let p = new HttpParams();
    if (params)
      Object.keys(params).forEach((k) => params[k] && (p = p.set(k, params[k])));
    return this.http.get(`${this.base}/incidents`, { params: p });
  }
  getIncident(id) {
    return this.http.get(`${this.base}/incidents/${id}`);
  }
  updateIncidentStatus(id, status) {
    return this.http.put(`${this.base}/incidents/${id}`, { status });
  }
  // ── Analysis — Bugs & Reports ────────────────────────────
  getReports(params) {
    let p = new HttpParams();
    if (params)
      Object.keys(params).forEach((k) => params[k] && (p = p.set(k, params[k])));
    return this.http.get(`${this.base}/bugs`, { params: p });
  }
  getDecisions(params) {
    let p = new HttpParams();
    if (params)
      Object.keys(params).forEach((k) => params[k] && (p = p.set(k, params[k])));
    return this.http.get(`${this.base}/reports`, { params: p });
  }
  // ── Notifications — utilise incidents récents ─────────────
  getNotifications() {
    return this.http.get(`${this.base}/incidents?size=10`);
  }
  markNotificationRead(id) {
    return this.http.put(`${this.base}/incidents/${id}`, { read: true });
  }
  markAllRead() {
    return this.http.get(`${this.base}/incidents?size=1`);
  }
  // ── Admin - Users ────────────────────────────────────────
  getUsers() {
    return this.http.get(`${this.base}/auth/users`);
  }
  createUser(data) {
    return this.http.post(`${this.base}/auth/register`, data);
  }
  updateUser(id, data) {
    return this.http.put(`${this.base}/auth/users/${id}`, data);
  }
  deleteUser(id) {
    return this.http.delete(`${this.base}/auth/users/${id}`);
  }
  static {
    this.\u0275fac = function ApiService_Factory(t) {
      return new (t || _ApiService)(\u0275\u0275inject(HttpClient));
    };
  }
  static {
    this.\u0275prov = /* @__PURE__ */ \u0275\u0275defineInjectable({ token: _ApiService, factory: _ApiService.\u0275fac, providedIn: "root" });
  }
};

export {
  ApiService
};
//# sourceMappingURL=chunk-MYQKSWHM.js.map
