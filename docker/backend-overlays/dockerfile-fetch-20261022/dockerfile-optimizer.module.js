"use strict";
const fetch_dockerfile_1 = require("./fetch-dockerfile");
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
exports.DockerfileOptimizerModule = exports.DockerfileOptimizerController = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const crypto_1 = require("crypto");
const dockerfile_analysis_entity_1 = require("./dockerfile-analysis.entity");
const jwt_auth_guard_1 = require("../auth/jwt-auth.guard");
const project_entity_1 = require("../projects/project.entity");
const N8N_URL = process.env.N8N_URL || 'http://172.31.172.61:5678';
const N8N_CALLBACK_SECRET = process.env.N8N_CALLBACK_SECRET;
const FETCH_WEBHOOK = `${N8N_URL}/webhook/dockerfile-fetch`;
const OPTIMIZE_WEBHOOK = `${N8N_URL}/webhook/dockerfile-optimize`;
const APPLY_WEBHOOK = `${N8N_URL}/webhook/dockerfile-apply`;
const APP_CONFIG_CANDIDATES = [
    'src/main/resources/application.properties',
    'src/main/resources/application.yml',
    'src/main/resources/application.yaml',
];
const jobs = new Map();
const JOB_RETENTION_MS = 30 * 60_000;
setInterval(() => {
    const now = Date.now();
    for (const [id, job] of jobs) {
        if (job.status === 'pending')
            continue;
        if (job.settledAt && now - job.settledAt > JOB_RETENTION_MS)
            jobs.delete(id);
    }
}, 5 * 60_000);
let DockerfileOptimizerController = class DockerfileOptimizerController {
    constructor(analyses, projects) {
        this.analyses = analyses;
        this.projects = projects;
    }
    async resolveDefaultBranch(owner, repo, token) {
        try {
            const headers = { 'User-Agent': 'DevSecOps-Platform' };
            if (token)
                headers['Authorization'] = `token ${token}`;
            const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
                headers,
                signal: AbortSignal.timeout(5000),
            });
            if (!res.ok)
                throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            if (!data.default_branch)
                throw new Error('default_branch absent');
            return data.default_branch;
        }
        catch (e) {
            console.warn(`[dockerfile-optimizer] default_branch fetch failed for ${owner}/${repo} (${e?.message || e})`);
            return '';
        }
    }
    async fetch(body) {
        if (!body?.owner || !body?.repo) {
            throw new common_1.HttpException('owner et repo sont requis', common_1.HttpStatus.BAD_REQUEST);
        }
        const result = await this.callFetch(body.owner, body.repo, body.filePath || 'Dockerfile', body.ref);
        if (!result?.success) {
            throw new common_1.HttpException({ code: result?.code || 'DOCKERFILE_NOT_FOUND', message: result?.message || 'Dockerfile introuvable' }, result?.statusCode || common_1.HttpStatus.NOT_FOUND);
        }
        return result;
    }
    async apply(body, req) {
        if (!['admin', 'developer'].includes(String(req.user?.role || '').toLowerCase())) {
            throw new common_1.HttpException('Utilisateur non autorisé à créer une correction', common_1.HttpStatus.FORBIDDEN);
        }
        if (!body?.requestId || !body?.projectId) {
            throw new common_1.HttpException('requestId et projectId sont requis', common_1.HttpStatus.BAD_REQUEST);
        }
        const ledgerId = `apply:${body.requestId}`;
        const existing = await this.analyses.findOneBy({ jobId: ledgerId });
        if (existing) {
            return { requestId: body.requestId, duplicate: true, status: existing.status, result: existing.result };
        }
        const projectById = await this.projects.findOneBy({ id: body.projectId });
        if (!projectById)
            throw new common_1.HttpException('Projet introuvable', common_1.HttpStatus.NOT_FOUND);
        if (!body?.dockerfile || !Array.isArray(body.findings) || body.findings.length === 0) {
            throw new common_1.HttpException('dockerfile et findings (au moins un) sont requis', common_1.HttpStatus.BAD_REQUEST);
        }
        if (!body?.owner || !body?.repo) {
            throw new common_1.HttpException('owner et repo sont requis', common_1.HttpStatus.BAD_REQUEST);
        }
        const configuredRepo = String(projectById.githubRepo || '').replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '');
        if (configuredRepo.toLowerCase() !== `${body.owner}/${body.repo}`.toLowerCase())
            throw new common_1.HttpException('Repository/project mismatch', common_1.HttpStatus.CONFLICT);
        const baseBranch = body.baseBranch || await this.resolveDefaultBranch(body.owner, body.repo, projectById.githubToken);
        if (!baseBranch)
            throw new common_1.HttpException('Branche par défaut introuvable', common_1.HttpStatus.BAD_GATEWAY);
        await this.analyses.save(this.analyses.create({ projectId: body.projectId, jobId: ledgerId, sourceDockerfile: body.dockerfile,
            status: dockerfile_analysis_entity_1.DockerfileAnalysisStatus.PENDING, result: { kind: 'APPLY', requestId: body.requestId } }));
        try {
            const res = await fetch(APPLY_WEBHOOK, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Internal-Secret': process.env.N8N_INTERNAL_SECRET || '' },
                body: JSON.stringify({
                    dockerfile: body.dockerfile,
                    findings: body.findings,
                    context: body.context || {},
                    owner: body.owner,
                    repo: body.repo,
                    baseBranch,
                    requestId: body.requestId,
                    filePath: body.filePath || 'Dockerfile',
                }),
                signal: AbortSignal.timeout(190000),
            });
            const data = await res.json();
            const result = Array.isArray(data) ? data[0] : data;
            const ledger = await this.analyses.findOneBy({ jobId: ledgerId });
            if (ledger) {
                ledger.status = dockerfile_analysis_entity_1.DockerfileAnalysisStatus.DONE;
                ledger.result = { kind: 'APPLY', requestId: body.requestId, response: result };
                ledger.settledAt = new Date();
                await this.analyses.save(ledger);
            }
            return { requestId: body.requestId, duplicate: false, ...result };
        }
        catch (e) {
            const ledger = await this.analyses.findOneBy({ jobId: ledgerId });
            if (ledger) {
                ledger.status = dockerfile_analysis_entity_1.DockerfileAnalysisStatus.ERROR;
                ledger.reason = 'Docker apply workflow failed';
                ledger.detail = e.message;
                ledger.settledAt = new Date();
                await this.analyses.save(ledger);
            }
            throw new common_1.HttpException(`Agent de remédiation Docker injoignable ou en échec : ${e.message}`, common_1.HttpStatus.BAD_GATEWAY);
        }
    }
    async fetchFirstAvailable(owner, repo, candidates, ref) {
        for (const filePath of candidates) {
            const res = await this.callFetch(owner, repo, filePath, ref);
            if (res?.success)
                return res.content;
        }
        return '';
    }
    async callFetch(owner, repo, filePath, ref) {
        return (0, fetch_dockerfile_1.fetchDockerfile)(FETCH_WEBHOOK, { owner, repo, filePath, ref });
    }
    async optimize(body) {
        if (!body?.owner || !body?.repo || !body?.projectId) {
            throw new common_1.HttpException('owner, repo et projectId sont requis', common_1.HttpStatus.BAD_REQUEST);
        }
        // Branche : si le front n'en fournit pas, on résout la branche par
        // défaut réelle du repo via GitHub plutôt que de retomber en silence
        // sur 'main' (voir resolveDefaultBranch — même logique que WF4). Le
        // token vient du Project (déjà rechargé pour projectId, requis
        // ci-dessus), pas du frontend.
        let ref = body.ref;
        if (!ref) {
            const project = await this.projects.findOneBy({ id: body.projectId });
            ref = await this.resolveDefaultBranch(body.owner, body.repo, project?.githubToken);
        }
        const dockerfileRes = await this.callFetch(body.owner, body.repo, body.dockerfilePath || 'Dockerfile', ref);
        if (!dockerfileRes?.success) {
            throw new common_1.HttpException({ code: dockerfileRes?.code || 'DOCKERFILE_NOT_FOUND', message: dockerfileRes?.message || 'Dockerfile introuvable' }, dockerfileRes?.statusCode || common_1.HttpStatus.NOT_FOUND);
        }
        // pom.xml optionnel — absent (projet non-Java, ou chemin différent) ne
        // lève JAMAIS d'erreur ici : RC-1/RC-3 s'abstiennent simplement si vide
        // (voir "Prepare - Optimizer Body" côté n8n).
        let pomXml = '';
        const pomRes = await this.callFetch(body.owner, body.repo, body.pomPath || 'pom.xml', ref);
        if (pomRes?.success)
            pomXml = pomRes.content;
        // application.properties/.yml optionnel (RC-2, port) — même logique :
        // absent n'est jamais une erreur, RC-2 s'abstient. appConfigPath permet
        // de forcer un chemin précis (tests, projets non standards) ; sinon on
        // essaie les emplacements Spring Boot usuels dans l'ordre.
        const appConfig = body.appConfigPath
            ? (await this.callFetch(body.owner, body.repo, body.appConfigPath, ref))?.content || ''
            : await this.fetchFirstAvailable(body.owner, body.repo, APP_CONFIG_CANDIDATES, ref);
        const id = (0, crypto_1.randomUUID)();
        jobs.set(id, { status: 'pending', createdAt: Date.now() });
        await this.analyses.save(this.analyses.create({
            jobId: id,
            projectId: body.projectId,
            status: dockerfile_analysis_entity_1.DockerfileAnalysisStatus.PENDING,
            sourceDockerfile: dockerfileRes.content,
            sourcePomXml: pomXml || null,
            sourceAppConfig: appConfig || null,
        }));
        const n8nPayload = {
            jobId: id,
            dockerfile: dockerfileRes.content,
            pomXml,
            appConfig,
            projectName: body.projectName || 'projet',
            context: { notes: body.notes || '' },
            buildError: body.buildError || null,
        };
        console.log(`[dockerfile-optimizer] payload envoyé à n8n pour ${id} : dockerfile=${dockerfileRes.content.length} chars, pomXml=${pomXml.length} chars, appConfig=${appConfig.length} chars`);
        fetch(OPTIMIZE_WEBHOOK, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(n8nPayload),
            signal: AbortSignal.timeout(30000),
        }).catch((e) => {
            const job = jobs.get(id);
            if (!job || job.status !== 'pending')
                return;
            const NETWORK_REFUSAL_CODES = new Set([
                'ECONNREFUSED', 'ENOTFOUND', 'EHOSTUNREACH', 'ECONNRESET', 'ENETUNREACH',
            ]);
            const isVerifiedNetworkRefusal = NETWORK_REFUSAL_CODES.has(e?.cause?.code);
            if (isVerifiedNetworkRefusal) {
                job.status = 'error';
                job.reason = 'Workflow n8n injoignable';
                job.detail = e?.cause?.message || e?.message || String(e);
                job.settledAt = Date.now();
            }
            else {
                console.warn(`[dockerfile-optimizer] fetch de déclenchement non confirmé pour ${id} ` +
                    `(${e?.name || '?'}: ${e?.message || e}) — job laissé 'pending', en attente du callback n8n`);
            }
        });
        return { id, pomFound: !!pomXml, appConfigFound: !!appConfig };
    }
    async getOptimizeStatus(id) {
        const job = jobs.get(id);
        if (job) {
            return { status: job.status, result: job.result, reason: job.reason, detail: job.detail };
        }
        const row = await this.analyses.findOneBy({ jobId: id });
        if (!row) {
            throw new common_1.HttpException('Analyse introuvable ou expirée', common_1.HttpStatus.NOT_FOUND);
        }
        return { status: row.status, result: row.result, reason: row.reason, detail: row.detail };
    }
    async receiveOptimizeCallback(id, body, secret) {
        if (!N8N_CALLBACK_SECRET || secret !== N8N_CALLBACK_SECRET) {
            throw new common_1.HttpException('Callback non autorisé', common_1.HttpStatus.FORBIDDEN);
        }
        const settledAt = Date.now();
        const job = jobs.get(id);
        if (job) {
            job.settledAt = settledAt;
            if (body.status === 'done') {
                job.status = 'done';
                job.result = body.result;
            }
            else {
                job.status = 'error';
                job.reason = body.reason || 'Erreur inconnue';
                job.detail = body.detail;
            }
        }
        else {
            console.warn(`[dockerfile-optimizer] callback reçu pour un job absent du Map (probable redémarrage) : ${id} — fallback DB`);
        }
        const row = await this.analyses.findOneBy({ jobId: id });
        if (!row) {
            console.warn(`[dockerfile-optimizer] callback reçu pour un jobId totalement inconnu (ni Map ni DB) : ${id}`);
            return { received: false };
        }
        row.status = body.status === 'done' ? dockerfile_analysis_entity_1.DockerfileAnalysisStatus.DONE : dockerfile_analysis_entity_1.DockerfileAnalysisStatus.ERROR;
        row.result = body.result ?? null;
        row.reason = body.status === 'error' ? (body.reason || 'Erreur inconnue') : null;
        row.detail = body.detail ?? null;
        row.settledAt = new Date(settledAt);
        await this.analyses.save(row);
        return { received: true };
    }
};
exports.DockerfileOptimizerController = DockerfileOptimizerController;
__decorate([
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, common_1.Post)('fetch'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], DockerfileOptimizerController.prototype, "fetch", null);
__decorate([
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, common_1.Post)('apply'),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], DockerfileOptimizerController.prototype, "apply", null);
__decorate([
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, common_1.Post)('optimize'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], DockerfileOptimizerController.prototype, "optimize", null);
__decorate([
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, common_1.Get)('optimize/:id/status'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], DockerfileOptimizerController.prototype, "getOptimizeStatus", null);
__decorate([
    (0, common_1.Post)('optimize/:id/callback'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Headers)('x-callback-secret')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, String]),
    __metadata("design:returntype", Promise)
], DockerfileOptimizerController.prototype, "receiveOptimizeCallback", null);
exports.DockerfileOptimizerController = DockerfileOptimizerController = __decorate([
    (0, common_1.Controller)('dockerfile'),
    __param(0, (0, typeorm_1.InjectRepository)(dockerfile_analysis_entity_1.DockerfileAnalysis)),
    __param(1, (0, typeorm_1.InjectRepository)(project_entity_1.Project)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        typeorm_2.Repository])
], DockerfileOptimizerController);
let DockerfileOptimizerModule = class DockerfileOptimizerModule {
};
exports.DockerfileOptimizerModule = DockerfileOptimizerModule;
exports.DockerfileOptimizerModule = DockerfileOptimizerModule = __decorate([
    (0, common_1.Module)({
        imports: [typeorm_1.TypeOrmModule.forFeature([dockerfile_analysis_entity_1.DockerfileAnalysis, project_entity_1.Project])],
        controllers: [DockerfileOptimizerController],
    })
], DockerfileOptimizerModule);
//# sourceMappingURL=dockerfile-optimizer.module.js.map