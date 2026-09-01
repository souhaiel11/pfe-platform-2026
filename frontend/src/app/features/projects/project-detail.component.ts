import { Component, OnInit, Input, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { CveTableComponent } from './cve-table.component';
import { ZapTableComponent } from './zap-table.component';
import { ProjectOverviewComponent } from './project-overview.component';
import { JenkinsfileOptimizerComponent } from './jenkinsfile-optimizer.component';
import { DockerfileOptimizerComponent } from './dockerfile-optimizer.component';
import { ApiService } from '../../core/services/api.service';
import { ToastService } from '../../core/services/toast.service';
import { RiskStateService } from '../../core/services/risk-state.service';
import { AuthService } from '../../core/services/auth.service';
import { StageStatusLabelPipe } from '../../shared/stage-status-label.pipe';
import { PresentationLabelPipe } from '../../shared/presentation-label.pipe';
import { FrenchDatePipe } from '../../shared/french-date.pipe';
import { userHttpError } from '../../core/http-error-message';
import { presentationLabel, remediationTypeLabel, riskLevelLabel } from '../../shared/status-labels';

@Component({
  selector: 'app-project-detail',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, CveTableComponent, ZapTableComponent, ProjectOverviewComponent, JenkinsfileOptimizerComponent, DockerfileOptimizerComponent, StageStatusLabelPipe, PresentationLabelPipe, FrenchDatePipe],
  templateUrl: './project-detail.component.html',
  styleUrls: ['./project-detail.component.scss'],
})
export class ProjectDetailComponent implements OnInit {
  @ViewChild('sonarDrawer') sonarDrawer?: ElementRef<HTMLElement>;
  @ViewChild('batchDialog') batchDialog?: ElementRef<HTMLElement>;
  approving = false;
  prValidationBusy = false;
  // R65 — voir incident-detail.component.ts : même conflit gouverné, même
  // UX en deux actions humaines distinctes (jamais de retry automatique).
  prValidationTargetStale = false;
  refreshValidationTargetBusy = false;
  buildTriggering = false;
  @Input() id!: string;

  project: any = null;
  incidents: any[] = [];
  allReports: any[] = [];
  latestReport: any = null;
  loading = true;
  loadError = false;
  readonly tabMap: Record<string,string> = {
    jenkins: 'jenkins', sonar: 'sonarqube',
    security: 'securite'
  };
  readonly VALID_TABS = ['rapport', 'jenkins', 'sonarqube', 'docker', 'securite', 'incidents', 'config'];
  activeTab = 'rapport';
  securityFilter: 'all' | 'trivy' | 'owasp' | 'zap' = 'all';
  manualTasks: any[] = [];
  manualSummary = { todo: 0, doneByUser: 0, stillDetected: 0, verified: 0, total: 0 };
  manualStatusFilter = 'ALL';
  manualSeverityFilter = 'ALL';
  get manualUserRole(): string { return String(this.auth.currentUser?.role || 'viewer'); }

  // Parsed report
  rp: any = {};
  ed: any = {}; // enrichedData du dernier rapport

  // Décision du Judge Agent — colonnes structurées du dernier Report
  // (judgeDecision/judgeConfidence), PAS rp.decision (qui vient de
  // Incident.aiAnalysis, gardé pour l'onglet Rapport IA uniquement).
  // Fail-CLOSED : decision null/absente => "EN ATTENTE", jamais "AUTORISÉ" par défaut.
  judge: { decision: string | null; confidence: number | null } = { decision: null, confidence: null };

  // Déploiement Azure — le backend (isReadyToDeploy, fail-closed) est le
  // SEUL juge. Le front n'affiche que ce qu'il renvoie ; en cas d'erreur
  // réseau on reste fail-closed ici aussi (jamais "prêt" par défaut).
  deployReady = false;
  deployReadiness: any = null;
  deploymentConfigured = false;
  deploymentTarget: any = null;
  convergenceCycles: any[] = [];
  deployReasons: string[] = [];
  deployReadyLoading = true;
  deploying = false;
  deployImageTag = 'latest';
  deploySuccessInfo: { state: string; health: string } | null = null;
  deployErrorMessage: string | null = null;
  deployConfirmationOpen = false;
  private deploymentRequestId: string | null = null;

  allCves(ed: any): any[] {
    return [ ...(ed?.trivy?.cves || []), ...(ed?.owasp?.cves || []) ];
  }

  // Règle dupliquée avec le backend (security-score.ts::isScannerComplete) —
  // absence de status (legacy) = donnée de confiance, status présent et
  // différent de 'COMPLETED' = scanner non exécuté. Garder synchronisée.
  isScannerMissing(block: any): boolean {
    const status = block?.status;
    return !!status && status !== 'COMPLETED';
  }
  devGuide(_ed: any): any {
    return this.rp?.developerGuide ?? null;
  }
  devTasks: any[] = [];
  checkedTasks = 0;

  // Score affiché dans le header (du dernier rapport)
  lastScore = 100;
  lastRisk = 'low';

  // true si trivy/owasp/zap/sonar n'a pas tourné sur le dernier rapport
  // (même périmètre que calculateSecurityScore côté backend, Étape 1).
  scanIncomplete = false;
  missingScanners: string[] = [];

  // Reports réels (Report.securityScore/riskLevel, Étape 1) du projet, pour
  // corréler le score du header — voir findMatchingReport().
  allReportsRaw: any[] = [];
  // true si le cas est complet (scanIncomplete=false) MAIS qu'aucun report
  // ne correspond (historique ancien, sans build.number) : "—" neutre,
  // jamais un palier fabriqué en repli.
  scoreUnavailable = false;

