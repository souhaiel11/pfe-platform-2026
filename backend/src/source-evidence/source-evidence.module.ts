// Module de lecture seule des emplacements de preuve (« Voir dans la source »).
import {
  BadRequestException, Controller, Get, Injectable, Module, NotFoundException, Param, UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { DataSource, EntityManager } from 'typeorm';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { LocalScannerReportStore, LocalReportContext } from './local-scanner-reports';
import {
  ArtifactEvidenceRow, IncidentSourceEvidence, ProjectEvidenceRow, ProjectSourceEvidence,
  RemediationEvidenceRow, buildIncidentEvidence, buildProjectEvidence,
} from './source-evidence.assembler';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Vérifie qu'une valeur est bien un UUID, sinon lève une erreur 400 nommant le champ fautif. */
export function assertUuid(value: string, label: string): string {
  if (!UUID.test(String(value || ''))) throw new BadRequestException(`${label} invalide`);
  return value;
}

const PROJECT_FIELDS = [
  'id', 'name', 'githubRepo', 'sonarqubeUrl', 'sonarqubePublicUrl', 'sonarqubeKey',
  'jenkinsUrl', 'jenkinsPublicUrl', 'jenkinsJobName', 'jenkinsJobPath',
  'trivyReportPath', 'owaspReportPath', 'zapReportPath', 'dockerfilePath', 'azureConfig',
].map(f => `"${f}"`).join(', ');

@Injectable()
export class SourceEvidenceService {
  private readonly localStore = new LocalScannerReportStore();
  /** Initialise les dépendances et l’état de ce composant. */
  constructor(private readonly db: DataSource) {}

  /** Construit le contexte (job/build/commit) nécessaire pour localiser les rapports de scanner locaux d'un incident. */
  private localContext(project: ProjectEvidenceRow, incident: any): LocalReportContext {
    return { projectId: project.id, projectName: project.name, incidentId: incident.id,
      job: incident.jenkinsJobName || incident.metadata?.enrichedData?.build?.job || project.jenkinsJobPath || project.jenkinsJobName,
      buildNumber: Number(incident.buildNumber), commitSha: incident.metadata?.sourceCommitSha || null };
  }

  /** Complète une vue de preuve déjà assemblée avec les rapports de scanner trouvés localement sur disque (quand disponibles). */
  private async withLocalReports<T extends { slots: Record<string, any>; findings?: any[] }>(view: T, project: ProjectEvidenceRow, incident: any): Promise<T> {
    if (!incident) return view;
    const localReports = await this.localStore.list(this.localContext(project, incident));
    for (const report of localReports) {
      if (!report.available) continue;
      const slot = `${report.scanner.toUpperCase()}_REPORT`;
      const current = view.slots[slot];
      view.slots[slot] = { ...current, availability: current?.availability === 'LINK' ? 'LINK' : 'PATH_ONLY', url: current?.url || null,
        sourcePath: report.sourcePath, buildNumber: Number(incident.buildNumber),
        applicationPath: `/scanner-reports/${incident.id}/${report.scanner}`,
        reason: current?.url ? null : 'Rapport consultable dans la plateforme ; chemin complet dans le stockage du backend.' };
    }
    for (const finding of view.findings || []) {
      const slot = view.slots[`${finding.scanner}_REPORT`];
      if (slot?.sourcePath) finding.slots.REPORT = slot;
    }
    return Object.assign(view, { localReports });
  }

  /** Lit le contenu brut d'un rapport de scanner local précis pour un incident, après avoir vérifié son existence et sa provenance. */
  async localReport(incidentId: string, scanner: string) {
    assertUuid(incidentId, 'incidentId');
    if (!['trivy', 'owasp', 'zap'].includes(scanner)) throw new BadRequestException('Scanner invalide.');
    const ctx = await this.read(async manager => {
      const [incident] = await manager.query('SELECT "id", "projectId", "buildNumber", "jenkinsJobName", "metadata" FROM "incidents" WHERE "id" = $1', [incidentId]);
      if (!incident) throw new NotFoundException('Analyse introuvable');
      return this.localContext(await this.project(manager, incident.projectId), incident);
    });
    try { return await this.localStore.read(ctx, scanner); }
    catch (error) {
      if (error.message === 'REPORT_NOT_FOUND') throw new NotFoundException('Rapport local absent ou provenance non vérifiable pour ce build.');
      throw new BadRequestException('Rapport local illisible ou JSON invalide.');
    }
  }

  /** Exécute une lecture dans une transaction REPEATABLE READ / READ ONLY — garantit qu'aucune méthode de ce service ne peut écrire. */
  private read<T>(work: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.db.transaction('REPEATABLE READ', async manager => {
      await manager.query('SET TRANSACTION READ ONLY');
      return work(manager);
    });
  }

  /** Relit les champs de configuration non sensibles d'un projet par id, ou lève une erreur 404. */
  private async project(manager: EntityManager, projectId: string): Promise<ProjectEvidenceRow> {
    const [row] = await manager.query(`SELECT ${PROJECT_FIELDS} FROM "projects" WHERE "id" = $1`, [projectId]);
    if (!row) throw new NotFoundException('Projet introuvable');
    return row as ProjectEvidenceRow;
  }

  /** Renvoie le dernier artefact de déploiement du projet, ou null si la table n'existe pas encore ou si aucun artefact n'est enregistré. */
  private async latestArtifact(manager: EntityManager, projectId: string): Promise<ArtifactEvidenceRow | null> {
    try {
      const [row] = await manager.query(
        `SELECT "buildNumber", "commitSha", "registry", "repository", "tag", "digest", "provenanceVerified"
           FROM "deployment_artifacts"
          WHERE "projectId" = $1 AND "provenanceVerified" = true
          ORDER BY "buildNumber" DESC, "createdAt" DESC
          LIMIT 1`,
        [projectId],
      );
      return (row as ArtifactEvidenceRow) || null;
    } catch {
      return null;
    }
  }

  /** Récupère les tâches de remédiation automatique liées à cet incident, pour construire leur chaîne de preuve. */
  private async remediationTasks(manager: EntityManager, incidentId: string): Promise<RemediationEvidenceRow[]> {
    try {
      return await manager.query(
        `SELECT "id", "source", "findingId", "ruleOrCve", "findingSnapshot", "securityFindingRemediation"
           FROM "manual_remediation_tasks"
          WHERE "incidentId" = $1 AND "securityFindingRemediation" IS NOT NULL
          ORDER BY "updatedAt" DESC
          LIMIT 50`,
        [incidentId],
      );
    } catch {
      return [];
    }
  }

  /** Assemble la table de preuve d'un projet à partir de ses lignes réellement persistées. */
  async forProject(projectId: string): Promise<ProjectSourceEvidence> {
    assertUuid(projectId, 'projectId');
    return this.read(async manager => {
      const project = await this.project(manager, projectId);
      const [latest] = await manager.query(
        `SELECT "id", "jenkinsJobName", "buildNumber", "metadata" FROM "incidents"
          WHERE "projectId" = $1 ORDER BY "createdAt" DESC, "id" DESC LIMIT 1`,
        [projectId],
      );
      const [latestReported] = await manager.query(
        `SELECT "id", "jenkinsJobName", "buildNumber", "metadata" FROM "incidents"
          WHERE "projectId" = $1 AND "metadata" #> '{validation,reports}' IS NOT NULL
          ORDER BY "createdAt" DESC, "id" DESC LIMIT 1`,
        [projectId],
      );
      return this.withLocalReports(buildProjectEvidence({
        project,
        latest: latest || null,
        latestReported: latestReported || null,
        artifact: await this.latestArtifact(manager, projectId),
      }), project, latest);
    });
  }

  /** Assemble la table de preuve complète d'un incident, le projet étant toujours relu depuis l'incident pour garantir l'isolation par projet. */
  async forIncident(incidentId: string): Promise<IncidentSourceEvidence> {
    assertUuid(incidentId, 'incidentId');
    return this.read(async manager => {
      const [incident] = await manager.query(
        `SELECT "id", "projectId", "buildNumber", "prUrl", "jenkinsJobName", "metadata"
           FROM "incidents" WHERE "id" = $1`,
        [incidentId],
      );
      if (!incident) throw new NotFoundException('Analyse introuvable');
      const project = await this.project(manager, incident.projectId);
      return this.withLocalReports(buildIncidentEvidence({
        project,
        incident,
        artifact: await this.latestArtifact(manager, incident.projectId),
        remediationTasks: await this.remediationTasks(manager, incidentId),
      }), project, incident);
    });
  }
}

@ApiTags('Source')
@ApiBearerAuth()
@Controller('source-evidence')
@UseGuards(JwtAuthGuard)
export class SourceEvidenceController {
  /** Initialise les dépendances et l’état de ce composant. */
  constructor(private readonly service: SourceEvidenceService) {}

  /** Renvoie la table de preuve d'un projet. */
  @Get('project/:id')
  project(@Param('id') id: string) { return this.service.forProject(id); }

  /** Renvoie le contenu brut d'un rapport de scanner local pour un incident donné. */
  @Get('incident/:id/local-reports/:scanner')
  localReport(@Param('id') id: string, @Param('scanner') scanner: string) { return this.service.localReport(id, scanner); }

  /** Renvoie la table de preuve complète d'un incident. */
  @Get('incident/:id')
  incident(@Param('id') id: string) { return this.service.forIncident(id); }
}

@Module({ controllers: [SourceEvidenceController], providers: [SourceEvidenceService] })
export class SourceEvidenceModule {}
