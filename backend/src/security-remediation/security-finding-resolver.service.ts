// R-SEC-V1.4 §1/§3 — trusted finding resolution. This is the ONLY place a
// caller's {projectId, findingTaskId} identifiers are turned into the
// evidence the deterministic orchestrator needs (source, package,
// installedVersion, fixedVersion, repository, candidateBaseSha). Every one
// of those values is read from ALREADY-PERSISTED, ALREADY-TRUSTED platform
// state -- never accepted as caller input (see §0). No new persistence is
// introduced: this reuses the EXISTING chain already established by
// ManualRemediationTask (manual-remediation.entity.ts, synced from real
// scanner findings via normalizeReport()) and Incident.metadata.sourceCommitSha
// (incidents.service.ts's own BRIQUE 3 binding: "the exact source commit
// Jenkins/WF1 reported for the build that produced this incident's
// findings", written atomically by WF1, never re-derived/guessed).
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ManualRemediationTask } from '../manual-remediation/manual-remediation.entity';
import { Incident } from '../incidents/incident.entity';
import { Project } from '../projects/project.entity';
import { isFullGitSha } from '../incidents/incidents.service';
import { SecurityFindingDecisionInput } from './security-finding-decision.types';

export type TrustedFindingResolutionFailureReason =
  | 'UNKNOWN_FINDING'
  | 'FINDING_PROJECT_MISMATCH'
  | 'PROJECT_NOT_FOUND'
  | 'MISSING_REPOSITORY_BINDING'
  | 'INCIDENT_NOT_FOUND'
  | 'INCIDENT_PROJECT_MISMATCH'
  | 'MISSING_TRUSTED_SHA'
  | 'INCOMPLETE_FINDING_EVIDENCE';

export type TrustedFindingResolution =
  // R-SEC-V1.5 §9/§10 -- cveId/title are COSMETIC ONLY: read alongside the
  // decision-relevant fields but never fed into `finding` (the orchestrator
  // input). They exist purely so a caller (WF6) can render a human-readable
  // commit message/PR body without a second read-path -- they have zero
  // influence on eligibility, provenance, or patch content.
  | { ok: true; repository: string; candidateBaseSha: string; finding: SecurityFindingDecisionInput; cveId: string | null; title: string | null }
  | { ok: false; reason: TrustedFindingResolutionFailureReason; detail: string };

@Injectable()
export class SecurityFindingResolverService {
  constructor(
    @InjectRepository(ManualRemediationTask) private readonly tasks: Repository<ManualRemediationTask>,
    @InjectRepository(Incident) private readonly incidents: Repository<Incident>,
    @InjectRepository(Project) private readonly projects: Repository<Project>,
  ) {}

  async resolve(projectId: string, findingTaskId: string): Promise<TrustedFindingResolution> {
    const fail = (reason: TrustedFindingResolutionFailureReason, detail: string): TrustedFindingResolution => ({ ok: false, reason, detail });

    // 1. the finding must exist at all.
    const task = await this.tasks.findOne({ where: { id: findingTaskId } });
    if (!task) return fail('UNKNOWN_FINDING', `No ManualRemediationTask with id "${findingTaskId}".`);

    // 2. ownership cross-check: the caller-supplied projectId must match the
    // finding's OWN persisted projectId -- never trust the caller's claim
    // alone (defends against a caller probing another project's findings
    // via a guessed/leaked findingTaskId).
    if (String(task.projectId) !== String(projectId)) {
      return fail('FINDING_PROJECT_MISMATCH', `Finding "${findingTaskId}" belongs to a different project than requested.`);
    }

    // 3. project must exist and carry a real repository binding.
    const project = await this.projects.findOne({ where: { id: projectId } });
    if (!project) return fail('PROJECT_NOT_FOUND', `No project with id "${projectId}".`);
    const repository = String(project.githubRepo || '').trim();
    if (!repository) return fail('MISSING_REPOSITORY_BINDING', `Project "${projectId}" has no githubRepo configured.`);

    // 4. the incident this finding was synced from must exist and must
    // itself belong to the SAME project -- a second, independent ownership
    // check (never rely on task.projectId alone, exactly the "never trust
    // a single source" discipline used throughout R81/V1.x).
    if (!task.incidentId) return fail('INCIDENT_NOT_FOUND', `Finding "${findingTaskId}" has no associated incident.`);
    const incident = await this.incidents.findOne({ where: { id: task.incidentId } });
    if (!incident) return fail('INCIDENT_NOT_FOUND', `Incident "${task.incidentId}" not found for finding "${findingTaskId}".`);
    if (String(incident.projectId) !== String(projectId)) {
      return fail('INCIDENT_PROJECT_MISMATCH', `Incident "${incident.id}" for finding "${findingTaskId}" belongs to a different project than requested.`);
    }

    // 5. the exact, trusted SHA the finding was observed at. Written
    // atomically by WF1 alongside the raw scan data this finding was
    // sync'd from (see incidents.service.ts's own BRIQUE 3 comment) --
    // never re-derived, never defaulted to "main"/HEAD/latest.
    const candidateBaseSha = String((incident.metadata as any)?.sourceCommitSha || '');
    if (!isFullGitSha(candidateBaseSha)) {
      return fail('MISSING_TRUSTED_SHA', `Incident "${incident.id}" has no trusted sourceCommitSha -- refusing to guess a SHA.`);
    }

    // 6. the finding's own persisted scanner evidence must actually be
    // complete enough to evaluate -- fail closed here rather than forwarding
    // an incomplete finding to a real checkout/Maven run for nothing.
    const snapshot = task.findingSnapshot || {};
    const pkg = snapshot.component;
    const installedVersion = snapshot.currentVersion;
    if (!pkg || !String(pkg).trim() || !installedVersion || !String(installedVersion).trim()) {
      return fail('INCOMPLETE_FINDING_EVIDENCE', `Finding "${findingTaskId}" is missing package/installedVersion in its persisted snapshot.`);
    }

    return {
      ok: true,
      repository,
      candidateBaseSha: candidateBaseSha.toLowerCase(),
      finding: {
        findingIdentity: task.findingFingerprint,
        source: task.source,
        package: String(pkg),
        expectedInstalledVersion: String(installedVersion),
        fixedVersion: snapshot.fixedVersion != null ? String(snapshot.fixedVersion) : null,
      },
      cveId: task.ruleOrCve != null && String(task.ruleOrCve).trim() ? String(task.ruleOrCve) : null,
      title: task.title != null && String(task.title).trim() ? String(task.title) : null,
    };
  }
}
