"use strict";
const optimizer_contract_1 = require("./optimizer-contract");
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
exports.JenkinsOptimizerModule = exports.JenkinsOptimizerController = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const crypto_1 = require("crypto");
const jenkins_analysis_entity_1 = require("./jenkins-analysis.entity");
const jenkins_apply_entity_1 = require("./jenkins-apply.entity");
const jwt_auth_guard_1 = require("../auth/jwt-auth.guard");
const jwt_or_internal_secret_guard_1 = require("../auth/jwt-or-internal-secret.guard");
const project_entity_1 = require("../projects/project.entity");
const N8N_URL = process.env.N8N_URL || 'http://172.31.172.61:5678';
const N8N_CALLBACK_SECRET = process.env.N8N_CALLBACK_SECRET;
const WEBHOOK = `${N8N_URL}/webhook/jenkinsfile-optimize`;
const APPLY_WEBHOOK = `${N8N_URL}/webhook/jenkinsfile-apply`;
const FETCH_WEBHOOK = `${N8N_URL}/webhook/jenkinsfile-fetch`;
function buildSelection(retained, discarded) {
    return {
        kept: retained.map((i) => ({ ref: i.id, title: i.title })),
        excluded: discarded.map((i) => ({ ref: i.id, title: i.title })),
    };
}
const jobs = new Map();
const JOB_RETENTION_MS = 30 * 60_000;
const APPLY_STALE_MS = 12 * 60_000;
setInterval(() => {
    const now = Date.now();
    for (const [id, job] of jobs) {
        if (job.status === 'pending')
            continue;
        if (job.settledAt && now - job.settledAt > JOB_RETENTION_MS)
            jobs.delete(id);
    }
}, 5 * 60_000);
let JenkinsOptimizerController = class JenkinsOptimizerController {
    constructor(analyses, applies, projects) {
        this.analyses = analyses;
        this.applies = applies;
        this.projects = projects;
        setInterval(() => this.sweepStaleApplies(), 2 * 60_000);
    }
    async sweepStaleApplies() {
        const staleBefore = new Date(Date.now() - APPLY_STALE_MS);
        const stale = await this.applies.find({
            where: { status: jenkins_apply_entity_1.JenkinsApplyStatus.PENDING, createdAt: (0, typeorm_2.LessThan)(staleBefore) },
        });
        for (const row of stale) {
            row.status = jenkins_apply_entity_1.JenkinsApplyStatus.FAILED;
            row.result = { message: 'Délai dépassé, réessayez.' };
            row.settledAt = new Date();
            await this.applies.save(row);
            console.warn(`[jenkins-optimizer] apply ${row.applyId} péremption forcée par le balayage en arrière-plan (aucun callback n8n reçu après ${APPLY_STALE_MS / 60000} min)`);
        }
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
            console.warn(`[jenkins-optimizer] default_branch fetch failed for ${owner}/${repo} (${e?.message || e})`);
            return '';
        }
    }
    async optimize(body) {
        if (!body?.projectId) {
            throw new common_1.HttpException('projectId requis', common_1.HttpStatus.BAD_REQUEST);
        }
        let jenkinsfile = body.jenkinsfile;
        let selection;
        if (body.priorJobId) {
            const prior = await this.analyses.findOneBy({ jobId: body.priorJobId });
            if (!prior) {
                throw new common_1.HttpException('Analyse de référence introuvable pour la régénération', common_1.HttpStatus.NOT_FOUND);
            }
            if (!prior.sourceJenkinsfile) {
                // Ligne antérieure à l'ajout de sourceJenkinsfile (colonne nullable) —
                // pas de fichier original à reprendre, pas de fallback silencieux.
                throw new common_1.HttpException('Régénération impossible : Jenkinsfile source non disponible pour cette analyse, relancez une analyse complète.', common_1.HttpStatus.UNPROCESSABLE_ENTITY);
            }
            jenkinsfile = prior.sourceJenkinsfile;
            if (Array.isArray(body.retainedIssues) && Array.isArray(body.discardedIssues)) {
                selection = buildSelection(body.retainedIssues, body.discardedIssues);
            }
        }
        if (!jenkinsfile || jenkinsfile.trim().length < 30) {
            throw new common_1.HttpException('Jenkinsfile vide ou trop court', common_1.HttpStatus.BAD_REQUEST);
        }
        (0, optimizer_contract_1.assertOptimizerInput)(jenkinsfile);
        const id = (0, crypto_1.randomUUID)();
        jobs.set(id, { status: 'pending', createdAt: Date.now() });
        // Écrite AVANT l'appel n8n ci-dessous, jamais après : c'est ce qui
        // permet au callback (et au polling) de retrouver ce job même si le
        // backend redémarre entre cette ligne et la réception du callback.
        await this.analyses.save(this.analyses.create({
            jobId: id,
            projectId: body.projectId,
            status: jenkins_analysis_entity_1.JenkinsAnalysisStatus.PENDING,
            sourceJenkinsfile: jenkinsfile,
        }));
        // Repo/branche rechargés depuis la DB (Project.githubRepo), jamais
        // acceptés depuis le frontend — même principe que
        // ProjectsService.getGithubStats(). Un projet sans githubRepo configuré
        // ne casse rien : owner/repo restent vides, WF4 continue comme avant
        // (analyse texte pure, sans contexte GitHub).
        let owner = '';
        let repo = '';
        let branch = 'main';
        const project = await this.projects.findOneBy({ id: body.projectId });
        if (project?.githubRepo) {
            const [o, r] = project.githubRepo.replace('https://github.com/', '').split('/');
            if (o && r) {
                owner = o;
                repo = r;
                branch = await this.resolveDefaultBranch(owner, repo, project.githubToken);
            }
        }
        // Fire-and-forget : on n'attend jamais cette promesse pour répondre au frontend.
        const n8nPayload = {
            jobId: id,
            jenkinsfile,
            projectName: body.projectName || 'projet',
            // Ajoutés pour le futur node "Fetch Project Context" côté n8n (pas
            // encore câblé) — owner/repo vides si le projet n'a pas de githubRepo
            // configuré, "Prepare - Optimizer Body" devra tolérer ce cas.
            owner,
            repo,
            branch,
            buildError: body.buildError || null,
            // context.notes reste pour l'analyse INITIALE (pas de sélection) —
            // selection est un champ structuré séparé, lu par "Prepare - Optimizer
            // Body" côté n8n, absent tant qu'il n'y a rien à régénérer.
            context: { notes: body.notes || '' },
            ...(selection ? { selection } : {}),
        };
        // Visibilité directe sur ce qui part réellement à l'agent — utile pour
        // diagnostiquer un prompt de régénération qui ne serait pas respecté.
        console.log(`[jenkins-optimizer] analyse envoyée à n8n : jobId=${id}, caractères=${jenkinsfile.length}`);
        fetch(WEBHOOK, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(n8nPayload),
            signal: AbortSignal.timeout(30000),
        }).then(async (response) => {
            const reason = await (0, optimizer_contract_1.readOptimizerRejection)(response);
            if (!reason || jobs.get(id)?.status !== 'pending')
                return;
            await this.receiveOptimizeCallback(id, { status: 'error', reason }, N8N_CALLBACK_SECRET);
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
                // Timeout du signal (TimeoutError/AbortError) ou toute autre
                // erreur ambiguë : on ne sait rien de l'état réel de l'analyse
                // côté n8n. On n'invente pas un échec — on logge et on laisse
                // 'pending', le callback (succès ou erreur explicite) tranchera.
                console.warn(`[jenkins-optimizer] fetch de déclenchement non confirmé pour ${id} ` +
                    `(${e?.name || '?'}: ${e?.message || e}) — job laissé 'pending', en attente du callback n8n`);
            }
        });
        return { id };
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
            console.warn(`[jenkins-optimizer] callback reçu pour un job absent du Map (probable redémarrage) : ${id} — fallback DB`);
        }
        const row = await this.analyses.findOneBy({ jobId: id });
        if (!row) {
            console.warn(`[jenkins-optimizer] callback reçu pour un jobId totalement inconnu (ni Map ni DB) : ${id}`);
            return { received: false };
        }
        row.status = body.status === 'done' ? jenkins_analysis_entity_1.JenkinsAnalysisStatus.DONE : jenkins_analysis_entity_1.JenkinsAnalysisStatus.ERROR;
        row.result = body.result ?? null;
        row.reason = body.status === 'error' ? (body.reason || 'Erreur inconnue') : null;
        row.detail = body.detail ?? null;
        row.settledAt = new Date(settledAt);
        await this.analyses.save(row);
        return { received: true };
    }
    async listAnalyses(projectId) {
        if (!projectId) {
            throw new common_1.HttpException('projectId requis', common_1.HttpStatus.BAD_REQUEST);
        }
        return this.analyses.find({ where: { projectId }, order: { createdAt: 'DESC' } });
    }
    async fetch(body) {
        if (!body?.owner || !body?.repo) {
            throw new common_1.HttpException('owner et repo sont requis', common_1.HttpStatus.BAD_REQUEST);
        }
        return require("./fetch-jenkinsfile").fetchJenkinsfile(FETCH_WEBHOOK, body);
    }
    async apply(body, req) {
        if (!['admin', 'developer'].includes(String(req.user?.role || '').toLowerCase())) {
            throw new common_1.HttpException('Utilisateur non autorisé à créer une correction', common_1.HttpStatus.FORBIDDEN);
        }
        if (!body?.jobId || !body?.owner || !body?.repo) {
            throw new common_1.HttpException('jobId, owner et repo sont requis', common_1.HttpStatus.BAD_REQUEST);
        }
        const analysis = await this.analyses.findOneBy({ jobId: body.jobId });
        if (!analysis) {
            throw new common_1.HttpException('Analyse introuvable pour cette PR', common_1.HttpStatus.NOT_FOUND);
        }
        if (!analysis.sourceJenkinsfile) {
            throw new common_1.HttpException('Analyse sans Jenkinsfile source, relancez l\'analyse', common_1.HttpStatus.BAD_REQUEST);
        }
        const storedIssues = analysis.result?.issues || [];
        const toFullIssue = (ref) => {
            const issue = storedIssues.find((i) => i.id === ref);
            return issue
                ? { ref: issue.id, title: issue.title, recommendation: issue.recommendation }
                : { ref, title: ref, recommendation: '' };
        };
        const retained = (body.retainedIssues || []).map((i) => toFullIssue(i.id));
        const excluded = (body.discardedIssues || []).map((i) => toFullIssue(i.id));
        const applyId = (0, crypto_1.randomUUID)();
        await this.applies.save(this.applies.create({
            applyId,
            analysisJobId: body.jobId,
            status: jenkins_apply_entity_1.JenkinsApplyStatus.PENDING,
        }));
        const project = await this.projects.findOne({ where: { githubRepo: `${body.owner}/${body.repo}` } });
        const baseBranch = body.baseBranch || await this.resolveDefaultBranch(body.owner, body.repo, project?.githubToken);
        if (!baseBranch)
            throw new common_1.HttpException('Branche par défaut introuvable', common_1.HttpStatus.BAD_GATEWAY);
        const applyPayload = {
            applyId,
            owner: body.owner,
            repo: body.repo,
            baseBranch,
            filePath: body.filePath || 'Jenkinsfile',
            originalJenkinsfile: analysis.sourceJenkinsfile,
            retained,
            excluded,
        };
        console.log(`[jenkins-optimizer] demande APPLY transmise à n8n pour applyId=${applyId}`);
        fetch(APPLY_WEBHOOK, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Internal-Secret': process.env.N8N_INTERNAL_SECRET || '' },
            body: JSON.stringify(applyPayload),
            signal: AbortSignal.timeout(30000),
        }).catch(async (e) => {
            const NETWORK_REFUSAL_CODES = new Set([
                'ECONNREFUSED', 'ENOTFOUND', 'EHOSTUNREACH', 'ECONNRESET', 'ENETUNREACH',
            ]);
            const isVerifiedNetworkRefusal = NETWORK_REFUSAL_CODES.has(e?.cause?.code);
            if (!isVerifiedNetworkRefusal) {
                console.warn(`[jenkins-optimizer] fetch APPLY de déclenchement non confirmé pour ${applyId} ` +
                    `(${e?.name || '?'}: ${e?.message || e}) — laissé 'pending', en attente du callback n8n`);
                return;
            }
            const row = await this.applies.findOneBy({ applyId });
            if (!row || row.status !== jenkins_apply_entity_1.JenkinsApplyStatus.PENDING)
                return;
            row.status = jenkins_apply_entity_1.JenkinsApplyStatus.FAILED;
            row.result = { message: 'Workflow n8n injoignable' };
            row.settledAt = new Date();
            await this.applies.save(row);
        });
        return { applyId };
    }
    async getApplyStatus(applyId) {
        const row = await this.applies.findOneBy({ applyId });
        if (!row) {
            throw new common_1.HttpException('Apply introuvable ou expiré', common_1.HttpStatus.NOT_FOUND);
        }
        if (row.status === jenkins_apply_entity_1.JenkinsApplyStatus.PENDING && Date.now() - row.createdAt.getTime() > APPLY_STALE_MS) {
            row.status = jenkins_apply_entity_1.JenkinsApplyStatus.FAILED;
            row.result = { message: 'Délai dépassé, réessayez.' };
            row.settledAt = new Date();
            await this.applies.save(row);
        }
        return { status: row.status, result: row.result };
    }
    async receiveApplyCallback(applyId, body, secret) {
        if (!N8N_CALLBACK_SECRET || secret !== N8N_CALLBACK_SECRET) {
            throw new common_1.HttpException('Callback non autorisé', common_1.HttpStatus.FORBIDDEN);
        }
        const row = await this.applies.findOneBy({ applyId });
        if (!row) {
            console.warn(`[jenkins-optimizer] callback APPLY reçu pour un applyId inconnu : ${applyId}`);
            return { received: false };
        }
        row.status = body.status;
        row.result = body.result ?? null;
        row.settledAt = new Date();
        await this.applies.save(row);
        return { received: true };
    }
};
exports.JenkinsOptimizerController = JenkinsOptimizerController;
__decorate([
    (0, common_1.UseGuards)(jwt_or_internal_secret_guard_1.JwtOrInternalSecretGuard),
    (0, common_1.Post)('optimize'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], JenkinsOptimizerController.prototype, "optimize", null);
__decorate([
    (0, common_1.UseGuards)(jwt_or_internal_secret_guard_1.JwtOrInternalSecretGuard),
    (0, common_1.Get)('optimize/:id/status'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], JenkinsOptimizerController.prototype, "getOptimizeStatus", null);
__decorate([
    (0, common_1.Post)('optimize/:id/callback'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Headers)('x-callback-secret')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, String]),
    __metadata("design:returntype", Promise)
], JenkinsOptimizerController.prototype, "receiveOptimizeCallback", null);
__decorate([
    (0, common_1.Get)('analyses'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __param(0, (0, common_1.Query)('projectId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], JenkinsOptimizerController.prototype, "listAnalyses", null);
__decorate([
    (0, common_1.UseGuards)(jwt_or_internal_secret_guard_1.JwtOrInternalSecretGuard),
    (0, common_1.Post)('fetch'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], JenkinsOptimizerController.prototype, "fetch", null);
__decorate([
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, common_1.Post)('apply'),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], JenkinsOptimizerController.prototype, "apply", null);
__decorate([
    (0, common_1.Get)('apply/:applyId/status'),
    __param(0, (0, common_1.Param)('applyId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], JenkinsOptimizerController.prototype, "getApplyStatus", null);
__decorate([
    (0, common_1.Post)('apply/:applyId/callback'),
    __param(0, (0, common_1.Param)('applyId')),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Headers)('x-callback-secret')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, String]),
    __metadata("design:returntype", Promise)
], JenkinsOptimizerController.prototype, "receiveApplyCallback", null);
exports.JenkinsOptimizerController = JenkinsOptimizerController = __decorate([
    (0, common_1.Controller)('jenkins'),
    __param(0, (0, typeorm_1.InjectRepository)(jenkins_analysis_entity_1.JenkinsAnalysis)),
    __param(1, (0, typeorm_1.InjectRepository)(jenkins_apply_entity_1.JenkinsApply)),
    __param(2, (0, typeorm_1.InjectRepository)(project_entity_1.Project)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.Repository])
], JenkinsOptimizerController);
let JenkinsOptimizerModule = class JenkinsOptimizerModule {
};
exports.JenkinsOptimizerModule = JenkinsOptimizerModule;
exports.JenkinsOptimizerModule = JenkinsOptimizerModule = __decorate([
    (0, common_1.Module)({
        imports: [typeorm_1.TypeOrmModule.forFeature([jenkins_analysis_entity_1.JenkinsAnalysis, jenkins_apply_entity_1.JenkinsApply, project_entity_1.Project])],
        controllers: [JenkinsOptimizerController],
    })
], JenkinsOptimizerModule);
//# sourceMappingURL=jenkins-optimizer.module.js.map