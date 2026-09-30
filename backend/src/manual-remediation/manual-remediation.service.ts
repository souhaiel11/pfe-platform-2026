import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { In, Repository } from 'typeorm';
import { Incident } from '../incidents/incident.entity';
import { Project } from '../projects/project.entity';
import { isFullGitSha } from '../candidate-verification/candidate-digest';
import { normalizeReport } from '../common/report-normalizer';
import { findingFingerprint } from './finding-fingerprint';
import { taskFingerprintAliases, owaspLegacyFingerprint } from './owasp-task-identity';
import { buildTrivyFixedVersionIndex, qualifyOwaspFixedVersionCorrelation, resolveOwaspFixedVersion } from './owasp-trivy-fixed-version-correlation';
import { resolveOwaspMavenIdentity } from '../common/owasp-finding-normalizer';
import { withFindingTaskIds } from './finding-task-id-enrichment';
import { ManualRemediationEvent, ManualRemediationStatus, ManualRemediationTask, ScannerFindingStatus } from './manual-remediation.entity';
import { Wf6RemediationResultDto } from '../security-remediation/wf6-remediation-result.dto';
import { Wf6BatchRemediationResultDto } from '../security-remediation/wf6-batch-remediation-result.dto';
import { V1_8CompatibilityDecisionService } from '../dependency-compatibility/v1_8-compatibility-decision.service';
import { canDispatchSecurityRemediationV1_8 } from '../dependency-compatibility/v1_8-security-remediation-gate';
import { v1_8EnforcementMode } from '../dependency-compatibility/v1_8-enforcement-mode';
import { buildWf6ValidatedFindingPayload, Wf6ValidatedFindingPayload } from '../dependency-compatibility/v1_8-remediation-plan-payload.types';

// Increment 1 — WF6's own dispatch contract. Deliberately minimal:
// findingTaskIds only, never the resolved finding detail (cveId/package/
// version) -- WF6's graph re-resolves every finding itself, server-side,
// via the SAME trusted SecurityFindingResolverService the singular path
// already uses (see security-remediation.controller.ts's
// resolveAndEvaluateBatch()) -- exactly the "never trust caller-supplied
// business data" discipline the singular /evaluate path already enforces.
// Sending more than the ids here would be dead weight the graph ignores,
// not a second, competing source of truth.
//
// ★ ONE unified webhook (wf6-security-remediation-evaluate, unchanged
// path) -- not a separate "-batch" endpoint. Per the explicit design
// decision this increment implements ("le mono-CVE est le cas particulier
// N=1 du multi, pas de branche legacy séparée"), a batch of 1 goes through
// this SAME webhook with a one-element findingTaskIds array.
export interface Wf6BatchDispatchPayload {
  projectId: string; batchId: string; findingTaskIds: string[];
  /**
   * V1.8 Phase 5 ticket — Phase 6/7: the validated-plan payload. Present
   * ONLY in ENFORCED mode (v1_8-enforcement-mode.ts), one entry per
   * dispatched finding, built exclusively from evidence that ALREADY
   * passed canDispatchSecurityRemediationV1_8() (ALLOW) -- never present in
   * SHADOW mode, so the wire payload every existing n8n workflow/test has
   * ever seen is completely unchanged unless enforcement is explicitly on.
   * WF6 executes this plan; it must not independently pick a version/owner
   * (see v1_8-security-remediation-gate.ts's own header comment on this
   * architecture rule).
   */
  v1_8ValidatedFindings?: Wf6ValidatedFindingPayload[];
}
export interface Wf6BatchDispatcher { dispatch(payload: Wf6BatchDispatchPayload): Promise<void> }
// Real, production dispatcher — mirrors incidents.service.ts's own WF2
// dispatch pattern (short client-side timeout, n8n does the long work).
// NOT exercised by any test in this increment (no deploy, no WF6 run) —
// see manual-remediation.service.batch.spec.ts's own header comment.
export class HttpWf6BatchDispatcher implements Wf6BatchDispatcher {
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
  constructor(
    @InjectRepository(ManualRemediationTask) private readonly repo: Repository<ManualRemediationTask>,
    @InjectRepository(Incident) private readonly incidents: Repository<Incident>,
    // Wf6BatchDispatcher is a TypeScript interface (erased at runtime) --
    // Nest cannot resolve a DI token for it on its own. @Optional() makes
    // Nest pass `undefined` instead of throwing, which is when this
    // parameter's own default value (a real HttpWf6BatchDispatcher) takes
    // over -- the exact same effect the manual `new ManualRemediationService(
    // repo, incidents, fakeDispatcher)` calls in this module's own spec
    // files get by simply supplying the 3rd argument directly, bypassing
    // Nest's injector entirely.
    @Optional() private readonly wf6BatchDispatcher: Wf6BatchDispatcher = new HttpWf6BatchDispatcher(),
    // V1.8 Phase 4 ticket — additive, read-only, opt-in ONLY (see list()'s
    // own `includeV18` parameter below). Never consulted by
    // launchBatchRemediation()/WF6 dispatch, never written back to any
    // task -- see this service's own header comment for the full boundary.
    @Optional() private readonly v1_8Decisions: V1_8CompatibilityDecisionService = new V1_8CompatibilityDecisionService(),
    // V1.8 Phase 5 ticket — read-only, used ONLY by the new enforcement
    // check in launchBatchRemediation() to resolve the SAME
    // repository/trusted-commit context SecurityFindingResolverService
    // already resolves for the singular /evaluate path (see this file's
    // own resolveV1_8DispatchContext() below for why this is injected
    // directly instead of that service, and manual-remediation.module.ts's
    // own header comment on the circular import it deliberately avoids).
    // Appended LAST and typed optional so every existing positional test
    // constructor call (`new ManualRemediationService(repo, incidents,
    // fakeDispatcher)`) keeps compiling and behaving exactly as before --
    // see resolveV1_8DispatchContext()'s own guard for the (SHADOW-mode-only)
    // absence case.
    @Optional() @InjectRepository(Project) private readonly projects?: Repository<Project>,
  ) {}

