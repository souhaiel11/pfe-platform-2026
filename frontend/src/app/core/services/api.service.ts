import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private base = environment.apiUrl;

  constructor(private http: HttpClient) {}

  // ── Dashboard ────────────────────────────────────────────
  getGlobalStats()  { return this.http.get<any>(`${this.base}/dashboard/global`); }
  getAgentStats()   { return this.http.get<any>(`${this.base}/dashboard/global`); }
  getSecurityGlobal() { return this.http.get<any>(`${this.base}/dashboard/security-global`); }
  getJenkinsGlobal()  { return this.http.get<any>(`${this.base}/dashboard/jenkins-global`); }
  getRiskIndicators() { return this.http.get<any>(`${this.base}/dashboard/risk-indicators`); }

  // ── Projects ─────────────────────────────────────────────
  getProjects()                          { return this.http.get<any[]>(`${this.base}/projects`); }
  getProject(id: string)                 { return this.http.get<any>(`${this.base}/projects/${id}`); }
  createProject(data: any)               { return this.http.post<any>(`${this.base}/projects`, data); }
  updateProject(id: string, data: any)   { return this.http.put<any>(`${this.base}/projects/${id}`, data); }
  validateProject(id: string) { return this.http.post<any>(`${this.base}/projects/${id}/validate`, {}); }
  deleteProject(id: string)              { return this.http.delete(`${this.base}/projects/${id}`); }

  // ── Incidents ────────────────────────────────────────────
  getIncidents(params?: any) {
    let p = new HttpParams();
    if (params) Object.keys(params).forEach(k => params[k] && (p = p.set(k, params[k])));
    return this.http.get<any>(`${this.base}/incidents`, { params: p });
  }
  getIncident(id: string) { return this.http.get<any>(`${this.base}/incidents/${id}`); }
  updateIncidentStatus(id: string, status: string) {
    return this.http.put<any>(`${this.base}/incidents/${id}`, { status });
  }

  // ── Analysis — Bugs & Reports ────────────────────────────
  getReports(params?: any) {
    let p = new HttpParams();
    if (params) Object.keys(params).forEach(k => params[k] && (p = p.set(k, params[k])));
    return this.http.get<any[]>(`${this.base}/bugs`, { params: p });
  }
  getDecisions(params?: any) {
    let p = new HttpParams();
    if (params) Object.keys(params).forEach(k => params[k] && (p = p.set(k, params[k])));
    return this.http.get<any[]>(`${this.base}/incidents`, { params: p });
  }
  // Vrais Report (rawData, judgeDecision/judgeConfidence) — distinct de
  // getDecisions() (/incidents) et de getReports() (/bugs, mal nommé).
  getProjectReports(params?: any) {
    let p = new HttpParams();
    if (params) Object.keys(params).forEach(k => params[k] && (p = p.set(k, params[k])));
    return this.http.get<any[]>(`${this.base}/reports`, { params: p });
  }

  // ── Notifications — utilise incidents récents ─────────────
  getNotifications() {
    return this.http.get<any[]>(`${this.base}/incidents?size=10`);
  }
  markNotificationRead(id: string) { return this.http.put(`${this.base}/incidents/${id}`, { read: true }); }
  markAllRead()                    { return this.http.get(`${this.base}/incidents?size=1`); }

  // ── Admin - Users ────────────────────────────────────────
  getUsers()                         { return this.http.get<any[]>(`${this.base}/auth/users`); }
  createUser(data: any)              { return this.http.post<any>(`${this.base}/auth/register`, data); }
  updateUser(id: string, data: any)  { return this.http.put<any>(`${this.base}/auth/users/${id}`, data); }
  deleteUser(id: string)             { return this.http.delete(`${this.base}/auth/users/${id}`); }

  getJenkins(id: string)  { return this.http.get<any>(`${this.base}/projects/${id}/jenkins-status`); }
  fetchJenkinsfile(owner: string, repo: string) { return this.http.post<any>(`${this.base}/jenkins/fetch`, { owner, repo, filePath: 'Jenkinsfile' }); }
  optimizeJenkinsfile(body: { projectId: string; projectName?: string; jenkinsfile: string; buildError?: string }) {
    return this.http.post<any>(`${this.base}/jenkins/optimize`, body);
  }
  optimizeDockerfile(body: { owner: string; repo: string; projectId: string; projectName?: string; buildError?: string }) {
    return this.http.post<any>(`${this.base}/dockerfile/optimize`, body);
  }

  // ── Integrations ─────────────────────────────────────────
  getIntegrations()                              { return this.http.get<any[]>(`${this.base}/integrations`); }
  getIntegration(id: string)                     { return this.http.get<any>(`${this.base}/integrations/${id}`); }
  createIntegration(data: any)                   { return this.http.post<any>(`${this.base}/integrations`, data); }
  updateIntegration(id: string, data: any)       { return this.http.put<any>(`${this.base}/integrations/${id}`, data); }
  testIntegration(id: string)                    { return this.http.post<any>(`${this.base}/integrations/${id}/test`, {}); }

  approveFix(id: string, findingId?: string) { return this.http.post(`${this.base}/incidents/${id}/approve`, findingId ? { findingId } : {}); }
  rejectFix(id: string) { return this.http.post(`${this.base}/incidents/${id}/reject`, {}); }

  triggerBuild(projectId: string) { return this.http.post(`${this.base}/incidents/${projectId}/trigger-build`, {}); }

  // ── Azure Deploy — le backend reste seul juge du "prêt à déployer",
  // voir azure-deploy-readiness.service.ts (fail-closed) ────────────
  getDeployReadiness(projectId: string) { return this.http.get<any>(`${this.base}/azure-deploy/ready/${projectId}`); }
  getConvergence(projectId: string) { return this.http.get<any>(`${this.base}/incidents/project/${projectId}/cycles`); }
  deployToAzure(projectId: string, imageTag: string, requestId: string, confirmed: boolean) {
    return this.http.post<any>(`${this.base}/azure-deploy/deploy`, { projectId, imageTag, requestId, confirmed });
  }
}
