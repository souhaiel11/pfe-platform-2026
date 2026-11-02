// Affiche l’incident, sa correction et les preuves de validation.
import { Subject, takeUntil } from 'rxjs';
import { scannerMetric } from '../../shared/data-truth';
import { PresentationTextPipe } from '../../shared/presentation-label.pipe';
import { SourceEvidenceLinkComponent } from '../../shared/source-evidence/source-evidence-link.component';
import { SourceEvidenceListComponent } from '../../shared/source-evidence/source-evidence-list.component';
import { StatusChipComponent } from '../../shared/status-chip/status-chip.component';
import { ZoneLabelComponent } from '../../shared/zone-label/zone-label.component';
import { EvidenceSection, FindingEvidence, IncidentSourceEvidence, SourceEvidence, normalizeEvidenceView, EvidenceLoadState } from '../../shared/source-evidence/source-evidence.types';
import { presentationLabel, fixRequestStatusLabel } from '../../shared/status-labels';
import { sortPipelineStages } from '../../shared/pipeline-stage-presentation';
import { Component, OnInit, OnDestroy, OnChanges, SimpleChanges, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { ApiService } from '../../core/services/api.service';
import { ToastService } from '../../core/services/toast.service';
import { AuthService } from '../../core/services/auth.service';
import { DeveloperGuideTabComponent } from './developer-guide/developer-guide-tab.component';
import { DeveloperGuide } from './developer-guide/developer-guide.model';
import { classify, remediationModeForPhase } from './jenkins-known-fixes';
import { ProjectOverviewComponent } from '../projects/project-overview.component';
import { RemediationCardComponent, RemediationIssue, RemediationMode } from './remediation-card.component';
import { StageStatusLabelPipe } from '../../shared/stage-status-label.pipe';
import { evaluateProjectCleanliness, ProjectCleanliness } from './project-cleanliness';
import { diagnoseTrivy, diagnoseOwasp, diagnoseZap, diagnoseSonar, diagnoseTests, diagnoseDocker, IncidentContext } from './phase-diagnostics';
import { PresentationLabelPipe } from '../../shared/presentation-label.pipe';
import { FrenchDatePipe } from '../../shared/french-date.pipe';
import { userHttpError } from '../../core/http-error-message';

/**
 * Page détail d'un incident : analyse IA, guide de correction, timeline de
 * cycle de vie, validation post-PR (WF3) et actions gouvernées (approuver,
 * refuser, demander/relancer la validation, annuler).
 */
@Component({
  selector: 'app-incident-detail',
  standalone: true,
  imports: [PresentationTextPipe, CommonModule, RouterModule, DeveloperGuideTabComponent, ProjectOverviewComponent, RemediationCardComponent, StageStatusLabelPipe, PresentationLabelPipe, FrenchDatePipe, SourceEvidenceLinkComponent, SourceEvidenceListComponent, StatusChipComponent, ZoneLabelComponent],
  templateUrl: './incident-detail.component.html',
  styleUrls: ['./incident-detail.component.scss'],
})
export class IncidentDetailComponent implements OnInit, OnDestroy, OnChanges {
  scannerMetric = scannerMetric;
  private readonly incidentScopeReset$ = new Subject<void>();
  @Input() id!: string;

  incident:    any  = null;
  reports:     any[] = [];
  aiAnalysis:  any  = null;
  developerGuide: DeveloperGuide | null = null;
  enrichedData: any = null;
  validation:  any  = null;
  classification: { type: 'jenkinsfile' | 'dockerfile' | 'vulnerability' | 'infra' | 'code' | 'unknown'; solution: string | null } =
    { type: 'unknown', solution: null };
  generatingWF4Fix = false;
  generatingWF5Fix = false;
  approvalBusy = false;
  prValidationBusy = false;
  prValidationRequest: any = null;
  prValidationTargetStale = false;
  refreshValidationTargetBusy = false;
  approvalError: string | null = null;
  decision:    any  = null;
  loadError = '';
  loading      = true;
  activeTab    = 'analysis';

  prGenerationState: 'idle' | 'polling' | 'timeout' = 'idle';
  private pollHandle: ReturnType<typeof setInterval> | null = null;
  private pollAttempts = 0;
  private readonly POLL_INTERVAL_MS = 4000;
  private readonly POLL_MAX_ATTEMPTS = 22;
  private readonly TERMINAL_FIX_STATUSES = ['CANCELLED', 'PR_CREATED', 'FIX_FAILED', 'REJECTED', 'VALIDATING', 'VALIDATED', 'COMPLETED'];
  readonly STALE_DISPATCH_THRESHOLD_MS = 30 * 60 * 1000;
  reconcileBusy = false;
  reconcileError: string | null = null;

  sourceEvidence: IncidentSourceEvidence | null = null;
  sourceEvidenceState: EvidenceLoadState = 'loading';

  tabs: any[] = [];

  /** Reconstruit la liste des onglets (avec leurs pastilles d'état) à partir des données chargées. */
  private updateTabs() {
    this.tabs = [
      { id: 'analysis',   label: 'Analyse IA', dot: null },
      { id: 'guide', label: 'Guide correction', dot: this.developerGuide?.issues?.length ? '#3b82f6' : null },
      { id: 'validation', label: 'Validation PR',
        dot: this.validation?.mergeAuthorization?.authorization === 'MERGE_READY' ? '#22c55e'
          : this.validation?.mergeAuthorization?.authorization === 'BLOCKED' ? '#e24b4a'
            : this.validation?.mergeAuthorization?.authorization === 'INCONCLUSIVE' ? '#f59e0b'
              : this.validation?.mergeAuthorization?.authorization === 'VALIDATING' ? '#3b82f6' : null },
      { id: 'raw',        label: 'Données brutes', dot: null },
    ];
  }

  lifecycleSteps: any[] = [];

  /** Reconstruit la timeline du cycle de vie (détecté → analysé → corrigé → validé → résolu) à partir du statut de l'incident. */
  private updateLifecycle() {
    const s = this.incident?.status || '';
    const ORDER = ['pending','analyzing','analyzed','fix_generated','validating','approved','completed'];

    const TERMINAL_AFTER_ANALYSIS = ['blocked', 'rejected', 'failed'];
    const isTerminal = TERMINAL_AFTER_ANALYSIS.includes(s);

    const idx = isTerminal ? 2 : ORDER.indexOf(s);

    this.lifecycleSteps = [
      { label: 'Détecté',  sub: 'Détection automatique · WF1', done: idx >= 0, active: idx === 0 },
      { label: 'Analysé',  sub: 'Analyse IA · WF1',            done: idx >= 2, active: idx === 1 || idx === 2 },
      {
        label: isTerminal ? 'Bloqué' : 'Correction proposée',
        sub: isTerminal ? 'Décision de gouvernance' : 'Proposition IA · WF2',
        done: isTerminal ? false : idx >= 3,
        active: isTerminal ? true : idx === 3,
        terminal: isTerminal,
      },
      { label: 'Validé',  sub: 'Validation déterministe · WF3', done: !isTerminal && idx >= 5, active: !isTerminal && (idx === 4 || idx === 5) },
      { label: 'Résolu',  sub: 'Correction fusionnée',          done: !isTerminal && idx >= 6, active: !isTerminal && idx === 6 },
    ];
  }

  private requestedTab: string | null = null;

  /** Initialise les dépendances et l’état de ce composant. */
  constructor(
    private api: ApiService,
    private toast: ToastService,
    private route: ActivatedRoute,
    private router: Router,
    public auth: AuthService,
  ) {}

  /** Vrai si l'utilisateur connecté peut agir sur cet incident (étiquette informative, l'autorisation réelle reste côté backend). */
  get canOperate(): boolean {
    return ['admin', 'developer'].includes(String(this.auth.currentUser?.role || '').toLowerCase());
  }

  /** Revient à la page du projet de cet incident. */
  goBack(): void {
    const projectId = this.incident?.projectId;
    this.router.navigate(projectId ? ['/projects', projectId] : ['/projects']);
  }

  /** Renvoie les étapes de pipeline gouvernées (enrichedData.stages), triées pour affichage. */
  governedStages(): any[] {
    const stages = this.enrichedData?.stages;
    return stages && typeof stages === 'object' ? sortPipelineStages(Object.values(stages) as any[]) : [];
  }

  /** Mode de correction pour la carte Jenkins, selon la classification réelle de l'erreur de build. */
  jenkinsRemediationMode(): RemediationMode {
    const t = this.classification.type;
    return t === 'jenkinsfile' || t === 'dockerfile' ? 'auto-fix-bulk' : 'signal-only';
  }
  /** Liste (à un seul élément) représentant l'erreur de build Jenkins pour la carte générique d'issues. */
  jenkinsIssues(): RemediationIssue[] {
    if (!this.incident?.errorReason) return [];
    return [{ id: 'build-error', title: this.incident.errorStep || '', detail: this.incident.errorReason }];
  }
  /** Libellé du bouton de correction Jenkins selon le type de fichier en cause. */
  jenkinsActionLabel(): string {
    return this.classification.type === 'dockerfile' ? 'Générer la correction via WF5' : 'Générer la correction via WF4';
  }
  /** Vrai si une génération de correction Jenkins/Dockerfile est en cours. */
  jenkinsCorrecting(): boolean {
    return this.classification.type === 'dockerfile' ? this.generatingWF5Fix : this.generatingWF4Fix;
  }
  /** Déclenche la bonne correction (WF4 Jenkinsfile ou WF5 Dockerfile) selon le type détecté. */
  onJenkinsCorrect(): void {
    if (this.classification.type === 'dockerfile') this.generateWF5Fix();
    else this.generateWF4Fix();
  }

  /** Construit le texte d'instruction humaine pour une CVE (mise à jour vers la version corrigée, ou vérification manuelle si inconnue). */
  private cveInstruction(cve: any): string {
    const pkg = cve?.pkg || 'paquet non identifié par le scan';
    const id = cve?.id || 'CVE non identifiée';
    if (cve?.fixedVersion) {
      const from = cve.installedVersion || 'version installée non fournie par le scan';
      return `Mettre à jour ${pkg} de ${from} vers ${cve.fixedVersion} (corrige ${id}).`;
    }
    return `${id} sur ${pkg} : aucune version corrigée indiquée par le scan — vérifier manuellement l'existence d'un correctif, ou évaluer un contournement.`;
  }
  /** Construit le texte de détail d'une CVE (titre, score CVSS, lien) pour affichage. */
  private cveDetail(cve: any): string {
    const parts: string[] = [];
    if (cve?.title) parts.push(cve.title);
    if (cve?.cvss != null) parts.push(`CVSS ${cve.cvss}`);
    if (cve?.primaryUrl) parts.push(cve.primaryUrl);
    return parts.length ? parts.join(' — ') : 'Aucun détail supplémentaire fourni par le scan.';
  }
  private static readonly SEV_RANK: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
  /** Trie une liste de CVE par sévérité décroissante, puis par score CVSS décroissant. */
  private sortBySeverity(cves: any[]): any[] {
    return [...cves].sort((a, b) => {
      const ra = IncidentDetailComponent.SEV_RANK[String(a?.severity).toUpperCase()] ?? 9;
      const rb = IncidentDetailComponent.SEV_RANK[String(b?.severity).toUpperCase()] ?? 9;
      return ra !== rb ? ra - rb : (b?.cvss || 0) - (a?.cvss || 0);
    });
  }
  /** Convertit une CVE brute en item de correction affichable (RemediationIssue). */
  private cveToIssue(cve: any): RemediationIssue {
    return {
      id: `${cve?.id || 'cve'}-${cve?.pkg || ''}`,
      title: this.cveInstruction(cve),
      detail: this.cveDetail(cve),
      severity: cve?.severity,
    };
  }
  /** Repli honnête quand seuls des compteurs agrégés sont disponibles (pas de détail CVE par CVE). */
  private aggregateFallback(t: any, phaseLabel: string): RemediationIssue[] {
    const total = (t?.critical || 0) + (t?.high || 0);
    if (!total) return [];
    const count = t.cves_count || total;
    return [{ id: `${phaseLabel}-summary`, title: `${count} ${count === 1 ? 'CVE détectée' : 'CVE détectées'} par ${phaseLabel}, détail indisponible dans cette analyse`, detail: null }];
  }

  /** Mode de correction pour la carte Trivy (toujours signalement, jamais auto-fix). */
  trivyMode(): RemediationMode { return remediationModeForPhase('trivy'); }
  /** Liste des CVE Trivy, triées par sévérité, converties en issues affichables. */
  trivyIssues(): RemediationIssue[] {
    const t = this.enrichedData?.trivy;
    if (!t || t.status !== 'COMPLETED') return [];
    const cves = Array.isArray(t.cves) ? t.cves : [];
    if (cves.length) return this.sortBySeverity(cves).map((c: any) => this.cveToIssue(c));
    return this.aggregateFallback(t, 'Trivy');
  }

  /** Mode de correction pour la carte OWASP Dependency-Check (toujours signalement). */
  owaspMode(): RemediationMode { return remediationModeForPhase('owasp'); }
  /** Liste des CVE OWASP, triées par sévérité, converties en issues affichables. */
  owaspIssues(): RemediationIssue[] {
    const o = this.enrichedData?.owasp;
    if (!o || o.status !== 'COMPLETED') return [];
    const cves = Array.isArray(o.cves) ? o.cves : [];
    if (cves.length) return this.sortBySeverity(cves).map((c: any) => this.cveToIssue(c));
    return this.aggregateFallback(o, 'OWASP');
  }

  /** Mode de correction pour la carte ZAP (toujours signalement). */
  zapMode(): RemediationMode { return remediationModeForPhase('zap'); }
  /** Liste des alertes ZAP converties en issues affichables, avec repli honnête sur les champs manquants. */
  zapIssues(): RemediationIssue[] {
    const alerts = this.enrichedData?.zap?.alerts;
    if (!Array.isArray(alerts) || !alerts.length) return [];
    return alerts.map((a: any, idx: number) => {
      const name = a?.alert || a?.name || a?.title || null;
      const where = a?.url || a?.instances?.[0]?.uri || a?.target_url || null;
      const risk = a?.risk || a?.riskdesc || a?.severity || null;
      const desc = a?.desc || a?.description || null;
      const solution = a?.solution || null;
      const title = name
        ? `${name}${where ? ' — ' + where : ''}`
        : `Alerte ZAP #${idx + 1} — nom non fourni par le scan`;
      const detailParts: string[] = [];
      if (desc) detailParts.push(desc);
      if (solution) detailParts.push(`Solution suggérée : ${solution}`);
      if (!detailParts.length) detailParts.push('Aucun détail fourni par le scan pour cette alerte.');
      return {
        id: a?.pluginid ? `zap-${a.pluginid}-${idx}` : `zap-${idx}`,
        title,
        detail: detailParts.join(' '),
        severity: risk,
      };
    });
  }

  /** Évalue si le projet est "propre" (déploiement non verrouillé), fail-closed si aucune donnée n'est disponible. */
  cleanliness(): ProjectCleanliness {
    if (!this.enrichedData) {
      return {
        clean: false,
        blockingPhases: [{ phase: 'État du projet', raison: "Aucune donnée d'analyse disponible pour cet incident — verrouillé par défaut.", type: 'humain' }],
        nonExecutedPhases: [],
        nonBlockingFindings: [],
      };
    }
    return evaluateProjectCleanliness(this.enrichedData);
  }

  /** Construit le contexte (errorReason/errorStep) transmis aux fonctions de diagnostic de phase. */
  private diagnosticContext(): IncidentContext {
    return { errorReason: this.incident?.errorReason || null, errorStep: this.incident?.errorStep || null };
  }

  /** Construit la liste des lignes "ce qui bloque / qui doit agir" à partir des phases bloquantes et des CVE critiques. */
  deploymentLines(): { actor: 'Agent' | 'Vous'; phase: string; text: string }[] {
    const c = this.cleanliness();
    const ctx = this.diagnosticContext();
    const lines: { actor: 'Agent' | 'Vous'; phase: string; text: string }[] = [];
    /** Ajoute un message à la liste des diagnostics. */
    const pushDiag = (diag: { actor: string | null; message: string; phase: string }) => {
      lines.push({ actor: diag.actor === 'agent' ? 'Agent' : 'Vous', phase: diag.phase, text: diag.message });
    };
    for (const bp of c.blockingPhases) {
      if (bp.phase === 'Vulnérabilités conteneur (Trivy)') {
        const criticals = (this.enrichedData?.trivy?.cves || []).filter((cv: any) => String(cv?.severity).toUpperCase() === 'CRITICAL');
        if (criticals.length) {
          for (const cv of criticals) lines.push({ actor: 'Vous', phase: 'Trivy', text: this.cveInstruction(cv) });
        } else {
          pushDiag(diagnoseTrivy(this.enrichedData, ctx));
        }
        continue;
      }
      if (bp.phase === 'Vulnérabilités dépendances (OWASP)') {
        const criticals = (this.enrichedData?.owasp?.cves || []).filter((cv: any) => String(cv?.severity).toUpperCase() === 'CRITICAL');
        if (criticals.length) {
          for (const cv of criticals) lines.push({ actor: 'Vous', phase: 'OWASP', text: this.cveInstruction(cv) });
        } else {
          pushDiag(diagnoseOwasp(this.enrichedData, ctx));
        }
        continue;
      }
      if (bp.phase === 'DAST (ZAP)') { pushDiag(diagnoseZap(this.enrichedData, ctx)); continue; }
      if (bp.phase === 'SonarQube') { pushDiag(diagnoseSonar(this.enrichedData, ctx)); continue; }
      if (bp.phase === 'Docker') { pushDiag(diagnoseDocker(this.enrichedData)); continue; }
      if (bp.phase === 'Tests') { pushDiag(diagnoseTests(this.enrichedData, ctx)); continue; }
      if (bp.phase === 'Jenkinsfile') {
        lines.push({ actor: 'Agent', phase: bp.phase, text: `${bp.raison} → lancer la correction via WF4 (carte "⬡ Build Jenkins" ci-dessus)` });
        continue;
      }
      lines.push({ actor: bp.type === 'agent' ? 'Agent' : 'Vous', phase: bp.phase, text: bp.raison });
    }
    return lines;
  }

  /** Résumé discret des points signalés mais non bloquants. */
  nonBlockingSummary(): string {
    const c = this.cleanliness();
    const parts = [...c.nonExecutedPhases, ...c.nonBlockingFindings].map(p => p.raison);
    return parts.join(' · ');
  }

  /** Calcule la progression (phases résolues / total) pour la barre de progression du verrou de déploiement. */
  progress(): { resolved: number; total: number; percent: number } {
    const c = this.cleanliness();
    const total = Math.max(7 - c.nonExecutedPhases.length, 0);
    const resolved = Math.max(total - c.blockingPhases.length, 0);
    return { resolved, total, percent: total > 0 ? Math.round((resolved / total) * 100) : 100 };
  }

  /** Renvoie le meilleur rang (position) parmi les phases nommées dans la liste des phases bloquantes. */
  private phaseRank(...names: string[]): number {
    const order = this.cleanliness().blockingPhases.map(p => p.phase);
    const idxs = names.map(n => order.indexOf(n)).filter(i => i !== -1);
    return idxs.length ? Math.min(...idxs) : 999;
  }
  /** Rang de priorité de la carte Jenkins/Docker/Tests (la meilleure des trois phases qu'elle représente). */
  jenkinsRank(): number { return this.phaseRank('Jenkinsfile', 'Docker', 'Tests'); }
  /** Rang de priorité de la carte Trivy. */
  trivyRank():   number { return this.phaseRank('Vulnérabilités conteneur (Trivy)'); }
  /** Rang de priorité de la carte OWASP. */
  owaspRank():   number { return this.phaseRank('Vulnérabilités dépendances (OWASP)'); }
  /** Rang de priorité de la carte ZAP. */
  zapRank():     number { return this.phaseRank('DAST (ZAP)'); }
  /** Rang de priorité de la carte SonarQube. */
  sonarRank():   number { return this.phaseRank('SonarQube'); }

  /** Renvoie le meilleur rang parmi toutes les cartes de phase. */
  private topRank(): number {
    const real = [this.jenkinsRank(), this.trivyRank(), this.owaspRank(), this.zapRank(), this.sonarRank()].filter(r => r < 999);
    return real.length ? Math.min(...real) : 999;
  }
  /** Vrai s'il existe au moins une phase bloquante à prioriser. */
  hasPriorityPhase(): boolean { return this.topRank() < 999; }
  /** Vrai si le rang donné est le rang prioritaire courant. */
  isPriority(rank: number): boolean { return this.hasPriorityPhase() && rank === this.topRank(); }
  /** Calcule l'ordre d'affichage CSS d'une carte selon sa priorité. */
  slotOrder(rank: number): number { return this.isPriority(rank) ? 0 : 2 + Math.min(rank, 900); }

  /** Vrai s'il existe des cartes visibles autres que la carte prioritaire (section "Ensuite"). */
  hasLaterCards(): boolean {
    if (!this.hasPriorityPhase()) return false;
    const cards: { visible: boolean; rank: number }[] = [
      { visible: this.incident?.source === 'jenkins', rank: this.jenkinsRank() },
      { visible: this.trivyIssues().length > 0, rank: this.trivyRank() },
      { visible: this.owaspIssues().length > 0, rank: this.owaspRank() },
      { visible: this.zapIssues().length > 0, rank: this.zapRank() },
      { visible: this.sonarIssues().length > 0, rank: this.sonarRank() },
    ];
    return cards.some(c => c.visible && !this.isPriority(c.rank));
  }

  /** Mode de correction de la carte SonarQube : sélective si au moins une issue est auto-corrigeable. */
  sonarMode(): RemediationMode {
    return this.sonarIssues().some(i => i.remediationType === 'AUTO_FIX_ELIGIBLE') ? 'auto-fix-selective' : 'signal-only';
  }
  /** Convertit les findings SonarQube bruts en issues affichables pour la carte de correction. */
  sonarIssues(): RemediationIssue[] {
    const issues = this.enrichedData?.sonar?.issues || [];
    return issues.map((i: any) => ({
      id: i.id || i.key,
      title: i.message,
      detail: i.component ? `${i.component}${i.line ? ':' + i.line : ''}` : null,
      severity: i.severity,
      stage: i.stage || 'sonar', source: i.source || 'SONARQUBE', blocking: i.blocking,
      rootCause: i.rootCause || null, impact: i.impact || null,
      file: i.file || (i.component?.includes(':') ? i.component.split(':').slice(1).join(':') : i.component),
      line: i.line || null, recommendation: i.recommendation || null,
      remediationType: i.remediationType || 'DEVELOPER_ACTION_REQUIRED',
    }));
  }
  /** Vrai si une correction Sonar est en cours (approbation ou génération de PR). */
  sonarCorrecting(): boolean { return this.approvalBusy || this.prGenerationState === 'polling'; }
  /** Demande confirmation puis lance la correction des findings Sonar sélectionnés. */
  onSonarCorrect(selected?: Set<string>): void {
    const findingIds = selected ? [...selected] : [];
    if (this.sonarSelectionLocked()) return;
    if (!findingIds.length || !globalThis.confirm(`Confirmer une demande unique pour ${findingIds.length} ${findingIds.length === 1 ? 'problème SonarQube sélectionné' : 'problèmes SonarQube sélectionnés'} ?`)) return;
    this.approveFix(findingIds);
  }

  /** Vrai si au moins un finding (toute phase) est marqué auto-corrigeable. */
  hasAutoFixEligible(): boolean {
    const stages = this.enrichedData?.stages || {};
    return Object.values(stages).some((s: any) => (s?.findings || []).some((f: any) => f.remediationType === 'AUTO_FIX_ELIGIBLE'))
      || this.sonarIssues().some(i => i.remediationType === 'AUTO_FIX_ELIGIBLE');
  }

  private readonly overviewTabMap: Record<string, string> = {
    jenkins: 'jenkins', sonar: 'sonarqube', security: 'securite',
  };
  /** Navigue vers l'onglet projet correspondant à la phase cliquée dans le rail d'étapes gouvernées. */
  onGoToTab(event: string): void {
    if (event === 'guide') { this.activeTab = 'guide'; return; }
    const projectId = this.incident?.projectId;
    if (!projectId) return;
    const [key] = event.split(':');
    const tab = this.overviewTabMap[key];
    if (!tab) return;
    this.router.navigate(['/projects', projectId], { queryParams: { tab } });
  }

  /** Applique l'onglet demandé via l'URL (?tab=...) le cas échéant, puis charge l'incident. */
  ngOnInit() {
    const tabParam = this.route.snapshot.queryParamMap.get('tab');
    const validTabs = ['analysis', 'guide', 'validation', 'raw'];
    if (tabParam && validTabs.includes(tabParam)) {
      this.requestedTab = tabParam;
      this.activeTab = tabParam;
    }
    this.load();
  }

  /** Réinitialise tout l'état local et recharge quand l'id d'incident change (navigation entre deux incidents). */
  ngOnChanges(changes: SimpleChanges) {
    if (!changes['id'] || changes['id'].firstChange) return;
    this.incidentScopeReset$.next();
    this.stopPrPolling();
    this.incident = null;
    this.reports = [];
    this.aiAnalysis = null;
    this.developerGuide = null;
    this.enrichedData = null;
    this.validation = null;
    this.decision = null;
    this.sourceEvidence = null;
    this.sourceEvidenceState = 'loading';
    this.tabs = [];
    this.prValidationRequest = null;
    this.prGenerationState = 'idle';
    this.approvalError = null;
    this.reconcileError = null;
    this.activeTab = 'analysis';
    this.load();
  }

  /** Charge la table de preuve de provenance de l'incident. */
  loadSourceEvidence() {
    this.sourceEvidenceState = 'loading';
    this.api.getIncidentSourceEvidence(this.id).pipe(takeUntil(this.incidentScopeReset$)).subscribe({
      /** Traite le résultat reçu et actualise les données locales. */
      next: view => {
        this.sourceEvidenceState = 'ready';
        this.sourceEvidence = view?.incidentId === this.id
          ? normalizeEvidenceView(view)
          : null;
      },
      /** Traite l’erreur reçue et termine le suivi de la demande. */
      error: () => { this.sourceEvidence = null; this.sourceEvidenceState = 'error'; },
    });
  }

  /** Renvoie la preuve de provenance d'un emplacement donné. */
  evidence(slot: string): SourceEvidence | null {
    return this.sourceEvidence?.slots?.[slot] || null;
  }

  /** Renvoie la table complète des emplacements de preuve. */
  evidenceSlots(): Record<string, SourceEvidence> | null {
    return this.sourceEvidence?.slots || null;
  }

  /** Sections de provenance servies par le backend, dans son ordre. */
  evidenceSections(): EvidenceSection[] {
    return this.sourceEvidence?.sections || [];
  }

  /** Sections restreintes à la validation post-PR, pour l'onglet Validation. */
  validationEvidenceSections(): EvidenceSection[] {
    return this.evidenceSections().filter(section => section.id === 'validation' || section.id === 'fix');
  }

  /** Renvoie les preuves de provenance par finding. */
  findingEvidence(): FindingEvidence[] | null {
    return this.sourceEvidence?.findings || null;
  }

  /** Chaîne de preuve d'une correction automatique (constat → PR) pour un taskId donné. */
  remediationEvidence(taskId: string | null | undefined) {
    const id = String(taskId || '').trim();
    if (!id) return null;
    return this.sourceEvidence?.remediations?.find(r => r.taskId === id) || null;
  }

  /** Identité factuelle (build/commit) affichée pour la provenance. */
  provenanceNote(): string {
    const build = this.sourceEvidence?.buildNumber;
    const commit = this.sourceEvidence?.commitSha;
    return [
      build != null ? `Build #${build}` : 'Build non enregistré',
      commit ? `commit ${commit.slice(0, 7)}` : 'commit source non enregistré',
    ].join(' — ');
  }

  /** Charge l'incident complet (analyse IA, validation, preuves) et reconstruit timeline/onglets. */
  load() {
    this.loadError = '';
    this.loading = true;
    this.loadSourceEvidence();
    this.api.getIncident(this.id).pipe(takeUntil(this.incidentScopeReset$)).subscribe({
      /** Traite le résultat reçu et actualise les données locales. */
      next: (inc: any) => {
        this.incident     = inc;
        const meta = inc.metadata || {};
        this.reports = [
          meta.rootCause && Object.keys(meta.rootCause).length > 0
            ? { agentType: 'ROOT_CAUSE', analysis: meta.rootCause.rootCause || meta.rootCause.analysisSummary || '', confidence: meta.rootCause.confidence ?? null }
            : null,
          meta.security && Object.keys(meta.security).length > 0
            ? { agentType: 'SECURITY', analysis: meta.security.securitySummary || '', confidence: meta.security.confidence ?? null }
            : null,
          meta.remediation && Object.keys(meta.remediation).length > 0
            ? { agentType: 'REMEDIATION', analysis: meta.remediation.fixDescription || (meta.remediation.fixSteps || []).join('\n') || '', confidence: meta.remediation.confidence ?? null }
            : null,
        ].filter(r => r !== null);
        this.decision     = inc.decision || null;
        if (inc.aiAnalysis && typeof inc.aiAnalysis === 'string') {
          try {
            this.aiAnalysis = JSON.parse(inc.aiAnalysis);
          } catch (e) {
            this.aiAnalysis = { justification: inc.aiAnalysis };
          }
        } else {
          this.aiAnalysis = inc.aiAnalysis || null;
        }
        this.developerGuide = this.aiAnalysis?.developerGuide ?? null;
        this.enrichedData = inc.metadata?.enrichedData || null;
        this.validation   = inc.metadata?.validation || null;
        this.prValidationRequest = inc.metadata?.prValidationRequest || null;
        this.classification = inc.source === 'jenkins'
          ? classify(inc.errorReason)
          : { type: 'unknown', solution: null };
        this.updateLifecycle();
        this.updateTabs();
        this.loading = false;
        if (!this.requestedTab && this.validation) this.activeTab = 'validation';
        this.restoreInProgressStateFromServer();
      },
      /** Traite l’erreur reçue et termine le suivi de la demande. */
      error: () => { this.loadError = 'Impossible de charger cet incident. Vérifiez son existence puis réessayez.'; this.toast.error('Erreur', this.loadError); this.loading = false; }
    });
  }

  /** Relance le polling de génération de PR si le backend indique encore un cycle en cours après un rechargement de page. */
  private restoreInProgressStateFromServer(): void {
    if (this.incident?.prUrl && this.fixRequestStatus() !== 'CANCEL_REQUESTED') { this.prGenerationState = 'idle'; return; }
    if (this.isFixInProgress() || this.fixRequestStatus() === 'CANCEL_REQUESTED') {
      if (this.prGenerationState !== 'polling') this.startPrPolling();
      return;
    }
    this.stopPrPolling();
    this.prGenerationState = 'idle';
  }

  /** Approuve la correction (globale ou sur les findings sélectionnés), ou relance une tentative annulée compatible. */
  approveFix(findingIds?: string[] | string) {
    if (this.approvalBusy) return;
    this.approvalBusy = true;
    this.approvalError = null;
    const fix = this.fixRequest();
    const requestedIds = Array.isArray(findingIds) ? findingIds
      : typeof findingIds === 'string' ? [findingIds] : fix?.findingIds;
    const sameSelection = Array.isArray(requestedIds) && Array.isArray(fix?.findingIds)
      && JSON.stringify([...requestedIds].sort()) === JSON.stringify([...fix.findingIds].sort());
    const request = fix?.status === 'CANCELLED' && fix.retryEligible === true && sameSelection
      ? this.api.retryFixBatch(this.id)
      : Array.isArray(findingIds)
      ? this.api.approveFixBatch(this.id, findingIds)
      : this.api.approveFix(this.id, findingIds);
    request.subscribe({
      /** Traite le résultat reçu et actualise les données locales. */
      next: (result: any) => {
        this.approvalBusy = false;
        this.toast.success(result?.duplicate ? 'Cette demande de correction existe déjà.' : 'Demande de correction enregistrée.');
        this.load();
        this.startPrPolling();
      },
      /** Traite l’erreur reçue et termine le suivi de la demande. */
      error: (err: any) => {
        this.approvalBusy = false;
        this.approvalError = userHttpError(err, 'Impossible de démarrer la correction. Actualisez les données puis réessayez.');
        this.toast.error('Erreur', this.approvalError || 'Impossible de démarrer la correction');
      }
    });
  }

  /** Refuse la correction proposée (l'action manuelle reste à faire). */
  rejectFix() {
    if (this.approvalBusy) return;
    this.approvalBusy = true;
    this.api.rejectFix(this.id).subscribe({
      /** Traite le résultat reçu et actualise les données locales. */
      next: () => { this.approvalBusy = false; this.toast.success('Correction refusée — action manuelle conservée'); this.load(); },
      /** Traite l’erreur reçue et termine le suivi de la demande. */
      error: (err: any) => { this.approvalBusy = false; this.approvalError = userHttpError(err, 'Impossible de refuser la correction. Réessayez.'); this.toast.error('Erreur', this.approvalError || 'Impossible de rejeter'); }
    });
  }

  /** Vrai si une demande de validation de la Pull Request peut être soumise maintenant. */
  canRequestPrValidation(): boolean {
    const fix = this.incident?.metadata?.fixRequest;
    const state = this.prValidationRequest?.status;
    return fix?.status === 'PR_CREATED' && !!this.incident?.prUrl && (!state || state === 'FAILED');
  }

  correctiveBusy = false;
  /** Vrai si une correction supplémentaire (corrective, sur la même PR) est actuellement en cours. */
  isCorrectiveInFlight(): boolean {
    const fix = this.incident?.metadata?.fixRequest;
    if (!fix || !['FIX_STARTING', 'DISPATCHED'].includes(fix.status)) return false;
    const attempts = Array.isArray(fix.attempts) ? fix.attempts : [];
    const last = attempts[attempts.length - 1];
    return !!last?.corrective;
  }
  /** Vrai si le backend autorise une correction corrective (PR bloquée avec cause exploitable). */
  canCorrectAndRevalidate(): boolean {
    const ma = this.mergeAuthorization();
    const state = this.prValidationRequest?.status;
    if (state === 'REQUESTED' || state === 'QUEUED' || state === 'RUNNING') return false;
    return ma?.authorization === 'BLOCKED' && ma?.correctiveActionAllowed === true;
  }
  /** Demande confirmation puis lance une nouvelle tentative de correction sur la Pull Request existante. */
  correctAndRevalidate(): void {
    if (this.correctiveBusy || !this.canCorrectAndRevalidate()) return;
    if (!globalThis.confirm(
      'Une nouvelle tentative de correction sera appliquée sur la même Pull Request.\n'
      + 'La Pull Request existante ne sera pas fusionnée automatiquement.',
    )) return;
    this.correctiveBusy = true;
    this.api.correctAndRevalidate(this.id).subscribe({
      /** Traite le résultat reçu et actualise les données locales. */
      next: (result: any) => {
        this.correctiveBusy = false;
        this.toast.success(result?.duplicate ? 'Cette correction est déjà en cours.' : 'Correction supplémentaire en cours.');
        this.load();
      },
      /** Traite l’erreur reçue et termine le suivi de la demande. */
      error: (err: any) => {
        this.correctiveBusy = false;
        this.toast.error('Correction refusée', userHttpError(err, 'La correction n’a pas pu être autorisée.'));
        this.load();
      },
    });
  }

  /** Demande la validation (WF3) de la Pull Request en cours. */
  requestPrValidation(): void {
    if (this.prValidationBusy || !this.canRequestPrValidation()) return;
    this.prValidationBusy = true;
    this.prValidationTargetStale = false;
    this.api.requestPrValidation(this.id).subscribe({
      /** Traite le résultat reçu et actualise les données locales. */
      next: (result: any) => {
        this.prValidationBusy = false;
        this.prValidationRequest = result?.validationRequest || this.prValidationRequest;
        this.toast.success(result?.duplicate ? 'Cette validation existe déjà.' : 'Validation de la Pull Request mise en attente.');
        this.load();
      },
      /** Traite l’erreur reçue et termine le suivi de la demande. */
      error: (err: any) => {
        this.prValidationBusy = false;
        const message = err?.error?.message;
        this.prValidationTargetStale = err?.status === 409 && typeof message === 'string' && message.includes('a changé');
        this.toast.error('Validation refusée', userHttpError(err, 'Impossible de demander la validation de la Pull Request.'));
        this.load();
      },
    });
  }

  /** Actualise la cible de validation après un nouveau commit légitime sur la même PR. */
  refreshValidationTarget(): void {
    if (this.refreshValidationTargetBusy) return;
    this.refreshValidationTargetBusy = true;
    this.api.refreshPrValidationTarget(this.id).subscribe({
      /** Traite le résultat reçu et actualise les données locales. */
      next: (result: any) => {
        this.refreshValidationTargetBusy = false;
        this.prValidationTargetStale = false;
        this.toast.success(result?.changed
          ? 'Cible de validation actualisée — vous pouvez maintenant réessayer la validation.'
          : 'La cible de validation est déjà à jour.');
        this.load();
      },
      /** Traite l’erreur reçue et termine le suivi de la demande. */
      error: (err: any) => {
        this.refreshValidationTargetBusy = false;
        this.toast.error('Actualisation refusée', userHttpError(err, 'Impossible d’actualiser la cible de validation.'));
        this.load();
      },
    });
  }

  /** Déclenche WF4 (optimisation du Jenkinsfile) avec le Jenkinsfile actuel et le contexte d'erreur du build. */
  generateWF4Fix(): void {
    const projectId = this.incident?.projectId;
    if (!projectId || this.classification.type !== 'jenkinsfile') return;
    this.generatingWF4Fix = true;
    this.api.getProject(projectId).subscribe({
      /** Traite le résultat reçu et actualise les données locales. */
      next: (project: any) => {
        const githubRepo = (project?.githubRepo || '').replace('https://github.com/', '');
        const [owner, repo] = githubRepo.split('/');
        if (!owner || !repo) {
          this.generatingWF4Fix = false;
          this.toast.error('Erreur', 'Dépôt GitHub non configuré pour ce projet.');
          return;
        }
        this.api.fetchJenkinsfile(owner, repo).subscribe({
          /** Traite le résultat reçu et actualise les données locales. */
          next: (fetchRes: any) => {
            this.api.optimizeJenkinsfile({
              projectId,
              projectName: project?.name,
              jenkinsfile: fetchRes.jenkinsfile,
              buildError: this.incident?.errorReason,
            }).subscribe({
              /** Traite le résultat reçu et actualise les données locales. */
              next: () => {
                this.generatingWF4Fix = false;
                this.toast.success('Analyse WF4 lancée', "Voir l'onglet Jenkinsfile Optimizer du projet.");
                this.router.navigate(['/projects', projectId]);
              },
              /** Traite l’erreur reçue et termine le suivi de la demande. */
              error: () => { this.generatingWF4Fix = false; this.toast.error('Erreur', 'Échec du déclenchement WF4.'); },
            });
          },
          /** Traite l’erreur reçue et termine le suivi de la demande. */
          error: () => { this.generatingWF4Fix = false; this.toast.error('Erreur', 'Impossible de récupérer le Jenkinsfile.'); },
        });
      },
      /** Traite l’erreur reçue et termine le suivi de la demande. */
      error: () => { this.generatingWF4Fix = false; this.toast.error('Erreur', 'Projet introuvable.'); },
    });
  }

  /** Déclenche WF5 (optimisation du Dockerfile), jumeau de generateWF4Fix() pour les erreurs de build liées au Dockerfile. */
  generateWF5Fix(): void {
    const projectId = this.incident?.projectId;
    if (!projectId || this.classification.type !== 'dockerfile') return;
    this.generatingWF5Fix = true;
    this.api.getProject(projectId).subscribe({
      /** Traite le résultat reçu et actualise les données locales. */
      next: (project: any) => {
        const githubRepo = (project?.githubRepo || '').replace('https://github.com/', '');
        const [owner, repo] = githubRepo.split('/');
        if (!owner || !repo) {
          this.generatingWF5Fix = false;
          this.toast.error('Erreur', 'Dépôt GitHub non configuré pour ce projet.');
          return;
        }
        this.api.optimizeDockerfile({
          owner,
          repo,
          projectId,
          projectName: project?.name,
          buildError: this.incident?.errorReason,
        }).subscribe({
          /** Traite le résultat reçu et actualise les données locales. */
          next: () => {
            this.generatingWF5Fix = false;
            this.toast.success('Analyse WF5 lancée', "Voir l'onglet Dockerfile Optimizer du projet.");
            this.router.navigate(['/projects', projectId]);
          },
          /** Traite l’erreur reçue et termine le suivi de la demande. */
          error: () => { this.generatingWF5Fix = false; this.toast.error('Erreur', 'Échec du déclenchement WF5.'); },
        });
      },
      /** Traite l’erreur reçue et termine le suivi de la demande. */
      error: () => { this.generatingWF5Fix = false; this.toast.error('Erreur', 'Projet introuvable.'); },
    });
  }

  /** Démarre le polling périodique qui attend l'apparition de la Pull Request (ou un échec/timeout) après approbation. */
  private startPrPolling() {
    this.stopPrPolling();
    this.pollAttempts = 0;
    this.prGenerationState = 'polling';
    this.pollHandle = setInterval(() => {
      this.pollAttempts++;
      this.api.getIncident(this.id).pipe(takeUntil(this.incidentScopeReset$)).subscribe({
        /** Traite le résultat reçu et actualise les données locales. */
        next: (inc: any) => {
          const status = inc?.metadata?.fixRequest?.status;
          const terminal = (status !== 'CANCEL_REQUESTED' && !!inc?.prUrl) || this.TERMINAL_FIX_STATUSES.includes(status);
          this.incident = inc;
          if (terminal) {
            this.prGenerationState = 'idle';
            this.stopPrPolling();
            this.load();
          } else if (this.pollAttempts >= this.POLL_MAX_ATTEMPTS) {
            this.prGenerationState = 'timeout';
            this.stopPrPolling();
          }
        },
        /** Traite l’erreur reçue et termine le suivi de la demande. */
        error: () => {
          if (this.pollAttempts >= this.POLL_MAX_ATTEMPTS) {
            this.prGenerationState = 'timeout';
            this.stopPrPolling();
          }
        },
      });
    }, this.POLL_INTERVAL_MS);
  }

  /** Arrête le polling de génération de PR s'il est actif. */
  private stopPrPolling() {
    if (this.pollHandle !== null) {
      clearInterval(this.pollHandle);
      this.pollHandle = null;
    }
  }

  /** Nettoie l'abonnement et arrête le polling à la destruction du composant. */
  ngOnDestroy() {
    this.incidentScopeReset$.next();
    this.incidentScopeReset$.complete();
    this.stopPrPolling();
  }

  /** Couleur associée à une sévérité (CRITICAL/HIGH/MEDIUM/LOW). */
  getSeverityColor(s: string) {
    const map: any = { CRITICAL:'var(--accent-red)', HIGH:'var(--accent-red)',
      MEDIUM:'var(--accent-orange)', LOW:'var(--accent-green)' };
    return map[s] || 'var(--border)';
  }

  /** Vrai si l'incident porte une URL de Pull Request réelle. */
  hasRealPr(): boolean { return /^https?:\/\//i.test(String(this.incident?.prUrl || '')); }
  /** Vrai si une nouvelle demande de correction doit être bloquée (PR déjà existante ou cycle déjà en cours). */
  /** Sélection Sonar verrouillée seulement pendant qu'une correction tourne : avec une PR ouverte, une nouvelle
   *  demande reste possible et reçoit du serveur le refus explicite « merge requis » ; après « Merge effectué »,
   *  elle démarre un nouveau cycle sur cet incident. */
  sonarSelectionLocked(): boolean {
    const fix = this.incident?.metadata?.fixRequest;
    if (this.hasRealPr() && fix?.workflow !== 'WF2') return true;
    return ['APPROVAL_REQUESTED', 'FIX_STARTING', 'DISPATCHED', 'CANCEL_REQUESTED'].includes(fix?.status);
  }
  newCorrectionBlocked(): boolean {
    if (this.hasRealPr()) return true;
    return ['APPROVAL_REQUESTED', 'FIX_STARTING', 'DISPATCHED', 'PR_CREATED', 'VALIDATING', 'CANCEL_REQUESTED']
      .includes(this.incident?.metadata?.fixRequest?.status);
  }

  /** Renvoie la demande de correction courante (metadata.fixRequest), ou null. */
  fixRequest(): any { return this.incident?.metadata?.fixRequest || null; }
  /** Statut brut de la demande de correction courante. */
  fixRequestStatus(): string | null { return this.fixRequest()?.status || null; }
  /** Libellé français du statut de la demande de correction. */
  fixRequestStatusLabel(): string { return fixRequestStatusLabel(this.fixRequestStatus()); }

  confirmMergePending = false;
  /** Fichiers réservés par la correction Sonar de cet incident (verrou levé par « Merge effectué »), ou null. */
  sonarFileLock(): { files: string[]; releasedAt?: string; releaseReason?: string; contestedFiles?: string[] } | null {
    const fix = this.fixRequest();
    return fix?.workflow === 'WF2' && Array.isArray(fix?.fileLock?.files) && fix.fileLock.files.length ? fix.fileLock : null;
  }
  /** Vrai si la PR Sonar de cet incident tient encore ses fichiers et peut être déclarée fusionnée. */
  canConfirmSonarMerge(): boolean {
    const fix = this.fixRequest();
    return this.canOperate && !!this.sonarFileLock() && !this.sonarFileLock()!.releasedAt && !!fix?.prNumber && !!this.incident?.prUrl;
  }
  /** « Merge effectué » : le backend vérifie sur GitHub que la PR est fusionnée, puis libère ses fichiers pour une autre correction. */
  confirmSonarMerge(): void {
    if (!this.canConfirmSonarMerge() || this.confirmMergePending) return;
    this.confirmMergePending = true;
    this.api.confirmIncidentMerge(this.id).subscribe({
      /** Traite le résultat reçu et actualise les données locales. */
      next: (result) => {
        this.confirmMergePending = false;
        this.toast.success(result?.reason === 'PR_CLOSED_UNMERGED'
          ? 'Pull Request fermée sans merge — fichiers libérés.'
          : 'Merge constaté sur GitHub — fichiers libérés pour une nouvelle correction.');
        this.load();
      },
      /** Traite l’erreur reçue et termine le suivi de la demande. */
      error: (err: any) => {
        this.confirmMergePending = false;
        this.toast.error('Merge non confirmé', userHttpError(err, 'Impossible de vérifier le merge sur GitHub. Réessayez.'));
      },
    });
  }

  /** Vrai si une correction est en cours de démarrage ou de dispatch. */
  isFixInProgress(): boolean {
    return ['FIX_STARTING', 'DISPATCHED'].includes(this.fixRequestStatus() || '');
  }
  cancelBusy = false;
  cancelError: string | null = null;

  /** Vrai si la demande de correction en cours peut être annulée (pas encore d'effet de bord démarré). */
  canCancelFix(): boolean {
    const fix = this.fixRequest();
    return fix?.workflow === 'WF2' && !!fix.requestId && fix.sideEffectsStarted !== true
      && ['FIX_STARTING', 'DISPATCHED', 'CANCEL_REQUESTED'].includes(fix.status);
  }

  /** Demande confirmation puis annule la demande de correction en cours. */
  cancelFix(): void {
    if (this.cancelBusy || !this.canCancelFix() || this.fixRequestStatus() === 'CANCEL_REQUESTED') return;
    if (!globalThis.confirm("Voulez-vous annuler cette correction ?\nLa correction sera arrêtée si elle n'a pas encore commencé à écrire sur GitHub.")) return;
    this.cancelBusy = true;
    this.cancelError = null;
    this.api.cancelFixRequest(this.id, this.fixRequest().requestId).subscribe({
      /** Traite le résultat reçu et actualise les données locales. */
      next: (result: any) => {
        this.cancelBusy = false;
        if (result.error) this.cancelError = 'Impossible de confirmer l’arrêt. La demande d’annulation reste en cours.';
        this.load();
      },
      /** Traite l’erreur reçue et termine le suivi de la demande. */
      error: (err: any) => {
        this.cancelBusy = false;
        this.cancelError = err?.status === 409 && err?.error?.code === 'CANCELLATION_TOO_LATE'
          ? 'La correction a déjà commencé à écrire sur GitHub et ne peut plus être annulée automatiquement.'
          : 'Impossible de demander l’annulation. Réessayez.';
        this.load();
      },
    });
  }

  /** Vrai si la correction est au stade "validation en cours". */
  isFixValidatingStage(): boolean { return this.fixRequestStatus() === 'VALIDATING'; }
  /** Vrai si la correction a échoué techniquement. */
  isFixFailedStage(): boolean { return this.fixRequestStatus() === 'FIX_FAILED'; }
  /** Vrai si WF2 a refusé le lot parce qu'il demande une correction humaine (pas une panne). */
  isManualReviewRequired(): boolean {
    const fix = this.fixRequest();
    return fix?.manualReviewRequired === true || fix?.lastErrorCode === 'WF2_MANUAL_REVIEW_REQUIRED';
  }
  /** Vrai si la correction a été refusée. */
  isFixRejectedStage(): boolean { return this.fixRequestStatus() === 'REJECTED'; }
  /** Vrai si la correction a atteint un état terminal de succès (validée ou complétée). */
  isFixTerminalSuccessStage(): boolean {
    return ['VALIDATED', 'COMPLETED'].includes(this.fixRequestStatus() || '');
  }

  /** Renvoie le détail d'échec de la correction (message + code), sans jamais exposer de données brutes sensibles. */
  fixFailureDetails(): { message: string; code: string | null } | null {
    const fix = this.fixRequest();
    if (!fix?.lastError) return null;
    return { message: String(fix.lastError), code: fix.lastErrorCode ? String(fix.lastErrorCode) : null };
  }

  /** Calcule l'horodatage (ms) du dernier dispatch de correction, pour détecter un blocage apparent. */
  private dispatchedAtMs(): number | null {
    const fix = this.fixRequest();
    if (!fix) return null;
    const attempts = Array.isArray(fix.attempts) ? fix.attempts : [];
    const last = attempts[attempts.length - 1];
    const raw = last?.dispatchedAt || fix.dispatchedAt || last?.authorizedAt;
    if (!raw) return null;
    const ms = Date.parse(raw);
    return Number.isFinite(ms) ? ms : null;
  }
  /** Vrai si la correction en cours dépasse le seuil de blocage apparent. */
  looksStuck(): boolean {
    if (!this.isFixInProgress()) return false;
    const dispatchedAt = this.dispatchedAtMs();
    if (dispatchedAt === null) return false;
    return Date.now() - dispatchedAt >= this.STALE_DISPATCH_THRESHOLD_MS;
  }
  /** Vrai si un administrateur peut acter manuellement l'abandon d'un dispatch bloqué. */
  canReconcileStaleDispatch(): boolean {
    return !!this.auth.isAdmin && this.looksStuck();
  }
  /** Demande confirmation puis marque côté plateforme la correction bloquée comme échouée. */
  reconcileStaleDispatch(): void {
    if (this.reconcileBusy || !this.canReconcileStaleDispatch()) return;
    const fix = this.fixRequest();
    const attemptCount = Number(fix?.attemptCount);
    if (!fix?.requestId || !fix?.batchId || !Number.isInteger(attemptCount)) return;
    if (!globalThis.confirm(
      'Cette action marque la correction bloquée comme échouée côté plateforme.\n'
      + 'Elle ne provoque PAS l’arrêt d’une exécution n8n en cours : si WF2 est '
      + 'encore réellement actif, il peut continuer à écrire sur GitHub.\n'
      + 'Continuer ?',
    )) return;
    this.reconcileBusy = true;
    this.reconcileError = null;
    this.api.reconcileStaleDispatch(this.id, fix.requestId, { batchId: fix.batchId, attemptCount }).subscribe({
      /** Traite le résultat reçu et actualise les données locales. */
      next: () => {
        this.reconcileBusy = false;
        this.toast.success('Correction marquée comme échouée.');
        this.stopPrPolling();
        this.prGenerationState = 'idle';
        this.load();
      },
      /** Traite l’erreur reçue et termine le suivi de la demande. */
      error: (err: any) => {
        this.reconcileBusy = false;
        this.reconcileError = userHttpError(err, 'Impossible de marquer cette correction comme échouée.');
        this.toast.error('Erreur', this.reconcileError || 'Impossible de marquer cette correction comme échouée.');
      },
    });
  }
  /** Renvoie les verdicts par finding (WF3), toujours la source autoritaire, jamais un statut global. */
  private findingResultEntries(): any[] {
    const m: any = this.incident?.metadata || {};
    const derived = m.validation?.derived?.findings;
    if (Array.isArray(derived) && derived.length) return derived;
    if (Array.isArray(m.validation?.findingResults)) return m.validation.findingResults;
    if (Array.isArray(m.prValidationRequest?.findingResults)) return m.prValidationRequest.findingResults;
    return [];
  }
  /** Renvoie les ids des findings du lot courant validés (verdict VALID). */
  validatedSonarIds(): Set<string> {
    const fix = this.incident?.metadata?.fixRequest;
    const batchIds = new Set(
      (Array.isArray(fix?.findingIds) ? fix.findingIds : (fix?.findingId ? [fix.findingId] : []))
        .map(String),
    );
    const validated = this.findingResultEntries()
      .filter(e => String(e?.verdict ?? e?.result ?? '').toUpperCase() === 'VALID'
        && batchIds.has(String(e?.findingId)))
      .map(e => String(e.findingId));
    // Déjà corrigés par une PR fusionnée de cet incident, ou inclus dans la PR encore ouverte.
    const remediated = (this.incident?.metadata?.remediatedFindingIds || []).map(String);
    const inOpenPr = this.hasRealPr() && fix?.workflow === 'WF2' ? [...batchIds] : [];
    return new Set([...validated, ...remediated, ...inOpenPr]);
  }
  /** Renvoie l'URL de la Pull Request du lot courant, si elle est valide. */
  batchPrUrl(): string | null {
    const u = this.incident?.metadata?.fixRequest?.prUrl || this.incident?.prUrl || '';
    return /^https?:\/\//i.test(String(u)) ? String(u) : null;
  }
  /** Renvoie le libellé d'affichage de la Pull Request du lot courant. */
  batchPrLabel(): string {
    const n = Number(this.incident?.metadata?.fixRequest?.prNumber);
    return Number.isInteger(n) && n > 0 ? `PR #${n}` : 'Voir la Pull Request';
  }

  /** Vrai si la validation est un succès prêt-à-fusionner, sur le commit réellement ciblé. */
  isMergeReadySuccess(): boolean {
    return this.prValidationRequest?.status === 'COMPLETED'
      && this.prValidationRequest?.result === 'VALIDATED'
      && this.mergeAuthorization()?.authorization === 'MERGE_READY'
      && !!this.batchPrUrl();
  }

  /** Renvoie l'autorisation de merge normalisée, déclassée en INCONCLUSIVE si elle porte sur un commit obsolète. */
  mergeAuthorization(): any {
    const ma = this.validation?.mergeAuthorization;
    if (!ma) return null;
    if (!this.mergeAuthForShaStale()) return ma;
    return {
      ...ma,
      authorization: 'INCONCLUSIVE',
      authorizedSha: null,
      correctiveActionAllowed: false,
      blockingReasons: [],
      technicalReasons: ['VALIDATION_STALE'],
    };
  }
  /** Renvoie l'état de santé global du pipeline de validation. */
  pipelineHealth(): any { return this.validation?.derived?.pipelineHealth ?? null; }

  private readonly MERGE_AUTH_META: Record<string, { color: string; icon: string; title: string; subtitle: string }> = {
    VALIDATING:   { color: 'var(--accent-blue)',   icon: '⏳', title: 'Analyse de la Pull Request en cours',
                    subtitle: 'Les corrections, les tests et les éventuelles régressions sont en cours de vérification.' },
    MERGE_READY:  { color: 'var(--accent-green)',  icon: '✅', title: 'Pull Request autorisée pour fusion',
                    subtitle: "Les problèmes ciblés sont corrigés et aucune régression bloquante n'a été détectée." },
    BLOCKED:      { color: 'var(--accent-red)',    icon: '⛔', title: 'Pull Request bloquée',
                    subtitle: 'Une correction supplémentaire est nécessaire avant la fusion.' },
    INCONCLUSIVE: { color: 'var(--accent-orange)', icon: '⚠️', title: 'Validation non concluante',
                    subtitle: 'La plateforme ne dispose pas encore de preuves suffisantes pour autoriser la fusion.' },
  };
  /** Renvoie le libellé/icône/couleur à afficher pour un état d'autorisation de merge donné. */
  mergeAuthMeta(a: string): { color: string; icon: string; title: string; subtitle: string } {
    if (a === 'INCONCLUSIVE' && this.mergeAuthForShaStale()) {
      return { color: 'var(--accent-orange)', icon: '⚠️', title: 'Validation obsolète — nouvelle validation requise',
        subtitle: 'La Pull Request a changé depuis cette validation. Une nouvelle validation complète est nécessaire.' };
    }
    return this.MERGE_AUTH_META[a] || { color: 'var(--border)', icon: 'ℹ️', title: 'État de validation inconnu', subtitle: '' };
  }

  private readonly MERGE_BLOCKING_LABELS: Record<string, string> = {
    FINDING_INVALID: "Finding ciblé non corrigé",
    REGRESSION_CHANGES_REQUIRED: 'Nouvelle régression bloquante introduite',
    CANDIDATE_TEST_FAILURE: 'Tests du candidat en échec',
    REMEDIATION_INCONCLUSIVE: 'Correction non concluante',
    REGRESSION_UNVERIFIED: "Absence de régression non vérifiable (analyse de référence indisponible)",
    STAGE_INCOMPLETE: 'Étapes de validation incomplètes',
    SHA_MISMATCH: 'Le commit validé ne correspond pas à la PR',
    VALIDATION_IN_PROGRESS: 'Analyse en cours',
  };
  /** Traduit un code de blocage de merge en libellé français lisible. */
  mergeBlockingLabel(code: string): string { return this.MERGE_BLOCKING_LABELS[code] || String(code); }

  /** Construit la checklist affichée quand la PR est prête à fusionner (items purement informatifs, jamais recalculés). */
  mergeReadyChecklist(): string[] {
    const ma = this.mergeAuthorization();
    if (!ma || ma.authorization !== 'MERGE_READY') return [];
    return [
      'Problèmes ciblés corrigés',
      'Commit exact vérifié',
      'Preuves de build/tests réunies',
      'Aucune régression bloquante',
    ];
  }

  /** Vrai si un avertissement Quality Gate doit s'afficher malgré une PR prête à fusionner. */
  showMergeReadyQualityWarning(): boolean {
    const ma = this.mergeAuthorization();
    return ma?.authorization === 'MERGE_READY'
      && String(this.pipelineHealth()?.sonarQualityGate || '').toUpperCase() === 'ERROR';
  }
  /** Renvoie le nombre de findings préexistants, uniquement si l'instantané de régression est fiable (jamais une estimation). */
  preexistingFindingCountIfReliable(): number | null {
    const regression = this.validation?.regression;
    if (!regression || regression.baselineSnapshotComplete !== true || regression.candidateSnapshotComplete !== true) return null;
    return typeof regression.preExistingCount === 'number' ? regression.preExistingCount : null;
  }

  /** Construit le libellé affiché pour un avertissement de validation. */
  advisoryLabel(a: any): string {
    const code = String(a?.code || '');
    if (code.startsWith('SONAR_QUALITY_GATE_')) {
      return `Contrôle qualité global SonarQube : ${presentationLabel(code.replace('SONAR_QUALITY_GATE_', ''))}`;
    }
    if (code === 'PIPELINE_TECHNICAL_FAILURE') return 'Défaillance technique du pipeline de validation';
    return 'Un point de validation nécessite votre attention. Consultez les détails techniques.';
  }

  /** Raccourcit un SHA de commit pour affichage. */
  shortSha(s: string): string { return String(s || '').slice(0, 10); }

  /** Vrai si l'autorisation de merge porte sur un commit qui n'est plus la cible de validation courante. */
  mergeAuthForShaStale(): boolean {
    const forSha = String(this.validation?.mergeAuthorization?.forSha || '').toLowerCase();
    const target = String(
      this.incident?.metadata?.fixRequest?.validationTargetSha
      || this.incident?.metadata?.fixRequest?.prHeadSha || '',
    ).toLowerCase();
    return !!forSha && !!target && forSha !== target;
  }

  /** Construit les lignes affichées pour le détail de santé du pipeline (build/tests/Quality Gate/scanners). */
  pipelineHealthRows(): { label: string; value: string }[] {
    const h = this.pipelineHealth();
    if (!h) return [];
    return [
      { label: 'Build', value: h.build },
      { label: 'Tests', value: h.tests },
      { label: 'Quality Gate SonarQube', value: h.sonarQualityGate },
      { label: 'Conteneur (Trivy)', value: h.trivy },
      { label: 'Dépendances (OWASP)', value: h.owasp },
      { label: 'DAST (ZAP)', value: h.zap },
      { label: 'Étapes requises', value: h.requiredStagesStatus },
    ];
  }
  /** Classe CSS de badge associée à une valeur de santé de pipeline. */
  healthBadgeClass(v: string): string {
    const s = String(v || '').toUpperCase();
    if (['OK', 'PASSED', 'SUCCESS', 'COMPLETED'].includes(s)) return 'info';
    if (['ERROR', 'FAILED'].includes(s)) return 'high';
    return 'medium';
  }
  /** Libellé français d'une valeur de santé de pipeline. */
  healthLabel(v: string): string {
    const map: Record<string, string> = {
      OK: 'OK', PASSED: 'Réussi', SUCCESS: 'Réussi', COMPLETED: 'Exécuté',
      ERROR: 'Échec', FAILED: 'Échec', NOT_RUN: 'Non exécuté', SKIPPED: 'Ignoré',
      RUNNING: 'En cours', UNKNOWN: 'Inconnu',
    };
    const s = String(v || 'UNKNOWN').toUpperCase();
    return map[s] || s;
  }
  /** Vrai si le Quality Gate global est rouge pour des raisons préexistantes, non liées au lot corrigé. */
  showPreexistingSonarNote(): boolean {
    const ma = this.mergeAuthorization();
    const qgRed = String(this.pipelineHealth()?.sonarQualityGate || '').toUpperCase() === 'ERROR';
    const blockedBySonar = (ma?.blockingReasons || []).some((r: string) => String(r).startsWith('SONAR'));
    return qgRed && !!ma && !blockedBySonar;
  }

  /** Classe CSS de badge associée à une sévérité. */
  getSeverityBadgeClass(s: string) {
    const map: any = { CRITICAL:'high', HIGH:'high', MEDIUM:'medium', LOW:'info' };
    return map[s] || '';
  }
  /** Classe CSS de badge associée à un statut d'incident. */
  getStatusBadgeClass(s: string) {
    const map: any = { approved:'info', analyzed:'medium', failed:'high',
      pending:'', completed:'info', validating:'medium' };
    return map[s] || '';
  }
  /** Classe CSS de badge associée à une décision du Judge. */
  getDecisionBadgeClass(d: string) {
    const map: any = { FIX_PROPOSED:'info', AUTO_FIX:'info', BLOCK:'high', NOTIFY_ONLY:'medium' };
    return map[d] || '';
  }

  /** Libellé du statut dominant affiché en en-tête (décision du Judge en priorité, sinon statut de l'incident). */
  dominantStatusLabel(): string {
    if (this.aiAnalysis?.decision) return this.aiAnalysis.decision;
    if (this.incident?.status === 'completed') return 'OK';
    return String(this.incident?.status || 'INCONNU').toUpperCase();
  }
  /** Couleur associée au statut dominant affiché en en-tête. */
  dominantStatusColor(): string {
    if (this.aiAnalysis?.decision) {
      const map: any = { FIX_PROPOSED: 'var(--accent-blue)', AUTO_FIX: 'var(--accent-blue)',
        BLOCK: 'var(--accent-red)', NOTIFY_ONLY: 'var(--accent-orange)' };
      return map[this.aiAnalysis.decision] || 'var(--text-muted)';
    }
    if (this.incident?.status === 'completed') return 'var(--accent-green)';
    if (this.incident?.status === 'failed') return 'var(--accent-red)';
    return 'var(--text-muted)';
  }
  /** Classe CSS de badge associée à l'état du Quality Gate SonarQube. */
  getSonarGateBadgeClass(s: string) {
    if (s === 'OK') return 'info';
    if (s === 'ERROR') return 'high';
    if (s === 'SKIPPED') return 'medium';
    return '';
  }
  /** Couleur associée à un type d'agent IA. */
  getAgentColor(t: string) {
    const map: any = { ROOT_CAUSE:'#38bdf8', SECURITY:'#e24b4a',
      REMEDIATION:'#22c55e', JUDGE:'#f59e0b' };
    return map[t] || '#7ba8c8';
  }
  /** Icône associée à un type d'agent IA. */
  getAgentIcon(t: string) {
    const map: any = { ROOT_CAUSE:'◈', SECURITY:'⬡', REMEDIATION:'◆', JUDGE:'▣' };
    return map[t] || '◉';
  }
  /** Libellé français d'un type d'agent IA. */
  getAgentLabel(t: string) {
    const map: any = { ROOT_CAUSE:'Analyse de la cause racine', SECURITY:'Analyse du risque de sécurité',
      REMEDIATION:'Correction', JUDGE:'Décision de gouvernance' };
    return map[t] || t;
  }
}