  async list(projectId: string, filters: { status?: string; source?: string; severity?: string; includeV18?: boolean } = {}) {
    if (!projectId) throw new BadRequestException('L’identifiant technique projectId est requis.');
    // One-time idempotent backfill for projects whose reports predate this
    // feature. Normal page refreshes only read the already persisted tasks.
    if (await this.repo.count({ where: { projectId } }) === 0) {
      const history = await this.incidents.find({ where: { projectId }, order: { createdAt: 'ASC' } });
      for (const incident of history) await this.syncIncident(incident);
    }
    const where: any = { projectId };
    if (filters.status) where.status = filters.status;
    if (filters.source) where.source = String(filters.source).toUpperCase();
    if (filters.severity) where.severity = String(filters.severity).toUpperCase();
    const tasks = await this.repo.find({ where, order: { updatedAt: 'DESC' } });
    // V1.8 Phase 4 ticket — Phase 2/4/9: additive `v1_8Decision` field,
    // ONLY when explicitly requested. Every existing caller (no query param)
    // gets back exactly the same rows as before this change, byte-for-byte
    // -- see this file's own attachFindingTaskIds() a few lines up for the
    // identical "strict additive, one new field, same convention" pattern
    // already established in this exact module.
    if (!filters.includeV18) return tasks;
    return tasks.map(t => ({
      ...t,
      v1_8Decision: (t.ruleOrCve && t.findingSnapshot?.component)
        ? this.v1_8Decisions.lookup(t.source, t.ruleOrCve, String(t.findingSnapshot.component), String(t.findingSnapshot.currentVersion || ''))
        : null,
    }));
  }

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

  // Increment 1 (sélection multiple CVE, cadrage OPTION A) — appelé par
  // IncidentsService.findAll()/findOne(), les deux endpoints qui servent
  // effectivement enrichedData.trivy/owasp.cves au frontend (GET /incidents,
  // consommé par project-detail.component.ts::loadReports() ->
  // api.getDecisions()). PAS un endpoint propre : une méthode que le
  // consommateur réel appelle avant de répondre, pour éviter d'ajouter une
  // seconde route juste pour un enrichissement.
  //
  // Additif strict (voir finding-task-id-enrichment.ts) : chaque incident
  // ressort avec le MÊME `metadata`, sauf `metadata.enrichedData.trivy/
  // owasp.cves[*].findingTaskId` en plus. Une seule requête groupée sur
  // TOUS les projectId présents dans le lot (jamais une requête par
  // incident) -- le même souci de coût qu'ailleurs dans ce module
  // (reconcileSource() groupe déjà par source/projet).
  async attachFindingTaskIds<T extends { projectId: string; metadata?: any }>(incidents: T[]): Promise<T[]> {
    const projectIds = [...new Set(incidents.map(i => i.projectId).filter(Boolean))];
    if (!projectIds.length) return incidents;
    const tasks = await this.repo.find({ where: { projectId: In(projectIds) } });
    const byKey = new Map<string, string | null>();
    for (const task of tasks) for (const fingerprint of taskFingerprintAliases(task)) {
      const key = `${task.projectId}::${fingerprint}`;
      // An ambiguous alias must never select another task arbitrarily.
      byKey.set(key, byKey.has(key) && byKey.get(key) !== task.id ? null : task.id);
    }
    return incidents.map(incident => {
      const enrichedData = incident.metadata?.enrichedData;
      if (!enrichedData) return incident;
      const lookup = (fingerprint: string) => byKey.get(`${incident.projectId}::${fingerprint}`) ?? null;
      return { ...incident, metadata: { ...incident.metadata, enrichedData: withFindingTaskIds(enrichedData, lookup) } };
    });
  }

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

