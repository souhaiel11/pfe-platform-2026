// Service central de remédiation manuelle et automatique des findings de sécurité.
import { assertLegacyReadmission, legacyArchive } from './legacy-reconciliation';
import { assertNotAlreadyFixedOnDefaultBranch, fetchDefaultBranchPom } from './default-branch-version-check';
import { mergeFromCommitFeed } from './github-merge-feed';
import { productionTarget, reserveTarget, bindTargetAttempt, settleTargetClaim, releaseTargetClaim, safeTerminalTargetRelease } from './remediation-target-reservation';
import { RetryE2EHarnessService } from '../security-remediation/retry-e2e-harness.service';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, Optional, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { RetrySecurityRemediationDto } from './retry-security-remediation.dto';
import { assertSecurityRemediationDispatchEnabled, callbackContract, assertLegacyCallback, completeLegacyAttempt, assertRetryAllowed, assertNoSideEffect, reserveAttempt, completeAttempt, assertCorrelation, normalizeSecurityRemediation, isProjectFixVerified, classifySecurityRemediationFailure } from './security-remediation-lifecycle';
import { EntityManager, In, Repository } from 'typeorm';
import { Incident } from '../incidents/incident.entity';
import { Project } from '../projects/project.entity';
import { isFullGitSha } from '../candidate-verification/candidate-digest';
import { normalizeReport } from '../common/report-normalizer';
import { findingFingerprint } from './finding-fingerprint';
import { effectiveBaseSha, latestConfirmedMerge } from './post-merge-baseline';
import { taskFingerprintAliases, owaspLegacyFingerprint } from './owasp-task-identity';
import { buildTrivyFixedVersionIndex, qualifyOwaspFixedVersionCorrelation, resolveOwaspFixedVersion } from './owasp-trivy-fixed-version-correlation';
import { resolveMavenProvenance } from '../security-remediation/maven-provenance-resolver';
import { classifySecurityAutoFixEligibility } from '../security-remediation/security-eligibility-classifier';
import { resolveOwaspMavenIdentity } from '../common/owasp-finding-normalizer';
import { withFindingTaskIds } from './finding-task-id-enrichment';
import { ManualRemediationEvent, ManualRemediationStatus, ManualRemediationTask, ScannerFindingStatus } from './manual-remediation.entity';
import { Wf6RemediationResultDto } from '../security-remediation/wf6-remediation-result.dto';
import { Wf6BatchRemediationResultDto } from '../security-remediation/wf6-batch-remediation-result.dto';
import { ReconcileStaleWf6DispatchDto } from './reconcile-stale-wf6-dispatch.dto';
import { V1_8CompatibilityDecisionService } from '../dependency-compatibility/v1_8-compatibility-decision.service';
import { canDispatchSecurityRemediationV1_8 } from '../dependency-compatibility/v1_8-security-remediation-gate';
import { v1_8EnforcementMode } from '../dependency-compatibility/v1_8-enforcement-mode';
import { buildWf6ValidatedFindingPayload, Wf6ValidatedFindingPayload } from '../dependency-compatibility/v1_8-remediation-plan-payload.types';

export const MAX_FINDINGS_PER_REMEDIATION_BATCH = 8;

