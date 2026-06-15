import {
  environment
} from "./chunk-NJ4DWT4A.js";
import {
  HttpClient,
  HttpParams
} from "./chunk-Y42B5JPZ.js";
import {
  ɵɵdefineInjectable,
  ɵɵinject
} from "./chunk-ZQZUXNDQ.js";

// src/app/core/services/api.service.ts
var ApiService = class _ApiService {
  constructor(http) {
    this.http = http;
    this.base = environment.apiUrl;
  }
  // ── Dashboard ────────────────────────────────────────────
  getGlobalStats() {
    return this.http.get(`${this.base}/metrics/global`);
  }
  getAgentStats() {
    return this.http.get(`${this.base}/metrics/agents`);
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
    return this.http.patch(`${this.base}/incidents/${id}/status`, { status });
  }
  // ── Analysis ─────────────────────────────────────────────
  getReports(params) {
    let p = new HttpParams();
    if (params)
      Object.keys(params).forEach((k) => params[k] && (p = p.set(k, params[k])));
    return this.http.get(`${this.base}/events/analysis/reports`, { params: p });
  }
  getDecisions(params) {
    let p = new HttpParams();
    if (params)
      Object.keys(params).forEach((k) => params[k] && (p = p.set(k, params[k])));
    return this.http.get(`${this.base}/events/analysis/decisions`, { params: p });
  }
  // ── Notifications ────────────────────────────────────────
  getNotifications() {
    return this.http.get(`${this.base}/notifications`);
  }
  markNotificationRead(id) {
    return this.http.patch(`${this.base}/notifications/${id}/read`, {});
  }
  markAllRead() {
    return this.http.patch(`${this.base}/notifications/read-all`, {});
  }
  // ── Admin - Users ────────────────────────────────────────
  getUsers() {
    return this.http.get(`${this.base}/admin/users`);
  }
  createUser(data) {
    return this.http.post(`${this.base}/admin/users`, data);
  }
  updateUser(id, data) {
    return this.http.put(`${this.base}/admin/users/${id}`, data);
  }
  deleteUser(id) {
    return this.http.delete(`${this.base}/admin/users/${id}`);
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
//# sourceMappingURL=chunk-6BA5PBBI.js.map
