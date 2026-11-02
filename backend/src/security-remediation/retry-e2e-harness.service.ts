/** Orchestre le cycle de vie complet (création, révocation, avancement) d'un plan de test E2E opérateur de relance de remédiation, entièrement sous verrous transactionnels. */
import { settleTargetClaim } from '../manual-remediation/remediation-target-reservation';
import { Project } from '../projects/project.entity';
import { Incident } from '../incidents/incident.entity';
import { V1_8CompatibilityDecisionService } from '../dependency-compatibility/v1_8-compatibility-decision.service';
import { canDispatchSecurityRemediationV1_8 } from '../dependency-compatibility/v1_8-security-remediation-gate';
import { Injectable, NotFoundException, ConflictException, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { ManualRemediationTask } from '../manual-remediation/manual-remediation.entity';
import { assertNoSideEffect, maxAutomaticAttempts } from '../manual-remediation/security-remediation-lifecycle';
import { RetryE2ETestPlanEntity } from './retry-e2e-test-plan.entity';
import { advanceHarness, harnessEnabled, HarnessContext } from './retry-e2e-harness.logic';
@Injectable()
export class RetryE2EHarnessService {
  private readonly logger = new Logger(RetryE2EHarnessService.name);
  /** Initialise les dépendances et l’état de ce composant. */
  constructor(private readonly db: DataSource) {}
  /** Refuse (404) tout appel si le harnais de test E2E n'est pas activé. */
  private requireEnabled() { if (!harnessEnabled()) throw new NotFoundException(); }
  /** Crée un plan de test E2E pour une tâche qualifiée (projet approuvé, finding éligible, aucune tentative en cours), sous verrou exclusif cross-processus. */
  async create(projectId: string, taskId: string, expiresAt: string) {
    this.requireEnabled();
    const ttl = Date.parse(expiresAt) - Date.now();
    if (!Number.isFinite(ttl) || ttl <= 0 || ttl > 30 * 60_000) throw new ConflictException('Expiry must be within 30 minutes.');
    if (process.env.SECURITY_REMEDIATION_E2E_TEST_PROJECT_ID !== projectId) throw new ConflictException('Project is not operator-approved for E2E.');
    return this.db.transaction(async tx => {
      await tx.query('SELECT pg_advisory_xact_lock(7461041)');
      const plans = tx.getRepository(RetryE2ETestPlanEntity);
      if (await plans.findOne({ where: { state: 'ACTIVE' } })) throw new ConflictException('An active plan already exists; revoke it first.');
      const task = await tx.getRepository(ManualRemediationTask).findOne({ where: { id: taskId }, lock: { mode: 'pessimistic_write' } });
      if (!task || task.projectId !== projectId) throw new NotFoundException();
      if (['CVE-2022-38749', 'CVE-2022-38751'].includes(task.ruleOrCve) || task.status !== 'TODO' ||
          !['DETECTED', 'STILL_DETECTED'].includes(task.scannerStatus) || task.securityFindingRemediation ||
          task.securityRemediationBatchId || task.remediationType === 'ADMIN_ACTION_REQUIRED' || !['TRIVY','OWASP'].includes(task.source) || maxAutomaticAttempts() < 2 ||
          !/^[A-Za-z0-9_.-]+:[A-Za-z0-9_.-]+$/.test(task.findingSnapshot?.component || '') ||
          !task.findingSnapshot?.currentVersion || !task.findingSnapshot?.fixedVersion) {
        throw new ConflictException('Finding is not qualified for the isolated test.');
      }
      const project = await tx.getRepository(Project).findOne({ where: { id: projectId } });
      const incident = task.incidentId && await tx.getRepository(Incident).findOne({ where: { id: task.incidentId } });
      const commitSha = String(incident?.metadata?.sourceCommitSha || '');
      if (!project?.githubRepo || !incident || incident.projectId !== projectId || !/^[a-f0-9]{40}$/i.test(commitSha))
        throw new ConflictException('Trusted project/scan binding is missing.');
      const evidence = new V1_8CompatibilityDecisionService().lookup(task.source, task.ruleOrCve,
        task.findingSnapshot.component, task.findingSnapshot.currentVersion);
      const gate = canDispatchSecurityRemediationV1_8({ repository: project.githubRepo, commitSha,
        source: task.source, cve: task.ruleOrCve, component: task.findingSnapshot.component,
        installedVersion: task.findingSnapshot.currentVersion, statusPermitsDispatch: true }, evidence);
      if (gate.decision !== 'ALLOW' || !['DEPENDENCY_VERSION','PROPERTY_VERSION'].includes(evidence.editType))
        throw new ConflictException('Current server-validated dependency evidence does not qualify this fixture.');
      assertNoSideEffect(task);
      const entry = plans.create({ id: randomUUID(), projectId, taskId, state: 'ACTIVE', plan: {
        enabled: true, projectId, taskId, expiresAt, attempt1Mode: 'FORCE_VERIFIER_TIMEOUT_ONCE',
        attempt2Mode: 'STOP_BEFORE_GIT_WRITE_ONCE', consumedAttempt1: false, consumedAttempt2: false,
        events: [{ hook: 'CREATED', at: new Date().toISOString() }],
      } });
      await plans.save(entry); this.audit(entry, 'CREATED'); return entry;
    });
  }
  /** Révoque un plan de test E2E, en refusant si une tentative est encore en vol ou si la barrière de non-écriture n'est pas encore franchie. */
  async revoke(id: string) {
    this.requireEnabled();
    return this.db.transaction(async tx => {
      const repo = tx.getRepository(RetryE2ETestPlanEntity);
      const entry = await repo.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!entry) throw new NotFoundException();
      const task = await tx.getRepository(ManualRemediationTask).findOne({ where: { id: entry.plan.taskId }, lock: { mode: 'pessimistic_write' } });
      if (task?.securityFindingRemediation?.status === 'DISPATCHING') throw new ConflictException('Cannot revoke an in-flight test.');
      if (entry.plan.consumedAttempt1 && !entry.plan.consumedAttempt2 && !(task?.securityFindingRemediation?.attemptNumber === 2 && task.securityFindingRemediation.finishedAt && task.securityFindingRemediation.retryable === false)) throw new ConflictException('Cannot release the no-write fence before the test stop is complete.');
      entry.state = 'REVOKED'; entry.plan.events.push({ hook: 'REVOKED', at: new Date().toISOString() });
      await repo.save(entry); this.audit(entry, 'REVOKED'); return { id, state: entry.state };
    });
  }
  /** Vérifie qu'un lancement de lot ne recouvre pas le plan de test actif, pour garder le test isolé du trafic réel. */
  async assertInitialScope(projectId: string, taskIds: string[], modern: boolean) {
    if (!harnessEnabled()) return;
    const entry = await this.db.getRepository(RetryE2ETestPlanEntity).findOne({ where: { state: 'ACTIVE' } });
    if (entry?.plan.projectId === projectId && taskIds.includes(entry.plan.taskId) && (!modern || taskIds.length !== 1))
      throw new ConflictException('The operator test requires one modern finding only.');
  }
  /** Point d'entrée appelé par le flux de remédiation réel pour faire avancer un plan de test actif correspondant, sous verrou. */
  async hook(context: HarnessContext, phase: 'INITIAL' | 'CANDIDATE_READY' | 'EVALUATION_ABORTED') {
    if (!harnessEnabled()) return 'NORMAL' as const;
    return this.db.transaction(async tx => {
      const repo = tx.getRepository(RetryE2ETestPlanEntity);
      const entry = await repo.findOne({ where: { projectId: context.projectId, taskId: context.taskId }, lock: { mode: 'pessimistic_write' } });
      if (!entry || entry.plan.projectId !== context.projectId || entry.plan.taskId !== context.taskId) return 'NORMAL' as const;
      const taskRepo = tx.getRepository(ManualRemediationTask);
      const task = await taskRepo.findOne({ where: { id: context.taskId }, lock: { mode: 'pessimistic_write' } });
      if (!task || task.projectId !== context.projectId) throw new ConflictException('Harness ownership mismatch.');
      if (entry.state !== 'ACTIVE' && !(entry.plan.consumedAttempt2 && entry.plan.attempt2?.attemptId === context.attemptId)) return 'NORMAL' as const;
      const before = entry.plan.events.length;
      const action = advanceHarness(entry.plan, task, context, phase, new Date().toISOString());
      if (action === 'BARRIER') { await settleTargetClaim(tx, task); await taskRepo.save(task); if (entry.state === 'ACTIVE') entry.state = 'COMPLETED'; }
      await repo.save(entry);
      if (entry.plan.events.length !== before) this.audit(entry, action, context);
      return action;
    });
  }
  /** Journalise un événement du harnais de test (hook déclenché) pour la traçabilité opérateur. */
  private audit(entry: RetryE2ETestPlanEntity, hook: string, identity?: HarnessContext) {
    this.logger.log(JSON.stringify({ planId: entry.id, projectId: entry.plan.projectId, taskId: entry.plan.taskId,
      attemptId: identity?.attemptId, batchId: identity?.batchId, hook, timestamp: new Date().toISOString() }));
  }
}