export interface Wf6BatchDispatchPayload {
  projectId: string; batchId: string; findingTaskIds: string[];
  attempts?: { findingTaskId: string; attemptId: string; attemptNumber: number }[];
  v1_8ValidatedFindings?: Wf6ValidatedFindingPayload[];
}
export interface Wf6BatchDispatcher {
/** Transmet la demande au service chargé de l’exécuter. */
dispatch(payload: Wf6BatchDispatchPayload): Promise<void> }
/** Dispatcher de production : envoie le lot au webhook n8n WF6 avec un timeout court côté client (le traitement long se fait côté n8n). */
export class HttpWf6BatchDispatcher implements Wf6BatchDispatcher {
  /** Envoie le payload de lot au webhook WF6 et lève une erreur si la réponse n'est pas HTTP OK. */
  async dispatch(payload: Wf6BatchDispatchPayload): Promise<void> {
    const base = String(process.env.N8N_URL || 'http://n8n:5678').replace(/\/$/, '');
    const response = await fetch(`${base}/webhook/wf6-security-remediation-evaluate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Internal-Secret': process.env.N8N_INTERNAL_SECRET || '' },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`n8n returned HTTP ${response.status}`);
  }
}

type Candidate = { source: string; finding: any; fingerprint: string };

@Injectable()
export class ManualRemediationService {
  /** Initialise les dépendances et l’état de ce composant. */
  constructor(
    @InjectRepository(ManualRemediationTask) private readonly repo: Repository<ManualRemediationTask>,
    @InjectRepository(Incident) private readonly incidents: Repository<Incident>,
    @Optional() private readonly wf6BatchDispatcher: Wf6BatchDispatcher = new HttpWf6BatchDispatcher(),
    @Optional() private readonly v1_8Decisions: V1_8CompatibilityDecisionService = new V1_8CompatibilityDecisionService(),
    @Optional() @InjectRepository(Project) private readonly projects?: Repository<Project>,
    @Optional() private readonly retryE2E?: RetryE2EHarnessService,
  ) {}

  /** Liste les tâches de remédiation d'un projet (en les créant d'abord par backfill si aucune n'existe encore), filtrables et enrichies en v1.8 si demandé. */
  async list(projectId: string, filters: { status?: string; source?: string; severity?: string; includeV18?: boolean } = {}) {
    if (!projectId) throw new BadRequestException('L’identifiant technique projectId est requis.');
    // Bootstrap complet quand aucune tâche n'existe (projet neuf) ; sinon on
    // resynchronise au moins le DERNIER incident à chaque lecture, pour que la
    // classification reflète le build le plus récent (ex. Trivy présent au build
    // réussi) et ne reste pas figée sur un build antérieur. syncIncident est
    // idempotent (upsert par empreinte) et la version corrigée déjà résolue est
    // conservée via existingSnapshot — un build ultérieur sans Trivy ne la perd pas.
    if (await this.repo.count({ where: { projectId } }) === 0) {
      const history = await this.incidents.find({ where: { projectId }, order: { createdAt: 'ASC' } });
      for (const incident of history) await this.syncIncident(incident);
    } else {
      const latest = await this.incidents.findOne({ where: { projectId }, order: { createdAt: 'DESC' } });
      if (latest) await this.syncIncident(latest);
    }
    const where: any = { projectId };
    if (filters.status) where.status = filters.status;
    if (filters.source) where.source = String(filters.source).toUpperCase();
    if (filters.severity) where.severity = String(filters.severity).toUpperCase();
    const tasks = await this.repo.find({ where, order: { updatedAt: 'DESC' } });
    const presentedTasks = tasks.map(t => ({ ...t, securityFindingRemediation: normalizeSecurityRemediation(t.securityFindingRemediation), projectFixVerified: isProjectFixVerified(t) }));
    if (!filters.includeV18) return presentedTasks;
    return presentedTasks.map(t => ({
      ...t,
      v1_8Decision: (t.ruleOrCve && t.findingSnapshot?.component)
        ? this.v1_8Decisions.lookup(t.source, t.ruleOrCve, String(t.findingSnapshot.component), String(t.findingSnapshot.currentVersion || ''))
        : null,
    }));
  }

  /** Compte les tâches d'un projet par statut (à faire, traitées, toujours détectées, vérifiées). */
  async summary(projectId: string) {
    const tasks = await this.repo.find({ where: { projectId } });
    return {
      todo: tasks.filter(t => t.status === ManualRemediationStatus.TODO || t.status === ManualRemediationStatus.REOPENED).length,
      doneByUser: tasks.filter(t => t.status === ManualRemediationStatus.DONE_BY_USER).length,
      stillDetected: tasks.filter(t => t.status === ManualRemediationStatus.DONE_BY_USER && t.scannerStatus === ScannerFindingStatus.STILL_DETECTED).length,
      verified: tasks.filter(t => t.status === ManualRemediationStatus.VERIFIED).length,
      total: tasks.length,
    };
  }

  /** Enrichit une liste d'incidents avec le findingTaskId de chaque CVE Trivy/OWASP, via une seule requête groupée sur tous les projets présents dans le lot. */
  async attachFindingTaskIds<T extends { projectId: string; metadata?: any }>(incidents: T[]): Promise<T[]> {
    const projectIds = [...new Set(incidents.map(i => i.projectId).filter(Boolean))];
    if (!projectIds.length) return incidents;
    const tasks = await this.repo.find({ where: { projectId: In(projectIds) } });
    const byKey = new Map<string, string | null>();
    for (const task of tasks) for (const fingerprint of taskFingerprintAliases(task)) {
      const key = `${task.projectId}::${fingerprint}`;
      byKey.set(key, byKey.has(key) && byKey.get(key) !== task.id ? null : task.id);
    }
    return incidents.map(incident => {
      const enrichedData = incident.metadata?.enrichedData;
      if (!enrichedData) return incident;
      /** Recherche la décision correspondant au contexte demandé. */
      const lookup = (fingerprint: string) => byKey.get(`${incident.projectId}::${fingerprint}`) ?? null;
      return { ...incident, metadata: { ...incident.metadata, enrichedData: withFindingTaskIds(enrichedData, lookup) } };
    });
  }

  /** Marque une tâche comme traitée manuellement par un utilisateur (hors flux de correction automatique). */
  async complete(id: string, user: any, note?: string) {
    const task = await this.authorizedTask(id, user, false);
    if (task.status === ManualRemediationStatus.VERIFIED) throw new BadRequestException('Une tâche déjà vérifiée par une analyse ne peut pas être traitée manuellement.');
    if (task.status === ManualRemediationStatus.DONE_BY_USER) throw new BadRequestException('Cette tâche est déjà marquée comme traitée manuellement.');
    const old = task.status;
    task.status = ManualRemediationStatus.DONE_BY_USER;
    task.scannerStatus = ScannerFindingStatus.STILL_DETECTED;
    task.completedByUserId = String(user.id);
    task.completedByDisplayName = String(user.name || user.email || user.id);
    task.completedAt = new Date();
    task.completionNote = String(note || '').trim().slice(0, 500) || null;
    task.events = [...(task.events || []), this.event(user, old, task.status, 'COMPLETED_BY_USER', task.lastSeenBuild)];
    return this.repo.save(task);
  }

  /** Rouvre une tâche (remise à REOPENED/DETECTED), en conservant l'historique de complétion précédent comme simple fait passé. */
  async reopen(id: string, user: any) {
    const task = await this.authorizedTask(id, user, true);
    const old = task.status;
    task.status = ManualRemediationStatus.REOPENED;
    task.scannerStatus = ScannerFindingStatus.DETECTED;
    task.verifiedAt = null;
    task.verifiedBuild = null;
    task.events = [...(task.events || []), this.event(user, old, task.status, 'REOPENED_BY_USER', task.lastSeenBuild)];
    return this.repo.save(task);
  }

  /** Point d'entrée principal appelé à chaque mise à jour d'incident : normalise le rapport scanner et réconcilie chaque bloc (Trivy/OWASP/ZAP) complet avec les tâches existantes. */
  async syncIncident(incidentOrId: Incident | string) {
    const incident = typeof incidentOrId === 'string'
      ? await this.incidents.findOne({ where: { id: incidentOrId } }) : incidentOrId;
    if (!incident?.projectId) return;
    const raw = incident.metadata?.enrichedData ? { enrichedData: incident.metadata.enrichedData } : incident.metadata;
    if (!raw) return;
    const normalized = normalizeReport(raw || {});
    const build = incident.buildNumber ?? incident.metadata?.build?.number ?? incident.metadata?.enrichedData?.build?.number ?? null;
    const trivyFixedVersionIndex = buildTrivyFixedVersionIndex(normalized.trivy?.cves || []);
    const pom = await this.fetchPomForProvenance(incident);
    const blocks: Array<{ source: string; block: any; findings: any[] }> = [
      { source: 'TRIVY', block: normalized.trivy, findings: normalized.trivy?.cves || [] },
      { source: 'OWASP', block: normalized.owasp, findings: normalized.owasp?.cves || [] },
      { source: 'ZAP', block: normalized.zap, findings: (normalized.zap as any)?.alerts || [] },
    ];
    for (const { source, block, findings } of blocks) {
      const complete = block?.completed === true || block?.status === 'COMPLETED' || (!block?.status && normalized._sourceFormat === 'legacy');
      if (!complete || block?.resultAvailable === false) {
        if (block?.status) await this.repo.update({ projectId: incident.projectId, source }, { scannerStatus: ScannerFindingStatus.UNAVAILABLE });
        continue;
      }
      await this.reconcileSource(incident, source, findings, build, trivyFixedVersionIndex, pom);
    }
  }

  /** Récupère le pom.xml du dépôt du projet (au SHA du build si connu, sinon la branche de l'incident) pour ancrer la résolution de provenance. Renvoie null si indisponible — la classification retombe alors sur le repli historique, sans régression. */
  private async fetchPomForProvenance(incident: Incident): Promise<{ pomXmlText: string; sha: string } | null> {
    try {
      const project = this.projects ? await this.projects.findOne({ where: { id: incident.projectId } }) : null;
      const repo = String(project?.githubRepo || '').replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '').trim();
      if (!repo.includes('/')) return null;
      const meta: any = incident.metadata || {};
      const rawSha = meta.sourceCommitSha || meta.commitSha || meta.commit || meta.enrichedData?.build?.commit || '';
      const fullSha = isFullGitSha(String(rawSha)) ? String(rawSha) : '';
      const branch = incident.jenkinsJobName && incident.jenkinsJobName.includes('/')
        ? incident.jenkinsJobName.split('/').slice(1).join('/') : '';
      const ref = fullSha || branch || 'HEAD';
      const [owner, name] = repo.split('/');
      const headers: Record<string, string> = { 'User-Agent': 'DevSecOps-Platform', Accept: 'application/vnd.github.v3.raw' };
      if (project?.githubToken) headers['Authorization'] = `token ${project.githubToken}`;
      const res = await fetch(`https://api.github.com/repos/${owner}/${name}/contents/pom.xml?ref=${encodeURIComponent(ref)}`, { headers, signal: AbortSignal.timeout(8000) });
      if (!res.ok) return null;
      const pomXmlText = await res.text();
      if (!pomXmlText || !pomXmlText.includes('<project')) return null;
      return { pomXmlText, sha: fullSha };
    } catch { return null; }
  }