  async reopen(id: string, user: any) {
    const task = await this.authorizedTask(id, user, true);
    const old = task.status;
    task.status = ManualRemediationStatus.REOPENED;
    task.scannerStatus = ScannerFindingStatus.DETECTED;
    task.verifiedAt = null;
    task.verifiedBuild = null;
    task.events = [...(task.events || []), this.event(user, old, task.status, 'REOPENED_BY_USER', task.lastSeenBuild)];
    // Completion identity/note are retained as historical facts.
    return this.repo.save(task);
  }

  async syncIncident(incidentOrId: Incident | string) {
    const incident = typeof incidentOrId === 'string'
      ? await this.incidents.findOne({ where: { id: incidentOrId } }) : incidentOrId;
    if (!incident?.projectId) return;
    const raw = incident.metadata?.enrichedData ? { enrichedData: incident.metadata.enrichedData } : incident.metadata;
    if (!raw) return;
    const normalized = normalizeReport(raw || {});
    const build = incident.buildNumber ?? incident.metadata?.build?.number ?? incident.metadata?.enrichedData?.build?.number ?? null;
    // Built once per sync, from THIS build's own Trivy findings only -- never
    // across builds/incidents. OWASP-only consumer (see reconcileSource());
    // Trivy's own reconciliation never reads it.
    const trivyFixedVersionIndex = buildTrivyFixedVersionIndex(normalized.trivy?.cves || []);
    const blocks: Array<{ source: string; block: any; findings: any[] }> = [
      { source: 'TRIVY', block: normalized.trivy, findings: normalized.trivy?.cves || [] },
      { source: 'OWASP', block: normalized.owasp, findings: normalized.owasp?.cves || [] },
      { source: 'ZAP', block: normalized.zap, findings: (normalized.zap as any)?.alerts || [] },
    ];
    for (const { source, block, findings } of blocks) {
      // Fail closed: absence is evidence only after a completed scanner result.
      const complete = block?.completed === true || block?.status === 'COMPLETED' || (!block?.status && normalized._sourceFormat === 'legacy');
      if (!complete || block?.resultAvailable === false) {
        if (block?.status) await this.repo.update({ projectId: incident.projectId, source }, { scannerStatus: ScannerFindingStatus.UNAVAILABLE });
        continue;
      }
      await this.reconcileSource(incident, source, findings, build, trivyFixedVersionIndex);
    }
  }