  // Jenkins builds
  jenkinsBuilds: any[] = [];
  buildReliability: { rate: number | null; sampleSize: number } | null = null;
  jenkinsMessage: string | null = null;

  // Analyse IA SonarQube extraite
  sonarAiAnalysis = '';
  showAllHistory = false;
  sonarSearch = '';
  sonarSeverity = 'ALL';
  sonarRemediation = 'ALL';
  sonarOwner = 'ALL';
  selectedSonarFinding: any = null;
  selectedSonarIds = new Set<string>();
  batchConfirmationOpen = false;
  private sonarTrigger: HTMLElement | null = null;

  // Correction manuelle (section 3, colonne droite) — recommandations réparties par priorité
  manualHigh: { text: string; high: boolean }[] = [];
  manualNormal: { text: string; high: boolean }[] = [];

  constructor(
    private api: ApiService,
    private toast: ToastService,
    private riskState: RiskStateService,
    private router: Router,
    private route: ActivatedRoute,
    public auth: AuthService,
  ) {}
  get canOperate() { return ['admin', 'developer'].includes(this.auth.currentUser?.role); }
  editProject() { if (this.canOperate) this.router.navigate(['/projects', this.id, 'edit']); }

  configHealthRows() {
    const stage = (key: string) => this.deployReadiness?.requiredStages?.find((s: any) => s.stage === key);
    return [
      { name: 'GitHub', state: this.project?.githubRepo ? 'Configuré' : 'Non configuré', ok: !!this.project?.githubRepo },
      { name: 'Jenkins', state: this.jenkinsMessage ? 'Indisponible' : (this.project?.jenkinsJobName ? 'Connecté' : 'Non configuré'), ok: !this.jenkinsMessage && !!this.project?.jenkinsJobName },
      { name: 'SonarQube', state: !this.project?.sonarqubeKey ? 'Non configuré' : (this.ed?.sonar ? 'Configuré' : 'Attention'), ok: !!this.project?.sonarqubeKey && !!this.ed?.sonar },
      { name: 'Docker', state: stage('docker')?.status === 'PASSED' ? 'Dockerfile détecté' : 'Attention', ok: stage('docker')?.status === 'PASSED' },
      { name: 'Tests', state: stage('tests')?.status === 'NOT_RUN' ? 'Désactivé' : (stage('tests')?.status === 'PASSED' ? 'Configuré' : 'Attention'), ok: stage('tests')?.status === 'PASSED' },
      { name: 'ZAP', state: this.ed?.zap?.target_url ? 'Configuré' : (stage('zap') ? 'Attention' : 'Non configuré'), ok: !!this.ed?.zap?.target_url },
      { name: 'Azure', state: this.deploymentConfigured ? 'Configuré' : 'Non configuré', ok: this.deploymentConfigured },
    ];
  }
  configStageStatus(key: string): string | null { return this.deployReadiness?.requiredStages?.find((s: any) => s.stage === key)?.status || null; }

  readinessReasonLabel(raw: unknown): string {
    const reason = String(raw || '').trim();
    if (!reason) return 'Raison indisponible';
    const count = reason.match(/^(\d+) unresolved blocking finding\(s\)$/i);
    if (count) return `${count[1]} ${count[1] === '1' ? 'problème bloquant non résolu' : 'problèmes bloquants non résolus'}`;
    const stage = reason.match(/^(tests|sonar|trivy|owasp|zap|docker|deploy)=(NOT_RUN|NOT_REACHED|FAILED|WARNING|RUNNING)$/i);
    if (stage) return `${presentationLabel(stage[1])} : ${presentationLabel(stage[2])}`;
    if (/^judgeDecision=BLOCK/i.test(reason)) return 'La décision de gouvernance bloque explicitement ce build.';
    return reason;
  }
  readinessReasonsLabel(): string { return (this.deployReasons || []).map(r => this.readinessReasonLabel(r)).join(' · '); }

  sonarFindings(): any[] {
    const severityRank: Record<string, number> = { BLOCKER: 0, CRITICAL: 1, MAJOR: 2, HIGH: 2, MINOR: 3, MEDIUM: 3, LOW: 4, INFO: 5 };
    const q = this.sonarSearch.trim().toLowerCase();
    return [...(this.ed?.sonar?.issues || [])]
      .filter((f: any) => this.sonarSeverity === 'ALL' || String(f.severity).toUpperCase() === this.sonarSeverity)
      .filter((f: any) => this.sonarRemediation === 'ALL' || (f.remediationType || 'UNKNOWN') === this.sonarRemediation)
      .filter((f: any) => this.sonarOwner === 'ALL' || (f.owner || 'UNASSIGNED') === this.sonarOwner)
      .filter((f: any) => !q || [f.rule, f.ruleKey, f.message, f.title, f.file, f.component].some(v => String(v || '').toLowerCase().includes(q)))
      .sort((a: any, b: any) => (severityRank[String(a.severity).toUpperCase()] ?? 9) - (severityRank[String(b.severity).toUpperCase()] ?? 9));
  }

  sonarOwners(): string[] {
    return [...new Set<string>((this.ed?.sonar?.issues || []).map((f: any) => f.owner).filter(Boolean))].sort();
  }

  openSonarFinding(finding: any, trigger?: Event) {
    this.selectedSonarFinding = finding;
    this.sonarTrigger = trigger?.currentTarget as HTMLElement || null;
    setTimeout(() => this.sonarDrawer?.nativeElement.focus());
  }