  /** Réconcilie les findings d'une source scanner (TRIVY/OWASP/ZAP) pour un build donné avec les tâches persistées. */
  private async reconcileSource(incident: Incident, source: string, findings: any[], build: number | null, trivyFixedVersionIndex?: ReturnType<typeof buildTrivyFixedVersionIndex>, pom?: { pomXmlText: string; sha: string } | null) {
    // Classification déterministe de l'auto-correction d'une dépendance (TRIVY/OWASP) :
    // provenance résolue depuis le pom.xml du projet (DIRECT_EXPLICIT / PROPERTY_MANAGED
    // + correctif de MÊME majeure => AUTO_FIX_ELIGIBLE). Renvoie undefined quand le pom
    // est indisponible, pour conserver le repli historique f.remediationType (jamais de
    // régression). Les transitives (pas dans <dependencies>) et les cross-major restent
    // DEVELOPER_ACTION_REQUIRED : VAL-D04 (snakeyaml) et VAL-D05 (commons-text) intacts.
    const classifyDependency = (snap: any): string | undefined => {
      if (source !== 'TRIVY' && source !== 'OWASP') return undefined;
      if (!pom?.pomXmlText) return undefined;
      const component = String(snap?.component || '').trim();
      const installedVersion = String(snap?.currentVersion || '').trim();
      const fixedVersion = snap?.fixedVersion ? String(snap.fixedVersion).trim() : '';
      if (!component.includes(':') || !installedVersion || !fixedVersion) return 'DEVELOPER_ACTION_REQUIRED';
      try {
        const provenance = resolveMavenProvenance({
          package: component, installedVersion, pomXmlText: pom.pomXmlText,
          dependencyTreeText: '', controllingFilePath: 'pom.xml', groundedSha: pom.sha || '0'.repeat(40),
        });
        return classifySecurityAutoFixEligibility(
          { source, ecosystem: 'MAVEN', pkg: component, installedVersion, fixedVersions: [fixedVersion] },
          provenance,
        ).remediationType;
      } catch { return 'DEVELOPER_ACTION_REQUIRED'; }
    };
    const candidates: Candidate[] = findings.map(finding => ({ source, finding, fingerprint: findingFingerprint(source, finding) }));
    const existing = await this.repo.find({ where: { projectId: incident.projectId, source } });
    const byFingerprint = new Map(existing.map(t => [t.findingFingerprint, t]));
    const byAlias = new Map<string, ManualRemediationTask[]>();
    for (const task of existing) for (const key of taskFingerprintAliases(task)) {
      byAlias.set(key, [...(byAlias.get(key) || []), task]);
    }
    const seenTaskIds = new Set<string>();
    const owaspMatches = new Map<string, ManualRemediationTask>();
    const claimed = new Map<string, string>();
    if (source === 'OWASP') for (const candidate of candidates) {
      const legacy = owaspLegacyFingerprint(candidate.finding);
      const legacyTask = legacy ? byFingerprint.get(legacy) : null;
      const matches = [...new Map([...(legacyTask ? [legacyTask] : []), ...(byAlias.get(candidate.fingerprint) || [])].map(task => [task.id, task])).values()];
      if (matches.length > 1) throw new BadRequestException('Correspondance OWASP ambiguë : plusieurs tâches pour le même composant.');
      const task = matches[0];
      if (!task) continue;
      const previousPackage = task.findingSnapshot?.packageType === 'maven' ? task.findingSnapshot?.pkg : null;
      const freshComponent = this.resolveOwaspIdentity(candidate.finding, task.findingSnapshot).component;
      if ((owaspMatches.has(candidate.fingerprint) && owaspMatches.get(candidate.fingerprint).id !== task.id)
        || (previousPackage && freshComponent && previousPackage !== freshComponent)
        || (claimed.has(task.id) && claimed.get(task.id) !== candidate.fingerprint)) {
        throw new BadRequestException('Correspondance OWASP ambiguë : identité Maven contradictoire.');
      }
      claimed.set(task.id, candidate.fingerprint);
      owaspMatches.set(candidate.fingerprint, task);
    }
    for (const candidate of candidates) {
      const f = candidate.finding;
      let task = source === 'OWASP' ? owaspMatches.get(candidate.fingerprint) || byFingerprint.get(candidate.fingerprint) : byFingerprint.get(candidate.fingerprint);
      const snapshot = this.snapshot(source, f, task?.findingSnapshot, trivyFixedVersionIndex);
      if (!task) {
        task = this.repo.create({ projectId: incident.projectId, incidentId: incident.id, findingId: String(f.id || f.key || f.VulnerabilityID || f.pluginid || '') || null, findingFingerprint: candidate.fingerprint, source, ruleOrCve: snapshot.ruleOrCve, title: snapshot.title, severity: snapshot.severity, remediationType: classifyDependency(snapshot) ?? (f.remediationType || 'DEVELOPER_ACTION_REQUIRED'), findingSnapshot: snapshot, status: ManualRemediationStatus.TODO, scannerStatus: ScannerFindingStatus.DETECTED, lastSeenBuild: build, events: [] });
        task.events = [this.event(null, null, task.status, 'CREATED', build)];
      } else {
        if (task.status === ManualRemediationStatus.VERIFIED) {
          const old = task.status;
          task.status = ManualRemediationStatus.REOPENED;
          task.events = [...(task.events || []), this.event(null, old, task.status, 'REAPPEARED', build)];
        }
        task.incidentId = incident.id;
        task.findingId = String(f.id || f.key || f.VulnerabilityID || f.pluginid || '') || task.findingId;
        task.findingSnapshot = snapshot;
        const recomputed = classifyDependency(snapshot);
        if (recomputed) task.remediationType = recomputed as any;
        task.severity = snapshot.severity;
        task.scannerStatus = task.status === ManualRemediationStatus.DONE_BY_USER ? ScannerFindingStatus.STILL_DETECTED : ScannerFindingStatus.DETECTED;
        task.lastSeenBuild = build;
      }
      const saved = await this.repo.save(task);
      byFingerprint.set(candidate.fingerprint, saved);
      seenTaskIds.add(saved.id);
    }
    for (const task of existing.filter(t => !seenTaskIds.has(t.id) && t.status !== ManualRemediationStatus.VERIFIED)) {
      const old = task.status;
      task.status = ManualRemediationStatus.VERIFIED;
      task.scannerStatus = ScannerFindingStatus.NOT_DETECTED;
      task.verifiedBuild = build;
      task.verifiedAt = new Date();
      task.events = [...(task.events || []), this.event(null, old, task.status, 'VERIFIED_BY_SCANNER', build)];
      await this.repo.save(task);
    }
  }

  /** Résout l'identité Maven (component/version) d'un finding OWASP, en préservant une identité déjà validée si le finding brut ne permet pas de la re-dériver. */
  private resolveOwaspIdentity(f: any, existingSnapshot?: any): { component: string | null; currentVersion: string | null; owaspIdentity: Record<string, any> } {
    const MAVEN_COORDINATE_RE = /^[A-Za-z0-9_.-]+:[A-Za-z0-9_.-]+$/;
    const freshIdentity = (f.packageType === 'maven' && typeof f.pkg === 'string' && MAVEN_COORDINATE_RE.test(f.pkg) && f.purl)
      ? { groupId: f.groupId || f.pkg.split(':')[0], artifactId: f.artifactId || f.pkg.split(':')[1], installedVersion: f.installedVersion || '', pkg: f.pkg, purl: f.purl }
      : resolveOwaspMavenIdentity(f);
    const rawLegacyPackage = String(f.legacyPackage || f.fileName || f.file || f.dependency || f.package || f.pkg || '').trim() || null;
    if (freshIdentity) {
      return {
        component: freshIdentity.pkg, currentVersion: freshIdentity.installedVersion,
        owaspIdentity: {
          pkg: freshIdentity.pkg, purl: freshIdentity.purl, packageType: 'maven',
          installedVersion: freshIdentity.installedVersion, legacyPackage: rawLegacyPackage || freshIdentity.pkg,
          groupId: freshIdentity.groupId, artifactId: freshIdentity.artifactId,
        },
      };
    }
    const existingIsMaven = existingSnapshot?.packageType === 'maven' && !!existingSnapshot?.component && !!existingSnapshot?.legacyPackage;
    if (existingIsMaven && existingSnapshot.legacyPackage === rawLegacyPackage) {
      return {
        component: existingSnapshot.component, currentVersion: existingSnapshot.installedVersion,
        owaspIdentity: {
          pkg: existingSnapshot.pkg ?? existingSnapshot.component, purl: existingSnapshot.purl ?? null, packageType: 'maven',
          installedVersion: existingSnapshot.installedVersion ?? null, legacyPackage: existingSnapshot.legacyPackage,
          groupId: existingSnapshot.groupId ?? null, artifactId: existingSnapshot.artifactId ?? null,
        },
      };
    }
    return {
      component: rawLegacyPackage, currentVersion: f.installedVersion || null,
      owaspIdentity: {
        pkg: rawLegacyPackage, purl: null, packageType: null,
        installedVersion: f.installedVersion || null, legacyPackage: rawLegacyPackage,
        groupId: null, artifactId: null,
      },
    };
  }

