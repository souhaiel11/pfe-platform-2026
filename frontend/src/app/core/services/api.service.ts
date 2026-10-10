import { SecurityRemediationTask } from '../../shared/security-remediation.types';
import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { IncidentSourceEvidence, ProjectSourceEvidence } from '../../shared/source-evidence/source-evidence.types';

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

  // includeV18: V1.8 Phase 4 ticket — opt-in, additive `v1_8Decision` field
  // per task (read-only display only; never changes remediationType or
  // selection eligibility). Omit/false = identical to pre-V1.8 behavior.
  getManualRemediationTasks(projectId: string, includeV18 = false) {
    const params: any = { projectId };
    if (includeV18) params.includeV18 = 'true';
    return this.http.get<any[]>(`${this.base}/manual-remediation`, { params });
  }
  getManualRemediationSummary(projectId: string) { return this.http.get<any>(`${this.base}/manual-remediation/summary`, { params: { projectId } }); }
  completeManualRemediation(id: string, note?: string) { return this.http.patch<any>(`${this.base}/manual-remediation/${id}/complete`, { note: note || undefined }); }
  reopenManualRemediation(id: string) { return this.http.patch<any>(`${this.base}/manual-remediation/${id}/reopen`, {}); }
  // Increment 1 (sélection multiple CVE) — un candidat/build/scan/PR pour N
  // findingTaskId sélectionnés (manual-remediation.controller.ts).
  launchSecurityRemediationBatch(projectId: string, findingTaskIds: string[]) {
    return this.http.post<any>(`${this.base}/manual-remediation/launch-batch`, { projectId, findingTaskIds });
  }

  retrySecurityFindingRemediation(taskId: string, expectedAttemptId?: string) {
    const body: { expectedAttemptId?: string } = {};
    if (expectedAttemptId) body.expectedAttemptId = expectedAttemptId;
    return this.http.post<{ status: string; batchId: string; tasks?: SecurityRemediationTask[] }>(
      `${this.base}/manual-remediation/${encodeURIComponent(taskId)}/retry`, body);
  }

  // ── Projects ─────────────────────────────────────────────
  getProjects()                          { return this.http.get<any[]>(`${this.base}/projects`); }
  getProject(id: string)                 { return this.http.get<any>(`${this.base}/projects/${id}`); }
  createProject(data: any)               { return this.http.post<any>(`${this.base}/projects`, data); }
  updateProject(id: string, data: any)   { return this.http.put<any>(`${this.base}/projects/${id}`, data); }
  validateProject(id: string) { return this.http.post<any>(`${this.base}/projects/${id}/validate`, {}); }
  // ADMIN-ONLY, write-only : le token n'est jamais relu depuis une réponse.
  updateJenkinsCredentials(id: string, username: string, token: string) {
    return this.http.put<any>(`${this.base}/projects/${id}/jenkins-credentials`, { username, token });
  }
  deleteProject(id: string)              { return this.http.delete(`${this.base}/projects/${id}`); }

  // ── Incidents ────────────────────────────────────────────
  getIncidents(params?: any) {
    let p = new HttpParams();
    if (params) Object.keys(params).forEach(k => params[k] && (p = p.set(k, params[k])));
    return this.http.get<any>(`${this.base}/incidents`, { params: p });
  }
  getIncidentSummaries(params: any) {
    return this.http.get<any>(`${this.base}/project-reads/incidents`, { params });
  }
  getReportSummaries(params: any) {
    return this.http.get<any>(`${this.base}/project-reads/reports`, { params });
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

  // ── Admin - Users ────────────────────────────────────────
  getUsers()                         { return this.http.get<any[]>(`${this.base}/auth/users`); }
  createUser(data: any)              { return this.http.post<any>(`${this.base}/auth/register`, data); }
  updateUser(id: string, data: any)  { return this.http.put<any>(`${this.base}/auth/users/${id}`, data); }
  deleteUser(id: string)             { return this.http.delete(`${this.base}/auth/users/${id}`); }

  // R48 — mesures SonarQube COURANTES (appel direct a l'API Sonar par le
  // backend), distinctes de l'instantane `enrichedData.sonar` du build. Le
  // contrat porte deja available/reason + null par mesure absente : aucune
  // inference a faire cote vue. Charge uniquement par l'onglet SonarQube.
  getSonarMetrics(id: string) { return this.http.get<any>(`${this.base}/projects/${id}/sonar-metrics`); }
  getJenkins(id: string)  { return this.http.get<any>(`${this.base}/projects/${id}/jenkins-status`); }

  // Table des SOURCES/PREUVES (« Voir dans la source »). Lecture seule, et
  // seule origine des URL de preuve : aucun composant ne construit d'URL
  // d'outil lui-meme — voir shared/source-evidence/source-evidence.types.ts.
  getProjectSourceEvidence(id: string) {
    return this.http.get<ProjectSourceEvidence>(`${this.base}/source-evidence/project/${id}`);
  }
  getIncidentSourceEvidence(id: string) {
    return this.http.get<IncidentSourceEvidence>(`${this.base}/source-evidence/incident/${id}`);
  }
  fetchJenkinsfile(owner: string, repo: string) { return this.http.post<any>(`${this.base}/jenkins/fetch`, { owner, repo, filePath: 'Jenkinsfile' }); }
  optimizeJenkinsfile(body: { projectId: string; projectName?: string; jenkinsfile: string; buildError?: string }) {
    return this.http.post<any>(`${this.base}/jenkins/optimize`, body);
  }
  optimizeDockerfile(body: { owner: string; repo: string; projectId: string; projectName?: string; buildError?: string }) {
    return this.http.post<any>(`${this.base}/dockerfile/optimize`, body);
  }

  // ── Integrations ─────────────────────────────────────────
  getPlatformCapabilities() { return this.http.get<any>(`${this.base}/dashboard/capabilities`); }
  getIntegrations()                              { return this.http.get<any[]>(`${this.base}/integrations`); }
  getIntegration(id: string)                     { return this.http.get<any>(`${this.base}/integrations/${id}`); }
  createIntegration(data: any)                   { return this.http.post<any>(`${this.base}/integrations`, data); }
  updateIntegration(id: string, data: any)       { return this.http.put<any>(`${this.base}/integrations/${id}`, data); }
  testIntegration(id: string)                    { return this.http.post<any>(`${this.base}/integrations/${id}/test`, {}); }

  approveFix(id: string, findingId?: string) { return this.http.post(`${this.base}/incidents/${id}/approve`, findingId ? { findingId } : {}); }
  approveFixBatch(id: string, findingIds: string[]) { return this.http.post<any>(`${this.base}/incidents/${id}/approve`, { findingIds }); }
  cancelFixRequest(id: string, requestId: string, body: { reason?: string } = {}) {
    return this.http.post<any>(`${this.base}/incidents/${id}/remediation/${encodeURIComponent(requestId)}/cancel`, body);
  }
  retryFixBatch(id: string) { return this.http.post<any>(`${this.base}/incidents/${id}/retry`, {}); }
  requestPrValidation(id: string) { return this.http.post<any>(`${this.base}/incidents/${id}/pr-validation`, {}); }
  refreshPrValidationTarget(id: string) { return this.http.post<any>(`${this.base}/incidents/${id}/pr-validation/refresh-target`, {}); }
  correctAndRevalidate(id: string) { return this.http.post<any>(`${this.base}/incidents/${id}/correct-and-revalidate`, {}); }
  rejectFix(id: string) { return this.http.post(`${this.base}/incidents/${id}/reject`, {}); }
  // Marque un dispatch WF2 bloqué comme échoué (EXISTING endpoint, admin-only
  // côté backend — jamais d'arrêt réel de n8n, voir incidents.service.ts).
  reconcileStaleDispatch(id: string, requestId: string, body: { batchId: string; attemptCount: number }) {
    return this.http.post<any>(`${this.base}/incidents/${id}/remediation/${requestId}/reconcile-stale-dispatch`, body);
  }

  triggerBuild(projectId: string) { return this.http.post(`${this.base}/incidents/${projectId}/trigger-build`, {}); }

  // ── Azure Deploy — le backend reste seul juge du "prêt à déployer",
  // voir azure-deploy-readiness.service.ts (fail-closed) ────────────
  getDeployReadiness(projectId: string) { return this.http.get<any>(`${this.base}/azure-deploy/ready/${projectId}`); }
  getConvergence(projectId: string) { return this.http.get<any>(`${this.base}/incidents/project/${projectId}/cycles`); }

  // ── Phase 2B.3 — Déploiement gouverné. Le front NE recalcule JAMAIS la
  // décision (READY/CONDITIONAL/CRITICAL_RISK/TECHNICALLY_IMPOSSIBLE) —
  // elle vient uniquement de ce preview, qui appelle côté backend le MÊME
  // resolveGovernanceSnapshot() que l'autorisation. ──────────────────
  getGovernancePreview(projectId: string, mainBuildNumber?: number, tag?: string) {
    const params: any = {};
    if (mainBuildNumber !== undefined && mainBuildNumber !== null) params.mainBuildNumber = String(mainBuildNumber);
    if (tag) params.tag = tag;
    return this.http.get<any>(`${this.base}/azure-deploy/governance/${projectId}`, { params });
  }

  // Seuls champs d'intention humaine (mode/reason/acknowledgements/
  // confirmationPhrase/mainBuildNumber/tag) — jamais decision/commitSha/
  // artifactDigest/riskSnapshot/environmentIdentityHash, qui n'existent
  // même pas sur AuthorizeDeploymentDto côté backend (toujours recalculés
  // serveur, jamais acceptés du front).
  authorizeDeployment(projectId: string, body: {
    mode: 'NORMAL' | 'CONDITIONAL_EXCEPTION' | 'CRITICAL_OVERRIDE';
    reason?: string;
    acknowledgements?: Record<string, boolean>;
    confirmationPhrase?: string;
    mainBuildNumber?: number;
    tag?: string;
  }) {
    return this.http.post<any>(`${this.base}/azure-deploy/authorize/${projectId}`, body);
  }

  // `confirmed: true` est un champ de plomberie de l'ancien DTO (toujours
  // requis par class-validator, @IsBoolean sans @IsOptional) — ce n'est
  // PAS un signal d'acceptation du risque dans le flux gouverné : c'est
  // authorizationId qui porte toute l'autorité. imageTag n'est jamais
  // envoyé ici (§13 — le tag ne sélectionne plus rien une fois une
  // autorisation créée ; le backend dispatch depuis l'artifactTag/digest
  // liés à l'autorisation elle-même, jamais depuis le body).
  deployGoverned(projectId: string, requestId: string, authorizationId: string) {
    return this.http.post<any>(`${this.base}/azure-deploy/deploy`, { projectId, requestId, authorizationId, confirmed: true });
  }
}
