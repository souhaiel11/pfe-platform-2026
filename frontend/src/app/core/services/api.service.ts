// Client HTTP centralisé : point de passage unique entre l'application Angular et l'API backend (préfixe /api).
import { SecurityRemediationTask } from '../../shared/security-remediation.types';
import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { IncidentSourceEvidence, ProjectSourceEvidence } from '../../shared/source-evidence/source-evidence.types';
import { BuildConsole, BuildDetail } from '../../shared/build-detail.types';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private base = environment.apiUrl;

  /** Injecte le client HTTP Angular utilisé par toutes les méthodes ci-dessous. */
  constructor(private http: HttpClient) {}

  /** Statistiques globales (projets/bugs/incidents agrégés) pour le dashboard. */
  getGlobalStats()  { return this.http.get<any>(`${this.base}/dashboard/global`); }
  /** Alias de getGlobalStats() — même endpoint, nom historique côté appelant. */
  getAgentStats()   { return this.http.get<any>(`${this.base}/dashboard/global`); }
  /** Indicateur de sécurité global (tous projets confondus) pour le dashboard. */
  getSecurityGlobal() { return this.http.get<any>(`${this.base}/dashboard/security-global`); }
  /** Fiabilité Jenkins globale (taux de succès des builds) pour le dashboard. */
  getJenkinsGlobal()  { return this.http.get<any>(`${this.base}/dashboard/jenkins-global`); }
  /** Scores de risque par projet, recalculés côté backend à chaque appel. */
  getRiskIndicators() { return this.http.get<any>(`${this.base}/dashboard/risk-indicators`); }

  /** Liste les tâches de remédiation manuelle d'un projet ; includeV18 ajoute en option le champ de décision V1.8 (affichage seul, sans effet sur l'éligibilité). */
  getManualRemediationTasks(projectId: string, includeV18 = false) {
    const params: any = { projectId };
    if (includeV18) params.includeV18 = 'true';
    return this.http.get<any[]>(`${this.base}/manual-remediation`, { params });
  }
  /** Compteurs de synthèse (ouverts/complétés/...) des tâches de remédiation manuelle d'un projet. */
  getManualRemediationSummary(projectId: string) { return this.http.get<any>(`${this.base}/manual-remediation/summary`, { params: { projectId } }); }
  /** Marque une tâche de remédiation manuelle comme terminée, avec une note optionnelle. */
  completeManualRemediation(id: string, note?: string) { return this.http.patch<any>(`${this.base}/manual-remediation/${id}/complete`, { note: note || undefined }); }
  /** Rouvre une tâche de remédiation manuelle précédemment complétée. */
  reopenManualRemediation(id: string) { return this.http.patch<any>(`${this.base}/manual-remediation/${id}/reopen`, {}); }
  /** Lance une remédiation de sécurité groupée pour plusieurs findings sélectionnés (un seul candidat/build/scan/PR pour tous). */
  launchSecurityRemediationBatch(projectId: string, findingTaskIds: string[]) {
    return this.http.post<any>(`${this.base}/manual-remediation/launch-batch`, { projectId, findingTaskIds });
  }

  /** Relance la remédiation d'un finding de sécurité après échec, en vérifiant optionnellement la tentative attendue. */
  retrySecurityFindingRemediation(taskId: string, expectedAttemptId?: string) {
    const body: { expectedAttemptId?: string } = {};
    if (expectedAttemptId) body.expectedAttemptId = expectedAttemptId;
    return this.http.post<{ status: string; batchId: string; tasks?: SecurityRemediationTask[] }>(
      `${this.base}/manual-remediation/${encodeURIComponent(taskId)}/retry`, body);
  }

  /** « Merge effectué » : demande au backend de constater sur GitHub le merge de la PR et de libérer le fichier traité. */
  confirmSecurityRemediationMerge(taskId: string) {
    return this.http.post<{ status: string; finalizedTaskIds?: string[]; mergeCommitSha?: string }>(
      `${this.base}/manual-remediation/${encodeURIComponent(taskId)}/confirm-merge`, {});
  }

  /** Liste tous les projets. */
  getProjects()                          { return this.http.get<any[]>(`${this.base}/projects`); }
  /** Récupère un projet par id. */
  getProject(id: string)                 { return this.http.get<any>(`${this.base}/projects/${id}`); }
  /** Crée un projet. */
  createProject(data: any)               { return this.http.post<any>(`${this.base}/projects`, data); }
  /** Met à jour un projet existant. */
  updateProject(id: string, data: any)   { return this.http.put<any>(`${this.base}/projects/${id}`, data); }
  /** Déclenche la validation de configuration d'un projet déjà enregistré. */
  validateProject(id: string) { return this.http.post<any>(`${this.base}/projects/${id}/validate`, {}); }

  /** Teste une configuration AVANT son enregistrement ; rien n'est écrit côté serveur, les identifiants ne servent qu'à la vérification puis sont oubliés. */
  checkProjectConfig(config: Record<string, any>) {
    return this.http.post<any>(`${this.base}/config-check/project`, config);
  }
  /** Met à jour les identifiants Jenkins d'un projet (admin uniquement) ; le token n'est jamais relu depuis une réponse. */
  updateJenkinsCredentials(id: string, username: string, token: string) {
    return this.http.put<any>(`${this.base}/projects/${id}/jenkins-credentials`, { username, token });
  }
  /** Supprime un projet. */
  deleteProject(id: string)              { return this.http.delete(`${this.base}/projects/${id}`); }

  /** Liste les incidents, filtrables via params (projectId/status/size/...), en ignorant les valeurs falsy. */
  getIncidents(params?: any) {
    let p = new HttpParams();
    if (params) Object.keys(params).forEach(k => params[k] && (p = p.set(k, params[k])));
    return this.http.get<any>(`${this.base}/incidents`, { params: p });
  }
  /** Version allégée/paginée des incidents, pour les listes qui n'ont pas besoin de l'objet complet. */
  getIncidentSummaries(params: any) {
    return this.http.get<any>(`${this.base}/project-reads/incidents`, { params });
  }
  /** Version allégée/paginée des reports, même logique que getIncidentSummaries(). */
  getReportSummaries(params: any) {
    return this.http.get<any>(`${this.base}/project-reads/reports`, { params });
  }
  /** Récupère un incident complet par id. */
  getIncident(id: string) { return this.http.get<any>(`${this.base}/incidents/${id}`); }
  /** Force le statut d'un incident (usage admin/debug, pas le flux normal d'approbation). */
  updateIncidentStatus(id: string, status: string) {
    return this.http.put<any>(`${this.base}/incidents/${id}`, { status });
  }

  /** Liste les bugs (module legacy) — nom historique, l'endpoint réel est /bugs. */
  getReports(params?: any) {
    let p = new HttpParams();
    if (params) Object.keys(params).forEach(k => params[k] && (p = p.set(k, params[k])));
    return this.http.get<any[]>(`${this.base}/bugs`, { params: p });
  }
  /** Liste les incidents sous l'angle "décisions IA" — même endpoint que getIncidents(). */
  getDecisions(params?: any) {
    let p = new HttpParams();
    if (params) Object.keys(params).forEach(k => params[k] && (p = p.set(k, params[k])));
    return this.http.get<any[]>(`${this.base}/incidents`, { params: p });
  }
  /** Récupère les vrais Report (rawData, judgeDecision/judgeConfidence) — distinct de getDecisions() et de getReports(). */
  getProjectReports(params?: any) {
    let p = new HttpParams();
    if (params) Object.keys(params).forEach(k => params[k] && (p = p.set(k, params[k])));
    return this.http.get<any[]>(`${this.base}/reports`, { params: p });
  }

  /** Liste tous les utilisateurs (admin). */
  getUsers()                         { return this.http.get<any[]>(`${this.base}/auth/users`); }
  /** Crée un utilisateur via l'endpoint d'inscription (admin). */
  createUser(data: any)              { return this.http.post<any>(`${this.base}/auth/register`, data); }
  /** Met à jour un utilisateur (admin). */
  updateUser(id: string, data: any)  { return this.http.put<any>(`${this.base}/auth/users/${id}`, data); }
  /** Supprime un utilisateur (admin). */
  deleteUser(id: string)             { return this.http.delete(`${this.base}/auth/users/${id}`); }

  /** Mesures SonarQube courantes du projet (appel direct à Sonar côté backend, pas l'instantané figé d'un build). */
  getSonarMetrics(id: string) { return this.http.get<any>(`${this.base}/projects/${id}/sonar-metrics`); }
  /** Statut Jenkins du job (dernier résultat + liste des numéros de build). */
  getJenkins(id: string)  { return this.http.get<any>(`${this.base}/projects/${id}/jenkins-status`); }

  /** Détail d'UN build Jenkins (étapes, erreur, commit, tests, artefacts) — distinct de getJenkins() qui ne donne que l'état du job. */
  getBuildDetail(projectId: string, build: number | 'last' = 'last') {
    return this.http.get<BuildDetail>(`${this.base}/projects/${projectId}/builds/${build}`);
  }
  /** Journal console d'un build, chargé à la demande (jamais embarqué dans getBuildDetail — trop volumineux). */
  getBuildConsole(projectId: string, build: number | 'last', tail = 200) {
    return this.http.get<BuildConsole>(`${this.base}/projects/${projectId}/builds/${build}/console`, { params: { tail } });
  }

  /** Liens de preuve ("voir dans la source") rattachés à un projet. */
  getProjectSourceEvidence(id: string) {
    return this.http.get<ProjectSourceEvidence>(`${this.base}/source-evidence/project/${id}`);
  }
  /** Rapport brut d'un scanner local pour un incident donné. */
  getLocalScannerReport(id: string, scanner: string) {
    return this.http.get<any>(`${this.base}/source-evidence/incident/${encodeURIComponent(id)}/local-reports/${encodeURIComponent(scanner)}`);
  }
  /** Liens de preuve rattachés à un incident. */
  getIncidentSourceEvidence(id: string) {
    return this.http.get<IncidentSourceEvidence>(`${this.base}/source-evidence/incident/${id}`);
  }
  /** Récupère le Jenkinsfile du dépôt (étape préalable à son optimisation). */
  fetchJenkinsfile(owner: string, repo: string) { return this.http.post<any>(`${this.base}/jenkins/fetch`, { owner, repo, filePath: 'Jenkinsfile' }); }
  /** Demande une analyse/optimisation IA du Jenkinsfile (proxy vers n8n WF4). */
  optimizeJenkinsfile(body: { projectId: string; projectName?: string; jenkinsfile: string; buildError?: string }) {
    return this.http.post<any>(`${this.base}/jenkins/optimize`, body);
  }
  /** Demande une analyse/optimisation IA du Dockerfile (proxy vers n8n WF5). */
  optimizeDockerfile(body: { owner: string; repo: string; projectId: string; projectName?: string; buildError?: string }) {
    return this.http.post<any>(`${this.base}/dockerfile/optimize`, body);
  }

  /** Rapport des fonctionnalités optionnelles actives côté backend (feature flags). */
  getPlatformCapabilities() { return this.http.get<any>(`${this.base}/dashboard/capabilities`); }
  /** Liste les intégrations outil (générique, distinct des URL par-projet). */
  getIntegrations()                              { return this.http.get<any[]>(`${this.base}/integrations`); }
  /** Récupère une intégration par id. */
  getIntegration(id: string)                     { return this.http.get<any>(`${this.base}/integrations/${id}`); }
  /** Crée une intégration. */
  createIntegration(data: any)                   { return this.http.post<any>(`${this.base}/integrations`, data); }
  /** Met à jour une intégration existante. */
  updateIntegration(id: string, data: any)       { return this.http.put<any>(`${this.base}/integrations/${id}`, data); }
  /** Vérifie la connectivité réelle d'une intégration déjà enregistrée. */
  testIntegration(id: string)                    { return this.http.post<any>(`${this.base}/integrations/${id}/test`, {}); }

  /** Approuve la correction d'un incident ; findingId cible un finding précis dans une liste de plusieurs. */
  approveFix(id: string, findingId?: string) { return this.http.post(`${this.base}/incidents/${id}/approve`, findingId ? { findingId } : {}); }
  /** Approuve en une fois la correction de plusieurs findings du même incident. */
  approveFixBatch(id: string, findingIds: string[]) { return this.http.post<any>(`${this.base}/incidents/${id}/approve`, { findingIds }); }
  /** « Merge effectué » : le backend constate sur GitHub le merge de la PR Sonar de l'incident et libère les fichiers qu'elle réservait. */
  confirmIncidentMerge(id: string) {
    return this.http.post<{ status: string; reason?: string; files?: string[]; alreadyReleased?: boolean }>(
      `${this.base}/incidents/${encodeURIComponent(id)}/confirm-merge`, {});
  }
  /** Annule une demande de remédiation (WF2) encore en cours, avec une raison optionnelle. */
  cancelFixRequest(id: string, requestId: string, body: { reason?: string } = {}) {
    return this.http.post<any>(`${this.base}/incidents/${id}/remediation/${encodeURIComponent(requestId)}/cancel`, body);
  }
  /** Relance le lot de corrections en échec pour cet incident. */
  retryFixBatch(id: string) { return this.http.post<any>(`${this.base}/incidents/${id}/retry`, {}); }
  /** Déclenche la validation post-PR (WF3) pour cet incident. */
  requestPrValidation(id: string) { return this.http.post<any>(`${this.base}/incidents/${id}/pr-validation`, {}); }
  /** Force le backend à re-résoudre la cible de validation PR (recovery). */
  refreshPrValidationTarget(id: string) { return this.http.post<any>(`${this.base}/incidents/${id}/pr-validation/refresh-target`, {}); }
  /** Lance une tentative corrective gouvernée sur la même PR après un blocage prouvé. */
  correctAndRevalidate(id: string) { return this.http.post<any>(`${this.base}/incidents/${id}/correct-and-revalidate`, {}); }
  /** Rejette la correction proposée pour cet incident. */
  rejectFix(id: string) { return this.http.post(`${this.base}/incidents/${id}/reject`, {}); }
  /** Marque un dispatch WF2 bloqué comme échoué (admin, ne stoppe jamais réellement une exécution n8n en cours). */
  reconcileStaleDispatch(id: string, requestId: string, body: { batchId: string; attemptCount: number }) {
    return this.http.post<any>(`${this.base}/incidents/${id}/remediation/${requestId}/reconcile-stale-dispatch`, body);
  }

  /** Déclenche manuellement un build Jenkins pour ce projet. */
  triggerBuild(projectId: string) { return this.http.post(`${this.base}/incidents/${projectId}/trigger-build`, {}); }

  /** Demande au backend sa décision "prêt à déployer" pour ce projet (jamais recalculée côté front). */
  getDeployReadiness(projectId: string) { return this.http.get<any>(`${this.base}/azure-deploy/ready/${projectId}`); }
  /** Cycles de convergence (gouvernance des étapes) pour ce projet. */
  getConvergence(projectId: string) { return this.http.get<any>(`${this.base}/incidents/project/${projectId}/cycles`); }

  /** Aperçu de la décision de gouvernance de déploiement (READY/CONDITIONAL/CRITICAL_RISK/...), sans effet de bord. */
  /** Derniers déploiements Azure du projet, avec le lien vers l'application déployée. */
  getDeploymentHistory(projectId: string) {
    return this.http.get<any[]>(`${this.base}/azure-deploy/history/${encodeURIComponent(projectId)}`);
  }
  getGovernancePreview(projectId: string, mainBuildNumber?: number, tag?: string) {
    const params: any = {};
    if (mainBuildNumber !== undefined && mainBuildNumber !== null) params.mainBuildNumber = String(mainBuildNumber);
    if (tag) params.tag = tag;
    return this.http.get<any>(`${this.base}/azure-deploy/governance/${projectId}`, { params });
  }

  /** Crée une autorisation de déploiement humaine (NORMAL/CONDITIONAL_EXCEPTION/CRITICAL_OVERRIDE) ; aucune donnée technique n'est envoyée, tout est recalculé serveur. */
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

  /** Déclenche le déploiement réel, une fois une autorisation déjà créée (authorizationId porte toute l'autorité). */
  deployGoverned(projectId: string, requestId: string, authorizationId: string) {
    return this.http.post<any>(`${this.base}/azure-deploy/deploy`, { projectId, requestId, authorizationId, confirmed: true });
  }
}