  /** Construit l'instantané présentable d'un finding brut (titre, sévérité, composant, version corrigée...) à partir de sa forme scanner native. */
  private snapshot(source: string, f: any, existingSnapshot?: any, trivyFixedVersionIndex?: ReturnType<typeof buildTrivyFixedVersionIndex>) {
    const ruleOrCve = String(f.id || f.VulnerabilityID || f.cve || f.rule || f.alertRef || f.pluginid || f.name || 'Non disponible');
    const owaspResolved = source === 'OWASP' ? this.resolveOwaspIdentity(f, existingSnapshot) : null;
    const owaspIdentity = owaspResolved?.owaspIdentity ?? {};
    const nativeFixedVersion = f.fixedVersion || f.FixedVersion || null;
    let fixedVersion: string | null = nativeFixedVersion;
    let fixedVersionSource: 'TRIVY_CORRELATED' | null = null;
    let fixedVersionEvidence: any = null;
    let fixedVersionUnavailableReason: 'MULTIPLE_CANDIDATES' | 'NO_TRIVY_MATCH' | null = null;
    if (source === 'OWASP') {
      const correlation = qualifyOwaspFixedVersionCorrelation(
        { cve: ruleOrCve, pkg: owaspResolved?.component || '', installedVersion: owaspResolved?.currentVersion || '' },
        trivyFixedVersionIndex || new Map(),
      );
      const resolved = resolveOwaspFixedVersion(nativeFixedVersion, existingSnapshot, correlation);
      fixedVersion = resolved.fixedVersion;
      fixedVersionSource = resolved.fixedVersionSource;
      fixedVersionEvidence = resolved.fixedVersionEvidence;
      fixedVersionUnavailableReason = resolved.fixedVersionUnavailableReason;
    }
    const component = source === 'OWASP' ? owaspResolved!.component : (f.pkg || f.PkgName || f.package || f.fileName || f.dependency || null);
    const currentVersion = source === 'OWASP' ? owaspResolved!.currentVersion : (f.installedVersion || f.InstalledVersion || f.version || null);
    return { ...owaspIdentity, source, ruleOrCve, title: String(f.title || f.Title || f.alert || f.name || f.description || ruleOrCve), severity: String(f.severity || f.Severity || f.risk || 'UNKNOWN').toUpperCase().split(' ')[0], component, currentVersion, fixedVersion, fixedVersionSource, fixedVersionEvidence, fixedVersionUnavailableReason, description: f.description || f.Description || f.desc || null, evidence: f.evidence || null, recommendation: f.recommendation || f.solution || null, url: f.url || null, parameter: f.param || f.parameter || null };
  }

  /** Vérifie que le contexte de tentative WF6 fourni (lot + identités) correspond bien aux tentatives actuellement actives, sans poser de verrou. */
  async verifyWf6AttemptContext(projectId: string, findingTaskIds: string[], batchId: string,
    attempts: { findingTaskId: string; attemptId: string; attemptNumber: number }[]) {
    if (!batchId || !attempts || attempts.length !== findingTaskIds.length || new Set(attempts.map(a => a.findingTaskId)).size !== attempts.length) throw new ConflictException('Contexte de tentative WF6 incomplet.');
    for (const id of findingTaskIds) {
      const task = await this.repo.findOne({ where: { id } });
      const identity = attempts.find(a => a.findingTaskId === id);
      if (!task || task.projectId !== projectId || !identity) throw new ConflictException('Contexte de tentative WF6 incorrect.');
      const a = assertCorrelation(task, { ...identity, batchId });
      if (a.finishedAt || task.securityFindingRemediation.status !== 'DISPATCHING') throw new ConflictException('Cette tentative WF6 n’est plus active.');
    }
  }

  /** Vérifie que chaque tâche possède bien, dans la réservation de son fichier cible, une revendication active cohérente avec sa tentative en cours. */
  async verifyWf6TargetOwnership(projectId: string, ids: string[], modern = false) {
    for (const id of ids) {
      const task = await this.repo.findOne({ where: { id } });
      if (!task || task.projectId !== projectId) throw new ConflictException('REMEDIATION_TARGET_OWNERSHIP_REQUIRED');
      const key = productionTarget(task);
      const [reservation] = await this.repo.manager.query(`SELECT claims FROM remediation_target_reservations
        WHERE "projectId"=$1 AND "targetKey"=$2 AND state='ACTIVE'`, [key.projectId, key.targetKey]);
      const claim = reservation?.claims?.[id];
      const r = task.securityFindingRemediation;
      if (!claim || claim.status !== 'DISPATCHING' || r?.status !== 'DISPATCHING' ||
          claim.attemptId !== (r.attemptId || null) || claim.batchId !== r.batchId ||
          (!modern && r.attemptId) || Object.entries(reservation.claims).some(([owner, c]: [string, any]) =>
            !ids.includes(owner) && ['RESERVED','DISPATCHING'].includes(c.status))) {
        throw new ConflictException({ code: 'REMEDIATION_TARGET_OWNERSHIP_REQUIRED', status: 'TARGET_BUSY',
          message: 'La cible n’appartient pas à cette tentative de correction.' });
      }
    }
  }

  /** Enregistre le résultat WF6 d'une seule CVE en le traitant comme un lot d'un seul élément (le mono-CVE est le cas particulier N=1 du multi). */
  async recordWf6Result(dto: Wf6RemediationResultDto) {
    const [task] = await this.recordWf6BatchResult({ ...dto, batchId: dto.batchId,
      findings: [{ ...dto, cveId: 'UNKNOWN' }] } as Wf6BatchRemediationResultDto);
    return task;
  }

  /** Relance une correction automatique déjà tentée pour une seule tâche, en réutilisant le lancement de lot avec un lot d'un seul élément. */
  async retrySecurityRemediation(taskId: string, input: RetrySecurityRemediationDto, user: any) {
    if (!['developer', 'admin'].includes(String(user?.role || '').toLowerCase())) throw new ForbiddenException('Action non autorisée');
    assertSecurityRemediationDispatchEnabled();
    const task = await this.repo.findOne({ where: { id: taskId } });
    if (!task) throw new NotFoundException('Tâche de correction introuvable.');
    return this.launchBatchRemediation(task.projectId, [task.id], user, { retryOnly: true, expectedAttemptId: input.expectedAttemptId || task.securityFindingRemediation?.attemptId, expectedLegacyState: task.securityFindingRemediation?.attemptId ? undefined : JSON.stringify(task.securityFindingRemediation) });
  }

