"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SourceEvidenceModule = exports.SourceEvidenceController = exports.SourceEvidenceService = void 0;
exports.assertUuid = assertUuid;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const typeorm_1 = require("typeorm");
const jwt_auth_guard_1 = require("../auth/jwt-auth.guard");
const local_scanner_reports_1 = require("./local-scanner-reports");
const source_evidence_assembler_1 = require("./source-evidence.assembler");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function assertUuid(value, label) {
    if (!UUID.test(String(value || '')))
        throw new common_1.BadRequestException(`${label} invalide`);
    return value;
}
const PROJECT_FIELDS = [
    'id', 'name', 'githubRepo', 'sonarqubeUrl', 'sonarqubePublicUrl', 'sonarqubeKey',
    'jenkinsUrl', 'jenkinsPublicUrl', 'jenkinsJobName', 'jenkinsJobPath',
    'trivyReportPath', 'owaspReportPath', 'zapReportPath', 'dockerfilePath', 'azureConfig',
].map(f => `"${f}"`).join(', ');
let SourceEvidenceService = class SourceEvidenceService {
    constructor(db) {
        this.db = db;
        this.localStore = new local_scanner_reports_1.LocalScannerReportStore();
    }
    localContext(project, incident) {
        return { projectId: project.id, projectName: project.name, incidentId: incident.id,
            job: incident.jenkinsJobName || incident.metadata?.enrichedData?.build?.job || project.jenkinsJobPath || project.jenkinsJobName,
            buildNumber: Number(incident.buildNumber), commitSha: incident.metadata?.sourceCommitSha || null };
    }
    async withLocalReports(view, project, incident) {
        if (!incident)
            return view;
        const localReports = await this.localStore.list(this.localContext(project, incident));
        for (const report of localReports) {
            if (!report.available)
                continue;
            const slot = `${report.scanner.toUpperCase()}_REPORT`;
            const current = view.slots[slot];
            view.slots[slot] = { ...current, availability: current?.availability === 'LINK' ? 'LINK' : 'PATH_ONLY', url: current?.url || null,
                sourcePath: report.sourcePath, buildNumber: Number(incident.buildNumber),
                reason: current?.url ? null : 'Fichier local disponible dans la plateforme, bloc « Rapports locaux du build ».' };
        }
        for (const finding of view.findings || []) {
            const slot = view.slots[`${finding.scanner}_REPORT`];
            if (slot?.sourcePath)
                finding.slots.REPORT = slot;
        }
        return Object.assign(view, { localReports });
    }
    async localReport(incidentId, scanner) {
        assertUuid(incidentId, 'incidentId');
        if (!['trivy', 'owasp', 'zap'].includes(scanner))
            throw new common_1.BadRequestException('Scanner invalide.');
        const ctx = await this.read(async (manager) => {
            const [incident] = await manager.query('SELECT "id", "projectId", "buildNumber", "jenkinsJobName", "metadata" FROM "incidents" WHERE "id" = $1', [incidentId]);
            if (!incident)
                throw new common_1.NotFoundException('Analyse introuvable');
            return this.localContext(await this.project(manager, incident.projectId), incident);
        });
        try {
            return await this.localStore.read(ctx, scanner);
        }
        catch (error) {
            if (error.message === 'REPORT_NOT_FOUND')
                throw new common_1.NotFoundException('Rapport local absent ou provenance non vérifiable pour ce build.');
            throw new common_1.BadRequestException('Rapport local illisible ou JSON invalide.');
        }
    }
    read(work) {
        return this.db.transaction('REPEATABLE READ', async (manager) => {
            await manager.query('SET TRANSACTION READ ONLY');
            return work(manager);
        });
    }
    async project(manager, projectId) {
        const [row] = await manager.query(`SELECT ${PROJECT_FIELDS} FROM "projects" WHERE "id" = $1`, [projectId]);
        if (!row)
            throw new common_1.NotFoundException('Projet introuvable');
        return row;
    }
    async latestArtifact(manager, projectId) {
        try {
            const [row] = await manager.query(`SELECT "buildNumber", "commitSha", "registry", "repository", "tag", "digest", "provenanceVerified"
           FROM "deployment_artifacts"
          WHERE "projectId" = $1 AND "provenanceVerified" = true
          ORDER BY "buildNumber" DESC, "createdAt" DESC
          LIMIT 1`, [projectId]);
            return row || null;
        }
        catch {
            return null;
        }
    }
    async remediationTasks(manager, incidentId) {
        try {
            return await manager.query(`SELECT "id", "source", "findingId", "ruleOrCve", "findingSnapshot", "securityFindingRemediation"
           FROM "manual_remediation_tasks"
          WHERE "incidentId" = $1 AND "securityFindingRemediation" IS NOT NULL
          ORDER BY "updatedAt" DESC
          LIMIT 50`, [incidentId]);
        }
        catch {
            return [];
        }
    }
    async forProject(projectId) {
        assertUuid(projectId, 'projectId');
        return this.read(async (manager) => {
            const project = await this.project(manager, projectId);
            const [latest] = await manager.query(`SELECT "id", "jenkinsJobName", "buildNumber", "metadata" FROM "incidents"
          WHERE "projectId" = $1 ORDER BY "createdAt" DESC, "id" DESC LIMIT 1`, [projectId]);
            const [latestReported] = await manager.query(`SELECT "id", "jenkinsJobName", "buildNumber", "metadata" FROM "incidents"
          WHERE "projectId" = $1 AND "metadata" #> '{validation,reports}' IS NOT NULL
          ORDER BY "createdAt" DESC, "id" DESC LIMIT 1`, [projectId]);
            return this.withLocalReports((0, source_evidence_assembler_1.buildProjectEvidence)({
                project,
                latest: latest || null,
                latestReported: latestReported || null,
                artifact: await this.latestArtifact(manager, projectId),
            }), project, latest);
        });
    }
    async forIncident(incidentId) {
        assertUuid(incidentId, 'incidentId');
        return this.read(async (manager) => {
            const [incident] = await manager.query(`SELECT "id", "projectId", "buildNumber", "prUrl", "jenkinsJobName", "metadata"
           FROM "incidents" WHERE "id" = $1`, [incidentId]);
            if (!incident)
                throw new common_1.NotFoundException('Analyse introuvable');
            const project = await this.project(manager, incident.projectId);
            return this.withLocalReports((0, source_evidence_assembler_1.buildIncidentEvidence)({
                project,
                incident,
                artifact: await this.latestArtifact(manager, incident.projectId),
                remediationTasks: await this.remediationTasks(manager, incidentId),
            }), project, incident);
        });
    }
};
exports.SourceEvidenceService = SourceEvidenceService;
exports.SourceEvidenceService = SourceEvidenceService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [typeorm_1.DataSource])
], SourceEvidenceService);
let SourceEvidenceController = class SourceEvidenceController {
    constructor(service) {
        this.service = service;
    }
    project(id) { return this.service.forProject(id); }
    localReport(id, scanner) { return this.service.localReport(id, scanner); }
    incident(id) { return this.service.forIncident(id); }
};
exports.SourceEvidenceController = SourceEvidenceController;
__decorate([
    (0, common_1.Get)('project/:id'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], SourceEvidenceController.prototype, "project", null);
__decorate([
    (0, common_1.Get)('incident/:id/local-reports/:scanner'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Param)('scanner')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], SourceEvidenceController.prototype, "localReport", null);
__decorate([
    (0, common_1.Get)('incident/:id'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], SourceEvidenceController.prototype, "incident", null);
exports.SourceEvidenceController = SourceEvidenceController = __decorate([
    (0, swagger_1.ApiTags)('Source'),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.Controller)('source-evidence'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __metadata("design:paramtypes", [SourceEvidenceService])
], SourceEvidenceController);
let SourceEvidenceModule = class SourceEvidenceModule {
};
exports.SourceEvidenceModule = SourceEvidenceModule;
exports.SourceEvidenceModule = SourceEvidenceModule = __decorate([
    (0, common_1.Module)({ controllers: [SourceEvidenceController], providers: [SourceEvidenceService] })
], SourceEvidenceModule);
//# sourceMappingURL=source-evidence.module.js.map