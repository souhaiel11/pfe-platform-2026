import { Component, OnInit, OnDestroy, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { ApiService } from '../../core/services/api.service';
import { ToastService } from '../../core/services/toast.service';
import { DeveloperGuideTabComponent } from './developer-guide/developer-guide-tab.component';
import { DeveloperGuide } from './developer-guide/developer-guide.model';
import { classify, remediationModeForPhase } from './jenkins-known-fixes';
import { ProjectOverviewComponent } from '../projects/project-overview.component';
import { RemediationCardComponent, RemediationIssue, RemediationMode } from './remediation-card.component';
import { evaluateProjectCleanliness, ProjectCleanliness } from './project-cleanliness';
import { diagnoseTrivy, diagnoseOwasp, diagnoseZap, diagnoseSonar, diagnoseTests, diagnoseDocker, IncidentContext } from './phase-diagnostics';

// ═══════════════════════════════════════════════════════════════════
//  INCIDENT DETAIL — v2.0
//  Ajouts : timeline cycle de vie + onglet Validation WF3
//  Données WF1 : incident.metadata.enrichedData + incident.aiAnalysis
//  Données WF3 : incident.metadata.validation
// ═══════════════════════════════════════════════════════════════════

@Component({
  selector: 'app-incident-detail',
  standalone: true,
  imports: [CommonModule, RouterModule, DeveloperGuideTabComponent, ProjectOverviewComponent, RemediationCardComponent],
  templateUrl: './incident-detail.component.html',
  styleUrls: ['./incident-detail.component.scss'],
})
export class IncidentDetailComponent implements OnInit, OnDestroy {
  @Input() id!: string;

  incident:    any  = null;
  reports:     any[] = [];
  aiAnalysis:  any  = null;   // colonne aiAnalysis (WF1)
  developerGuide: DeveloperGuide | null = null;
  enrichedData: any = null;   // metadata.enrichedData (WF1)
  validation:  any  = null;   // metadata.validation (WF3)
  // Classification déterministe (errorReason) : type détermine si un bouton
  // WF4/WF5 peut être proposé — voir jenkins-known-fixes.ts pour le garde-fou.
  // 'vulnerability' n'affiche JAMAIS de bouton (ni WF4 ni WF5), voir le
  // template — le vrai fix est dans le code/les dépendances.
  classification: { type: 'jenkinsfile' | 'dockerfile' | 'vulnerability' | 'infra' | 'code' | 'unknown'; solution: string | null } =
    { type: 'unknown', solution: null };
  generatingWF4Fix = false;
  generatingWF5Fix = false;
  decision:    any  = null;   // legacy
  loading      = true;
  activeTab    = 'analysis';

  // ── Polling prUrl après "Approuver le fix" ──
  // Signal de succès = incident.prUrl non vide, JAMAIS incident.status : vérifié
  // sur données réelles que status peut retomber à 'approved' après un second
  // appel alors qu'une vraie PR existe déjà (18 incidents avec prUrl réel dont
  // 5 en status='approved', 13 en 'fix_generated') — status n'est pas monotone,
  // prUrl l'est.
  prGenerationState: 'idle' | 'polling' | 'timeout' = 'idle';
  private pollHandle: ReturnType<typeof setInterval> | null = null;
  private pollAttempts = 0;
  private readonly POLL_INTERVAL_MS = 4000;
  private readonly POLL_MAX_ATTEMPTS = 22; // ~90s — les 2 exécutions réelles observées ont pris 14s et 23s

  // ── Tabs (mis à jour dans load()) ──
  tabs: any[] = [];

  private updateTabs() {
    this.tabs = [
      { id: 'analysis',   label: 'Analyse IA', dot: null },
      { id: 'guide', label: 'Guide correction', dot: this.developerGuide?.issues?.length ? '#3b82f6' : null },
      { id: 'validation', label: 'Validation PR',
        dot: this.validation ? (this.validation.passed ? '#22c55e' : '#e24b4a') : null },
      { id: 'raw',        label: 'Données brutes', dot: null },
    ];
  }

  // ── Timeline étapes (mis à jour dans load()) ──
  lifecycleSteps: any[] = [];

  private updateLifecycle() {
    const s = this.incident?.status || '';
    const ORDER = ['pending','analyzing','analyzed','fix_generated','validating','approved','completed'];

    // Etats terminaux qui interrompent le chemin normal apres l'analyse.
    // Le Judge a tranche (Detecte + Analyse sont donc acquis), mais la suite
    // ne suit pas la sequence standard fix_generated -> validating -> approved.
    const TERMINAL_AFTER_ANALYSIS = ['blocked', 'rejected', 'failed'];
    const isTerminal = TERMINAL_AFTER_ANALYSIS.includes(s);

    const idx = isTerminal ? 2 : ORDER.indexOf(s);

    this.lifecycleSteps = [
      { label: 'Détecté',     sub: 'WF1',   done: idx >= 0, active: idx === 0 },
      { label: 'Analysé',     sub: 'WF1',   done: idx >= 2, active: idx === 1 || idx === 2 },
      {
        label: isTerminal ? 'Bloqué' : 'Fix proposé',
        sub: isTerminal ? 'judge' : 'WF2',
        done: isTerminal ? false : idx >= 3,
        active: isTerminal ? true : idx === 3,
        terminal: isTerminal,
      },
      { label: 'Validé',      sub: 'WF3',   done: !isTerminal && idx >= 5, active: !isTerminal && (idx === 4 || idx === 5) },
      { label: 'Résolu',      sub: 'merge', done: !isTerminal && idx >= 6, active: !isTerminal && idx === 6 },
    ];
  }

  // Onglet demandé explicitement via ?tab=... (ex: lien depuis le Rapport IA d'un projet)
  private requestedTab: string | null = null;

  constructor(
    private api: ApiService,
    private toast: ToastService,
    private route: ActivatedRoute,
    private router: Router,
  ) {}

  goBack(): void {
    const projectId = this.incident?.projectId;
    this.router.navigate(projectId ? ['/projects', projectId] : ['/projects']);
  }

  // ── Carte Jenkins (Couche 2, mode A) ────────────────────────────────────
  // Mode DYNAMIQUE ici, pas la table statique PHASE_MODE : cette carte
  // reflète l'erreur RÉELLE de CET incident (classify(errorReason)), qui
  // peut pointer vers jenkinsfile OU dockerfile selon ce qui a vraiment
  // cassé — remediationModeForPhase('jenkins') sert aux cartes de phase
  // génériques (Trivy/OWASP/ZAP/Sonar, statiques), pas à celle-ci.
  // 'auto-fix-bulk' ici, PAS 'auto-fix-selective' : avant de lancer
  // l'analyse, on n'a qu'UN résumé synthétique de l'erreur (errorReason),
  // pas encore la vraie liste d'issues avec id individuel que WF4/WF5
  // produiront — rien de réel à cocher tant que optimize() n'a pas tourné.
  jenkinsRemediationMode(): RemediationMode {
    const t = this.classification.type;
    return t === 'jenkinsfile' || t === 'dockerfile' ? 'auto-fix-bulk' : 'signal-only';
  }
  jenkinsIssues(): RemediationIssue[] {
    if (!this.incident?.errorReason) return [];
    return [{ id: 'build-error', title: this.incident.errorStep || '', detail: this.incident.errorReason }];
  }
  jenkinsActionLabel(): string {
    return this.classification.type === 'dockerfile' ? 'Générer la correction via WF5' : 'Générer la correction via WF4';
  }
  jenkinsCorrecting(): boolean {
    return this.classification.type === 'dockerfile' ? this.generatingWF5Fix : this.generatingWF4Fix;
  }
  onJenkinsCorrect(): void {
    if (this.classification.type === 'dockerfile') this.generateWF5Fix();
    else this.generateWF4Fix();
  }

  // ── Instructions humaines par CVE (Trivy/OWASP) ──────────────────────────
  // enrichedData.{trivy,owasp}.cves[] est déjà au format v2.1 (voir
  // report-normalizer.ts::Cve, vérifié en base sur de vraies données WF1 :
  // {id, pkg, cvss, title, source, severity, primaryUrl, fixedVersion,
  // installedVersion}) — WF1 écrit directement ce format dans
  // incident.metadata.enrichedData, aucun passage par normalizeReport() ici
  // (celui-ci ne s'applique qu'aux Report), mais même contrat de données.
  // fixedVersion/installedVersion arrivent en "" (jamais absents) quand
  // inconnus — jamais null — donc `!cve.fixedVersion` couvre les deux cas.
  private cveInstruction(cve: any): string {
    const pkg = cve?.pkg || 'paquet non identifié par le scan';
    const id = cve?.id || 'CVE non identifiée';
    if (cve?.fixedVersion) {
      const from = cve.installedVersion || 'version installée non fournie par le scan';
      return `Mettre à jour ${pkg} de ${from} vers ${cve.fixedVersion} (corrige ${id}).`;
    }
    // Honnête : le scan ne fournit pas de version corrigée — on ne
    // l'invente jamais, on dit explicitement qu'il faut vérifier à la main.
    return `${id} sur ${pkg} : aucune version corrigée indiquée par le scan — vérifier manuellement l'existence d'un correctif, ou évaluer un contournement.`;
  }
  private cveDetail(cve: any): string {
    const parts: string[] = [];
    if (cve?.title) parts.push(cve.title);
    if (cve?.cvss != null) parts.push(`CVSS ${cve.cvss}`);
    if (cve?.primaryUrl) parts.push(cve.primaryUrl);
    return parts.length ? parts.join(' — ') : 'Aucun détail supplémentaire fourni par le scan.';
  }
  private static readonly SEV_RANK: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
  private sortBySeverity(cves: any[]): any[] {
    return [...cves].sort((a, b) => {
      const ra = IncidentDetailComponent.SEV_RANK[String(a?.severity).toUpperCase()] ?? 9;
      const rb = IncidentDetailComponent.SEV_RANK[String(b?.severity).toUpperCase()] ?? 9;
      return ra !== rb ? ra - rb : (b?.cvss || 0) - (a?.cvss || 0);
    });
  }
  private cveToIssue(cve: any): RemediationIssue {
    return {
      id: `${cve?.id || 'cve'}-${cve?.pkg || ''}`,
      title: this.cveInstruction(cve),
      detail: this.cveDetail(cve),
      severity: cve?.severity,
    };
  }
  // Filet honnête : si un jour la forme des données change et que les
  // compteurs agrégés sont présents sans le détail cves[] (ne devrait plus
  // arriver au format v2.1 actuel, vérifié en base), on ne fabrique pas de
  // CVE — on affiche le fait brut plutôt que de masquer le problème.
  private aggregateFallback(t: any, phaseLabel: string): RemediationIssue[] {
    const total = (t?.critical || 0) + (t?.high || 0);
    if (!total) return [];
    return [{ id: `${phaseLabel}-summary`, title: `${t.cves_count || total} CVE détectée(s) par ${phaseLabel}, détail indisponible dans ce scan`, detail: null }];
  }

  // ── Carte Trivy (Couche 2, mode B — signalement) ─────────────────────────
  // Statique : la phase Trivy est TOUJOURS 'vulnerability', jamais besoin de
  // classify() dessus (voir remediationModeForPhase, jenkins-known-fixes.ts).
  trivyMode(): RemediationMode { return remediationModeForPhase('trivy'); }
  trivyIssues(): RemediationIssue[] {
    const t = this.enrichedData?.trivy;
    if (!t || t.status !== 'COMPLETED') return [];
    const cves = Array.isArray(t.cves) ? t.cves : [];
    if (cves.length) return this.sortBySeverity(cves).map((c: any) => this.cveToIssue(c));
    return this.aggregateFallback(t, 'Trivy');
  }

  // ── Carte OWASP Dependency-Check (Couche 2, signalement) ─────────────────
  // Même contrat de données que Trivy (ScannerBlock), source différente.
  owaspMode(): RemediationMode { return remediationModeForPhase('owasp'); }
  owaspIssues(): RemediationIssue[] {
    const o = this.enrichedData?.owasp;
    if (!o || o.status !== 'COMPLETED') return [];
    const cves = Array.isArray(o.cves) ? o.cves : [];
    if (cves.length) return this.sortBySeverity(cves).map((c: any) => this.cveToIssue(c));
    return this.aggregateFallback(o, 'OWASP');
  }

  // ── Carte ZAP (Couche 2, signalement) ─────────────────────────────────
  // enrichedData.zap.alerts[] : présent dans le rawData brut (vérifié en
  // base — ex. report 043c6f66, zap.alerts=[] mais la clé existe) mais
  // JAMAIS observé non-vide sur aucun report de ce projet (ZAP timeout /
  // scanner UNKNOWN sur tous les builds récents, voir dette connue) — donc
  // AUCUNE forme réelle de ces objets n'a pu être vérifiée. Lecture
  // défensive sur les noms de champs standards du rapport JSON ZAP
  // (alert/risk/desc/solution/instances[].uri) ; si rien d'exploitable,
  // on le dit honnêtement plutôt que d'inventer une alerte.
  zapMode(): RemediationMode { return remediationModeForPhase('zap'); }
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

  // ── Couche 3 : verrou de déploiement (Bloc C) ────────────────────────────
  // evaluateProjectCleanliness() (project-cleanliness.ts) est la SEULE
  // source de vérité pour clean/blocked — ce composant se contente de la
  // traduire en texte lisible, jamais de recalculer la logique de blocage.
  // Fail-closed explicite : enrichedData absent => verrouillé, pas "on ne
  // sait pas donc on laisse passer".
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

  // Phase 3 (couche d'interprétation) : contexte errorReason/errorStep du
  // MÊME incident, seul endroit où ces colonnes existent (incident.entity.ts
  // — pas dans enrichedData). Passé à diagnose*() pour que le cascade pointe
  // la vraie cause capturée plutôt qu'une hypothèse générique.
  private diagnosticContext(): IncidentContext {
    return { errorReason: this.incident?.errorReason || null, errorStep: this.incident?.errorStep || null };
  }

  // Une ligne par point bloquant, avec l'acteur responsable. Pour les 2
  // phases vulnérabilité, on n'affiche PAS le compteur agrégé de
  // blockingPhases : on éclate en une ligne par CVE CRITICAL réelle, en
  // réutilisant cveInstruction() (Bloc A, déjà prouvé) — c'est ça qui donne
  // "Log4Shell (log4j) → mettre à jour vers 2.15.0" plutôt que "2 CVE".
  // Pour tout le reste, on délègue à phase-diagnostics.ts (Phase 2) plutôt
  // qu'à un hint statique — un "UNKNOWN" ne doit plus jamais atteindre
  // l'écran nu. Docker et SonarQube en particulier : l'ancien hint disait
  // toujours "→ lancer WF5/WF2" même quand la vraie cause est un bug de
  // câblage plateforme (Docker) ou un appel API cassé (Sonar gate) que WF2/
  // WF5 ne peuvent pas corriger — c'était une fausse piste, corrigée ici.
  deploymentLines(): { actor: 'Agent' | 'Vous'; phase: string; text: string }[] {
    const c = this.cleanliness();
    const ctx = this.diagnosticContext();
    const lines: { actor: 'Agent' | 'Vous'; phase: string; text: string }[] = [];
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
        // Déjà le mécanisme le plus riche (classify() + vrai log console,
        // voir jenkinsIssues()/Bloc A) — pas de diagnose dédié à dupliquer ici.
        lines.push({ actor: 'Agent', phase: bp.phase, text: `${bp.raison} → lancer la correction via WF4 (carte "⬡ Build Jenkins" ci-dessus)` });
        continue;
      }
      // Filet : phase future non couverte par phase-diagnostics.ts.
      lines.push({ actor: bp.type === 'agent' ? 'Agent' : 'Vous', phase: bp.phase, text: bp.raison });
    }
    return lines;
  }

  // Texte discret pour le cas "propre" : ce qui reste signalé sans bloquer.
  nonBlockingSummary(): string {
    const c = this.cleanliness();
    const parts = [...c.nonExecutedPhases, ...c.nonBlockingFindings].map(p => p.raison);
    return parts.join(' · ');
  }

  // ── Carte SonarQube (Couche 2, mode C — auto-fix-bulk) ──────────────────
  // Statique comme Trivy : la phase Sonar est TOUJOURS 'auto-fix-bulk'
  // (PHASE_MODE, jenkins-known-fixes.ts) — WF2 ne cible pas encore une
  // issue précise, correction assumée sur l'ensemble des findings.
  // onSonarCorrect() appelle le MÊME approveFix() que le bouton générique
  // "✓ Approuver le fix" du header : aucun nouvel endpoint, aucun nouveau
  // workflow — cette carte ne fait que rendre visibles les vraies findings
  // Sonar (enrichedData.sonar.issues, déjà écrites par WF1) avant de
  // déclencher l'action déjà prouvée. Les deux boutons coexistent : le
  // bouton du header reste le contrôle de cycle de vie générique de
  // l'incident (gaté sur incident.status), celui-ci est contextuel à la
  // phase Sonar — ils appellent la même méthode donc ne peuvent jamais se
  // contredire, et `correcting` est branché sur le même signal de polling
  // pour que les deux reflètent "en cours" ensemble.
  sonarMode(): RemediationMode { return remediationModeForPhase('sonar'); }
  sonarIssues(): RemediationIssue[] {
    const issues = this.enrichedData?.sonar?.issues || [];
    return issues.map((i: any) => ({
      id: i.key,
      title: i.message,
      detail: i.component ? `${i.component}${i.line ? ':' + i.line : ''}` : null,
      severity: i.severity,
    }));
  }
  sonarCorrecting(): boolean { return this.prGenerationState === 'polling'; }
  onSonarCorrect(): void { this.approveFix(); }

  // Traduit les clés abstraites émises par <app-project-overview> (le rail
  // de phases, réutilisé tel quel — voir project-overview.component.ts)
  // vers les vrais onglets de la page Projet. Même mapping que
  // project-detail.component.ts::tabMap/onGoToTab, adapté : 'guide' reste
  // ICI (cette page a déjà un onglet 'guide' local), pas de navigation.
  private readonly overviewTabMap: Record<string, string> = {
    jenkins: 'jenkins', sonar: 'sonarqube', security: 'securite',
  };
  onGoToTab(event: string): void {
    if (event === 'guide') { this.activeTab = 'guide'; return; }
    const projectId = this.incident?.projectId;
    if (!projectId) return;
    const [key] = event.split(':');
    const tab = this.overviewTabMap[key];
    if (!tab) return;
    this.router.navigate(['/projects', projectId], { queryParams: { tab } });
  }

  ngOnInit() {
    const tabParam = this.route.snapshot.queryParamMap.get('tab');
    const validTabs = ['analysis', 'guide', 'validation', 'raw'];
    if (tabParam && validTabs.includes(tabParam)) {
      this.requestedTab = tabParam;
      this.activeTab = tabParam;
    }
    this.load();
  }

  load() {
    this.loading = true;
    this.api.getIncident(this.id).subscribe({
      next: (inc: any) => {
        this.incident     = inc;
        // Rapports agents depuis metadata (rootCause, security, remediation)
        const meta = inc.metadata || {};
        this.reports = [
          meta.rootCause && Object.keys(meta.rootCause).length > 0
            ? { agentType: 'ROOT_CAUSE', analysis: meta.rootCause.rootCause || meta.rootCause.analysisSummary || '', confidence: meta.rootCause.confidence || 0 }
            : null,
          meta.security && Object.keys(meta.security).length > 0
            ? { agentType: 'SECURITY', analysis: meta.security.securitySummary || '', confidence: meta.security.confidence || 0 }
            : null,
          meta.remediation && Object.keys(meta.remediation).length > 0
            ? { agentType: 'REMEDIATION', analysis: meta.remediation.fixDescription || (meta.remediation.fixSteps || []).join('\n') || '', confidence: meta.remediation.confidence || 0 }
            : null,
        ].filter(r => r !== null);
        this.decision     = inc.decision || null;
        // ── Données WF1 ──
        // aiAnalysis peut être du JSON string OU du texte brut — parse sûr
        if (inc.aiAnalysis && typeof inc.aiAnalysis === 'string') {
          try {
            this.aiAnalysis = JSON.parse(inc.aiAnalysis);
          } catch (e) {
            // texte brut : on l'enveloppe pour l'affichage
            this.aiAnalysis = { justification: inc.aiAnalysis };
          }
        } else {
          this.aiAnalysis = inc.aiAnalysis || null;
        }
        this.developerGuide = this.aiAnalysis?.developerGuide ?? null;
        this.enrichedData = inc.metadata?.enrichedData || null;
        // ── Données WF3 ──
        this.validation   = inc.metadata?.validation || null;
        // ── Build Jenkins direct (source='jenkins') ──
        this.classification = inc.source === 'jenkins'
          ? classify(inc.errorReason)
          : { type: 'unknown', solution: null };
        this.updateLifecycle();
        this.updateTabs();
        this.loading = false;
        // Si validé, ouvrir directement l'onglet validation — sauf si un onglet a été demandé explicitement via l'URL
        if (!this.requestedTab && this.validation) this.activeTab = 'validation';
      },
      error: () => { this.toast.error('Erreur', 'Incident introuvable'); this.loading = false; }
    });
  }

  approveFix() {
    this.api.approveFix(this.id).subscribe({
      next: () => {
        this.toast.success('Fix approuvé — WF2 déclenché');
        this.load();
        this.startPrPolling();
      },
      error: () => this.toast.error('Erreur', 'Impossible d\'approuver')
    });
  }

  rejectFix() {
    this.api.rejectFix(this.id).subscribe({
      next: () => { this.toast.success('Fix rejeté'); this.load(); },
      error: () => this.toast.error('Erreur', 'Impossible de rejeter')
    });
  }

  // Déclenche WF4 (optimize) avec le contexte d'erreur du build en plus du
  // Jenkinsfile actuel — GARDE-FOU : n'est appelable QUE depuis le bouton du
  // template, lui-même gaté sur classification.type === 'jenkinsfile' (voir
  // incident-detail.component.html). WF4 lit déjà pom.xml/Dockerfile de son
  // côté (projectContext) — on ne duplique pas cette lecture ici.
  generateWF4Fix(): void {
    const projectId = this.incident?.projectId;
    if (!projectId || this.classification.type !== 'jenkinsfile') return;
    this.generatingWF4Fix = true;
    this.api.getProject(projectId).subscribe({
      next: (project: any) => {
        const githubRepo = (project?.githubRepo || '').replace('https://github.com/', '');
        const [owner, repo] = githubRepo.split('/');
        if (!owner || !repo) {
          this.generatingWF4Fix = false;
          this.toast.error('Erreur', 'Dépôt GitHub non configuré pour ce projet.');
          return;
        }
        this.api.fetchJenkinsfile(owner, repo).subscribe({
          next: (fetchRes: any) => {
            this.api.optimizeJenkinsfile({
              projectId,
              projectName: project?.name,
              jenkinsfile: fetchRes.jenkinsfile,
              buildError: this.incident?.errorReason,
            }).subscribe({
              next: () => {
                this.generatingWF4Fix = false;
                this.toast.success('Analyse WF4 lancée', "Voir l'onglet Jenkinsfile Optimizer du projet.");
                this.router.navigate(['/projects', projectId]);
              },
              error: () => { this.generatingWF4Fix = false; this.toast.error('Erreur', 'Échec du déclenchement WF4.'); },
            });
          },
          error: () => { this.generatingWF4Fix = false; this.toast.error('Erreur', 'Impossible de récupérer le Jenkinsfile.'); },
        });
      },
      error: () => { this.generatingWF4Fix = false; this.toast.error('Erreur', 'Projet introuvable.'); },
    });
  }

  // Déclenche WF5 (optimize) — jumeau de generateWF4Fix(). GARDE-FOU : n'est
  // appelable QUE depuis le bouton du template, lui-même gaté sur
  // classification.type === 'dockerfile' (voir incident-detail.component.html).
  // Contrairement à WF4, WF5 optimize() fetch le Dockerfile lui-même côté
  // backend (voir dockerfile-optimizer.module.ts) — pas de fetch séparé ici.
  // buildError est déjà envoyé pour préparer le câblage backend/n8n à venir ;
  // WF5 ne l'exploite pas encore côté n8n à ce stade.
  generateWF5Fix(): void {
    const projectId = this.incident?.projectId;
    if (!projectId || this.classification.type !== 'dockerfile') return;
    this.generatingWF5Fix = true;
    this.api.getProject(projectId).subscribe({
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
          next: () => {
            this.generatingWF5Fix = false;
            this.toast.success('Analyse WF5 lancée', "Voir l'onglet Dockerfile Optimizer du projet.");
            this.router.navigate(['/projects', projectId]);
          },
          error: () => { this.generatingWF5Fix = false; this.toast.error('Erreur', 'Échec du déclenchement WF5.'); },
        });
      },
      error: () => { this.generatingWF5Fix = false; this.toast.error('Erreur', 'Projet introuvable.'); },
    });
  }

  private startPrPolling() {
    this.stopPrPolling();
    this.pollAttempts = 0;
    this.prGenerationState = 'polling';
    this.pollHandle = setInterval(() => {
      this.pollAttempts++;
      this.api.getIncident(this.id).subscribe({
        next: (inc: any) => {
          if (inc.prUrl) {
            this.incident = inc;
            this.prGenerationState = 'idle';
            this.stopPrPolling();
            this.load(); // resynchronise timeline/tabs avec le nouvel état complet
          } else if (this.pollAttempts >= this.POLL_MAX_ATTEMPTS) {
            this.prGenerationState = 'timeout';
            this.stopPrPolling();
          }
        },
        error: () => {
          if (this.pollAttempts >= this.POLL_MAX_ATTEMPTS) {
            this.prGenerationState = 'timeout';
            this.stopPrPolling();
          }
        },
      });
    }, this.POLL_INTERVAL_MS);
  }

  private stopPrPolling() {
    if (this.pollHandle !== null) {
      clearInterval(this.pollHandle);
      this.pollHandle = null;
    }
  }

  ngOnDestroy() {
    this.stopPrPolling();
  }

  getSeverityColor(s: string) {
    const map: any = { CRITICAL:'var(--accent-red)', HIGH:'var(--accent-red)',
      MEDIUM:'var(--accent-orange)', LOW:'var(--accent-green)' };
    return map[s] || 'var(--border)';
  }
  getSeverityBadgeClass(s: string) {
    const map: any = { CRITICAL:'high', HIGH:'high', MEDIUM:'medium', LOW:'info' };
    return map[s] || '';
  }
  getStatusBadgeClass(s: string) {
    const map: any = { approved:'info', analyzed:'medium', failed:'high',
      pending:'', completed:'info', validating:'medium' };
    return map[s] || '';
  }
  getDecisionBadgeClass(d: string) {
    const map: any = { FIX_PROPOSED:'info', AUTO_FIX:'info', BLOCK:'high', NOTIFY_ONLY:'medium' };
    return map[d] || '';
  }

  // ── Statut dominant du header (Couche 1) ────────────────────────────────
  // Les 3 dimensions (cycle de vie incident.status, sévérité aiAnalysis.
  // securityLevel, décision aiAnalysis.decision) ne sont PAS le même signal
  // — avant, affichées en badges de même taille, elles se faisaient
  // concurrence sans hiérarchie. Ici : la décision du Judge est LA
  // information qui compte pour un développeur ("qu'est-ce que je fais ?"),
  // le reste passe en secondaire. Repli sur incident.status si le Judge n'a
  // pas encore tranché (ex: incident Jenkins brut, WF1 pas encore passé).
  dominantStatusLabel(): string {
    if (this.aiAnalysis?.decision) return this.aiAnalysis.decision;
    if (this.incident?.status === 'completed') return 'OK';
    return String(this.incident?.status || 'INCONNU').toUpperCase();
  }
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
  getSonarGateBadgeClass(s: string) {
    if (s === 'OK') return 'info';
    if (s === 'ERROR') return 'high';
    if (s === 'SKIPPED') return 'medium';
    return '';
  }
  getAgentColor(t: string) {
    const map: any = { ROOT_CAUSE:'#38bdf8', SECURITY:'#e24b4a',
      REMEDIATION:'#22c55e', JUDGE:'#f59e0b' };
    return map[t] || '#7ba8c8';
  }
  getAgentIcon(t: string) {
    const map: any = { ROOT_CAUSE:'◈', SECURITY:'⬡', REMEDIATION:'◆', JUDGE:'▣' };
    return map[t] || '◉';
  }
  getAgentLabel(t: string) {
    const map: any = { ROOT_CAUSE:'Root Cause Analysis', SECURITY:'Security Risk',
      REMEDIATION:'Remediation', JUDGE:'Judge Agent' };
    return map[t] || t;
  }
}