  /** Refuse une sélection déjà corrigée sur la branche par défaut (scan antérieur à la fusion), avant toute réservation ; ignoré si GitHub est injoignable. */
  private async assertSelectionNotFixedOnDefaultBranch(projectId: string, findingTaskIds: string[]) {
    const ids = [...new Set((findingTaskIds || []).map(String))];
    const project = this.projects ? await this.projects.findOne({ where: { id: projectId } }) : null;
    const repository = String(project?.githubRepo || '').replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '').trim();
    if (!ids.length || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) return;
    const tasks = await this.repo.find({ where: { id: In(ids) } });
    const remote = await fetchDefaultBranchPom(repository, project?.githubToken);
    if (remote) assertNotAlreadyFixedOnDefaultBranch(remote.pom, tasks.filter(t => String(t.projectId) === String(projectId)), remote.branch);
  }

  /** Lance (ou réessaie) une correction automatique pour un lot de 1 à 8 CVE. */
  async launchBatchRemediation(projectId: string, findingTaskIds: string[], user: any,
    operation: { retryOnly?: boolean; expectedAttemptId?: string; expectedLegacyState?: string } = {}) {
    const role = String(user?.role || '').toLowerCase();
    if (role === 'viewer' || !['developer', 'admin'].includes(role)) throw new ForbiddenException('Action non autorisée');

    assertSecurityRemediationDispatchEnabled();
    if (this.retryE2E) await this.retryE2E.assertInitialScope(projectId, [...new Set(findingTaskIds || [])], true);
    if (!operation.retryOnly) await this.assertSelectionNotFixedOnDefaultBranch(projectId, findingTaskIds);
    const reserved = await this.repo.manager.transaction(async manager => {
      const repo = manager.getRepository(ManualRemediationTask);
      const project = await manager.getRepository(Project).findOne({ where: { id: projectId } });
      if (!project) throw new NotFoundException('Projet introuvable.');
      const ids = [...new Set((findingTaskIds || []).map(String))];
      if (!ids.length) throw new BadRequestException('Au moins une CVE doit être sélectionnée.');
      if (ids.length > MAX_FINDINGS_PER_REMEDIATION_BATCH) throw new BadRequestException(`Un lot ne peut pas dépasser ${MAX_FINDINGS_PER_REMEDIATION_BATCH} CVE.`);

      const locked: ManualRemediationTask[] = [];
      for (const id of [...ids].sort()) {
        const task = await repo.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
        if (task) locked.push(task);
      }
      const tasks = ids.map(id => locked.find(t => t.id === id)).filter(Boolean) as ManualRemediationTask[];
      const byId = new Map(tasks.map(t => [t.id, t]));
      const missing = ids.filter(id => !byId.has(id));
      if (missing.length) throw new NotFoundException(`Tâche(s) de correction introuvable(s) : ${missing.join(', ')}.`);

      const mismatched = tasks.filter(t => String(t.projectId) !== String(projectId));
      if (mismatched.length) throw new ForbiddenException(`Tâche(s) ne correspondant pas au projet déclaré : ${mismatched.map(t => t.ruleOrCve || t.id).join(', ')}.`);

      for (const task of tasks) {
        if (operation.expectedLegacyState && JSON.stringify(task.securityFindingRemediation) !== operation.expectedLegacyState) throw new ConflictException('La tentative historique attendue n’est plus actuelle.');
        if (operation.retryOnly) assertRetryAllowed(task, operation.expectedAttemptId);
        else if ((task.securityFindingRemediation as any)?.targetFinalizedReason === 'PR_MERGED') {
          const sr: any = task.securityFindingRemediation;
          const pr = Number(sr.prNumber) > 0 ? Number(sr.prNumber) : Number((String(sr.prUrl || '').match(/\/pull\/(\d+)\/?$/) || [])[1]);
          throw new ConflictException(`${task.ruleOrCve || task.id} a déjà été corrigé par la Pull Request${pr > 0 ? ' #' + pr : ''} fusionnée. Choisissez une autre vulnérabilité. Aucune nouvelle correction n’a été lancée.`);
        }
        else if (task.securityFindingRemediation) throw new ConflictException(`Une tentative existe déjà pour ${task.ruleOrCve || task.id} ; utilisez Réessayer.`);
        else { assertLegacyReadmission(task); assertNoSideEffect(task); }
        if (!['TRIVY', 'OWASP'].includes(task.source)) throw new ConflictException('Scanner non pris en charge.');
        if (!/^[A-Za-z0-9_.-]+:[A-Za-z0-9_.-]+$/.test(String(task.findingSnapshot?.component || ''))) throw new ConflictException('Coordonnées Maven invalides.');
      }

      const adminOnly = tasks.filter(t => t.remediationType === 'ADMIN_ACTION_REQUIRED');
      if (adminOnly.length && role !== 'admin') {
        throw new ForbiddenException(`Nécessite l’intervention d’un administrateur : ${adminOnly.map(t => t.ruleOrCve || t.id).join(', ')}.`);
      }

      const v1_8CompleteOverride = new Set<string>();
      if (v1_8EnforcementMode() === 'ENFORCED') {
        for (const t of tasks) {
          if (t.findingSnapshot?.fixedVersion) continue;
          const context = await this.resolveV1_8DispatchContext(t);
          if (!context) continue;
          const evidence = this.v1_8Decisions.lookup(t.source, String(t.ruleOrCve), String(t.findingSnapshot?.component), String(t.findingSnapshot?.currentVersion || ''));
          const gate = canDispatchSecurityRemediationV1_8({ ...context, source: t.source, cve: String(t.ruleOrCve), component: String(t.findingSnapshot?.component), installedVersion: String(t.findingSnapshot?.currentVersion || ''), statusPermitsDispatch: true }, evidence);
          if (gate.decision === 'ALLOW') v1_8CompleteOverride.add(t.id);
        }
      }

      const incomplete = tasks.filter(t => !t.source || !t.ruleOrCve || !t.findingSnapshot?.component || !t.findingSnapshot?.currentVersion || (!t.findingSnapshot?.fixedVersion && !v1_8CompleteOverride.has(t.id)));
      if (incomplete.length) {
        throw new BadRequestException(`Donnée insuffisante pour lancer une correction automatisée : ${incomplete.map(t => t.ruleOrCve || t.id).join(', ')}.`);
      }

      const alreadyInProgress = tasks.filter(t => ['CANDIDATE_READY', 'DISPATCHING'].includes(t.securityFindingRemediation?.status));
      if (alreadyInProgress.length) {
        throw new ConflictException(`Déjà en cours ou déjà proposée(s), sélection refusée : ${alreadyInProgress.map(t => t.ruleOrCve).join(', ')}.`);
      }

      const byComponent = new Map<string, ManualRemediationTask[]>();
      for (const t of tasks) {
        const key = String(t.findingSnapshot.component).toLowerCase();
        byComponent.set(key, [...(byComponent.get(key) || []), t]);
      }
      const colliding = [...byComponent.values()].filter(group => group.length > 1).filter(group => {
        const plans = group.map(t => this.v1_8Decisions.lookup(t.source, String(t.ruleOrCve), String(t.findingSnapshot.component), String(t.findingSnapshot.currentVersion || '')));
        const first = plans[0];
        return !(first.editType === 'PARENT_VERSION' && first.actualEditTarget && plans.every(p =>
          p.editType === 'PARENT_VERSION' && p.actualEditTarget === first.actualEditTarget && p.fromVersion === first.fromVersion && p.toVersion === first.toVersion));
      });
      if (colliding.length) {
        const detail = colliding.map(group => `${group[0].findingSnapshot.component} (${group.map(t => t.ruleOrCve).join(' vs ')})`).join('; ');
        throw new ConflictException(`Plusieurs CVE sélectionnées sur le même composant Maven — non supporté dans un même lot : ${detail}.`);
      }

      let v1_8ValidatedFindings: Wf6ValidatedFindingPayload[] | undefined;
      if (v1_8EnforcementMode() === 'ENFORCED' || tasks.some(t => !!legacyArchive(t))) {
        v1_8ValidatedFindings = [];
        for (const task of tasks) {
          const context = await this.resolveV1_8DispatchContext(task);
          if (!context) throw new ConflictException(`Contexte de dépôt/commit introuvable pour la correction — dispatch refusé : ${task.ruleOrCve || task.id}.`);
          assertLegacyReadmission(task, context.commitSha);
          const evidence = this.v1_8Decisions.lookup(task.source, String(task.ruleOrCve), String(task.findingSnapshot.component), String(task.findingSnapshot.currentVersion || ''));
          const gate = canDispatchSecurityRemediationV1_8({ ...context, source: task.source, cve: String(task.ruleOrCve), component: String(task.findingSnapshot.component), installedVersion: String(task.findingSnapshot.currentVersion || ''), statusPermitsDispatch: true }, evidence);
          if (gate.decision !== 'ALLOW') {
            throw new ConflictException(`Validation V1.8 refusée pour ${task.ruleOrCve || task.id} : ${gate.reason}.`);
          }
          v1_8ValidatedFindings.push(buildWf6ValidatedFindingPayload(task.id, gate.evidence));
        }
      }

      const targets = new Map<string, { key: ReturnType<typeof productionTarget>; tasks: ManualRemediationTask[] }>();
      for (const task of tasks) {
        const key = productionTarget(task);
        const group = targets.get(key.targetKey) || { key, tasks: [] };
        group.tasks.push(task); targets.set(key.targetKey, group);
      }
      const targetReservations = new Map<string, string>();
      for (const [key, group] of [...targets.entries()].sort(([a], [b]) => a.localeCompare(b))) {
        targetReservations.set(key, await reserveTarget(manager, group.key, group.tasks.map(t => t.id)));
      }

      const batchId = 'sec-batch-' + randomUUID();
      const dispatchedAt = new Date().toISOString();
      const v1_8PlanByTaskId = new Map((v1_8ValidatedFindings || []).map(f => [f.findingTaskId, f.remediationPlan]));
      const attempts = tasks.map(task => {
        const attempt = reserveAttempt(task, batchId, dispatchedAt);
        task.securityFindingRemediation.v1_8Plan = v1_8PlanByTaskId.get(task.id) ?? null;
        return { findingTaskId: task.id, attemptId: attempt.attemptId!, attemptNumber: attempt.attemptNumber };
      });
      for (const task of tasks) await bindTargetAttempt(manager, targetReservations.get(productionTarget(task).targetKey)!, task);
      await repo.save(tasks);
      const payload: Wf6BatchDispatchPayload = { projectId, batchId, findingTaskIds: ids, attempts,
        ...(v1_8ValidatedFindings ? { v1_8ValidatedFindings } : {}) };
      return { payload };
    });

    try {
      await this.wf6BatchDispatcher.dispatch(reserved.payload);
    } catch (err: any) {
      await this.repo.manager.transaction(async manager => {
        const repo = manager.getRepository(ManualRemediationTask);
        for (const identity of [...reserved.payload.attempts!].sort((a,b) => a.findingTaskId.localeCompare(b.findingTaskId))) {
          const task = await repo.findOne({ where: { id: identity.findingTaskId }, lock: { mode: 'pessimistic_write' } });
          if (!task || task.securityFindingRemediation?.attemptId !== identity.attemptId || task.securityFindingRemediation.status !== 'DISPATCHING') continue;
          completeAttempt(task, { ...identity, batchId: reserved.payload.batchId }, {
            status: 'DISPATCH_FAILED', reasonCode: 'DISPATCH_FAILED', reason: 'DISPATCH_FAILED',
            unresolvedGitSideEffect: true,
          });
          await settleTargetClaim(manager, task);
          await repo.save(task);
        }
      });
      throw new ConflictException('La correction n’a pas pu démarrer ; vérifiez le dispatch avant toute relance.');
    }
    return { ...reserved.payload, status: 'DISPATCHING' };
  }

  /** Enregistre le résultat d'un lot WF6. */
  async recordWf6BatchResult(dto: Wf6BatchRemediationResultDto, manager?: EntityManager) {
    /** Applique la mise à jour prévue aux données. */
    const apply = async (tx: EntityManager) => {
      const repo = tx.getRepository(ManualRemediationTask);
      if (!dto.findings?.length || new Set(dto.findings.map(f => f.findingTaskId)).size !== dto.findings.length) throw new ConflictException('Résultat WF6 vide ou dupliqué.');
      if ((dto.attemptId !== undefined || dto.attemptNumber !== undefined) &&
          (dto.findings.length !== 1 || dto.attemptId !== dto.findings[0].attemptId || dto.attemptNumber !== dto.findings[0].attemptNumber)) {
        throw new ConflictException('L’identité moderne doit être complète sur chaque finding.');
      }
      const tasks = new Map<string, ManualRemediationTask>();
      for (const id of dto.findings.map(f => f.findingTaskId).sort()) {
        const task = await repo.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
        if (!task) throw new NotFoundException('Tâche de correction introuvable pour ce résultat WF6.');
        if (task.projectId !== dto.projectId) throw new ForbiddenException('Projet du résultat WF6 incorrect.');
        tasks.set(id, task);
      }
      const contract = callbackContract(dto);
      /** Construit le résultat associé à l’élément demandé. */
      const resultFor = (f: Wf6BatchRemediationResultDto['findings'][number]) => {
        const status = ['CLOSED', 'STILL_OPEN', 'NOT_OBSERVED', 'PENDING'].includes(f.status) ? dto.status : f.status;
        return {
          status: ['PR_CREATED', 'PR_REUSED'].includes(status) ? 'CANDIDATE_READY' : status,
          candidateStatus: f.status, batchStatus: dto.status,
          reason: f.reason ?? dto.reason ?? null,
          reasonCode: f.reasonCode || dto.reasonCode || (f.status === 'PENDING' ? dto.reason : f.reason) || dto.reason || f.status,
          executionId: dto.executionId ?? null, prUrl: dto.prUrl ?? null, prNumber: dto.prNumber ?? null,
          branchName: dto.branchName ?? null, candidateSha: dto.evaluatedSha ?? null,
          candidateIdentity: dto.candidateIdentity ?? null, evaluatedSha: dto.evaluatedSha ?? null,
          patchEvidence: f.patchEvidence ?? null, securityValidationEvidence: f.securityValidationEvidence ?? null,
          verificationEvidence: { candidateStatus: f.status, securityValidationEvidence: f.securityValidationEvidence ?? null },
          unresolvedGitSideEffect: dto.unresolvedGitSideEffect === true || ['PR_CREATE_FAILED', 'BRANCH_CREATE_FAILED', 'PR_HEAD_DRIFT_CLEANUP_FAILED', 'WRITE_CONFLICT'].includes(f.reason || f.status),
        };
      };
      for (const f of dto.findings) {
        const task = tasks.get(f.findingTaskId)!;
        if (f.cveId !== 'UNKNOWN' && f.cveId !== task.ruleOrCve) throw new ConflictException('Identité CVE du résultat WF6 incorrecte.');
        if (contract === 2) assertCorrelation(task, { attemptId: f.attemptId, attemptNumber: f.attemptNumber, batchId: dto.batchId });
        else assertLegacyCallback(task, dto.batchId, resultFor(f));
      }
      const saved: ManualRemediationTask[] = [];
      for (const f of dto.findings) {
        const task = tasks.get(f.findingTaskId)!;
        const result = resultFor(f);
        const changed = contract === 2
          ? completeAttempt(task, { attemptId: f.attemptId, attemptNumber: f.attemptNumber, batchId: dto.batchId }, result)
          : completeLegacyAttempt(task, dto.batchId, result);
        if (changed) await settleTargetClaim(tx, task);
        saved.push(changed ? await repo.save(task) : task);
      }
      return saved;
    };
    return manager ? apply(manager) : this.repo.manager.transaction(apply);
  }

  /** Réconciliation réservée aux administrateurs d'un batch WF6 resté bloqué à DISPATCHING depuis plus que le seuil configuré, en le terminant en échec technique. */
  async reconcileStaleWf6Dispatch(taskId: string, input: ReconcileStaleWf6DispatchDto, user: any) {
    if (!user || String(user.role || '').toLowerCase() !== 'admin') {
      throw new ForbiddenException('Seul un administrateur peut réconcilier un dispatch WF6 obsolète.');
    }
    const configuredThreshold = Number(process.env.WF6_STALE_DISPATCH_MS || 30 * 60 * 1000);
    if (!Number.isFinite(configuredThreshold) || configuredThreshold <= 0) {
      throw new ServiceUnavailableException('Le seuil de dispatch WF6 obsolète est invalide.');
    }
    const requestedAttemptCount = Number(input?.attemptCount);
    const result = await this.repo.manager.transaction(async manager => {
      const repo = manager.getRepository(ManualRemediationTask);
      const task = await repo.findOne({ where: { id: taskId }, lock: { mode: 'pessimistic_write' } });
      if (!task) throw new NotFoundException('Tâche de correction introuvable.');
      const current: any = task.securityFindingRemediation || {};

      if (current.status !== 'DISPATCHING') {
        return { applied: false, alreadyTerminal: true, status: current.status ?? null, task };
      }
      if (current.batchId !== input?.batchId) {
        throw new ConflictException('La récupération ne correspond pas au lot WF6 demandé.');
      }
      if (!Number.isInteger(requestedAttemptCount) || requestedAttemptCount < 1 || requestedAttemptCount !== Number(current.attemptCount)) {
        throw new ConflictException('La récupération ne correspond pas à la tentative WF6 active (une tentative plus récente existe peut-être déjà).');
      }
      if (task.securityRemediationBatchId && task.securityRemediationBatchId !== input.batchId) {
        throw new ConflictException('La récupération ne correspond pas au lot WF6 enregistré pour cette tâche.');
      }
      if (current.prUrl || current.prNumber) {
        throw new ConflictException('Une Pull Request est déjà enregistrée pour cette tentative WF6 — réconciliation refusée.');
      }
      const attempts = Array.isArray(current.attempts) ? current.attempts : [];
      const activeAttempt = current.attemptId
        ? attempts.find((entry: any) => entry.attemptId === current.attemptId)
        : attempts.find((entry: any) => Number(entry?.attemptNumber || entry?.attempt) === requestedAttemptCount);
      if (!activeAttempt) throw new ConflictException('La tentative WF6 à récupérer est introuvable.');
      const dispatchedAt = Date.parse(String(activeAttempt.startedAt || activeAttempt.at || current.updatedAt || ''));
      if (!Number.isFinite(dispatchedAt)) {
        throw new ConflictException('L’horodatage de dispatch WF6 est absent ou invalide.');
      }
      const recoveredAt = new Date().toISOString();
      if (Date.parse(recoveredAt) - dispatchedAt < configuredThreshold) {
        throw new ConflictException('Le dispatch WF6 n’a pas dépassé le seuil de récupération.');
      }

      const underlyingReasonCode = activeAttempt.underlyingReasonCode || activeAttempt.reasonCode || current.underlyingReasonCode;
      const result = { status: 'TECHNICAL_FAILURE', reason: 'WF6_STALE_DISPATCH_RECONCILED',
        reasonCode: 'WF6_STALE_DISPATCH_RECONCILED', underlyingReasonCode,
        unresolvedGitSideEffect: true };
      if (current.attemptId) {
        completeAttempt(task, { attemptId: current.attemptId, attemptNumber: current.attemptNumber, batchId: current.batchId }, result, recoveredAt);
      } else {
        const normalized = normalizeSecurityRemediation(current)!;
        const policy = classifySecurityRemediationFailure(result);
        const legacyNumber = Number(activeAttempt.attemptNumber || activeAttempt.attempt);
        task.securityFindingRemediation = { ...normalized, ...result, ...policy, retryable: policy.retryable, updatedAt: recoveredAt,
          attempts: normalized.attempts.map(a => a.attemptNumber === legacyNumber ? { ...a, ...result,
            reasonMessage: policy.safeMessage, retryable: policy.retryable, finishedAt: recoveredAt, legacyAttempt: true } : a) };
      }
      await settleTargetClaim(manager, task);
      await repo.save(task);

      const reloaded = await repo.findOne({ where: { id: taskId } });
      return { applied: true, alreadyTerminal: false, status: 'TECHNICAL_FAILURE', task: reloaded! };
    });

    return {
      success: true, applied: result.applied, alreadyTerminal: result.alreadyTerminal,
      taskId, batchId: input.batchId, attemptCount: input.attemptCount,
      status: result.status,
    };
  }

  /** Abandonne volontairement la réservation du fichier cible d'une tâche (réservé aux administrateurs), après vérification qu'aucun effet Git résiduel n'est en jeu. */
  async abandonTarget(taskId: string, expectedAttemptId: string, user: any) {
    if (String(user?.role).toLowerCase() !== 'admin') throw new ForbiddenException('Administrateur requis.');
    return this.repo.manager.transaction(async tx => {
      const repo = tx.getRepository(ManualRemediationTask);
      const task = await repo.findOne({ where: { id: taskId }, lock: { mode: 'pessimistic_write' } });
      if (!task) throw new NotFoundException();
      const r = task.securityFindingRemediation;
      if (!expectedAttemptId || r?.attemptId !== expectedAttemptId || !r.finishedAt || r.status === 'DISPATCHING') throw new ConflictException('Tentative terminée attendue requise.');
      const verified = isProjectFixVerified(task) && ['CANDIDATE_READY','CLOSED'].includes(r.status);
      if (!verified) {
        assertNoSideEffect(task);
        if (!classifySecurityRemediationFailure(r).retryable && !safeTerminalTargetRelease(r)) throw new ConflictException('Issue distante incertaine : réconciliation requise.');
      }
      await releaseTargetClaim(tx, task, (verified ? 'PROJECT_VERIFIED:' : 'ADMIN_ABANDONED:') + String(user.id || 'admin'));
      task.securityFindingRemediation = verified
        ? { ...r, targetFinalizedAt: new Date().toISOString(), targetFinalizedBy: String(user.id || 'admin') }
        : { ...r, status: 'REMEDIATION_ABANDONED', retryable: false,
          abandonedAt: new Date().toISOString(), abandonedBy: String(user.id || 'admin') };
      await repo.save(task);
      return { taskId, status: verified ? 'TARGET_FINALIZED' : 'REMEDIATION_ABANDONED' };
    });
  }

  /** « Merge effectué » : vérifie sur GitHub (sans build) que la PR de la correction est fusionnée dans la branche par défaut, libère le fichier réservé pour tout le lot et autorise une nouvelle correction sur ce fichier, à partir du commit de merge. */
  async confirmPullRequestMerged(taskId: string, user: any) {
    const role = String(user?.role || '').toLowerCase();
    if (!['developer', 'admin'].includes(role)) throw new ForbiddenException('Action non autorisée');
    const task = await this.repo.findOne({ where: { id: taskId } });
    if (!task) throw new NotFoundException('Tâche de correction introuvable.');
    const r: any = task.securityFindingRemediation;
    // Une PR réutilisée (PR_REUSED) n'est enregistrée qu'avec son URL : le numéro en est déduit
    // (Number(null) vaudrait 0 et ferait échouer toutes les vérifications suivantes).
    const prNumber = Number(r?.prNumber) > 0 ? Number(r.prNumber) : Number((String(r?.prUrl || '').match(/\/pull\/(\d+)\/?$/) || [])[1]);
    if (!r || r.status !== 'CANDIDATE_READY' || !r.prUrl || !Number.isSafeInteger(prNumber) || prNumber <= 0) {
      throw new ConflictException('Aucune Pull Request de correction en attente de merge pour cette tâche.');
    }
    if (r.targetFinalizedAt) return { taskId, status: 'TARGET_FINALIZED', alreadyFinalized: true, mergeCommitSha: r.mergeCommitSha || null };
    const project = this.projects ? await this.projects.findOne({ where: { id: task.projectId } }) : null;
    const repository = String(project?.githubRepo || '').replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '').trim();
    if (!repository || !String(r.prUrl).toLowerCase().includes(`github.com/${repository.toLowerCase()}/pull/${prNumber}`)) {
      throw new ConflictException('La Pull Request enregistrée ne correspond pas au dépôt du projet.');
    }
    const headers: Record<string, string> = { Accept: 'application/vnd.github+json' };
    if (project?.githubToken) headers.Authorization = `Bearer ${project.githubToken}`;
    let pr: any;
    // Juste après un merge, l'API GitHub peut encore répondre « non fusionnée » pendant quelques secondes : on relit
    // jusqu'à 4 fois (≈ 9 s) avant de conclure, et `merged_at` fait foi au même titre que `merged`.
    const isMerged = (p: any) => p?.merged === true || (p?.state === 'closed' && typeof p?.merged_at === 'string' && !!p.merged_at);
    for (let attempt = 0; attempt < 4; attempt++) {
      if (attempt) await new Promise(resolve => setTimeout(resolve, 3_000));
      try {
        const res = await fetch(`https://api.github.com/repos/${repository}/pulls/${prNumber}`, { headers: { ...headers, 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(15_000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        pr = await res.json();
      } catch (e: any) {
        // Quota épuisé (403/429) : inutile d'insister, le flux des commits répond tout de suite.
        if (attempt < 3 && !/HTTP (403|429)/.test(String(e?.message))) continue;
        // API refusée (quota anonyme épuisé, HTTP 403/429) ou injoignable : constat par le flux public des commits.
        const feed = await mergeFromCommitFeed(repository, prNumber);
        if (!feed) throw new ServiceUnavailableException(`Impossible de vérifier la Pull Request sur GitHub (${e?.message || e}). Réessayez dans une minute.`);
        pr = { merged: true, state: 'closed', merged_at: feed.mergedAt, merge_commit_sha: feed.mergeCommitSha, base: { ref: 'HEAD', repo: { default_branch: 'HEAD' } } };
        break;
      }
      if (isMerged(pr)) break;
    }
    if (pr && isMerged(pr)) pr = { ...pr, merged: true };
    if (pr?.merged !== true && pr?.state === 'closed') return this.releaseClosedUnmergedPullRequest(task, { ...r, prNumber }, user, role);
    if (pr?.merged !== true) throw new ConflictException(`La Pull Request #${prNumber} n’est pas encore fusionnée sur GitHub.`);
    const defaultBranch = pr?.base?.repo?.default_branch;
    if (!defaultBranch || pr?.base?.ref !== defaultBranch) throw new ConflictException('La Pull Request n’a pas été fusionnée dans la branche par défaut.');
    if (!isFullGitSha(String(pr?.merge_commit_sha || '')) || !pr?.merged_at) throw new ConflictException('GitHub ne fournit pas le commit de merge.');
    const at = new Date().toISOString();
    const finalized = await this.repo.manager.transaction(async tx => {
      const tasks = tx.getRepository(ManualRemediationTask);
      const siblings = await tasks.createQueryBuilder('t').setLock('pessimistic_write')
        .where('t."projectId" = :projectId', { projectId: task.projectId })
        .andWhere(`t."securityFindingRemediation"->>'batchId' = :batchId`, { batchId: String(r.batchId) })
        .andWhere(`(t."securityFindingRemediation"->>'prNumber' = :prNumber OR t."securityFindingRemediation"->>'prUrl' = :prUrl)`,
          { prNumber: String(r.prNumber), prUrl: String(r.prUrl) }).getMany();
      const ids: string[] = [];
      for (const sibling of siblings) {
        const sr: any = sibling.securityFindingRemediation;
        if (!sr || sr.status !== 'CANDIDATE_READY' || sr.targetFinalizedAt) continue;
        await releaseTargetClaim(tx, sibling, 'PR_MERGED:' + String(user.id || role));
        sibling.securityFindingRemediation = { ...sr, prNumber: sr.prNumber ?? prNumber, targetFinalizedAt: at, targetFinalizedBy: String(user.id || role), targetFinalizedReason: 'PR_MERGED',
          prMergedAt: pr.merged_at, mergeCommitSha: String(pr.merge_commit_sha).toLowerCase() } as any;
        await tasks.save(sibling);
        ids.push(sibling.id);
      }
      return ids;
    });
    return { taskId, status: 'TARGET_FINALIZED', finalizedTaskIds: finalized, mergeCommitSha: String(pr.merge_commit_sha).toLowerCase(), prMergedAt: pr.merged_at };
  }

  /** PR de correction fermée SANS merge (constaté sur GitHub) : aucun effet Git ne subsiste sur la branche par défaut, le fichier est libéré et la tentative marquée abandonnée. */
  private async releaseClosedUnmergedPullRequest(task: ManualRemediationTask, r: any, user: any, role: string) {
    const at = new Date().toISOString();
    const released = await this.repo.manager.transaction(async tx => {
      const tasks = tx.getRepository(ManualRemediationTask);
      const siblings = await tasks.createQueryBuilder('t').setLock('pessimistic_write')
        .where('t."projectId" = :projectId', { projectId: task.projectId })
        .andWhere(`t."securityFindingRemediation"->>'batchId' = :batchId`, { batchId: String(r.batchId) })
        .andWhere(`(t."securityFindingRemediation"->>'prNumber' = :prNumber OR t."securityFindingRemediation"->>'prUrl' = :prUrl)`,
          { prNumber: String(r.prNumber), prUrl: String(r.prUrl) }).getMany();
      const ids: string[] = [];
      for (const sibling of siblings) {
        const sr: any = sibling.securityFindingRemediation;
        if (!sr || sr.status !== 'CANDIDATE_READY' || sr.targetFinalizedAt) continue;
        await releaseTargetClaim(tx, sibling, 'PR_CLOSED_UNMERGED:' + String(user.id || role));
        sibling.securityFindingRemediation = { ...sr, status: 'REMEDIATION_ABANDONED', retryable: false, abandonedAt: at,
          abandonedBy: String(user.id || role), abandonedReason: 'PR_CLOSED_UNMERGED', targetFinalizedAt: at, targetFinalizedReason: 'PR_CLOSED_UNMERGED' } as any;
        await tasks.save(sibling);
        ids.push(sibling.id);
      }
      return ids;
    });
    return { taskId: task.id, status: 'TARGET_RELEASED_PR_CLOSED', finalizedTaskIds: released };
  }

  /** Liste les réservations de fichiers cibles actives depuis plus longtemps que le seuil configuré, sans rien modifier (détection seule). */
  async staleTargets(user: any) {
    if (String(user?.role).toLowerCase() !== 'admin') throw new ForbiddenException('Administrateur requis.');
    const threshold = Number(process.env.WF6_STALE_DISPATCH_MS || 30 * 60 * 1000);
    if (!Number.isFinite(threshold) || threshold <= 0) throw new ServiceUnavailableException('Seuil invalide.');
    return this.repo.manager.query(`SELECT * FROM remediation_target_reservations WHERE state='ACTIVE'
      AND "updatedAt" < now() - ($1::double precision * interval '1 millisecond') ORDER BY "updatedAt"`, [threshold]);
  }

  /** Charge une tâche et vérifie que l'utilisateur a le rôle requis pour l'action demandée (admin pour les tâches ADMIN_ACTION_REQUIRED et pour toute réouverture). */
  private async authorizedTask(id: string, user: any, reopening: boolean) {
    const task = await this.repo.findOne({ where: { id } });
    if (!task) throw new NotFoundException('Tâche de correction manuelle introuvable.');
    const role = String(user?.role || '').toLowerCase();
    if (role === 'viewer' || !['developer', 'admin'].includes(role)) throw new ForbiddenException('Action non autorisée');
    if (task.remediationType === 'ADMIN_ACTION_REQUIRED' && role !== 'admin') throw new ForbiddenException('Cette tâche nécessite l’intervention d’un administrateur.');
    if (reopening && role !== 'admin') throw new ForbiddenException('Seul un administrateur peut rouvrir une tâche.');
    return task;
  }

  /** Construit une entrée d'historique horodatée pour une transition de statut de tâche. */
  private event(user: any, oldStatus: ManualRemediationStatus | null, newStatus: ManualRemediationStatus, reason: ManualRemediationEvent['reason'], buildNumber: number | null): ManualRemediationEvent {
    return { at: new Date().toISOString(), actorId: user?.id ? String(user.id) : null, actorDisplayName: user ? String(user.name || user.email || user.id) : 'Scanner', oldStatus, newStatus, reason, buildNumber };
  }

  /** Résout le dépôt GitHub et le commit SHA source de confiance d'une tâche, pour la porte V1.8 ; renvoie null (jamais d'exception) sur toute donnée manquante. */
  private async resolveV1_8DispatchContext(task: ManualRemediationTask): Promise<{ repository: string; commitSha: string } | null> {
    if (!task.incidentId || !this.projects) return null;
    const [project, incident] = await Promise.all([
      this.projects.findOne({ where: { id: task.projectId } }),
      this.incidents.findOne({ where: { id: task.incidentId } }),
    ]);
    if (!project || !incident) return null;
    const repository = String(project.githubRepo || '').trim();
    if (!repository) return null;
    const buildSha = String((incident.metadata as any)?.sourceCommitSha || '');
    if (!isFullGitSha(buildSha)) return null;
    const commitSha = effectiveBaseSha(buildSha.toLowerCase(), incident.createdAt, await latestConfirmedMerge(this.repo, task.projectId));
    return { repository, commitSha };
  }
}