  closeSonarFinding() {
    this.selectedSonarFinding = null;
    setTimeout(() => this.sonarTrigger?.focus());
  }

  findingValue(value: any): string { return value === null || value === undefined || value === '' ? 'Non disponible' : String(value); }
  findingEvidence(finding: any): string {
    const evidence = String(finding?.evidence || '').trim();
    const id = String(finding?.id || finding?.key || '').trim();
    if (!evidence || evidence === id || /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(evidence)) return this.findingValue(finding?.message);
    return evidence;
  }
  findingFileName(f: any): string { return String(f?.file || f?.component || 'Non disponible').split('/').pop() || 'Non disponible'; }
  remediationLabel(raw: string): string {
    return remediationTypeLabel(raw);
  }

  findingId(finding: any): string { return String(finding?.id || finding?.key || ''); }
  isAutoFixEligible(finding: any): boolean { return finding?.remediationType === 'AUTO_FIX_ELIGIBLE'; }
  activeFixRequest(): any { return this.latestReport?.metadata?.fixRequest || null; }
  prValidationRequest(): any { return this.latestReport?.metadata?.prValidationRequest || null; }
  canRequestPrValidation(): boolean {
    const request = this.activeFixRequest();
    const validationState = this.prValidationRequest()?.status;
    // Un échec de transport Jenkins (FAILED) reste réessayable explicitement —
    // seul un statut actif/résolu (REQUESTED/QUEUED/RUNNING/COMPLETED) verrouille le bouton.
    return this.canOperate && request?.status === 'PR_CREATED'
      && !!this.latestReport?.prUrl && !!request?.prNumber
      && (!validationState || validationState === 'FAILED');
  }
  requestPrValidation(): void {
    if (this.prValidationBusy || !this.canRequestPrValidation() || !this.latestReport?.id) return;
    this.prValidationBusy = true;
    this.prValidationTargetStale = false;
    this.api.requestPrValidation(this.latestReport.id).subscribe({
      next: (result: any) => {
        this.prValidationBusy = false;
        this.latestReport.metadata = {
          ...(this.latestReport.metadata || {}),
          prValidationRequest: result?.validationRequest || this.prValidationRequest(),
        };
        this.toast.success(result?.duplicate ? 'Cette validation existe déjà.' : 'Validation de la Pull Request mise en attente.');
        this.loadReports();
      },
      error: (error: any) => {
        this.prValidationBusy = false;
        const message = error?.error?.message;
        this.prValidationTargetStale = error?.status === 409 && typeof message === 'string' && message.includes('a changé');
        this.toast.error('Validation refusée', userHttpError(error, 'Impossible de demander la validation de la Pull Request.'));
        this.loadReports();
      },
    });
  }

