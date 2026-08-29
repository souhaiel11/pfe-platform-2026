import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Incident } from '../incidents/incident.entity';
import { normalizeReport } from '../common/report-normalizer';
import { findingFingerprint } from './finding-fingerprint';
import { ManualRemediationEvent, ManualRemediationStatus, ManualRemediationTask, ScannerFindingStatus } from './manual-remediation.entity';

type Candidate = { source: string; finding: any; fingerprint: string };

@Injectable()
export class ManualRemediationService {
  constructor(
    @InjectRepository(ManualRemediationTask) private readonly repo: Repository<ManualRemediationTask>,
    @InjectRepository(Incident) private readonly incidents: Repository<Incident>,
  ) {}

  async list(projectId: string, filters: { status?: string; source?: string; severity?: string } = {}) {
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
    return this.repo.find({ where, order: { updatedAt: 'DESC' } });
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
      await this.reconcileSource(incident, source, findings, build);
    }
  }

  private async reconcileSource(incident: Incident, source: string, findings: any[], build: number | null) {
    const candidates: Candidate[] = findings.map(finding => ({ source, finding, fingerprint: findingFingerprint(source, finding) }));
    const fingerprints = [...new Set(candidates.map(c => c.fingerprint))];
    const existing = await this.repo.find({ where: { projectId: incident.projectId, source } });
    const byFingerprint = new Map(existing.map(t => [t.findingFingerprint, t]));
    for (const candidate of candidates) {
      const f = candidate.finding;
      let task = byFingerprint.get(candidate.fingerprint);
      const snapshot = this.snapshot(source, f);
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
    }
    for (const task of existing.filter(t => !fingerprints.includes(t.findingFingerprint) && t.status !== ManualRemediationStatus.VERIFIED)) {
      const old = task.status;
      task.status = ManualRemediationStatus.VERIFIED;
      task.scannerStatus = ScannerFindingStatus.NOT_DETECTED;
      task.verifiedBuild = build;
      task.verifiedAt = new Date();
      task.events = [...(task.events || []), this.event(null, old, task.status, 'VERIFIED_BY_SCANNER', build)];
      await this.repo.save(task);
    }
  }

  private snapshot(source: string, f: any) {
    const ruleOrCve = String(f.id || f.VulnerabilityID || f.cve || f.rule || f.alertRef || f.pluginid || f.name || 'Non disponible');
    return { source, ruleOrCve, title: String(f.title || f.Title || f.alert || f.name || f.description || ruleOrCve), severity: String(f.severity || f.Severity || f.risk || 'UNKNOWN').toUpperCase().split(' ')[0], component: f.pkg || f.PkgName || f.package || f.fileName || f.dependency || null, currentVersion: f.installedVersion || f.InstalledVersion || f.version || null, fixedVersion: f.fixedVersion || f.FixedVersion || null, description: f.description || f.Description || f.desc || null, evidence: f.evidence || null, recommendation: f.recommendation || f.solution || null, url: f.url || null, parameter: f.param || f.parameter || null };
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
}
