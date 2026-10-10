import { Subject, takeUntil } from 'rxjs';
import { availableNumber, scannerHasResult, scannerMetric, scannerState, qualityGatePresentation, testStageCoverage, testStageCoverageState, scannerHasStaleFindings, scannerStaleFindingCount, dockerImageState, dockerImageRef, dockerImageParts, dockerPushState, dockerProvenanceState, sourceInteger } from '../../shared/data-truth';
import { SecurityRemediationTask } from '../../shared/security-remediation.types';
import { getSecurityRemediationPresentation, summarizeSecurityRemediation } from '../../shared/security-remediation-presentation';
import { mergeSecurityFindings, SecurityFindingRow } from '../../shared/security-findings-view';
import { PresentationTextPipe } from '../../shared/presentation-label.pipe';
import { frenchDate, frenchDuration, frenchRelative } from '../../shared/french-format';
import { sortPipelineStages, pipelineStageLabel } from '../../shared/pipeline-stage-presentation';
import { Component, ElementRef, Input, OnChanges, OnDestroy, OnInit, SimpleChanges, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { CveTableComponent } from './cve-table.component';
import { ZapTableComponent } from './zap-table.component';
import { ProjectOverviewComponent } from './project-overview.component';
import { JenkinsfileOptimizerComponent } from './jenkinsfile-optimizer.component';
import { DockerfileOptimizerComponent } from './dockerfile-optimizer.component';
import { DeploymentGovernanceComponent } from './deployment-governance.component';
import { ApiService } from '../../core/services/api.service';
import { ToastService } from '../../core/services/toast.service';
import { RiskStateService } from '../../core/services/risk-state.service';
import { AuthService } from '../../core/services/auth.service';
import { StageStatusLabelPipe } from '../../shared/stage-status-label.pipe';
import { PresentationLabelPipe } from '../../shared/presentation-label.pipe';
import { FrenchDatePipe } from '../../shared/french-date.pipe';
import { userHttpError } from '../../core/http-error-message';
import { presentationText, presentationLabel, remediationTypeLabel, riskLevelLabel } from '../../shared/status-labels';
import { findingDescriptionText, findingEligibilityText, findingEvidenceText, findingRecommendationText, findingResponsibleText, findingWhyImportantText } from '../../shared/finding-presentation';
import { formatScoreOn100, isValidScoreOn100 } from '../../shared/score-display';
import { canSelectCveTask as canSelectCveTaskShared, CveSelectionEligibility } from '../../shared/cve-selection-eligibility';
import { StatusChipComponent } from '../../shared/status-chip/status-chip.component';
import { ProjectContextStripComponent } from '../../shared/project-context/project-context-strip.component';
import { CopyableIdComponent } from '../../shared/copyable-id/copyable-id.component';
import { InfoHintComponent } from '../../shared/info-hint/info-hint.component';
import { ZoneLabelComponent } from '../../shared/zone-label/zone-label.component';
import { statusColor } from '../../shared/status-chip/status-tone';
import { SourceEvidenceLinkComponent } from '../../shared/source-evidence/source-evidence-link.component';
import { SourceEvidenceListComponent } from '../../shared/source-evidence/source-evidence-list.component';
import { EvidenceSection, IncidentSourceEvidence, ProjectSourceEvidence, SourceEvidence, normalizeEvidenceView, EvidenceLoadState } from '../../shared/source-evidence/source-evidence.types';

@Component({
  selector: 'app-project-detail',
  standalone: true,
  imports: [PresentationTextPipe, CommonModule, FormsModule, RouterModule, CveTableComponent, ZapTableComponent, ProjectOverviewComponent, JenkinsfileOptimizerComponent, DockerfileOptimizerComponent, DeploymentGovernanceComponent, SourceEvidenceLinkComponent, SourceEvidenceListComponent, StatusChipComponent, ProjectContextStripComponent, CopyableIdComponent, InfoHintComponent, ZoneLabelComponent, StageStatusLabelPipe, PresentationLabelPipe, FrenchDatePipe],
  templateUrl: './project-detail.component.html',
  styleUrls: ['./project-detail.component.scss'],
})
export class ProjectDetailComponent implements OnInit, OnChanges, OnDestroy {
  private readonly projectScopeReset$ = new Subject<void>();
  // Tonalité de statut dérivée en UN endroit (shared/status-chip/status-tone.ts).
  // Remplace les binaires `=== 'SUCCESS' ? vert : rouge' des gabarits, qui
  // peignaient en rouge un build en cours, interrompu ou inconnu.
  statusColor = statusColor;
  scannerMetric = scannerMetric;
  scannerState = scannerState;
  qualityGatePresentation = qualityGatePresentation;
  // R49 — expose au gabarit, comme ses voisins : la vue Docker n'affiche le
  // lien « vulnerabilites de l'image » que si le scan a reellement un resultat.
  scannerHasResult = scannerHasResult;
  dataErrors: Record<string, string> = {};
  // repositoryUrl() a été retiré : l'URL du dépôt vient de l'emplacement
  // GIT_REPOSITORY du contrat de preuve, qui respecte le fournisseur et
  // n'invente pas d'URL GitHub pour un dépôt hébergé ailleurs.
  jenkinsLive = false;
  jenkinsLoading = false;
  jenkinsConnectionState(): string { return this.jenkinsMessage ? 'Indisponible' : this.jenkinsLive ? 'Données reçues' : this.project?.jenkinsJobName ? 'Configuré, connexion non vérifiée' : 'Non configuré'; }
  reportedBranch(): string { return this.rp?.metadata?.sourceBranch || this.rp?.metadata?.branch || this.ed?.build?.branch || ''; }
  orderedStages(): any[] { return sortPipelineStages(this.deployReadiness?.requiredStages || []); }
  pipelineStageLabel = pipelineStageLabel;
  frenchDuration = frenchDuration;

  // ── Bandeau de contexte projet (§3) ──────────────────────────────────
  // Répond d'un coup d'œil : quel projet, quelle branche, quel build, quel
  // commit, quand. Chaque valeur vient d'une source réelle et vaut null
  // quand elle n'est pas enregistrée — jamais un repli inventé.

  /** Build de l'analyse affichée. */
  contextBuildNumber(): number | null {
    const n = this.reportEvidence?.buildNumber ?? this.ed?.build?.number ?? this.latestReport?.buildNumber ?? null;
    return typeof n === 'number' && Number.isSafeInteger(n) ? n : null;
  }

  contextBuildStatus(): string | null {
    const value = String(this.ed?.build?.status ?? '').trim();
    return value ? value : null;
  }

  contextCommitFull(): string | null {
    const sha = this.reportEvidence?.commitSha || this.latestReport?.metadata?.sourceCommitSha || null;
    return typeof sha === 'string' && /^[0-9a-f]{7,40}$/i.test(sha) ? sha : null;
  }

  /** Fraîcheur relative de la dernière analyse — jamais fabriquée (§19). */
  contextFreshness(): string | null {
    return frenchRelative(this.latestReport?.createdAt);
  }

  contextTimestamp(): string | null {
    return this.latestReport?.createdAt ? frenchDate(this.latestReport.createdAt) : null;
  }

  /** Copie une valeur technique complète (§21). */
  contextCopied: string | null = null;
  copyValue(value: string | null) {
    if (!value) return;
    const clipboard = (navigator as any)?.clipboard;
    if (!clipboard?.writeText) return;
    clipboard.writeText(value).then(
      () => { this.contextCopied = value; setTimeout(() => { if (this.contextCopied === value) this.contextCopied = null; }, 1600); },
      () => { this.contextCopied = null; },
    );
  }

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

  // ── Sources & preuves (« Voir dans la source ») ─────────────────────
  // DEUX tables distinctes, jamais fusionnées :
  //   projectEvidence  — portée PROJET (job Jenkins, projet Sonar, dépôt,
  //                      cible Azure) : vraie quel que soit le build affiché ;
  //   reportEvidence   — portée ANALYSE SÉLECTIONNÉE (build, commit, chemins
  //                      de rapport, image publiée, PR, exécution n8n).
  // Les confondre ferait désigner le build courant comme source d'un constat
  // issu d'un build antérieur. Aucune URL n'est construite ici : tout vient
  // de GET /api/source-evidence/* (voir api.service.ts).
  projectEvidence: ProjectSourceEvidence | null = null;
  reportEvidence: IncidentSourceEvidence | null = null;
  // État du CHARGEMENT, jamais confondu avec la disponibilité d'une preuve :
  // une requête en échec affichait auparavant « Source non disponible », ce
  // qui affirmait une absence qu'on n'avait pas constatée (§17).
  projectEvidenceState: EvidenceLoadState = 'loading';
  reportEvidenceState: EvidenceLoadState = 'loading';
  allReports: any[] = [];
  allReportsTotal: number | null = null;
  historyPage = 1;
  historyHasNext = false;
  historyLoading = false;
  incidentsLoading = false;
  private reportSelection = 0;
  private reportDetails = new Map<string, any>();
  latestReport: any = null;
  loading = true;
  loadError = false;
  readonly tabMap: Record<string,string> = {
    jenkins: 'jenkins', sonar: 'sonarqube',
    // R49 — destination propre a Docker. Sans cette entree, onGoToTab()
    // resolvait `undefined` et setActiveTab() retombait sur 'rapport'.
    docker: 'docker',
    security: 'securite',
    // The overview's "Déploiement" stage opens the platform's own deployment
    // section, never Jenkins.
    deploiement: 'deploiement'
  };
  // 'deploiement' is the platform's OWN deployment-governance section. It is
  // deliberately distinct from 'jenkins' (CI/CD build evidence): Jenkins is a
  // build source, never the deployment UI. Every project gets both tabs; only
  // the DATA behind them differs.
  readonly VALID_TABS = ['rapport', 'jenkins', 'sonarqube', 'docker', 'securite', 'deploiement', 'incidents', 'config'];
  activeTab = 'rapport';
  securityFilter: 'all' | 'trivy' | 'owasp' | 'zap' = 'all';
  manualTasks: any[] = [];
  manualTasksLoading = false;
  manualSummaryLoaded = false;
  reportsLoading = true;
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
  convergenceLoading = true;
  deployReasons: string[] = [];
  deployReadyLoading = true;
  allCves(ed: any): any[] {
    return [ ...(ed?.trivy?.cves || []), ...(ed?.owasp?.cves || []) ];
  }

  // Règle dupliquée avec le backend (security-score.ts::isScannerComplete) —
  // absence de status (legacy) = donnée de confiance, status présent et
  // différent de 'COMPLETED' = scanner non exécuté. Garder synchronisée.
  isScannerMissing(block: any): boolean {
    return !scannerHasResult(block);
  }
  devGuide(_ed: any): any {
    return this.rp?.developerGuide ?? null;
  }
  devTasks: any[] = [];
  checkedTasks = 0;

  // Score affiché dans le header (du dernier rapport)
  lastScore: number | null = null;
  lastRisk = 'UNKNOWN';

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
  scoreUnavailable = true;

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

  // Increment 1 (sélection multiple CVE) — même patron que la sélection
  // Sonar ci-dessus (selectedSonarIds/canSelectFinding/confirmSonarCorrection),
  // volontairement un Set/état SÉPARÉ : les deux onglets (Sonar,
  // Trivy+OWASP) ont des cycles de vie de sélection indépendants, jamais
  // partagés. Contient des ManualRemediationTask.id (findingTaskId), pas des
  // identifiants de CVE — l'appel de lancement en a besoin tel quel.
  selectedCveTaskIds = new Set<string>();
  launchingCveBatch = false;
  cveBatchError: string | null = null;

  // Retour visuel + rafraîchissement automatique pendant un lot en cours
  // (tâches Trivy/OWASP au statut DISPATCHING) — sans ceci, un lot lancé
  // n'était visible qu'au moment du lancement : l'utilisateur ne voyait
  // plus rien bouger pendant les ~10 min d'un run réel et pouvait croire à
  // un échec. Un seul point de vérité (syncBatchPolling(), appelé à chaque
  // rechargement de manualTasks) démarre/arrête le polling ET couvre le cas
  // d'un rechargement de page pendant qu'un lot tourne déjà côté serveur.
  batchPolling = false;
  batchPollTimedOut = false;
  private batchPollTimer: ReturnType<typeof setInterval> | null = null;
  private batchPollElapsedMs = 0;
  private readonly BATCH_POLL_INTERVAL_MS = 8000;
  // Un run réel dure ~10 min ; plafond volontairement large (20 min) pour
  // ne jamais couper un traitement légitime encore en cours, mais borné
  // pour ne jamais poller indéfiniment si un run échoue sans jamais
  // ressortir de DISPATCHING côté serveur.
  private readonly BATCH_POLL_MAX_MS = 20 * 60 * 1000;

  retryPendingIds: ReadonlySet<string> = new Set();
  securityLifecycleSummary() {
    const rows = [...this.securityRows('TRIVY'), ...this.securityRows('OWASP')];
    return summarizeSecurityRemediation(rows, row => this.manualTasks.find(t => t.id === row.findingTaskId),
      () => ({selectable:false,reason:''}));
  }
  securityRows(source: 'TRIVY' | 'OWASP'): SecurityFindingRow[] {
    const raw = this.ed?.[source.toLowerCase()]?.cves || [];
    const rows = raw.map((r: Record<string, string>) => ({ ...r,
      id:r['id'] || r['VulnerabilityID'] || r['cve'] || r['name'] || '',
      pkg:r['pkg'] || r['PkgName'] || r['package'] || r['fileName'] || '', source }));
    try { return mergeSecurityFindings(rows, this.manualTasks, source); }
    catch { return []; } // Table displays blocking identity error; never approximate.
  }
  hasSecurityRows(source: 'TRIVY' | 'OWASP'): boolean {
    return !!this.ed?.[source.toLowerCase()]?.cves?.length || this.manualTasks.some(t => t.source === source);
  }
  dispatchingCount(): number { return this.securityLifecycleSummary().dispatching; }
  failedRetryableCount(): number { return this.securityLifecycleSummary().failedRetryable; }
  candidateReadyCount(): number { return this.securityLifecycleSummary().candidateReady; }
  retrySecurityFinding(task: SecurityRemediationTask): void {
    if (!this.canOperate || this.retryPendingIds.has(task.id)) return;
    const current = this.manualTasks.find(t => t.id === task.id);
    if (!current || getSecurityRemediationPresentation(current, {selectable:false,reason:''}).retryAllowed !== true) return;
    this.retryPendingIds = new Set([...this.retryPendingIds, task.id]);
    const release = () => { const next = new Set(this.retryPendingIds); next.delete(task.id); this.retryPendingIds = next; };
    this.api.retrySecurityFindingRemediation(task.id, current.securityFindingRemediation?.attemptId).subscribe({
      next: () => { this.loadManualRemediation(release); },
      error: (error: {status?: number}) => {
        this.toast.error('Relance refusée', error.status === 409
          ? 'L’état de la tentative a changé ou la relance n’est plus autorisée. Les données sont actualisées.'
          : 'Impossible de relancer la correction. Actualisez les données avant de réessayer.');
        this.loadManualRemediation(release);
      },
    });
  }
  correctSecurityFinding(taskId: string): void {
    const row = [...this.securityRows('TRIVY'), ...this.securityRows('OWASP')].find(r => r.findingTaskId === taskId);
    const task = this.manualTasks.find(t => t.id === taskId);
    if (!row || !task || !getSecurityRemediationPresentation(task, this.canSelectCveTask(task,row), row).selectable) return;
    if (this.launchingCveBatch) return;
    this.selectedCveTaskIds = new Set([taskId]);
    this.launchCveBatch();
  }

  private syncBatchPolling(): void {
    if (this.dispatchingCount() > 0) {
      this.batchPollTimedOut = false;
      this.startBatchPolling();
    } else {
      this.stopBatchPolling();
    }
  }

  private startBatchPolling(): void {
    if (this.batchPollTimer) return;
    this.batchPolling = true;
    this.batchPollElapsedMs = 0;
    this.batchPollTimer = setInterval(() => {
      this.batchPollElapsedMs += this.BATCH_POLL_INTERVAL_MS;
      if (this.batchPollElapsedMs >= this.BATCH_POLL_MAX_MS) {
        this.stopBatchPolling();
        this.batchPollTimedOut = true;
        return;
      }
      this.loadManualRemediation();
    }, this.BATCH_POLL_INTERVAL_MS);
  }

  private stopBatchPolling(): void {
    if (this.batchPollTimer) {
      clearInterval(this.batchPollTimer);
      this.batchPollTimer = null;
    }
    this.batchPolling = false;
  }

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
      { name: 'Jenkins', state: this.jenkinsConnectionState(), ok: this.jenkinsLive },
      { name: 'SonarQube', state: !this.project?.sonarqubeKey ? 'Non configuré' : (this.ed?.sonar ? 'Configuré' : 'Attention'), ok: !!this.project?.sonarqubeKey && !!this.ed?.sonar },
      { name: 'Docker', state: stage('docker')?.status === 'PASSED' ? 'Étape Docker réussie' : 'Attention', ok: stage('docker')?.status === 'PASSED' },
      { name: 'Tests', state: stage('tests')?.status === 'NOT_RUN' ? 'Non exécutés' : (stage('tests')?.status === 'PASSED' ? 'Configuré' : 'Attention'), ok: stage('tests')?.status === 'PASSED' },
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
    return presentationText(reason);
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
  // R-UX — délègue au module scanner-agnostique partagé (finding-presentation.ts).
  // Comportement inchangé pour un evidence exploitable ; seul le repli final
  // (ni evidence ni message) devient un message lisible au lieu de "Non
  // disponible" brut, sans jamais perdre la preuve brute quand elle existe.
  findingEvidence(finding: any): string {
    return findingEvidenceText(finding) ?? "Aucune preuve technique brute n'est fournie par la source d'analyse.";
  }
  findingWhyImportant(finding: any): string { return findingWhyImportantText(finding); }
  findingRecommendationLabel(finding: any): string { return findingRecommendationText(finding); }
  findingResponsibleLabel(finding: any): string { return findingResponsibleText(finding); }
  findingEligibilityLabel(finding: any): string { return findingEligibilityText(finding); }
  findingFileName(f: any): string { return String(f?.file || f?.component || 'Non disponible').split('/').pop() || 'Non disponible'; }

  // ── Score de sécurité (0-100, voir security-score.ts) — présentation
  // uniquement, générique sur n'importe quel score du même contrat (header
  // ET historique ci-dessous partagent cette même vérité). `lastScore` peut
  // rester `null`/invalide même quand scanIncomplete/scoreUnavailable sont
  // tous deux faux (report corrélé par build.number mais sans score propre
  // persisté) -- ce garde ferme ce cas plutôt que d'afficher un badge vide.
  hasValidScore(): boolean { return isValidScoreOn100(this.lastScore); }
  historyScoreLabel(score: any): string { return formatScoreOn100(score) ?? 'non vérifié'; }
  historyScoreCritical(score: any): boolean { return isValidScoreOn100(score) && score < 40; }
  remediationLabel(raw: string): string {
    return remediationTypeLabel(raw);
  }
  // Presentational only: DEVELOPER_ACTION_REQUIRED is the platform's generic
  // "no automatic remediation batch exists for this finding" fallback (see
  // manual-remediation.service.ts), never a claim that the finding is a
  // proven blocking defect. For an INFO-severity finding that reads as
  // confusing/alarming during a demo. Generic on (severity, remediationType)
  // only -- no rule/file/project literal -- so it applies identically to
  // every scanner-sourced finding this view ever renders, for any project.
  findingActionLabel(finding: any): string {
    const remediationType = finding?.remediationType;
    const isInformational = String(finding?.severity || '').toUpperCase() === 'INFO';
    if (isInformational && remediationType === 'DEVELOPER_ACTION_REQUIRED') return 'Information — à examiner';
    return this.remediationLabel(remediationType);
  }

  findingId(finding: any): string { return String(finding?.id || finding?.key || ''); }
  /**
   * Couverture autoritaire, source unique.
   *
   * Elle vient du rapport de couverture du build (`tests.coverage`), que la
   * bibliotheque partagee remplit depuis le rapport JaCoCo. Le bloc Sonar
   * expose aussi un champ `coverage`, mais WF1 le lit sur la reponse de l'API
   * /issues qui ne le porte pas : il vaut 0 par construction et ne doit pas
   * etre affiche. La vue d'ensemble lit deja cette meme source.
   *
   * R47 -- une etape de tests SKIPPED/UNKNOWN ecrit `coverage: 0` sans avoir
   * rien mesure : testStageCoverage() ne retient donc un chiffre que pour une
   * etape reellement executee, et laisse `null` sinon.
   */
  authoritativeCoverage(): number | null {
    return testStageCoverage(this.ed?.tests);
  }
  /**
   * Constats d'une analyse anterieure retenus par un scanner non execute.
   *
   * Ils ne comptent pas pour ce build (les compteurs restent indisponibles),
   * mais les cacher perdrait de l'information vraie. L'ecran les annonce.
   */
  staleScannerNotice(block: any): string | null {
    const n = scannerStaleFindingCount(block);
    if (n === null) return null;
    return `${n} constat${n > 1 ? 's' : ''} d'une analyse antérieure, non rattaché${n > 1 ? 's' : ''} à ce build`;
  }
  hasStaleScannerFindings(block: any): boolean { return scannerHasStaleFindings(block); }

  /** Motif d'absence, quand l'etape de tests n'a rien mesure. */
  coverageState(): string { return testStageCoverageState(this.ed?.tests); }

  isAutoFixEligible(finding: any): boolean { return finding?.remediationType === 'AUTO_FIX_ELIGIBLE'; }
  activeFixRequest(): any { return this.latestReport?.metadata?.fixRequest || null; }
  prValidationRequest(): any { return this.latestReport?.metadata?.prValidationRequest || null; }

  // Etat UX terminal de l'automatisation, distinct d'une fusion GitHub :
  // toutes les preuves persistées doivent concorder et une vraie PR doit exister.
  isMergeReadySuccess(): boolean {
    const request = this.prValidationRequest();
    const authorization = this.normalizedMergeAuthorization();
    return request?.status === 'COMPLETED'
      && request?.result === 'VALIDATED'
      && authorization?.authorization === 'MERGE_READY'
      && (!!this.batchPrUrl() || this.batchPrNumber() !== null);
  }

  private normalizedMergeAuthorization(): any {
    const authorization = this.latestReport?.metadata?.validation?.mergeAuthorization;
    if (!authorization) return null;
    const forSha = String(authorization.forSha || '').toLowerCase();
    const fix = this.activeFixRequest();
    const targetSha = String(fix?.validationTargetSha || fix?.prHeadSha || '').toLowerCase();
    return forSha && targetSha && forSha !== targetSha
      ? { ...authorization, authorization: 'INCONCLUSIVE', authorizedSha: null }
      : authorization;
  }

  // ── Résumé compact de l'autorisation de merge (Option C) ───────────────
  // Même vocabulaire / couleur que l'écran incident (55418e3). Le détail
  // (raisons FR, santé globale, note « problèmes préexistants ») vit sur
  // /incidents/:id?tab=validation — on n'y duplique PAS le bloc riche.
  // Retourne null si validation.mergeAuthorization est absent (incidents
  // pré-bb32694) → le template retombe sur prValidationRequest.status/result.
  mergeAuthShort(): { label: string; color: string } | null {
    const st = this.prValidationRequest()?.status;
    // Revalidation en cours : l'autorisation stockée reflète le run précédent.
    if (st === 'REQUESTED' || st === 'QUEUED' || st === 'RUNNING') {
      return { label: 'Analyse en cours', color: 'var(--accent-blue)' };
    }
    const auth = this.normalizedMergeAuthorization()?.authorization;
    const map: Record<string, { label: string; color: string }> = {
      MERGE_READY:  { label: 'Autorisée pour fusion', color: 'var(--accent-green)' },
      BLOCKED:      { label: 'Bloquée',               color: 'var(--accent-red)' },
      INCONCLUSIVE: { label: 'Non concluante',        color: 'var(--accent-orange)' },
      VALIDATING:   { label: 'Analyse en cours',      color: 'var(--accent-blue)' },
    };
    return map[auth] || null;
  }
  // Une vraie PR de correction existe déjà pour cet incident. Modèle backend :
  // un incident → une fixRequest → une PR (incidents.service.ts:929). Tant que
  // cette PR existe, aucune nouvelle demande de correction n'est acceptée ;
  // seule la revalidation de la MÊME PR reste possible.
  hasRealPr(): boolean { return /^https?:\/\//i.test(String(this.latestReport?.prUrl || '')); }
  // Le backend refuse toute NOUVELLE demande de correction tant qu'un cycle est
  // en cours (startFix ligne 960) ou qu'une PR existe (ligne 929). L'UI reflète
  // exactement cette règle : plus de sélection ni de « Proposer une correction ».
  // Reste permis : aucun cycle, ou cycle FIX_FAILED / REJECTED sans PR
  // (→ « Réessayer la correction » gère ce cas séparément).
  newCorrectionBlocked(): boolean {
    if (this.hasRealPr()) return true;
    return ['APPROVAL_REQUESTED', 'FIX_STARTING', 'DISPATCHED', 'PR_CREATED', 'VALIDATING']
      .includes(this.activeFixRequest()?.status);
  }
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

  // ── Verdict per-finding AUTORITAIRE (WF3 / Sonar exact-SHA) ─────────────
  // Seule source de vérité pour l'état « corrigé/vert » : la preuve par
  // finding produite par WF3, jamais un statut global. Ordre de lecture :
  //   1. validation.derived.findings[].verdict   (records R22-A récents)
  //   2. validation.findingResults[].result      (repli, incidents antérieurs
  //   3. prValidationRequest.findingResults[].result   ex. 65e35d1b)
  // Ne consulte JAMAIS incident.status / fixRequest.status / prUrl / prNumber.
  private findingResultEntries(): any[] {
    const meta: any = this.latestReport?.metadata || {};
    const derived = meta.validation?.derived?.findings;
    if (Array.isArray(derived) && derived.length) return derived;
    if (Array.isArray(meta.validation?.findingResults)) return meta.validation.findingResults;
    if (Array.isArray(meta.prValidationRequest?.findingResults)) return meta.prValidationRequest.findingResults;
    return [];
  }
  findingVerdict(finding: any): string | null {
    const id = this.findingId(finding);
    const entry = this.findingResultEntries().find((e: any) => String(e?.findingId) === id);
    if (!entry) return null;
    return String(entry.verdict ?? entry.result ?? '').toUpperCase() || null;
  }
  isFindingValidated(finding: any): boolean { return this.findingVerdict(finding) === 'VALID'; }
  isFindingMergeReady(finding: any): boolean {
    return this.isMergeReadySuccess() && this.findingInActiveBatch(finding) && this.isFindingValidated(finding);
  }

  // ── Provenance PR du batch de remédiation ──────────────────────────────
  // prUrl RÉEL stocké (fixRequest.prUrl, repli latestReport.prUrl) — jamais
  // reconstruit. N'est rattaché qu'aux findings de fixRequest.findingIds.
  findingInActiveBatch(finding: any): boolean {
    return this.requestFindingIds().includes(this.findingId(finding));
  }
  batchPrUrl(): string | null {
    const url = this.activeFixRequest()?.prUrl || this.latestReport?.prUrl || '';
    return /^https?:\/\//i.test(String(url)) ? String(url) : null;
  }
  batchPrNumber(): number | null {
    const n = Number(this.activeFixRequest()?.prNumber);
    return Number.isInteger(n) && n > 0 ? n : null;
  }
  showFindingPrLink(finding: any): boolean {
    return this.findingInActiveBatch(finding) && !!this.batchPrUrl();
  }
  // Libellé du badge « Correction » quand le finding n'est PAS validé par WF3.
  // Hors batch : éligibilité. Dans le batch : état de cycle, sauf « PR créée »
  // / « Validée » qui seraient redondants ou non autoritaires (le lien PR et le
  // badge vert per-finding portent déjà ces deux faits).
  findingCellStatus(finding: any): string | null {
    if (!this.findingInActiveBatch(finding)) return this.findingActionLabel(finding);
    const state = this.findingRequestState(finding);
    return state === 'PR créée' || state === 'Validée' ? null : state;
  }
  canRetryFixRequest(): boolean {
    const request = this.activeFixRequest();
    return this.canOperate && request?.status === 'FIX_FAILED' && request?.retryEligible === true
      && this.requestFindingIds().length > 0;
  }
  retryFailedFix(): void {
    if (!this.canRetryFixRequest() || this.approving || !this.latestReport?.id) return;
    this.modifyingFailedSelection = false;
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
  // ── « Modifier la sélection » ────────────────────────────────────────────
  // Distinct de retryFailedFix() : celui-ci réutilise le MÊME fixRequest
  // (même requestId/batchId, tentative+1) ; ceci crée systématiquement un
  // TOUT NOUVEAU fixRequest via le contrat existant approveFixBatch (voir
  // startFix isModifiedSelectionAfterFailure côté backend) -- jamais de
  // mutation de l'ancien fixRequest FIX_FAILED, jamais de retry implicite.
  modifyingFailedSelection = false;
  canModifySelection(): boolean {
    return this.canOperate && this.activeFixRequest()?.status === 'FIX_FAILED';
  }
  startModifySelection(): void {
    if (!this.canModifySelection()) return;
    this.modifyingFailedSelection = true;
    const failedIds = new Set(this.requestFindingIds());
    this.selectedSonarIds = new Set(
      (this.ed?.sonar?.issues || [])
        .filter((f: any) => failedIds.has(this.findingId(f)) && this.canSelectFinding(f))
        .map((f: any) => this.findingId(f)),
    );
  }
  cancelModifySelection(): void {
    this.modifyingFailedSelection = false;
    this.clearSonarSelection();
  }
  previousFixRequests(): any[] {
    return Array.isArray(this.latestReport?.metadata?.previousFixRequests) ? this.latestReport.metadata.previousFixRequests : [];
  }
  findingRequestState(finding: any): string | null {
    if (!this.requestFindingIds().includes(this.findingId(finding))) return null;
    const labels: Record<string,string> = { APPROVAL_REQUESTED:'Correction demandée', FIX_STARTING:'Correction demandée', DISPATCHED:'Correction en cours', PR_CREATED:'PR créée', VALIDATING:'Validation en cours', VALIDATED:'Validée', REJECTED:'Rejetée', FIX_FAILED:'Échec de la correction' };
    return labels[this.activeFixRequest()?.status] || 'Correction en cours';
  }
  isSelected(finding: any): boolean {
    return this.canSelectFinding(finding) && this.selectedSonarIds.has(this.findingId(finding));
  }
  failedSelectionUnchanged(): boolean {
    const selected = [...this.selectedSonarIds].sort();
    return this.modifyingFailedSelection && JSON.stringify(selected) === JSON.stringify([...new Set(this.requestFindingIds())].sort());
  }
  canSelectFinding(finding: any): boolean {
    const baseline = finding?.baselineSha || finding?.sourceCommitSha;
    if (finding?.stale === true || ['RESOLVED', 'CLOSED', 'FIXED'].includes(String(finding?.status || '').toUpperCase())
      || (baseline && String(baseline).toLowerCase() !== String(this.latestReport?.metadata?.sourceCommitSha || '').toLowerCase())) return false;

    // En mode « Modifier la sélection », les findings de l'ANCIEN batch
    // FIX_FAILED redeviennent sélectionnables (l'utilisateur peut les
    // déselectionner) -- seul ce cas précis lève le verrou logicalBatch ;
    // en dehors de ce mode, comportement strictement inchangé.
    const editableFailedBatchMember = this.modifyingFailedSelection
      && this.activeFixRequest()?.status === 'FIX_FAILED'
      && this.requestFindingIds().includes(this.findingId(finding));
    return this.canOperate && this.isAutoFixEligible(finding) && !this.newCorrectionBlocked()
      && !this.isFindingValidated(finding)
      && !this.isFindingLocked(finding)
      && (editableFailedBatchMember || !this.isFindingOwnedByLogicalBatch(finding));
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
    // Générique (aucun autre rule-hardcoding) : reformule légèrement le
    // message brut de la source pour tout finding non couvert ci-dessus,
    // quel que soit le scanner (Sonar/Trivy/OWASP/ZAP) -- voir finding-presentation.ts.
    return findingDescriptionText(finding);
  }
  openBatchConfirmation(): void {
    if (this.newCorrectionBlocked() || this.failedSelectionUnchanged() || !this.selectedSonarFindings().length) return;
    this.batchConfirmationOpen = true;
    setTimeout(() => this.batchDialog?.nativeElement.focus());
  }
  closeBatchConfirmation(): void { if (!this.approving) this.batchConfirmationOpen = false; }
  confirmSonarCorrection(): void {
    if (this.approving) return;
    const findingIds = this.selectedSonarFindings().map(f => this.findingId(f));
    if (this.newCorrectionBlocked() || this.failedSelectionUnchanged() || !this.canOperate || !this.latestReport?.id || !findingIds.length) return;
    this.approving = true;
    const wasModifyingFailedSelection = this.modifyingFailedSelection;
    this.api.approveFixBatch(this.latestReport.id, findingIds).subscribe({
      next: (result: any) => {
        this.approving = false;
        this.batchConfirmationOpen = false;
        this.modifyingFailedSelection = false;
        const old = this.latestReport.metadata?.fixRequest;
        this.latestReport.metadata = { ...(this.latestReport.metadata || {}),
          previousFixRequests: wasModifyingFailedSelection
            ? [...this.previousFixRequests(), old] : this.previousFixRequests(),
          fixRequest: {
            requestId: result.requestId, batchId: result.batchId,
            findingIds, findingId: findingIds[0], status: result.status,
            attemptCount: result.attemptCount || 1, retryEligible: false,
            attempts: [{ attempt: result.attemptCount || 1, status: result.status }],
          },
        };
        this.clearSonarSelection();
        this.toast.success('Correction demandée', result.duplicate ? 'Cette demande existe déjà.' : 'La demande gouvernée a été enregistrée.');
      },
      error: (e: any) => { this.approving = false; this.toast.error('Demande refusée', userHttpError(e, 'Impossible de proposer cette correction.')); },
    });
  }

  // ── Sélection multiple CVE (Trivy/OWASP) — même patron que la sélection
  // Sonar ci-dessus, branchée directement sur POST /manual-remediation/
  // launch-batch. "Appel direct" (cadrage increment 1) : pas de dialog de
  // confirmation intermédiaire comme openBatchConfirmation() côté Sonar.
  canSelectCveTask = (task: any, cve: { fixedVersion?: string; pkg?: string }): CveSelectionEligibility => {
    return canSelectCveTaskShared(task, this.canOperate, cve);
  };
  selectedCveCount(): number { return this.selectedCveTaskIds.size; }
  clearCveSelection(): void { this.selectedCveTaskIds = new Set(); }
  toggleCveTaskSelection(taskId: string): void {
    if (this.launchingCveBatch) return;
    const next = new Set(this.selectedCveTaskIds);
    next.has(taskId) ? next.delete(taskId) : next.add(taskId);
    this.selectedCveTaskIds = next;
  }
  // launchBatchRemediation() refuse tout lot de plus de 8 CVE
  // (manual-remediation.service.ts) — vérifié ici pour ne jamais laisser
  // l'utilisateur déclencher un 400 générique évitable ; pas une nouvelle
  // règle métier inventée côté UI, juste l'anticipation d'une règle serveur
  // déjà réelle.
  cveBatchOverCap(): boolean { return this.selectedCveTaskIds.size > 8; }
  launchCveBatch(): void {
    if (this.launchingCveBatch || !this.canOperate || !this.selectedCveTaskIds.size || this.cveBatchOverCap()) return;
    this.launchingCveBatch = true;
    this.cveBatchError = null;
    const findingTaskIds = [...this.selectedCveTaskIds];
    this.api.launchSecurityRemediationBatch(this.id, findingTaskIds).subscribe({
      next: () => {
        this.launchingCveBatch = false;
        // Sélection vidée : le retour visuel détaillé (statut DISPATCHING en
        // direct, polling) est l'incrément suivant — ici, loadManualRemediation()
        // recharge une fois pour que le badge "en cours" apparaisse au prochain
        // rendu, cohérent avec le seul mécanisme de rafraîchissement qui existe
        // déjà sur cette page (un refresh ponctuel après chaque action, jamais
        // un polling — voir completeManualTask() ci-dessus). Garder les CVE
        // cochées n'aurait aucun sens : elles viennent d'entrer en DISPATCHING,
        // donc canSelectCveTask() les aurait de toute façon rendues non
        // sélectionnables au prochain affichage.
        this.clearCveSelection();
        this.toast.success('Correction lancée', `Le traitement de ${findingTaskIds.length} vulnérabilité${findingTaskIds.length > 1 ? 's' : ''} a démarré.`);
        this.loadManualRemediation();
      },
      error: (err: any) => {
        this.launchingCveBatch = false;
        // Sélection volontairement CONSERVÉE sur refus (409 : conflit de
        // propriété, CVE déjà en cours...) -- l'utilisateur doit pouvoir
        // corriger juste la sélection fautive (retirer la CVE nommée dans le
        // message) plutôt que tout recommencer depuis zéro.
        let message = userHttpError(err, 'Impossible de lancer la correction.');
        const selectedTasks = this.manualTasks.filter(task => findingTaskIds.includes(task.id));
        for (const task of selectedTasks) {
          message = message.split(task.id).join(task.ruleOrCve || task.findingSnapshot?.ruleOrCve || task.id);
        }
        if ((err?.status === 409 || err?.status === 403) && !selectedTasks.some(task =>
          message.includes(task.ruleOrCve || task.findingSnapshot?.ruleOrCve || task.id))) {
          const names = selectedTasks.map(task => task.ruleOrCve || task.findingSnapshot?.ruleOrCve || task.id);
          message += ` Sélection refusée : ${names.join(', ')}.`;
        }
        this.cveBatchError = message;
      },
    });
  }

  // Source unique de vérité pour changer d'onglet : met à jour activeTab ET
  // reflète le choix dans l'URL (?tab=xxx) sans recharger la page, pour que
  // l'onglet actif survive à un F5. replaceUrl:true pour ne pas polluer
  // l'historique/bouton retour à chaque clic d'onglet.
  /**
   * Onglets déjà ouverts au moins une fois pendant cette visite.
   *
   * Sert à un seul onglet, et pour une raison mesurée : la vue Déploiement
   * attend une vérification de l'artefact auprès du registre Azure, qui
   * prend 10 à 12 s (deux vérifications distantes de l'artefact ; la
   * cause exacte de leur coût n'est pas établie, voir le rapport de gel).
   * Avec un `*ngIf` seul, le composant est détruit à chaque changement
   * d'onglet et **repaie ces 12 s à chaque retour**. En le gardant monté
   * une fois ouvert, le second passage est immédiat.
   *
   * Ce n'est pas une mise en cache de la décision de gouvernance : le
   * composant conserve simplement le résultat qu'il a déjà obtenu, comme
   * s'il était resté affiché. Le bouton « Réévaluer » reste la façon de
   * redemander une décision fraîche au serveur, et le serveur reste seul à
   * la calculer. Le premier affichage, lui, n'est jamais anticipé : rien
   * n'est demandé à Azure tant que l'onglet n'a pas été ouvert.
   */
  visitedTabs = new Set<string>(['rapport']);

  setActiveTab(tab: string) {
    const previousTab = this.activeTab;
    this.activeTab = this.VALID_TABS.includes(tab) ? tab : 'rapport';
    this.visitedTabs.add(this.activeTab);
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab: this.activeTab },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
    if (this.project && this.activeTab !== previousTab) this.loadActiveTabData();
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

  // ── Filtre "source" de l'onglet Sécurité (chips Tous/Trivy/OWASP/ZAP) ──
  // Frontend-only : bascule la même propriété `securityFilter` déjà
  // consommée par les *ngIf des 3 sections ci-dessous (déjà composée avec
  // manualSeverityFilter/manualStatusFilter à l'intérieur de chaque
  // app-cve-table/app-zap-table -- rien à changer côté composition).
  // `ed.{trivy,owasp,zap}` est le contrat fermé actuel de EnrichedData
  // (report-normalizer.ts) : aucune source supplémentaire n'existe
  // aujourd'hui à agréger sous "Tous" -- voir la note dans le rapport F6.
  setSecurityFilter(scanner: 'all' | 'trivy' | 'owasp' | 'zap'): void {
    this.securityFilter = scanner;
  }
  securityFindingsCount(scanner: 'all' | 'trivy' | 'owasp' | 'zap'): number | null {
    const count = (key: 'trivy' | 'owasp' | 'zap'): number | null => {
      const block = this.ed?.[key];
      const rows = key === 'zap' ? block?.alerts : block?.cves;
      if (scannerHasResult(block) && Array.isArray(rows)) return rows.length;
      if (key !== 'zap') {
        const historical = (this.manualTasks || []).filter(t => t.source === key.toUpperCase());
        if (historical.length) return historical.length;
      }
      return null;
    };
    if (scanner !== 'all') return count(scanner);
    const counts = [count('trivy'), count('owasp'), count('zap')];
    return counts.every(x => x !== null) ? counts.reduce<number>((sum, n) => sum + n!, 0) : null;
  }
  // Vrai quand ce scanner a bien tourné (donnée fiable) mais n'a produit
  // aucun finding -- distinct de isScannerMissing (scanner non exécuté),
  // pour ne jamais afficher une zone vide sans explication (voir F5).
  securityScannerEmpty(scanner: 'trivy' | 'owasp' | 'zap'): boolean {
    const block = this.ed?.[scanner];
    return !this.isScannerMissing(block) && this.securityFindingsCount(scanner) === 0;
  }

  ngOnInit() {
    const tab = this.route.snapshot.queryParamMap.get('tab');
    this.activeTab = tab && this.VALID_TABS.includes(tab) ? tab : 'rapport';
    this.loadProject();
  }

  // The router reuses this component when only :id changes (route component
  // input binding), so navigating project A -> B updates `id` WITHOUT
  // re-running ngOnInit. Without this hook the whole page would keep showing
  // A's data under B's URL. Every per-project collection is cleared first so
  // no value from the previous project can survive into the new one, not even
  // transiently while the new requests are in flight.
  ngOnChanges(changes: SimpleChanges) {
    if (changes['id'] && !changes['id'].firstChange) {
      this.resetProjectScopedState();
      this.loadProject();
    }
  }

  private resetProjectScopedState() {
    this.projectScopeReset$.next();
    this.stopBatchPolling();
    this.latestReport = null;
    this.rp = {};
    this.ed = {};
    this.judge = { decision: null, confidence: null };
    this.lastScore = null;
    this.lastRisk = 'UNKNOWN';
    this.scoreUnavailable = true;
    this.scanIncomplete = false;
    this.missingScanners = [];
    this.sonarLive = null;
    this.sonarLiveLoading = false;
    this.imageProvenance = null;
    this.imageProvenanceLoading = false;
    this.jenkinsLive = false;
    this.jenkinsLoading = false;
    this.jenkinsMessage = null;
    this.buildReliability = null;
    this.selectedSonarFinding = null;
    this.selectedSonarIds = new Set();
    this.selectedCveTaskIds = new Set();
    this.batchConfirmationOpen = false;
    this.securityFilter = 'all';
    this.devTasks = [];
    this.checkedTasks = 0;
    this.project = null;
    this.projectEvidence = null;
    this.reportEvidence = null;
    this.projectEvidenceState = 'loading';
    this.reportEvidenceState = 'loading';
    this.incidents = [];
    this.allReports = [];
    this.allReportsTotal = null;
    this.historyPage = 1;
    this.historyHasNext = false;
    this.historyLoading = false;
    this.incidentsLoading = false;
    this.showAllHistory = false;
    this.reportDetails.clear();
    this.reportSelection++;
    this.allReportsRaw = [];
    this.jenkinsBuilds = [];
    this.manualTasks = [];
    this.manualTasksLoading = false;
    this.manualSummaryLoaded = false;
    this.reportsLoading = true;
    this.manualSummary = { todo: 0, doneByUser: 0, stillDetected: 0, verified: 0, total: 0 };
    this.deployReadiness = null;
    this.deployReady = false;
    this.deploymentConfigured = false;
    this.deploymentTarget = null;
    this.deployReasons = [];
    this.convergenceCycles = [];
    this.convergenceLoading = true;
    this.dataErrors = {};
  }

  ngOnDestroy() {
    this.projectScopeReset$.next();
    this.projectScopeReset$.complete();
    this.stopBatchPolling();
  }

  loadProject() {
    this.loading = true;
    this.loadError = false;
    this.api.getProject(this.id).pipe(takeUntil(this.projectScopeReset$)).subscribe({
      next: p => {
        this.project = p;
        this.loading = false;
        this.loadSourceEvidence();
        this.loadReports();
        this.loadJudgeStatus();
        this.loadActiveTabData();
      },
      error: () => {
        this.toast.error('Erreur', 'Projet introuvable');
        this.loading = false;
        this.loadError = true;
      }
    });
  }

  // Shared report/header evidence remains project-scoped. Feature reads run
  // only while their tab is open; re-entry revalidates rather than using a
  // global cache (especially readiness, current tasks and live Jenkins).
  private loadActiveTabData() {
    if (this.activeTab === 'jenkins') this.loadJenkinsBuilds();
    if (this.activeTab === 'sonarqube') this.loadSonarMetrics();
    if (this.activeTab === 'docker') this.loadImageProvenance();
    if (['rapport', 'securite', 'deploiement', 'config'].includes(this.activeTab)) this.loadDeployReadiness();
    if (this.activeTab === 'securite') {
      this.loadConvergence();
      this.loadManualRemediation();
    }
  }

  // ── Sources & preuves ───────────────────────────────────────────────
  // Une table de preuve absente n'est jamais une erreur bloquante : la vue
  // affiche alors « Source non disponible », ce qui est l'état honnête.
  loadSourceEvidence() {
    this.projectEvidenceState = 'loading';
    this.api.getProjectSourceEvidence(this.id).pipe(takeUntil(this.projectScopeReset$)).subscribe({
      next: view => {
        this.projectEvidenceState = 'ready';
        // Garde d'isolation : une réponse qui ne porte pas CE projet est
        // rejetée plutôt qu'affichée (réponse tardive après changement de
        // projet). Un lien de preuve d'un autre projet serait un faux.
        this.projectEvidence = view?.projectId === this.id
          ? normalizeEvidenceView(view)
          : null;
      },
      // Panne de transport : on le DIT, au lieu de prétendre qu'aucune
      // preuve n'existe. L'utilisateur peut réessayer.
      error: () => { this.projectEvidence = null; this.projectEvidenceState = 'error'; },
    });
  }

  loadReportEvidence(reportId: string) {
    this.reportEvidence = null;
    this.reportEvidenceState = 'loading';
    if (!reportId) { this.reportEvidenceState = 'ready'; return; }
    this.api.getIncidentSourceEvidence(reportId).pipe(takeUntil(this.projectScopeReset$)).subscribe({
      next: view => {
        this.reportEvidenceState = 'ready';
        this.reportEvidence = view?.projectId === this.id && view?.incidentId === reportId
          ? normalizeEvidenceView(view)
          : null;
      },
      error: () => { this.reportEvidence = null; this.reportEvidenceState = 'error'; },
    });
  }

  /**
   * Preuve de l'ANALYSE affichée, avec repli sur la preuve de PROJET quand
   * l'emplacement n'a pas de portée build (job Jenkins, dépôt, cible Azure).
   * Le repli ne va jamais dans l'autre sens : un emplacement de build ne
   * prend jamais la valeur du dernier build connu du projet.
   */
  evidence(slot: string): SourceEvidence | null {
    return this.reportEvidence?.slots?.[slot] || this.projectEvidence?.slots?.[slot] || null;
  }

  /**
   * Table de preuve FUSIONNÉE pour les blocs d'onglet : la preuve du projet
   * sert de base, celle de l'analyse sélectionnée la surcharge.
   *
   * Un seul alias est appliqué, et il est explicite : les onglets demandent
   * « le build affiché ». Quand une analyse est sélectionnée, c'est SON build
   * (JENKINS_BUILD) ; sinon, le dernier build connu du projet
   * (JENKINS_LATEST_BUILD). Les deux emplacements restent distincts dans le
   * contrat parce qu'ils n'affirment pas la même chose — l'alias n'existe que
   * pour le rendu, et ne va jamais dans l'autre sens.
   */
  allEvidenceSlots(): Record<string, SourceEvidence> {
    const project = this.projectEvidence?.slots || {};
    const report = this.reportEvidence?.slots || {};
    const merged: Record<string, SourceEvidence> = { ...project, ...report };
    if (!report['JENKINS_BUILD']) {
      if (project['JENKINS_LATEST_BUILD']) merged['JENKINS_BUILD'] = project['JENKINS_LATEST_BUILD'];
      if (project['JENKINS_LATEST_BUILD_LOGS']) merged['JENKINS_BUILD_LOGS'] = project['JENKINS_LATEST_BUILD_LOGS'];
    }
    return merged;
  }

  // Regroupements d'affichage par onglet. C'est de la PRÉSENTATION (quel bloc
  // montre quoi, dans quel ordre) ; les URL et la disponibilité viennent
  // toujours du backend. Les clés sont les emplacements du contrat.
  jenkinsEvidenceSections(): EvidenceSection[] {
    return [
      { id: 'job', title: 'Job et build', slots: ['JENKINS_JOB', 'JENKINS_BUILD', 'JENKINS_BUILD_LOGS'] },
      { id: 'code', title: 'Code analysé', slots: ['GIT_REPOSITORY', 'GIT_COMMIT'] },
    ];
  }

  dockerEvidenceSections(): EvidenceSection[] {
    return [
      { id: 'image', title: 'Image publiée', slots: ['PUBLISHED_IMAGE', 'IMAGE_DIGEST'] },
      { id: 'source', title: 'Source de l’image', slots: ['DOCKERFILE', 'GIT_COMMIT', 'JENKINS_BUILD'] },
      { id: 'registry', title: 'Registre et cible', slots: ['ACR_REGISTRY', 'AZURE_TARGET', 'AZURE_RESOURCE_GROUP'] },
    ];
  }

  sonarEvidenceSections(): EvidenceSection[] {
    return [
      { id: 'sonar', title: 'Analyse SonarQube', slots: ['SONAR_PROJECT'] },
      { id: 'origin', title: 'Build et commit analysés', slots: ['JENKINS_BUILD', 'GIT_COMMIT'] },
    ];
  }

  securityEvidenceSections(): EvidenceSection[] {
    return [
      { id: 'reports', title: 'Rapports de scanner', slots: ['TRIVY_REPORT', 'OWASP_REPORT', 'ZAP_REPORT'] },
      { id: 'dast', title: 'Cible analysée (DAST)', slots: ['ZAP_TARGET'] },
      { id: 'sast', title: 'Analyse statique', slots: ['SONAR_PROJECT'] },
      { id: 'origin', title: 'Build et commit analysés', slots: ['JENKINS_BUILD', 'GIT_COMMIT'] },
    ];
  }

  deploymentEvidenceSections(): EvidenceSection[] {
    return [
      { id: 'target', title: 'Cible de déploiement', slots: ['AZURE_TARGET', 'AZURE_RESOURCE_GROUP'] },
      { id: 'artifact', title: 'Artefact déployable', slots: ['PUBLISHED_IMAGE', 'IMAGE_DIGEST', 'ACR_REGISTRY'] },
      { id: 'provenance', title: 'Provenance', slots: ['GIT_COMMIT', 'JENKINS_BUILD'] },
    ];
  }

  reportEvidenceSections(): EvidenceSection[] {
    return this.reportEvidence?.sections || [];
  }

  /**
   * Identité factuelle de l'analyse dont on montre la provenance. Le build et
   * le commit sont nommés explicitement pour qu'il soit impossible de
   * confondre la provenance affichée avec celle d'une autre analyse de
   * l'historique.
   */
  reportProvenanceNote(): string {
    const build = this.reportEvidence?.buildNumber;
    const commit = this.reportEvidence?.commitSha;
    const parts: string[] = [];
    parts.push(build != null ? `Build #${build}` : 'Build non enregistré');
    parts.push(commit ? `commit ${commit.slice(0, 7)}` : 'commit source non enregistré');
    return parts.join(' — ');
  }

  /**
   * État à afficher pour un bloc qui lit la table FUSIONNÉE. Une panne est
   * signalée dès qu'une des deux lectures a échoué ; un chargement en cours
   * ne devient jamais « vide ».
   */
  evidenceState(): EvidenceLoadState {
    if (this.projectEvidenceState === 'error' || this.reportEvidenceState === 'error') return 'error';
    if (this.projectEvidenceState === 'loading' || this.reportEvidenceState === 'loading') return 'loading';
    return 'ready';
  }

  /** Relance les DEUX lectures de preuve après un échec. */
  retrySourceEvidence() {
    this.loadSourceEvidence();
    if (this.latestReport?.id) this.loadReportEvidence(this.latestReport.id);
    else this.reportEvidenceState = 'ready';
  }

  /** Preuve strictement de portée PROJET (jamais celle d'un build). */
  projectEvidenceSlot(slot: string): SourceEvidence | null {
    return this.projectEvidence?.slots?.[slot] || null;
  }

  /** Emplacements d'un constat Sonar précis — issue exacte, règle, fichier. */
  sonarIssueEvidence(finding: any): Record<string, SourceEvidence> | null {
    const id = String(finding?.id || finding?.key || '').trim();
    if (!id) return null;
    return this.reportEvidence?.sonarIssues?.find(i => i.issueId === id)?.slots || null;
  }

  /** Chaîne de preuve d'une correction automatique (constat → PR). */
  remediationEvidence(taskId: string | null | undefined) {
    const id = String(taskId || '').trim();
    if (!id) return null;
    return this.reportEvidence?.remediations?.find(r => r.taskId === id) || null;
  }

  // ── Image Docker du build (R49) ──────────────────────────────────────
  // Provenance d'image : repository / tag / digest / commit, servis par le
  // contrat de gouvernance deja en place. Le digest est l'identite IMMUABLE de
  // l'image, contrairement au tag : il est donc prefere pour la provenance, et
  // reste `null` tant que la provenance n'est pas verifiee -- jamais substitue
  // par le tag.
  imageProvenance: any = null;
  imageProvenanceLoading = false;
  loadImageProvenance() {
    if (this.imageProvenanceLoading) return;
    this.imageProvenanceLoading = true;
    delete this.dataErrors['imageProvenance'];
    this.api.getGovernancePreview(this.id).pipe(takeUntil(this.projectScopeReset$)).subscribe({
      next: (g: any) => {
        this.imageProvenanceLoading = false;
        // Garde de portee projet, comme pour le detail d'analyse : une reponse
        // qui ne porte pas CE projet n'est jamais affichee.
        this.imageProvenance = (g && (!g.projectId || g.projectId === this.id)) ? g : null;
      },
      error: () => {
        this.imageProvenanceLoading = false;
        this.imageProvenance = null;
        this.dataErrors['imageProvenance'] = 'Provenance de l’image indisponible.';
      },
    });
  }

  // ── Lectures Docker, toutes derivees de sources autoritaires ──
  dockerImageRef(): string | null { return dockerImageRef(this.ed?.docker); }
  dockerImageState(): string { return dockerImageState(this.ed?.docker); }
  dockerRepository(): string | null {
    // L'artefact verifie fait foi sur le repository ; a defaut, la reference
    // produite par le build. Jamais une construction a partir du nom du projet.
    return this.imageProvenance?.artifact?.repository || dockerImageParts(this.ed?.docker).repository;
  }
  dockerTag(): string | null {
    return this.imageProvenance?.artifact?.tag || dockerImageParts(this.ed?.docker).tag;
  }
  dockerDigest(): string | null {
    const d = this.imageProvenance?.artifact?.digest;
    return typeof d === 'string' && d.trim() ? d : null;
  }
  dockerRegistry(): string | null {
    const r = this.imageProvenance?.artifact?.registry || this.deploymentTarget?.registry;
    return typeof r === 'string' && r.trim() ? r : null;
  }
  dockerProvenanceVerified(): boolean | null {
    const v = this.imageProvenance?.artifact?.provenanceVerified;
    return typeof v === 'boolean' ? v : null;
  }
  dockerPushState(): string { return dockerPushState(this.ed?.docker); }
  dockerProvenanceState(): string { return dockerProvenanceState(this.ed?.docker); }
  /** Reference publiee telle que le registre l'a confirmee, jamais deduite. */
  dockerPublishedReference(): string | null {
    const r = String(this.ed?.docker?.published_reference ?? '').trim();
    return r ? r : null;
  }
  dockerBuildStatus(): string | null {
    const s = String(this.ed?.docker?.build_status ?? '').trim();
    return s ? s : null;
  }
  /** Commit source du build : la preuve d'identite, jamais devinee. */
  dockerCommitSha(): string | null {
    const fromReport = this.latestReport?.metadata?.sourceCommitSha;
    const fromIdentity = this.imageProvenance?.buildIdentity?.commitSha;
    for (const c of [fromReport, fromIdentity]) {
      if (typeof c === 'string' && /^[0-9a-f]{7,40}$/i.test(c.trim())) return c.trim();
    }
    return null;
  }
  /** Jenkins livre ce numero en nombre ou en chaine selon le type de job. */
  dockerBuildNumber(): number | null { return sourceInteger(this.ed?.build?.number ?? null); }
  // dockerJenkinsBuildUrl() a été retiré : la preuve Jenkins de la vue Docker
  // vient désormais de l'emplacement JENKINS_BUILD du contrat de preuve
  // (voir dockerEvidenceSections()). L'ancien helper publiait l'URL
  // enregistrée TELLE QUELLE, y compris l'IP d'hôte périmée qu'elle porte
  // souvent — un lien cliquable qui n'arrivait nulle part.
  /**
   * « Prete pour deploiement » n'est PAS « deployee ».
   * Une image prete a une identite verifiee et une cible configuree ; une image
   * deployee exige une tentative de deploiement reussie, que cette vue ne
   * constate pas. Elle ne l'affirme donc jamais.
   */
  dockerDeploymentRelation(): string {
    if (!this.deploymentConfigured) return 'Non configuré';
    return this.dockerProvenanceVerified() === true ? 'Image prête pour déploiement' : 'Identité d’image non vérifiée';
  }
  dockerPorts(): string | null {
    const ports = this.deploymentTarget?.ports;
    return Array.isArray(ports) && ports.length ? ports.map(String).join(', ') : null;
  }
  dockerHealthCheck(): string | null {
    const hc = this.deploymentTarget?.healthCheck;
    if (!hc || (!hc.path && !hc.port)) return null;
    return `${hc.port ? ':' + hc.port : ''}${hc.path || ''}` || null;
  }

  // ── Mesures Sonar courantes (R48) ────────────────────────────────────
  // L'instantane du build et l'etat courant de Sonar sont deux verites
  // differentes : un build de la semaine derniere n'est pas l'analyse de ce
  // matin. On ne les fusionne donc jamais -- l'ecran les presente cote a cote,
  // chacun date et etiquete. Le backend fournit deja available/reason, donc la
  // vue ne devine rien : elle affiche le motif qu'on lui donne.
  sonarLive: any = null;
  sonarLiveLoading = false;
  loadSonarMetrics() {
    if (this.sonarLiveLoading) return;
    this.sonarLiveLoading = true;
    delete this.dataErrors['sonarLive'];
    this.api.getSonarMetrics(this.id).pipe(takeUntil(this.projectScopeReset$)).subscribe({
      next: (m: any) => { this.sonarLiveLoading = false; this.sonarLive = m || null; },
      error: () => {
        this.sonarLiveLoading = false;
        this.sonarLive = null;
        this.dataErrors['sonarLive'] = 'Impossible de contacter SonarQube via le backend.';
      },
    });
  }
  /** Motif d'indisponibilite, tel que le backend le qualifie -- jamais devine. */
  sonarLiveState(): string {
    if (this.sonarLiveLoading) return 'Chargement…';
    if (this.dataErrors['sonarLive']) return 'Indisponible';
    if (!this.sonarLive) return 'Non disponible';
    if (this.sonarLive.available === true) return '';
    return ({
      SONAR_NOT_CONFIGURED: 'Non configuré',
      SONAR_TOKEN_UNAVAILABLE: 'Identifiant SonarQube non approvisionné',
      SONAR_PROJECT_NOT_FOUND: 'Projet inconnu de SonarQube',
      SONAR_API_ERROR: 'Erreur SonarQube',
    } as Record<string, string>)[String(this.sonarLive.reason || '')]
      || (String(this.sonarLive.reason || '').startsWith('SONAR_API_STATUS_')
            ? `SonarQube a répondu ${String(this.sonarLive.reason).replace('SONAR_API_STATUS_', 'HTTP ')}`
            : 'Non disponible');
  }
  /** Une mesure absente reste absente : aucune substitution par 0. */
  sonarLiveMetric(field: string): number | null {
    return this.sonarLive?.available === true ? availableNumber(this.sonarLive[field]) : null;
  }
  sonarLiveText(field: string): string | null {
    if (this.sonarLive?.available !== true) return null;
    const v = this.sonarLive[field];
    return typeof v === 'string' && v.trim() ? v : null;
  }

  loadManualRemediation(onLoaded?: () => void) {
    this.manualTasksLoading = true;
    delete this.dataErrors['tasks'];
    // includeV18=true: additive `v1_8Decision` field per task, read-only
    // display (cve-table.component.ts's own v1_8Presentation()) -- see
    // api.service.ts's own header comment on this parameter.
    this.api.getManualRemediationTasks(this.id, true).pipe(takeUntil(this.projectScopeReset$)).subscribe({
      next: tasks => { this.manualTasksLoading = false; this.manualTasks = tasks || []; this.syncBatchPolling(); onLoaded?.(); },
      error: () => {
        this.manualTasksLoading = false;
        // Pendant un polling actif, une erreur transitoire ne doit pas
        // effacer les tâches déjà connues -- sinon les badges "en cours"
        // disparaîtraient à tort. Seul le tout premier chargement part de [].
        if (!this.manualTasks.length) this.manualTasks = [];
        onLoaded?.();
        this.dataErrors['tasks'] = 'Impossible de charger les tâches de correction. Actualisez la page pour réessayer.';
      },
    });
    this.api.getManualRemediationSummary(this.id).pipe(takeUntil(this.projectScopeReset$)).subscribe({ next: summary => { this.manualSummary = summary; this.manualSummaryLoaded = true; }, error: () => { this.manualSummaryLoaded = false; this.dataErrors['summary'] = 'Impossible de charger le résumé des corrections.'; } });
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
    delete this.dataErrors['incidents'];
    this.api.getIncidents({ projectId: this.id, size: 20 }).pipe(takeUntil(this.projectScopeReset$)).subscribe({next: (r: any) => { this.incidents = r.content || r; }, error: () => { this.dataErrors['incidents'] = 'Impossible de charger les incidents du projet.'; }});
  }

  loadReports() {
    this.reportsLoading = true;
    this.incidentsLoading = true;
    this.reportDetails.clear();
    this.reportSelection++;
    delete this.dataErrors['decisions'];
    delete this.dataErrors['incidents'];
    this.api.getIncidentSummaries({ projectId: this.id, page: 1, pageSize: 20 })
      .pipe(takeUntil(this.projectScopeReset$)).subscribe({
        next: (r: any) => { this.incidentsLoading = false; this.incidents = r.items; },
        error: () => { this.incidentsLoading = false; this.dataErrors['incidents'] = 'Impossible de charger les incidents du projet.'; }
      });
    this.loadHistory(true);
  }

  loadHistory(reset = false) {
    if (this.historyLoading && !reset) return;
    this.historyLoading = true;
    delete this.dataErrors['decisions'];
    const page = reset ? 1 : this.historyPage + 1;
    this.api.getIncidentSummaries({ projectId: this.id, page, pageSize: 20, analysisOnly: true })
      .pipe(takeUntil(this.projectScopeReset$)).subscribe({
        next: (r: any) => {
          this.historyLoading = false;
          this.historyPage = r.page;
          this.historyHasNext = r.hasNext;
          this.allReportsTotal = r.total;
          this.allReports = reset ? r.items : [...this.allReports, ...r.items];
          if (reset) {
            this.reportsLoading = false;
            if (r.items.length) this.selectReport(r.items[0]);
          }
        },
        error: () => {
          this.historyLoading = false;
          this.reportsLoading = false;
          this.dataErrors['decisions'] = 'Impossible de charger les analyses du projet.';
        }
      });
  }

  // Dernier Report réel (colonnes judgeDecision/judgeConfidence) — sert le
  // badge Déploiement fail-closed ET (voir findMatchingReport) le score réel
  // du header, corrélé par build. N'affecte pas l'onglet Rapport IA en
  // lui-même (qui reste sur /incidents, allReports/rp inchangés).
  loadJudgeStatus() {
    delete this.dataErrors['reports'];
    this.api.getReportSummaries({ projectId: this.id, page: 1, pageSize: 100 }).pipe(takeUntil(this.projectScopeReset$)).subscribe({
      next: (result: any) => {
        this.allReportsRaw = result.items;
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
      error: () => { this.judge = { decision: null, confidence: null }; this.allReportsRaw = []; this.dataErrors['reports'] = 'Impossible de charger les rapports du projet.'; },
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
      const repBuildNum = rep?.buildNumber ?? rep?.rawData?.enrichedData?.build?.number;
      return repBuildNum !== null && repBuildNum !== undefined && Number(repBuildNum) === Number(buildNum);
    }) ?? null;
  }

  loadDeployReadiness() {
    this.deployReadyLoading = true;
    this.deployReadiness = null;
    this.deployReady = false;
    this.api.getDeployReadiness(this.id).pipe(takeUntil(this.projectScopeReset$)).subscribe({
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
    delete this.dataErrors['convergence'];
    this.convergenceLoading = true;
    this.api.getConvergence(this.id).pipe(takeUntil(this.projectScopeReset$)).subscribe({
      next: (r: any) => { this.convergenceCycles = Array.isArray(r?.cycles) ? r.cycles : []; this.convergenceLoading = false; },
      error: () => { this.convergenceCycles = []; this.dataErrors['convergence'] = 'Impossible de charger les cycles de validation.'; this.convergenceLoading = false; },
    });
  }

  stageCss(status: string): string {
    return ['PASSED', 'FAILED', 'WARNING', 'RUNNING', 'NOT_RUN', 'NOT_REACHED'].includes(status) ? status.toLowerCase() : 'not-run';
  }

  loadJenkinsBuilds() {
    this.jenkinsLoading = true;
    // Pas de garde côté front sur jenkinsJobName : le backend est la seule
    // source de vérité sur "configuré ou pas" (getJenkinsStatus), y compris
    // pour le message exact à afficher — jamais deviné côté client.
    this.api.getJenkins(this.id).pipe(takeUntil(this.projectScopeReset$)).subscribe({
      next: (d: any) => {
        this.jenkinsLoading = false;
        this.jenkinsBuilds = d?.builds || [];
        // Même source que le dashboard (getJenkinsStatus) — null si _liveData
        // est faux (non configuré/erreur/timeout — plus aucun mock possible),
        // jamais un chiffre inventé.
        this.jenkinsLive = d?._liveData === true;
        this.buildReliability = { rate: d?.buildSuccessRate ?? null, sampleSize: d?.sampleSize ?? 0 };
        this.jenkinsMessage = d?._liveData ? null : (d?.message || 'Données Jenkins indisponibles. Vérifiez sa configuration.');
      },
      error: () => { this.jenkinsLoading = false; this.jenkinsLive = false; this.buildReliability = null; this.jenkinsBuilds = []; this.jenkinsMessage = 'Impossible de contacter le backend'; }
    });
  }

  selectReport(r: any) {
    if (!r.summaryOnly) { this.applyReport(r); return; }
    const cached = this.reportDetails.get(r.id);
    const selection = ++this.reportSelection;
    if (cached) { this.reportsLoading = false; delete this.dataErrors['reportDetail']; this.applyReport(cached); return; }
    this.reportsLoading = true;
    this.latestReport = null;
    this.ed = {};
    this.rp = {};
    this.lastScore = null;
    this.scoreUnavailable = true;
    delete this.dataErrors['reportDetail'];
    this.api.getIncident(r.id).pipe(takeUntil(this.projectScopeReset$)).subscribe({
      next: (detail: any) => {
        if (selection !== this.reportSelection) return;
        this.reportsLoading = false;
        if (!detail || detail.projectId !== this.id || detail.id !== r.id) {
          this.dataErrors['reportDetail'] = 'Impossible de charger le détail de cette analyse.';
          return;
        }
        this.reportDetails.set(r.id, detail);
        this.applyReport(detail);
      },
      error: () => {
        if (selection !== this.reportSelection) return;
        this.reportsLoading = false;
        this.dataErrors['reportDetail'] = 'Impossible de charger le détail de cette analyse.';
      }
    });
  }

  private applyReport(r: any) {
    this.latestReport = r;
    this.loadReportEvidence(r?.id);
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
        const message = userHttpError(err, 'Impossible de déclencher le build. Vérifiez la connexion Jenkins puis réessayez.');
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
        confidence:       typeof json.confidenceScore === 'number' ? json.confidenceScore + '%' : null,
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
    if (!navigator.clipboard?.writeText) { this.toast.error('Copie indisponible', 'Utilisez un navigateur autorisant le presse-papiers.'); return; }
    navigator.clipboard.writeText(this.latestReport?.aiAnalysis || this.latestReport?.aiSummary || '').then(() => {
      this.toast.success('Copié', 'Rapport copié dans le presse-papiers');
    }).catch(() => this.toast.error('Copie impossible', 'Le navigateur a refusé l’accès au presse-papiers.'));
  }

  copyText(text: string) {
    if (!navigator.clipboard?.writeText) { this.toast.error('Copie indisponible', 'Utilisez un navigateur autorisant le presse-papiers.'); return; }
    navigator.clipboard.writeText(text || '').then(() => {
      this.toast.success('Copié', 'Commande copiée dans le presse-papiers');
    }).catch(() => this.toast.error('Copie impossible', 'Le navigateur a refusé l’accès au presse-papiers.'));
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
      security:    ['security risk agent:', 'security agent:', 'agent de sécurité', 'risque sécurité', 'risque de sécurité'],
      remediation: ['remediation', 'remédiation', 'correction']
    };
    const found = parts.find(p => keywords[kind].some(k => p.toLowerCase().includes(k)));
    if (found) return found;
    return ''; // An unmatched agent cannot inherit another agent's narrative.
  }

  getInfoRows() {
    if (!this.project) return [];
    return [
      { label: 'ID',             value: this.project.id },
      { label: 'Environnement',  value: this.project.environment || 'Non disponible' },
      { label: 'Créé le',        value: this.project.createdAt ? frenchDate(this.project.createdAt, false) : '—' },
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
    if (d === 'FIX_PROPOSED' || d === 'AUTO_FIX') return 'var(--accent-blue)';
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
    return l === 'LOW' ? 'var(--accent-green)' : 'var(--text-muted)';
  }

  getPriColor(p: string): string {
    if (p === 'HAUTE')   return 'var(--accent-red)';
    if (p === 'MOYENNE') return 'var(--accent-orange)';
    return 'var(--accent-blue)';
  }
}