  refreshValidationTarget(): void {
    if (this.refreshValidationTargetBusy || !this.latestReport?.id) return;
    this.refreshValidationTargetBusy = true;
    this.api.refreshPrValidationTarget(this.latestReport.id).subscribe({
      next: (result: any) => {
        this.refreshValidationTargetBusy = false;
        this.prValidationTargetStale = false;
        this.toast.success(result?.changed
          ? 'Cible de validation actualisée — vous pouvez maintenant réessayer la validation.'
          : 'La cible de validation est déjà à jour.');
        this.loadReports();
      },
      error: (error: any) => {
        this.refreshValidationTargetBusy = false;
        this.toast.error('Actualisation refusée', userHttpError(error, 'Impossible d’actualiser la cible de validation.'));
        this.loadReports();
      },
    });
  }
  activeFindingIds(): string[] {
    const request = this.activeFixRequest();
    if (!request || !['APPROVAL_REQUESTED','FIX_STARTING','DISPATCHED','PR_CREATED','VALIDATING'].includes(request.status)) return [];
    return Array.isArray(request.findingIds) ? request.findingIds.map(String) : (request.findingId ? [String(request.findingId)] : []);
  }
  requestFindingIds(): string[] {
    const request = this.activeFixRequest();
    return Array.isArray(request?.findingIds) ? request.findingIds.map(String) : (request?.findingId ? [String(request.findingId)] : []);
  }
  isFindingLocked(finding: any): boolean { return this.activeFindingIds().includes(this.findingId(finding)); }
  isFindingInFailedRequest(finding: any): boolean {
    return this.activeFixRequest()?.status === 'FIX_FAILED'
      && this.requestFindingIds().includes(this.findingId(finding));
  }
  isFindingOwnedByLogicalBatch(finding: any): boolean {
    const request = this.activeFixRequest();
    return !!(request?.requestId || request?.batchId)
      && this.requestFindingIds().includes(this.findingId(finding));
  }
  canRetryFixRequest(): boolean {
    const request = this.activeFixRequest();
    return this.canOperate && request?.status === 'FIX_FAILED' && request?.retryEligible === true
      && this.requestFindingIds().length > 0;
  }
  retryFailedFix(): void {
    if (!this.canRetryFixRequest() || this.approving || !this.latestReport?.id) return;
    this.approving = true;
    this.api.retryFixBatch(this.latestReport.id).subscribe({
      next: (result: any) => {
        this.approving = false;
        this.latestReport.metadata = { ...(this.latestReport.metadata || {}), fixRequest: {
          ...this.latestReport.metadata?.fixRequest, status: result.status, attemptCount: result.attemptCount,
          retryEligible: false,
        }};
        this.toast.success('Correction relancée', 'La nouvelle tentative du batch existant a été enregistrée.');
      },
      error: (e: any) => { this.approving = false; this.toast.error('Nouvelle tentative refusée', userHttpError(e, 'Impossible de réessayer cette correction.')); },
    });
  }
  findingRequestState(finding: any): string | null {
    if (!this.requestFindingIds().includes(this.findingId(finding))) return null;
    const labels: Record<string,string> = { APPROVAL_REQUESTED:'Correction demandée', FIX_STARTING:'Correction demandée', DISPATCHED:'Correction en cours', PR_CREATED:'PR créée', VALIDATING:'Validation en cours', VALIDATED:'Validée', REJECTED:'Rejetée', FIX_FAILED:'Échec de la correction' };
    return labels[this.activeFixRequest()?.status] || 'Correction en cours';
  }
  isSelected(finding: any): boolean {
    return this.canSelectFinding(finding) && this.selectedSonarIds.has(this.findingId(finding));
  }
  canSelectFinding(finding: any): boolean {
    return this.canOperate && this.isAutoFixEligible(finding)
      && !this.isFindingLocked(finding) && !this.isFindingOwnedByLogicalBatch(finding);
  }
  toggleFindingSelection(finding: any, selected = !this.isSelected(finding)): void {
    if (!this.canSelectFinding(finding)) return;
    const id = this.findingId(finding);
    if (selected) this.selectedSonarIds.add(id); else this.selectedSonarIds.delete(id);
  }
  eligibleFilteredFindings(): any[] { return this.sonarFindings().filter(f => this.canSelectFinding(f)); }
  allEligibleFilteredSelected(): boolean {
    const eligible = this.eligibleFilteredFindings();
    return eligible.length > 0 && eligible.every(f => this.isSelected(f));
  }
  toggleFilteredSelection(): void {
    const eligible = this.eligibleFilteredFindings();
    const select = !this.allEligibleFilteredSelected();
    for (const finding of eligible) this.toggleFindingSelection(finding, select);
  }
  clearSonarSelection(): void { this.selectedSonarIds.clear(); }
  selectedSonarFindings(): any[] {
    const selected = this.selectedSonarIds;
    return (this.ed?.sonar?.issues || []).filter((f: any) => selected.has(this.findingId(f)) && this.canSelectFinding(f));
  }
  sonarFindingSummary(finding: any): string {
    const rule = String(finding?.rule || finding?.ruleKey || '');
    const message = String(finding?.message || '').trim();
    if (rule === 'java:S1068') {
      const field = message.match(/"([^"]+)"/)?.[1];
      return field ? `Supprimer le champ privé « ${field} » inutilisé.` : 'Supprimer ce champ privé inutilisé.';
    }
    if (rule === 'java:S125') return 'Supprimer ce bloc de code commenté devenu inutile.';
    return message || 'Description non disponible';
  }
  openBatchConfirmation(): void {
    if (!this.selectedSonarFindings().length) return;
    this.batchConfirmationOpen = true;
    setTimeout(() => this.batchDialog?.nativeElement.focus());
  }
  closeBatchConfirmation(): void { if (!this.approving) this.batchConfirmationOpen = false; }
  confirmSonarCorrection(): void {
    if (this.approving) return;
    const findingIds = this.selectedSonarFindings().map(f => this.findingId(f));
    if (!this.canOperate || !this.latestReport?.id || !findingIds.length) return;
    this.approving = true;
    this.api.approveFixBatch(this.latestReport.id, findingIds).subscribe({
      next: (result: any) => {
        this.approving = false;
        this.batchConfirmationOpen = false;
        this.latestReport.metadata = { ...(this.latestReport.metadata || {}), fixRequest: {
          ...this.latestReport.metadata?.fixRequest, requestId: result.requestId, batchId: result.batchId,
          findingIds, findingId: findingIds[0], status: result.status,
        }};
        this.clearSonarSelection();
        this.toast.success('Correction demandée', result.duplicate ? 'Cette demande existe déjà.' : 'La demande gouvernée a été enregistrée.');
      },
      error: (e: any) => { this.approving = false; this.toast.error('Demande refusée', userHttpError(e, 'Impossible de proposer cette correction.')); },
    });
  }

  // Source unique de vérité pour changer d'onglet : met à jour activeTab ET
  // reflète le choix dans l'URL (?tab=xxx) sans recharger la page, pour que
  // l'onglet actif survive à un F5. replaceUrl:true pour ne pas polluer
  // l'historique/bouton retour à chaque clic d'onglet.
  setActiveTab(tab: string) {
    this.activeTab = this.VALID_TABS.includes(tab) ? tab : 'rapport';
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab: this.activeTab },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  onGoToTab(event: string) {
    if (event === 'guide') {
      // Pas un onglet de cette page — navigation vers /incidents/:id, ne
      // passe donc pas par setActiveTab.
      if (!this.latestReport?.id) {
        this.toast.info('Guide de correction', 'Aucun incident disponible pour ce projet');
        return;
      }
      this.router.navigate(['/incidents', this.latestReport.id], { queryParams: { tab: 'guide' } });
      return;
    }
    const [key, filter] = event.split(':');
    this.setActiveTab(this.tabMap[key]);
    if (key === 'security') {
      this.securityFilter = (filter as 'trivy' | 'owasp' | 'zap') || 'all';
    }
  }

  goBack(): void {
    if (this.activeTab === 'securite' && this.securityFilter !== 'all') {
      this.securityFilter = 'all';
      return;
    }
    if (this.activeTab !== 'rapport') {
      this.setActiveTab('rapport');
      return;
    }
    this.router.navigate(['/projects']);
  }

  // Clic direct sur un onglet (barre d'onglets) — réinitialise le filtre sécurité
  selectTab(tab: string) {
    this.setActiveTab(tab);
    if (tab === 'securite') this.securityFilter = 'all';
  }

  securityFilterLabel(): string {
    const labels: Record<string, string> = {
      trivy: 'Conteneur (Trivy)',
      owasp: 'Dépendances (OWASP)',
      zap: 'DAST (ZAP)',
    };
    return labels[this.securityFilter] || '';
  }

  ngOnInit() {
    const tab = this.route.snapshot.queryParamMap.get('tab');
    this.activeTab = tab && this.VALID_TABS.includes(tab) ? tab : 'rapport';
    this.loadProject();
  }

  loadProject() {
    this.loading = true;
    this.loadError = false;
    this.api.getProject(this.id).subscribe({
      next: p => {
        this.project = p;
        this.loading = false;
        this.loadIncidents();
        this.loadReports();
        this.loadJenkinsBuilds();
        this.loadJudgeStatus();
        this.loadDeployReadiness();
        this.loadConvergence();
        this.loadManualRemediation();
      },
      error: () => {
        this.toast.error('Erreur', 'Projet introuvable');
        this.loading = false;
        this.loadError = true;
      }
    });
  }

  loadManualRemediation() {
    this.api.getManualRemediationTasks(this.id).subscribe({ next: tasks => this.manualTasks = tasks || [], error: () => this.manualTasks = [] });
    this.api.getManualRemediationSummary(this.id).subscribe({ next: summary => this.manualSummary = summary, error: () => {} });
  }

  completeManualTask(event: { task: any; note?: string }) {
    this.api.completeManualRemediation(event.task.id, event.note).subscribe({
      next: () => { this.toast.success('Traitement enregistré', 'La résolution technique sera confirmée par une prochaine analyse.'); this.loadManualRemediation(); },
      error: (err) => this.toast.error('Action refusée', userHttpError(err, 'Impossible d’enregistrer le traitement.')),
    });
  }

  reopenManualTask(task: any) {
    this.api.reopenManualRemediation(task.id).subscribe({
      next: () => { this.toast.success('Tâche rouverte', 'Le suivi manuel est de nouveau à traiter.'); this.loadManualRemediation(); },
      error: (err) => this.toast.error('Action refusée', userHttpError(err, 'Impossible de rouvrir la tâche.')),
    });
  }

  loadIncidents() {
    this.api.getIncidents({ projectId: this.id, size: 20 }).subscribe((r: any) => {
      this.incidents = r.content || r;
    });
  }

  loadReports() {
    this.api.getDecisions({ projectId: this.id }).subscribe({
      next: (r: any) => {
        const list: any[] = Array.isArray(r) ? r : [];
        this.allReports = list
          .filter(x => x.aiAnalysis)
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        if (this.allReports.length > 0) this.selectReport(this.allReports[0]);
      },
      error: () => {}
    });
  }

  // Dernier Report réel (colonnes judgeDecision/judgeConfidence) — sert le
  // badge Déploiement fail-closed ET (voir findMatchingReport) le score réel
  // du header, corrélé par build. N'affecte pas l'onglet Rapport IA en
  // lui-même (qui reste sur /incidents, allReports/rp inchangés).
  loadJudgeStatus() {
    this.api.getProjectReports({ projectId: this.id }).subscribe({
      next: (list: any[]) => {
        this.allReportsRaw = Array.isArray(list) ? list : [];
        const latest = this.allReportsRaw.length > 0 ? this.allReportsRaw[0] : null;
        this.judge = {
          decision: latest?.judgeDecision ?? null,
          confidence: latest?.judgeConfidence ?? null,
        };
        // loadReports() et loadJudgeStatus() sont indépendants (2 appels HTTP
        // séparés) : si l'historique était déjà sélectionné avant que les
        // reports arrivent, on recalcule le score maintenant que la
        // corrélation par buildNumber est possible.
        if (this.latestReport) this.selectReport(this.latestReport);
      },
      error: () => { this.judge = { decision: null, confidence: null }; this.allReportsRaw = []; },
    });
  }

  // Corrélation Incident -> Report : pas de FK entre les deux tables, mais
  // Incident.buildNumber == Report.rawData.enrichedData.build.number pour le
  // même run de pipeline (vérifié sur données réelles). Les reports
  // antérieurs à cette convention n'ont pas build.number -> pas de match,
  // jamais de repli sur une estimation.
  private findMatchingReport(incident: any): any | null {
    const buildNum = incident?.buildNumber;
    if (buildNum === null || buildNum === undefined || !this.allReportsRaw.length) return null;
    return this.allReportsRaw.find(rep => {
      const repBuildNum = rep?.rawData?.enrichedData?.build?.number;
      return repBuildNum !== null && repBuildNum !== undefined && Number(repBuildNum) === Number(buildNum);
    }) ?? null;
  }

  loadDeployReadiness() {
    this.deployReadyLoading = true;
    this.api.getDeployReadiness(this.id).subscribe({
      next: (r: any) => {
        this.deployReadiness = r;
        this.deployReady = !!r?.ready;
        this.deploymentConfigured = r?.deploymentConfigured === true;
        this.deploymentTarget = r?.deploymentTarget || null;
        this.deployReasons = r?.reasons || [];
        this.deployReadyLoading = false;
      },
      error: () => {
        // Backend injoignable ou erreur : jamais "prêt" par défaut côté front non plus.
        this.deployReady = false;
        this.deployReadiness = null;
        this.deploymentConfigured = false;
        this.deployReasons = ["Impossible de vérifier l'état de préparation au déploiement (backend injoignable)"];
        this.deployReadyLoading = false;
      },
    });
  }

  loadConvergence() {
    this.api.getConvergence(this.id).subscribe({
      next: (r: any) => { this.convergenceCycles = Array.isArray(r?.cycles) ? r.cycles : []; },
      error: () => { this.convergenceCycles = []; },
    });
  }

  stageCss(status: string): string {
    return ['PASSED', 'FAILED', 'WARNING', 'RUNNING', 'NOT_RUN', 'NOT_REACHED'].includes(status) ? status.toLowerCase() : 'not-run';
  }

  requestDeployConfirmation() {
    if (!this.canOperate || !this.deployReady || !this.deploymentConfigured || this.deploying) return;
    this.deploymentRequestId = globalThis.crypto?.randomUUID?.() || `deploy-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    this.deployConfirmationOpen = true;
  }

  cancelDeployConfirmation() {
    if (this.deploying) return;
    this.deployConfirmationOpen = false;
    this.deploymentRequestId = null;
  }

  // Le backend re-vérifie isReadyToDeploy à l'intérieur même de /deploy —
  // ce clic ne fait que proposer l'action, jamais ne la garantit. Si l'état
  // a changé entre le chargement de la page et le clic (409 NOT_READY_TO_DEPLOY),
  // on réaligne l'affichage sur le verdict du backend, qui reste seul juge.
  deployToAzure() {
    if (!this.deployReady || !this.deploymentConfigured || this.deploying || !this.project?.id || !this.deploymentRequestId) return;
    this.deploying = true;
    this.deploySuccessInfo = null;
    this.deployErrorMessage = null;
    this.api.deployToAzure(this.project.id, this.deployImageTag || 'latest', this.deploymentRequestId, true).subscribe({
      next: (r: any) => {
        this.deploying = false;
        this.deployConfirmationOpen = false;
        if (r?.success) {
          this.deploySuccessInfo = { state: r.state, health: r.healthOk ? 'UP' : (r.health || 'inconnu') };
          this.toast.success('Déploiement réussi', `Conteneur ${r.state} — santé ${r.healthOk ? 'UP' : 'KO'}`);
        } else {
          const msg = `Déploiement échoué côté agent (état: ${r?.state || 'inconnu'}).`;
          this.deployErrorMessage = msg;
          this.toast.error('Déploiement échoué', msg);
        }
      },
      error: (err: any) => {
        this.deploying = false;
        const body = err?.error;
        if (err.status === 409 && body?.error === 'NOT_READY_TO_DEPLOY') {
          this.deployReady = false;
          this.deployReasons = body.reasons || [];
          this.toast.error('Non prêt à déployer', "L'état a changé depuis le chargement de la page — le backend a refusé.");
        } else if (err.status === 409 && body?.error === 'AZURE_SESSION_EXPIRED') {
          const msg = "Session Azure expirée sur l'hôte — exécuter `az login`, puis réessayer.";
          this.deployErrorMessage = msg;
          this.toast.error('Session Azure expirée', msg);
        } else {
          const msg = body?.message || 'Erreur inattendue lors du déploiement.';
          this.deployErrorMessage = msg;
          this.toast.error('Erreur', msg);
        }
      },
    });
  }

  loadJenkinsBuilds() {
    // Pas de garde côté front sur jenkinsJobName : le backend est la seule
    // source de vérité sur "configuré ou pas" (getJenkinsStatus), y compris
    // pour le message exact à afficher — jamais deviné côté client.
    this.api.getJenkins(this.id).subscribe({
      next: (d: any) => {
        this.jenkinsBuilds = d?.builds || [];
        // Même source que le dashboard (getJenkinsStatus) — null si _liveData
        // est faux (non configuré/erreur/timeout — plus aucun mock possible),
        // jamais un chiffre inventé.
        this.buildReliability = { rate: d?.buildSuccessRate ?? null, sampleSize: d?.sampleSize ?? 0 };
        this.jenkinsMessage = d?._liveData ? null : (d?.message || 'Données Jenkins indisponibles');
      },
      error: () => { this.buildReliability = null; this.jenkinsBuilds = []; this.jenkinsMessage = 'Impossible de contacter le backend'; }
    });
  }

  selectReport(r: any) {
    this.latestReport = r;
    this.rp = this.parseReport(r.aiAnalysis);
    // Charger enrichedData
    this.ed = (r.metadata?.enrichedData) ?? (r.rawData?.enrichedData) ?? {};
    // Complétude des scanners — pilote les badges "SCANNER NON EXÉCUTÉ" et
    // l'état INDETERMINE du header (voir isScannerMissing ci-dessus).
    this.missingScanners = (['trivy', 'owasp', 'zap', 'sonar'] as const)
      .filter(k => this.isScannerMissing(this.ed[k]));
    this.scanIncomplete = this.missingScanners.length > 0;

    // Score du header — VRAI Report.securityScore/riskLevel (Étape 1,
    // incomplete-aware), jamais un palier fabriqué depuis le texte IA
    // (rp.security). Cas incomplete : le template affiche '?' via
    // scanIncomplete, la valeur ci-dessous n'est alors jamais rendue.
    this.scoreUnavailable = false;
    if (this.scanIncomplete) {
      this.lastRisk = 'indetermine';
    } else {
      const matched = this.findMatchingReport(r);
      if (matched) {
        this.lastScore = matched.securityScore;
        this.lastRisk = (matched.riskLevel || '').toLowerCase();
        this.riskState.setLevel(this.lastRisk);
      } else {
        // Historique ancien sans corrélation possible (pas de build.number
        // sur le report) : "—" neutre, jamais une estimation.
        this.scoreUnavailable = true;
        this.lastRisk = 'unavailable';
      }
    }
    // Tâches développeur
    this.devTasks = this.parseDevTasks(this.rp.developerActions);
    this.checkedTasks = 0;
    // Extraire analyse IA SonarQube depuis agentActions
    this.sonarAiAnalysis = this.extractSonarAnalysis(this.rp.agentActions);
    // Recommandations de correction manuelle, réparties par priorité
    const manualItems = this.parseManualItems(this.rp.recommendations);
    this.manualHigh = manualItems.filter(m => m.high);
    this.manualNormal = manualItems.filter(m => !m.high);
  }

  extractSonarAnalysis(agentActions: string): string {
    if (!agentActions) return '';
    const parts = agentActions.split('|');
    const sonarPart = parts.find(p => p.toLowerCase().includes('sonar') || p.toLowerCase().includes('quality') || p.toLowerCase().includes('code smell'));
    return sonarPart ? sonarPart.trim() : '';
  }

  triggerBuild() {
    if (this.buildTriggering) return;
    this.buildTriggering = true;
    this.api.triggerBuild(this.project.id).subscribe({
      next: (r: any) => {
        this.buildTriggering = false;
        if (r.success) {
          this.toast.success('Build lancé', 'Build ' + (r.job || '') + ' accepté par Jenkins');
          this.loadJenkinsBuilds();
        }
        else this.toast.error('Erreur', r.error || 'Echec du déclenchement');
      },
      error: (err: any) => {
        this.buildTriggering = false;
        const message = err?.error?.message || err?.error?.error?.message || 'Impossible de déclencher le build';
        this.toast.error('Erreur Jenkins', message);
      },
    });
  }

  toolUrl(base: string | null | undefined, path = ''): string | null {
    if (!base || !/^https?:\/\//i.test(base)) return null;
    return `${base.replace(/\/$/, '')}${path}`;
  }

  // URL Jenkins publique/navigateur — jamais jenkinsInternalUrl (résolution
  // DNS Docker, injoignable depuis le navigateur). Repli sur le champ legacy
  // jenkinsUrl pour les projets non migrés. Miroir de resolveJenkinsPublicUrl
  // côté backend.
  jenkinsPublicUrl(): string | null {
    return this.project?.jenkinsPublicUrl || this.project?.jenkinsUrl || null;
  }

  buildUrl(url: string | null | undefined): string | null {
    if (!url) return null;
    try {
      const source = new URL(url);
      const configured = this.toolUrl(this.jenkinsPublicUrl());
      if (!configured) return null;
      const target = new URL(configured);
      target.pathname = source.pathname;
      target.search = source.search;
      return target.toString();
    } catch { return null; }
  }

  splitItems(text: string): string[] {
    if (!text) return [];
    return text.split('|').map(s => s.trim()).filter(s => s.length > 0);
  }

  getSevColor(item: string): string {
    if (!item) return 'var(--text-tertiary)';
    const s = item.toUpperCase();
    if (s.includes('CRITICAL')) return 'var(--color-critical)';
    if (s.includes('HIGH'))     return 'var(--color-high)';
    if (s.includes('MEDIUM'))   return 'var(--color-warning)';
    if (s.includes('LOW'))      return 'var(--accent-blue)';
    return 'var(--text-tertiary)';
  }

  getSevBadge(item: string): string {
    if (!item) return '';
    const s = item.toUpperCase();
    if (s.includes('CRITICAL')) return 'CRITICAL';
    if (s.includes('HIGH'))     return 'HIGH';
    if (s.includes('MEDIUM'))   return 'MEDIUM';
    if (s.includes('LOW'))      return 'LOW';
    return '';
  }

  parseReport(summary: string): any {
    if (!summary) return {};
    try {
      const json = JSON.parse(summary);
      return {
        build:            json.build || json.build_number || null,
        job:              json.job   || 'Non disponible',
        status:           json.status || null,
        decision:         json.decision || 'NOTIFY_ONLY',
        confidence:       (json.confidenceScore || 0) + '%',
        errors:           this.fmt(json.errorsSummary),
        cicdIssues:       this.fmt(json.cicdIssues),
        securityIssues:   this.fmt(json.securityIssues),
        agentActions:     this.fmt(json.agentActions),
        developerActions: this.fmt(json.developerActions),
        security:         json.securityLevel || 'LOW',
        recommendations:  this.fmt(json.recommendations),
        justification:    json.justification || '',
        warning:          json.warning || '',
        developerReviewPoints: Array.isArray(json.developerReviewPoints)
          ? json.developerReviewPoints
          : (json.developerReviewPoints ? [json.developerReviewPoints] : []),
        _raw:             json
      };
    } catch(e) { return {}; }
  }

  fmt(val: any): string {
    if (!val) return '';
    if (typeof val === 'string') return val;
    if (Array.isArray(val)) return val.map((x: any) => typeof x === 'string' ? x : JSON.stringify(x)).join(' | ');
    return JSON.stringify(val);
  }

  parseDevTasks(raw: string): any[] {
    if (!raw) return [];
    const lines = raw.split(/\d+\.\s+/).filter(l => l.trim());
    if (lines.length > 1) {
      return lines.map(l => {
        const pm = l.match(/\[(HAUTE|MOYENNE|BASSE)\]/i);
        return { text: l.replace(/\[.*?\]/g, '').trim(), priority: pm?.[1]?.toUpperCase() || null, done: false };
      });
    }
    return raw.split('|').map(l => ({ text: l.trim(), priority: null, done: false })).filter(t => t.text);
  }

  toggleTask(i: number) {
    this.devTasks[i].done = !this.devTasks[i].done;
    this.checkedTasks = this.devTasks.filter(t => t.done).length;
  }

  approveFix(id: string) {
    this.approving = true;
    this.api.approveFix(id).subscribe({
      next: () => { this.approving = false; this.loadReports(); },
      error: () => { this.approving = false; alert('Erreur approbation'); },
    });
  }

  rejectFix(id: string) {
    this.approving = true;
    this.api.rejectFix(id).subscribe({
      next: () => { this.approving = false; this.loadReports(); },
      error: () => { this.approving = false; alert('Erreur rejet'); },
    });
  }

  copyReport() {
    navigator.clipboard.writeText(this.latestReport?.aiAnalysis || this.latestReport?.aiSummary || '').then(() => {
      this.toast.success('Copié', 'Rapport copié dans le presse-papiers');
    });
  }

  copyText(text: string) {
    navigator.clipboard.writeText(text || '').then(() => {
      this.toast.success('Copié', 'Commande copiée dans le presse-papiers');
    });
  }

  countIssues(severity: 'BLOCKER' | 'CRITICAL' | 'MAJOR' | 'BUG'): number {
    const issues = this.ed?.sonar?.issues || [];
    if (severity === 'BUG') return issues.filter((i: any) => i.type === 'BUG').length;
    return issues.filter((i: any) => i.severity === severity).length;
  }

  parseManualItems(raw: string): { text: string; high: boolean }[] {
    return this.splitItems(raw).map(text => ({
      text: text.replace(/\[.*?\]/g, '').trim(),
      high: /\[(HAUTE|CRITIQUE|URGENT|BLOQUANT)\]/i.test(text)
    }));
  }

  getAgentText(kind: 'root' | 'security' | 'remediation'): string {
    if (!this.rp.agentActions) return '';
    const parts = this.splitItems(this.rp.agentActions);
    const keywords: Record<string, string[]> = {
      root:        ['root cause', 'cause racine', 'root-cause'],
      security:    ['security risk', 'risque sécurité', 'risque de sécurité', 'security'],
      remediation: ['remediation', 'remédiation', 'correction']
    };
    const found = parts.find(p => keywords[kind].some(k => p.toLowerCase().includes(k)));
    if (found) return found;
    const idx = kind === 'root' ? 0 : kind === 'security' ? 1 : 2;
    return parts[idx] || '';
  }

  getInfoRows() {
    if (!this.project) return [];
    return [
      { label: 'ID',             value: this.project.id },
      { label: 'Environnement',  value: this.project.environment || 'Non disponible' },
      { label: 'Créé le',        value: this.project.createdAt ? new Date(this.project.createdAt).toLocaleDateString('fr-FR') : '—' },
      { label: 'Outil CI/CD',    value: this.project.cicdTool || 'Non configuré' },
      { label: 'Job Jenkins',    value: this.project.jenkinsJobName || 'Non configuré' },
      { label: 'URL Jenkins publique',  value: this.jenkinsPublicUrl() || 'Non configurée' },
      { label: 'URL Jenkins interne',   value: this.project.jenkinsInternalUrl || this.project.jenkinsUrl || 'Non configurée' },
      { label: 'Identifiants Jenkins',  value: this.project.jenkinsCredentialConfigured ? 'Configurés' : 'Non configurés' },
      { label: 'Clé SonarQube',  value: this.project.sonarqubeKey || 'Non configurée' },
      { label: 'Dépôt GitHub',   value: this.project.githubRepo || 'Non configuré' },
      { label: 'Description',    value: this.project.description || 'Non disponible' },
    ];
  }

  getAvatarBg(name: string): string {
    const colors = ['var(--accent-blue-bg)', 'var(--accent-green-bg)', 'var(--accent-orange-bg)', 'var(--accent-purple-bg)', 'var(--accent-red-bg)'];
    if (!name) return colors[0];
    return colors[name.charCodeAt(0) % colors.length];
  }

  getDecisionColor(d: string): string {
    if (d === 'FIX_PROPOSED' || d === 'AUTO_FIX') return '#1D9E75';
    if (d === 'BLOCK')       return '#E24B4A';
    if (d === 'NOTIFY_ONLY') return '#888780';
    return '#888780';
  }
  decisionLabel(d: string): string {
    return presentationLabel(d);
  }
  riskLevelLabel(level: string): string {
    return riskLevelLabel(level);
  }

  getSecColor(level: string): string {
    const l = (level || '').toUpperCase();
    if (l === 'CRITICAL') return 'var(--accent-red)';
    if (l === 'HIGH')     return 'var(--accent-orange)';
    if (l === 'MEDIUM')   return '#f59e0b';
    return 'var(--accent-green)';
  }

  getPriColor(p: string): string {
    if (p === 'HAUTE')   return 'var(--accent-red)';
    if (p === 'MOYENNE') return 'var(--accent-orange)';
    return 'var(--accent-blue)';
  }
}
