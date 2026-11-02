// Gère sécurité finding résolveur et les échanges nécessaires.
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ManualRemediationTask } from '../manual-remediation/manual-remediation.entity';
import { Incident } from '../incidents/incident.entity';
import { Project } from '../projects/project.entity';
import { isFullGitSha } from '../candidate-verification/candidate-digest';
import { SecurityFindingDecisionInput } from './security-finding-decision.types';
import { effectiveBaseSha, latestConfirmedMerge } from '../manual-remediation/post-merge-baseline';

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
  | { ok: true; repository: string; candidateBaseSha: string; finding: SecurityFindingDecisionInput; cveId: string | null; title: string | null }
  | { ok: false; reason: TrustedFindingResolutionFailureReason; detail: string };

@Injectable()
export class SecurityFindingResolverService {
  /** Initialise les dépendances et l’état de ce composant. */
  constructor(
    @InjectRepository(ManualRemediationTask) private readonly tasks: Repository<ManualRemediationTask>,
    @InjectRepository(Incident) private readonly incidents: Repository<Incident>,
    @InjectRepository(Project) private readonly projects: Repository<Project>,
  ) {}

  /** Résout un {projectId, findingTaskId} en preuve de confiance complète (dépôt, SHA, package, versions), en vérifiant à chaque étape la cohérence de propriété entre tâche/incident/projet. */
  async resolve(projectId: string, findingTaskId: string): Promise<TrustedFindingResolution> {
    /** Construit le résultat fail. */
    const fail = (reason: TrustedFindingResolutionFailureReason, detail: string): TrustedFindingResolution => ({ ok: false, reason, detail });

    const task = await this.tasks.findOne({ where: { id: findingTaskId } });
    if (!task) return fail('UNKNOWN_FINDING', `No ManualRemediationTask with id "${findingTaskId}".`);

    if (String(task.projectId) !== String(projectId)) {
      return fail('FINDING_PROJECT_MISMATCH', `Finding "${findingTaskId}" belongs to a different project than requested.`);
    }

    const project = await this.projects.findOne({ where: { id: projectId } });
    if (!project) return fail('PROJECT_NOT_FOUND', `No project with id "${projectId}".`);
    const repository = String(project.githubRepo || '').trim();
    if (!repository) return fail('MISSING_REPOSITORY_BINDING', `Project "${projectId}" has no githubRepo configured.`);

    if (!task.incidentId) return fail('INCIDENT_NOT_FOUND', `Finding "${findingTaskId}" has no associated incident.`);
    const incident = await this.incidents.findOne({ where: { id: task.incidentId } });
    if (!incident) return fail('INCIDENT_NOT_FOUND', `Incident "${task.incidentId}" not found for finding "${findingTaskId}".`);
    if (String(incident.projectId) !== String(projectId)) {
      return fail('INCIDENT_PROJECT_MISMATCH', `Incident "${incident.id}" for finding "${findingTaskId}" belongs to a different project than requested.`);
    }

    const buildSha = String((incident.metadata as any)?.sourceCommitSha || '');
    if (!isFullGitSha(buildSha)) {
      return fail('MISSING_TRUSTED_SHA', `Incident "${incident.id}" has no trusted sourceCommitSha -- refusing to guess a SHA.`);
    }
    // Après un « Merge effectué » sans nouveau build, on part du commit de merge vérifié sur GitHub.
    const candidateBaseSha = effectiveBaseSha(buildSha, incident.createdAt, await latestConfirmedMerge(this.tasks, projectId));

    const snapshot = task.findingSnapshot || {};
    const pkg = snapshot.component;
    const installedVersion = snapshot.currentVersion;
    if (!pkg || !String(pkg).trim() || !installedVersion || !String(installedVersion).trim()) {
      return fail('INCOMPLETE_FINDING_EVIDENCE', `Finding "${findingTaskId}" is missing package/installedVersion in its persisted snapshot.`);
    }

    const v1_8Plan = task.securityFindingRemediation?.v1_8Plan;
    const isParentPlan = v1_8Plan && v1_8Plan.editType === 'PARENT_VERSION';
    const parentRemediationPlan = isParentPlan
      && String(v1_8Plan.actualEditTarget || '').trim() && String(v1_8Plan.fromVersion || '').trim() && String(v1_8Plan.toVersion || '').trim()
      ? {
          actualEditTarget: String(v1_8Plan.actualEditTarget).trim(), fromVersion: String(v1_8Plan.fromVersion).trim(), toVersion: String(v1_8Plan.toVersion).trim(),
          ...(String(v1_8Plan.expectedResolvedDependency || '').trim() ? { expectedResolvedDependency: String(v1_8Plan.expectedResolvedDependency).trim() } : {}),
        }
      : undefined;
    const pinnedTargetVersion = !isParentPlan && v1_8Plan && String(v1_8Plan.actualEditTarget) === String(pkg) && String(v1_8Plan.toVersion || '').trim()
      ? String(v1_8Plan.toVersion).trim() : undefined;

    return {
      ok: true,
      repository,
      candidateBaseSha: candidateBaseSha.toLowerCase(),
      finding: {
        findingIdentity: task.findingFingerprint,
        cveId: task.ruleOrCve || undefined,
        source: task.source,
        package: String(pkg),
        expectedInstalledVersion: String(installedVersion),
        fixedVersion: snapshot.fixedVersion != null ? String(snapshot.fixedVersion) : null,
        ...(pinnedTargetVersion ? { pinnedTargetVersion } : {}),
        ...(parentRemediationPlan ? { parentRemediationPlan } : {}),
      },
      cveId: task.ruleOrCve != null && String(task.ruleOrCve).trim() ? String(task.ruleOrCve) : null,
      title: task.title != null && String(task.title).trim() ? String(task.title) : null,
    };
  }
}