  private async reconcileSource(incident: Incident, source: string, findings: any[], build: number | null, trivyFixedVersionIndex?: ReturnType<typeof buildTrivyFixedVersionIndex>) {
    const candidates: Candidate[] = findings.map(finding => ({ source, finding, fingerprint: findingFingerprint(source, finding) }));
    const existing = await this.repo.find({ where: { projectId: incident.projectId, source } });
    const byFingerprint = new Map(existing.map(t => [t.findingFingerprint, t]));
    const byAlias = new Map<string, ManualRemediationTask[]>();
    for (const task of existing) for (const key of taskFingerprintAliases(task)) {
      byAlias.set(key, [...(byAlias.get(key) || []), task]);
    }
    const seenTaskIds = new Set<string>();
    // Preflight OWASP migration before any save: never reuse one legacy task
    // for two canonical packages, or choose among ambiguous canonical aliases.
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
      // Compare against the RESOLVED component (same resolver snapshot()
      // itself uses just below), never candidate.finding.pkg directly: the
      // raw finding reaching this method is a jar filename, never a Maven
      // coordinate (see resolveOwaspIdentity()'s own header), so comparing
      // it straight against a task's already-validated Maven pkg would flag
      // every ordinary resync as a false "contradictory identity".
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
        task = this.repo.create({ projectId: incident.projectId, incidentId: incident.id, findingId: String(f.id || f.key || f.VulnerabilityID || f.pluginid || '') || null, findingFingerprint: candidate.fingerprint, source, ruleOrCve: snapshot.ruleOrCve, title: snapshot.title, severity: snapshot.severity, remediationType: f.remediationType || 'DEVELOPER_ACTION_REQUIRED', findingSnapshot: snapshot, status: ManualRemediationStatus.TODO, scannerStatus: ScannerFindingStatus.DETECTED, lastSeenBuild: build, events: [] });
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

  // OWASP-only Maven identity resolution. The finding actually reaching this
  // method (incident.metadata.enrichedData.owasp.cves[] / report.rawData's
  // equivalent) is ALREADY a flattened, one-row-per-CVE shape -- it never
  // carries the original Dependency-Check dependency.packages[] PURL array
  // (that is lost upstream, before enrichedData is built). Calling
  // resolveOwaspMavenIdentity() here is still correct: it is the SAME
  // canonical helper the rest of the OWASP pipeline uses (never a second,
  // divergent PURL parser), and it degrades safely to null when .packages[]
  // isn't present -- which is every real sync today. Since a resync can
  // therefore never independently RE-DERIVE a Maven identity, the safe
  // behaviour is to PRESERVE an already-validated one from existingSnapshot
  // (same raw legacyPackage = same finding, nothing invalidated it) rather
  // than regress component/purl/installedVersion back to the raw jar
  // filename on every sync. If the raw identity itself changes (a real jar/
  // version bump) there is nothing safe to preserve, so this correctly
  // falls back to the raw-only shape instead of keeping stale data.
  private resolveOwaspIdentity(f: any, existingSnapshot?: any): { component: string | null; currentVersion: string | null; owaspIdentity: Record<string, any> } {
    // A finding that already self-declares a resolved Maven identity (e.g.
    // normalizeOwaspFinding()'s own output, or any future ingestion step
    // that pre-resolves it) is trusted directly -- never re-parsed, never a
    // second PURL parser. Otherwise fall back to the canonical resolver
    // itself, in case the raw nested dependency.packages[] shape is ever
    // preserved this far.
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

  private snapshot(source: string, f: any, existingSnapshot?: any, trivyFixedVersionIndex?: ReturnType<typeof buildTrivyFixedVersionIndex>) {
    const ruleOrCve = String(f.id || f.VulnerabilityID || f.cve || f.rule || f.alertRef || f.pluginid || f.name || 'Non disponible');
    const owaspResolved = source === 'OWASP' ? this.resolveOwaspIdentity(f, existingSnapshot) : null;
    const owaspIdentity = owaspResolved?.owaspIdentity ?? {};
    // Trivy/ZAP fixedVersion resolution is UNCHANGED: native scan value only.
    // OWASP alone may additionally borrow a Trivy-correlated target version
    // -- see owasp-trivy-fixed-version-correlation.ts for the full ordering
    // (native > existing persisted value > fresh correlation > null) and why
    // a once-resolved value is never flipped by a later correlation pass.
    const nativeFixedVersion = f.fixedVersion || f.FixedVersion || null;
    let fixedVersion: string | null = nativeFixedVersion;
    let fixedVersionSource: 'TRIVY_CORRELATED' | null = null;
    let fixedVersionEvidence: any = null;
    // UX-only breadcrumb (never decision-affecting, see owasp-trivy-fixed-
    // version-correlation.ts's own header): why a target is unavailable,
    // distinguishing "Trivy evidence exists but doesn't collapse to one
    // safe version" from "no Trivy evidence at all" for the frontend.
    let fixedVersionUnavailableReason: 'MULTIPLE_CANDIDATES' | 'NO_TRIVY_MATCH' | null = null;
    if (source === 'OWASP') {
      // Correlate on the RESOLVED Maven component (fresh or preserved), never
      // the raw finding's own pkg -- Trivy's own index is keyed by Maven
      // groupId:artifactId, so correlating on a jar filename could never
      // match anything (silent, permanent NO_TRIVY_MATCH for every finding).
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

  // Execution-2060 follow-up — persists a WF6 result against the SAME
  // finding row WF6 itself already resolved (findingTaskId ===
  // ManualRemediationTask.id === the exact value WF6 sets as
  // decision.findingIdentity's own source, security-finding-resolver.
  // service.ts:105). Deliberately does NOT touch status/scannerStatus (the
  // MANUAL human-tracking fields) -- this is a strictly separate,
  // additive record; the UI decision of how/whether to derive a badge
  // from it is a later, explicitly out-of-scope layer.
  //
  // Idempotence: WF6's own requestId is DETERMINISTIC per finding
  // (`sec-eval-<findingTaskId>`, security-remediation.controller.ts), so
  // every real attempt for the SAME finding necessarily looks like a
  // repeat -- there is no meaningful "duplicate vs distinct" distinction
  // to reject on. This always overwrites the top-level snapshot with the
  // LATEST callback (the only state relevant to "is this currently
  // fixed") while appending to `attempts` so no prior result is lost --
  // the same trailing-record discipline `events[]` already uses on this
  // same entity, just for a different (automated, not human) history.
  // Never a write-authorizing gate: WF6's own /revalidate step already
  // re-derives everything fresh immediately before any GitHub write,
  // independent of whatever this table currently holds.
  async recordWf6Result(dto: Wf6RemediationResultDto) {
    const task = await this.repo.findOne({ where: { id: dto.findingTaskId } });
    if (!task) throw new NotFoundException('Tâche de correction introuvable pour ce résultat WF6.');
    if (String(task.projectId) !== String(dto.projectId)) {
      throw new ForbiddenException('Ce résultat WF6 ne correspond pas au projet déclaré pour cette tâche.');
    }
    const previous = task.securityFindingRemediation;
    const attemptNumber = (Number(previous?.attemptCount) || 0) + 1;
    const at = new Date().toISOString();
    const attempt = {
      attempt: attemptNumber, at, status: dto.status, reason: dto.reason ?? null,
      candidateIdentity: dto.candidateIdentity ?? null, evaluatedSha: dto.evaluatedSha ?? null,
      branchName: dto.branchName ?? null, prUrl: dto.prUrl ?? null, prNumber: dto.prNumber ?? null,
      executionId: dto.executionId ?? null,
      patchEvidence: dto.patchEvidence ?? null, securityValidationEvidence: dto.securityValidationEvidence ?? null,
    };
    task.securityFindingRemediation = {
      status: dto.status, reason: dto.reason ?? null,
      candidateIdentity: dto.candidateIdentity ?? null, evaluatedSha: dto.evaluatedSha ?? null,
      branchName: dto.branchName ?? null,
      // A callback that does not repeat prUrl/prNumber (e.g. a non-PR-
      // reaching outcome) never erases an EARLIER real PR link -- only an
      // explicit new value ever overwrites one.
      prUrl: dto.prUrl ?? previous?.prUrl ?? null, prNumber: dto.prNumber ?? previous?.prNumber ?? null,
      patchEvidence: dto.patchEvidence ?? null, securityValidationEvidence: dto.securityValidationEvidence ?? null,
      attemptCount: attemptNumber, updatedAt: at,
      attempts: [...(Array.isArray(previous?.attempts) ? previous.attempts : []), attempt],
    };
    return this.repo.save(task);
  }

  // Increment 1 — multi-CVE remediation, ONE candidate/build/scan/PR for N
  // selected findings. Mirrors incidents.service.ts's own WF2 dispatch
  // pattern (validate -> write a transient DISPATCHING marker -> dispatch
  // with a bounded timeout -> roll back to a FAILED marker on dispatch
  // failure, never leave a task silently stuck) — adapted for N tasks
  // sharing ONE batchId instead of one Report.metadata.fixRequest.
  //
  // Idempotence decision (explicit, per this increment's own instruction):
  // a CVE already CANDIDATE_READY or DISPATCHING anywhere is a NAMED 409,
  // never a silent exclusion from the batch — the caller (today: a human
  // operator; later: the UI) decides what to do about it, this method
  // never decides FOR them by quietly dropping a finding.
  async launchBatchRemediation(projectId: string, findingTaskIds: string[], user: any) {
    const role = String(user?.role || '').toLowerCase();
    if (role === 'viewer' || !['developer', 'admin'].includes(role)) throw new ForbiddenException('Action non autorisée');

    const ids = [...new Set((findingTaskIds || []).map(String))];
    if (!ids.length) throw new BadRequestException('Au moins une CVE doit être sélectionnée.');
    if (ids.length > 8) throw new BadRequestException('Un lot ne peut pas dépasser 8 CVE.');

    const tasks = await this.repo.find({ where: { id: In(ids) } });
    const byId = new Map(tasks.map(t => [t.id, t]));
    const missing = ids.filter(id => !byId.has(id));
    if (missing.length) throw new NotFoundException(`Tâche(s) de correction introuvable(s) : ${missing.join(', ')}.`);

    const mismatched = tasks.filter(t => String(t.projectId) !== String(projectId));
    if (mismatched.length) throw new ForbiddenException(`Tâche(s) ne correspondant pas au projet déclaré : ${mismatched.map(t => t.ruleOrCve || t.id).join(', ')}.`);

    const adminOnly = tasks.filter(t => t.remediationType === 'ADMIN_ACTION_REQUIRED');
    if (adminOnly.length && role !== 'admin') {
      throw new ForbiddenException(`Nécessite l’intervention d’un administrateur : ${adminOnly.map(t => t.ruleOrCve || t.id).join(', ')}.`);
    }

    const incomplete = tasks.filter(t => !t.source || !t.ruleOrCve || !t.findingSnapshot?.component || !t.findingSnapshot?.currentVersion || !t.findingSnapshot?.fixedVersion);
    if (incomplete.length) {
      throw new BadRequestException(`Donnée insuffisante pour lancer une correction automatisée : ${incomplete.map(t => t.ruleOrCve || t.id).join(', ')}.`);
    }

    // Idempotence — explicit 409, every offending CVE named, never a
    // silent drop from the batch (see this method's own header).
    const alreadyInProgress = tasks.filter(t => ['CANDIDATE_READY', 'DISPATCHING'].includes(t.securityFindingRemediation?.status));
    if (alreadyInProgress.length) {
      throw new ConflictException(`Déjà en cours ou déjà proposée(s), sélection refusée : ${alreadyInProgress.map(t => t.ruleOrCve).join(', ')}.`);
    }

    // Cheap, static, pre-grounding conflict pre-check (§2 of the design
    // cadrage): more than one selected CVE against the SAME Maven
    // coordinate cannot be safely proven compatible without a real
    // checkout — refuse up front, named, rather than guess at version
    // compatibility from scanner strings alone.
    //
    // V1.8 Phase 7C — the ONE narrow exception: two+ CVEs sharing a
    // component are NOT actually colliding when every one of them is
    // remediated by the SAME already-validated PARENT_VERSION plan (they
    // never touch that component's own declaration at all -- the shared
    // edit lands on a completely different node, the <parent>). Checked
    // against the V1.8 evidence store directly (this.v1_8Decisions), never
    // the task's own persisted state (no v1_8Plan has been written yet at
    // this point in the method) -- byte-identical editType/actualEditTarget/
    // fromVersion/toVersion required across the WHOLE group, never a
    // partial/majority match.
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

    // V1.8 Phase 5 ticket — Phase 4/5/9: the authoritative gate, ENFORCED
    // mode only (default SHADOW leaves every existing test/environment
    // byte-for-byte unchanged -- see v1_8-enforcement-mode.ts). Every task
    // must independently ALLOW; a single BLOCK refuses the WHOLE batch,
    // fail-closed, before anything is written or dispatched -- never a
    // partial dispatch of "the ones that passed". This NEVER falls back to
    // the old classifier/remediationType (Phase 5's own rule): a task
    // already past the adminOnly/incomplete/alreadyInProgress/colliding
    // checks above that still fails THIS gate is blocked here, full stop.
    // Phase 6/7 — collected only in ENFORCED mode, attached to the dispatch
    // payload below (Wf6BatchDispatchPayload.v1_8ValidatedFindings); absent
    // entirely in SHADOW mode.
    let v1_8ValidatedFindings: Wf6ValidatedFindingPayload[] | undefined;
    if (v1_8EnforcementMode() === 'ENFORCED') {
      v1_8ValidatedFindings = [];
      for (const task of tasks) {
        const context = await this.resolveV1_8DispatchContext(task);
        if (!context) throw new ConflictException(`Contexte de dépôt/commit introuvable pour la correction — dispatch refusé : ${task.ruleOrCve || task.id}.`);
        const evidence = this.v1_8Decisions.lookup(task.source, String(task.ruleOrCve), String(task.findingSnapshot.component), String(task.findingSnapshot.currentVersion || ''));
        const gate = canDispatchSecurityRemediationV1_8({ ...context, source: task.source, cve: String(task.ruleOrCve), component: String(task.findingSnapshot.component), installedVersion: String(task.findingSnapshot.currentVersion || ''), statusPermitsDispatch: true }, evidence);
        if (gate.decision !== 'ALLOW') {
          throw new ConflictException(`Validation V1.8 refusée pour ${task.ruleOrCve || task.id} : ${gate.reason}.`);
        }
        v1_8ValidatedFindings.push(buildWf6ValidatedFindingPayload(task.id, gate.evidence));
      }
    }

    // Deterministic batchId: same selection -> same id, always (same
    // discipline as WF6's own sec-eval-<findingTaskId> requestId).
    const batchId = 'sec-batch-' + createHash('sha256').update([...ids].sort().join(',')).digest('hex').slice(0, 16);
    const dispatchedAt = new Date().toISOString();
    // V1.8 — index this dispatch's validated findings (ENFORCED mode only;
    // undefined/empty in SHADOW mode) by findingTaskId so each task can
    // persist its OWN pinned plan below. This is the only place
    // v1_8Plan is ever written -- security-finding-resolver.service.ts is
    // the only place it is ever read back.
    const v1_8PlanByTaskId = new Map((v1_8ValidatedFindings || []).map(f => [f.findingTaskId, f.remediationPlan]));
    for (const task of tasks) {
      const previous = task.securityFindingRemediation;
      const attemptNumber = (Number(previous?.attemptCount) || 0) + 1;
      task.securityRemediationBatchId = batchId;
      task.securityFindingRemediation = {
        status: 'DISPATCHING', reason: null, batchId,
        candidateIdentity: previous?.candidateIdentity ?? null, evaluatedSha: previous?.evaluatedSha ?? null,
        branchName: previous?.branchName ?? null, prUrl: previous?.prUrl ?? null, prNumber: previous?.prNumber ?? null,
        patchEvidence: null, securityValidationEvidence: null,
        v1_8Plan: v1_8PlanByTaskId.get(task.id) ?? null,
        attemptCount: attemptNumber, updatedAt: dispatchedAt,
        attempts: [...(Array.isArray(previous?.attempts) ? previous.attempts : []), { attempt: attemptNumber, at: dispatchedAt, status: 'DISPATCHING', reason: null, batchId }],
      };
    }
    await this.repo.save(tasks);

    const payload: Wf6BatchDispatchPayload = { projectId, batchId, findingTaskIds: ids, ...(v1_8ValidatedFindings ? { v1_8ValidatedFindings } : {}) };
    try {
      await this.wf6BatchDispatcher.dispatch(payload);
    } catch (err: any) {
      const failedAt = new Date().toISOString();
      for (const task of tasks) {
        const current = task.securityFindingRemediation;
        task.securityFindingRemediation = { ...current, status: 'DISPATCH_FAILED', reason: err?.message || 'Workflow unavailable', updatedAt: failedAt };
      }
      await this.repo.save(tasks);
      throw new ConflictException(`La correction n’a pas pu démarrer : ${err?.message || 'workflow indisponible'}.`);
    }

    return { batchId, findingTaskIds: ids, status: 'DISPATCHING' };
  }

  // Increment 1 — persists the batch result: one shared candidate/PR
  // identity (candidateIdentity/branchName/prUrl/prNumber/evaluatedSha),
  // written onto EVERY task in the batch, plus each task's OWN per-CVE
  // status/reason/evidence — never a single global blob covering multiple
  // findings (the UI needs to mark each CVE individually later). Same
  // attempts[]-history and non-erasure-of-a-real-PR-link discipline as
  // recordWf6Result() above.
  async recordWf6BatchResult(dto: Wf6BatchRemediationResultDto) {
    const ids = dto.findings.map(f => f.findingTaskId);
    const tasks = await this.repo.find({ where: { id: In(ids) } });
    const byId = new Map(tasks.map(t => [t.id, t]));
    const missing = ids.filter(id => !byId.has(id));
    if (missing.length) throw new NotFoundException(`Tâche(s) de correction introuvable(s) pour ce résultat WF6 : ${missing.join(', ')}.`);
    const mismatchedProject = tasks.filter(t => String(t.projectId) !== String(dto.projectId));
    if (mismatchedProject.length) throw new ForbiddenException('Ce résultat WF6 ne correspond pas au projet déclaré pour ce lot.');
    const mismatchedBatch = tasks.filter(t => t.securityRemediationBatchId && t.securityRemediationBatchId !== dto.batchId);
    if (mismatchedBatch.length) throw new ForbiddenException(`Ce résultat WF6 ne correspond pas au lot déclaré pour : ${mismatchedBatch.map(t => t.id).join(', ')}.`);

    const at = new Date().toISOString();
    const saved: ManualRemediationTask[] = [];
    for (const finding of dto.findings) {
      const task = byId.get(finding.findingTaskId)!;
      const previous = task.securityFindingRemediation;
      const attemptNumber = (Number(previous?.attemptCount) || 0) + 1;
      const attempt = {
        attempt: attemptNumber, at, status: finding.status, reason: finding.reason ?? null, batchId: dto.batchId,
        candidateIdentity: dto.candidateIdentity ?? null, evaluatedSha: dto.evaluatedSha ?? null,
        branchName: dto.branchName ?? null, prUrl: dto.prUrl ?? null, prNumber: dto.prNumber ?? null,
        executionId: dto.executionId ?? null, patchEvidence: finding.patchEvidence ?? null, securityValidationEvidence: finding.securityValidationEvidence ?? null,
      };
      task.securityRemediationBatchId = dto.batchId;
      task.securityFindingRemediation = {
        status: finding.status, reason: finding.reason ?? null, batchId: dto.batchId,
        candidateIdentity: dto.candidateIdentity ?? null, evaluatedSha: dto.evaluatedSha ?? null,
        branchName: dto.branchName ?? null,
        prUrl: dto.prUrl ?? previous?.prUrl ?? null, prNumber: dto.prNumber ?? previous?.prNumber ?? null,
        patchEvidence: finding.patchEvidence ?? null, securityValidationEvidence: finding.securityValidationEvidence ?? null,
        attemptCount: attemptNumber, updatedAt: at,
        attempts: [...(Array.isArray(previous?.attempts) ? previous.attempts : []), attempt],
      };
      saved.push(await this.repo.save(task));
    }
    return saved;
  }

  private async authorizedTask(id: string, user: any, reopening: boolean) {
    const task = await this.repo.findOne({ where: { id } });
    if (!task) throw new NotFoundException('Tâche de correction manuelle introuvable.');
    const role = String(user?.role || '').toLowerCase();
    if (role === 'viewer' || !['developer', 'admin'].includes(role)) throw new ForbiddenException('Action non autorisée');
    if (task.remediationType === 'ADMIN_ACTION_REQUIRED' && role !== 'admin') throw new ForbiddenException('Cette tâche nécessite l’intervention d’un administrateur.');
    if (reopening && role !== 'admin') throw new ForbiddenException('Seul un administrateur peut rouvrir une tâche.');
    return task;
  }

  private event(user: any, oldStatus: ManualRemediationStatus | null, newStatus: ManualRemediationStatus, reason: ManualRemediationEvent['reason'], buildNumber: number | null): ManualRemediationEvent {
    return { at: new Date().toISOString(), actorId: user?.id ? String(user.id) : null, actorDisplayName: user ? String(user.name || user.email || user.id) : 'Scanner', oldStatus, newStatus, reason, buildNumber };
  }

  // V1.8 Phase 5 ticket — resolves the SAME two trusted facts
  // SecurityFindingResolverService.resolve() already resolves (project's
  // githubRepo + the incident's own atomically-written sourceCommitSha),
  // for launchBatchRemediation()'s ENFORCED-mode gate call above. Returns
  // null (never throws) on any failure -- the caller turns that into a
  // clean, named ConflictException rather than an unhandled rejection.
  // Duplicates a couple of field reads, not any decision logic; kept
  // separate from that service to avoid a circular module import (see
  // manual-remediation.module.ts's own header comment).
  private async resolveV1_8DispatchContext(task: ManualRemediationTask): Promise<{ repository: string; commitSha: string } | null> {
    if (!task.incidentId || !this.projects) return null;
    const [project, incident] = await Promise.all([
      this.projects.findOne({ where: { id: task.projectId } }),
      this.incidents.findOne({ where: { id: task.incidentId } }),
    ]);
    if (!project || !incident) return null;
    const repository = String(project.githubRepo || '').trim();
    if (!repository) return null;
    const commitSha = String((incident.metadata as any)?.sourceCommitSha || '');
    if (!isFullGitSha(commitSha)) return null;
    return { repository, commitSha: commitSha.toLowerCase() };
  }
}
