import { currentOptimizerVerdict } from '../common/optimizer-verdict';
import { fetchDockerfile } from './fetch-dockerfile';
// Contient le contrôleur et le module de l'optimiseur Dockerfile.
import { Module, Controller, Post, Get, Param, Body, Headers, UseGuards, HttpException, HttpStatus, Req, Query } from '@nestjs/common';
import { TypeOrmModule, InjectRepository } from '@nestjs/typeorm';
import { Repository, Not, Like } from 'typeorm';
import { randomUUID } from 'crypto';
import { DockerfileAnalysis, DockerfileAnalysisStatus } from './dockerfile-analysis.entity';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { JwtOrInternalSecretGuard } from '../auth/jwt-or-internal-secret.guard';
import { Project } from '../projects/project.entity';

const N8N_URL = process.env.N8N_URL || 'http://172.31.172.61:5678';
const N8N_CALLBACK_SECRET = process.env.N8N_CALLBACK_SECRET;
const FETCH_WEBHOOK = `${N8N_URL}/webhook/dockerfile-fetch`;
const OPTIMIZE_WEBHOOK = `${N8N_URL}/webhook/dockerfile-optimize`;
const APPLY_WEBHOOK = `${N8N_URL}/webhook/dockerfile-apply`;

// Chemins candidats pour le fichier de config Spring Boot (RC-2, port) —
// essayés dans l'ordre, le premier trouvé gagne. Aucun trouvé n'est pas une
// erreur : RC-2 s'abstient simplement (voir Runtime Coherence Checker).
const APP_CONFIG_CANDIDATES = [
  'src/main/resources/application.properties',
  'src/main/resources/application.yml',
  'src/main/resources/application.yaml',
];

type JobStatus = 'pending' | 'done' | 'error';
interface JobEntry {
  status: JobStatus;
  result?: any;
  reason?: string;
  detail?: string;
  createdAt: number;
  settledAt?: number;
}

const jobs = new Map<string, JobEntry>();
const JOB_RETENTION_MS = 30 * 60_000;

setInterval(() => {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (job.status === 'pending') continue; // jamais purgé, peu importe l'âge
    if (job.settledAt && now - job.settledAt > JOB_RETENTION_MS) jobs.delete(id);
  }
}, 5 * 60_000);

@Controller('dockerfile')
export class DockerfileOptimizerController {

  /** Initialise les dépendances et l’état de ce composant. */
  constructor(
    @InjectRepository(DockerfileAnalysis)
    private readonly analyses: Repository<DockerfileAnalysis>,
    @InjectRepository(Project)
    private readonly projects: Repository<Project>,
  ) {}

  /** Même logique que JenkinsOptimizerController.resolveDefaultBranch(). */
  private async resolveDefaultBranch(owner: string, repo: string, token?: string): Promise<string> {
    try {
      const headers: Record<string, string> = { 'User-Agent': 'DevSecOps-Platform' };
      if (token) headers['Authorization'] = `token ${token}`;
      const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
        headers,
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!data.default_branch) throw new Error('default_branch absent');
      return data.default_branch;
    } catch (e: any) {
      console.warn(`[dockerfile-optimizer] default_branch fetch failed for ${owner}/${repo} (${e?.message || e})`);
      return '';
    }
  }

  // Protégé JWT : contrairement à jenkins-optimizer/fetch (appelé nulle
  // part côté front pour l'instant), cette branche est destinée à être
  // appelée directement par le front dès son intégration.
  @UseGuards(JwtAuthGuard)
  /** Endpoint HTTP : récupère un Dockerfile depuis GitHub via la branche n8n dockerfile-fetch déjà prouvée. */
  @Post('fetch')
  async fetch(@Body() body: { owner: string; repo: string; filePath?: string; ref?: string }) {
    if (!body?.owner || !body?.repo) {
      throw new HttpException('owner et repo sont requis', HttpStatus.BAD_REQUEST);
    }
    const result = await this.callFetch(body.owner, body.repo, body.filePath || 'Dockerfile', body.ref);
    if (!result?.success) {
      throw new HttpException({ code: result?.code || 'DOCKERFILE_NOT_FOUND', message: result?.message || 'Dockerfile introuvable' }, result?.statusCode || HttpStatus.NOT_FOUND);
    }
    return result;
  }

  /** Remédiation (couche apply WF5). */
  @UseGuards(JwtAuthGuard)
  /**
   * Endpoint HTTP : remédiation Dockerfile MVP, volontairement SYNCHRONE (agent + gate + PR
   * GitHub dans un seul aller-retour n8n borné à 190s) — contrairement à jenkins-optimizer,
   * aucun polling/callback ici. Déduplique par requestId via une ligne-témoin DockerfileAnalysis.
   */
  @Post('apply')
  async apply(@Body() body: {
    requestId: string;
    projectId: string;
    dockerfile: string;
    findings: any[];
    context?: { pomXml?: string; appConfig?: string };
    owner: string;
    repo: string;
    baseBranch?: string;
    filePath?: string;
  }, @Req() req: any) {
    if (!['admin', 'developer'].includes(String(req.user?.role || '').toLowerCase())) {
      throw new HttpException('Utilisateur non autorisé à créer une correction', HttpStatus.FORBIDDEN);
    }
    if (!body?.requestId || !body?.projectId) {
      throw new HttpException('requestId et projectId sont requis', HttpStatus.BAD_REQUEST);
    }
    const ledgerId = `apply:${body.requestId}`;
    const existing = await this.analyses.findOneBy({ jobId: ledgerId });
    if (existing) {
      return { requestId: body.requestId, duplicate: true, status: existing.status, result: existing.result };
    }
    const projectById = await this.projects.findOneBy({ id: body.projectId });
    if (!projectById) throw new HttpException('Projet introuvable', HttpStatus.NOT_FOUND);
    if (!body?.dockerfile || !Array.isArray(body.findings) || body.findings.length === 0) {
      throw new HttpException('dockerfile et findings (au moins un) sont requis', HttpStatus.BAD_REQUEST);
    }
    if (!body?.owner || !body?.repo) {
      throw new HttpException('owner et repo sont requis', HttpStatus.BAD_REQUEST);
    }

    const configuredRepo = String(projectById.githubRepo || '').replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '');
    if (configuredRepo.toLowerCase() !== `${body.owner}/${body.repo}`.toLowerCase()) throw new HttpException('Repository/project mismatch', HttpStatus.CONFLICT);
    const baseBranch = body.baseBranch || await this.resolveDefaultBranch(body.owner, body.repo, projectById.githubToken);
    if (!baseBranch) throw new HttpException('Branche par défaut introuvable', HttpStatus.BAD_GATEWAY);
    await this.analyses.save(this.analyses.create({ projectId: body.projectId, jobId: ledgerId, sourceDockerfile: body.dockerfile,
      status: DockerfileAnalysisStatus.PENDING, result: { kind: 'APPLY', requestId: body.requestId } }));
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
      if (ledger) { ledger.status = DockerfileAnalysisStatus.DONE; ledger.result = { kind: 'APPLY', requestId: body.requestId, response: result }; ledger.settledAt = new Date(); await this.analyses.save(ledger); }
      return { requestId: body.requestId, duplicate: false, ...result };
    } catch (e: any) {
      const ledger = await this.analyses.findOneBy({ jobId: ledgerId });
      if (ledger) { ledger.status = DockerfileAnalysisStatus.ERROR; ledger.reason = 'Docker apply workflow failed'; ledger.detail = e.message; ledger.settledAt = new Date(); await this.analyses.save(ledger); }
      throw new HttpException(
        `Agent de remédiation Docker injoignable ou en échec : ${e.message}`,
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

  /** Essaie chaque chemin candidat jusqu'au premier succès — utilisé pour application.properties/.yml (RC-2) dont le chemin/format varie selon le projet. */
  private async fetchFirstAvailable(owner: string, repo: string, candidates: string[], ref?: string): Promise<string> {
    for (const filePath of candidates) {
      const res = await this.callFetch(owner, repo, filePath, ref);
      if (res?.success) return res.content;
    }
    return '';
  }

  /** Appelle la branche n8n dockerfile-fetch déjà prouvée. */
  private async callFetch(owner: string, repo: string, filePath: string, ref?: string): Promise<any> {
    return fetchDockerfile(FETCH_WEBHOOK, { owner, repo, filePath, ref });
  }

  /** Lance l'analyse en tâche de fond et renvoie un id immédiatement. */
  // JWT humain ou secret interne (routage automatique d'un échec de build, cf. webhooks.service).
  @UseGuards(JwtOrInternalSecretGuard)
  /**
   * Endpoint HTTP : récupère Dockerfile (obligatoire) + pom.xml + config applicative Spring Boot
   * (les deux derniers optionnels, absence jamais une erreur) depuis GitHub via la branche fetch,
   * puis lance l'analyse en tâche de fond (fire-and-forget) — le résultat arrive uniquement via
   * /optimize/:id/callback.
   */
  @Post('optimize')
  async optimize(@Body() body: {
    owner: string;
    repo: string;
    projectId: string;
    projectName?: string;
    dockerfilePath?: string;
    pomPath?: string;
    appConfigPath?: string;
    ref?: string;
    notes?: string;
    buildError?: string;
  }) {
    if (!body?.owner || !body?.repo || !body?.projectId) {
      throw new HttpException('owner, repo et projectId sont requis', HttpStatus.BAD_REQUEST);
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
      throw new HttpException({ code: dockerfileRes?.code || 'DOCKERFILE_NOT_FOUND', message: dockerfileRes?.message || 'Dockerfile introuvable' }, dockerfileRes?.statusCode || HttpStatus.NOT_FOUND);
    }

    // pom.xml optionnel — absent (projet non-Java, ou chemin différent) ne
    // lève JAMAIS d'erreur ici : RC-1/RC-3 s'abstiennent simplement si vide
    // (voir "Prepare - Optimizer Body" côté n8n).
    let pomXml = '';
    const pomRes = await this.callFetch(body.owner, body.repo, body.pomPath || 'pom.xml', ref);
    if (pomRes?.success) pomXml = pomRes.content;

    // application.properties/.yml optionnel (RC-2, port) — même logique :
    // absent n'est jamais une erreur, RC-2 s'abstient. appConfigPath permet
    // de forcer un chemin précis (tests, projets non standards) ; sinon on
    // essaie les emplacements Spring Boot usuels dans l'ordre.
    const appConfig = body.appConfigPath
      ? (await this.callFetch(body.owner, body.repo, body.appConfigPath, ref))?.content || ''
      : await this.fetchFirstAvailable(body.owner, body.repo, APP_CONFIG_CANDIDATES, ref);

    const id = randomUUID();
    jobs.set(id, { status: 'pending', createdAt: Date.now() });

    await this.analyses.save(
      this.analyses.create({
        jobId: id,
        projectId: body.projectId,
        status: DockerfileAnalysisStatus.PENDING,
        sourceDockerfile: dockerfileRes.content,
        sourcePomXml: pomXml || null,
        sourceAppConfig: appConfig || null,
      }),
    );

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
    }).catch((e: any) => {
      const job = jobs.get(id);
      if (!job || job.status !== 'pending') return;

      const NETWORK_REFUSAL_CODES = new Set([
        'ECONNREFUSED', 'ENOTFOUND', 'EHOSTUNREACH', 'ECONNRESET', 'ENETUNREACH',
      ]);
      const isVerifiedNetworkRefusal = NETWORK_REFUSAL_CODES.has(e?.cause?.code);

      if (isVerifiedNetworkRefusal) {
        job.status = 'error';
        job.reason = 'Workflow n8n injoignable';
        job.detail = e?.cause?.message || e?.message || String(e);
        job.settledAt = Date.now();
      } else {
        console.warn(
          `[dockerfile-optimizer] fetch de déclenchement non confirmé pour ${id} ` +
          `(${e?.name || '?'}: ${e?.message || e}) — job laissé 'pending', en attente du callback n8n`,
        );
      }
    });

    return { id, pomFound: !!pomXml, appConfigFound: !!appConfig };
  }

  /** Recharge la dernière analyse du projet, hors demandes d’application. */
  @Get('analyses')
  @UseGuards(JwtAuthGuard)
  async listAnalyses(@Query('projectId') projectId?: string) {
    if (!projectId?.trim()) throw new HttpException('projectId requis', HttpStatus.BAD_REQUEST);
    const rows = await this.analyses.find({
      where: { projectId: projectId.trim(), jobId: Not(Like('apply:%')) },
      order: { createdAt: 'DESC' },
      take: 1,
    });
    const project = await this.projects.findOneBy({ id: projectId.trim() });
    return Promise.all(rows.map(row => currentOptimizerVerdict(row, project, 'Dockerfile')));
  }

  /** Renvoie Optimize statut. */
  @UseGuards(JwtAuthGuard)
  @Get('optimize/:id/status')
  async getOptimizeStatus(@Param('id') id: string) {
    const row = await this.analyses.findOneBy({ jobId: id });
    if (!row) {
      throw new HttpException('Analyse introuvable ou expirée', HttpStatus.NOT_FOUND);
    }
    const view = await currentOptimizerVerdict(row, await this.projects.findOneBy({ id: row.projectId }), 'Dockerfile');
    return { status: view.status, result: view.result, reason: view.reason, detail: view.detail };
  }

  /** Appelé PAR n8n (WF5) à la fin du workflow — succès ou échec explicite. */
  @Post('optimize/:id/callback')
  async receiveOptimizeCallback(
    @Param('id') id: string,
    @Body() body: { status: 'done' | 'error'; result?: any; reason?: string; detail?: string },
    @Headers('x-callback-secret') secret?: string,
  ) {
    if (!N8N_CALLBACK_SECRET || secret !== N8N_CALLBACK_SECRET) {
      throw new HttpException('Callback non autorisé', HttpStatus.FORBIDDEN);
    }

    const settledAt = Date.now();
    const job = jobs.get(id);
    if (job) {
      job.settledAt = settledAt;
      if (body.status === 'done') {
        job.status = 'done';
        job.result = body.result;
      } else {
        job.status = 'error';
        job.reason = body.reason || 'Erreur inconnue';
        job.detail = body.detail;
      }
    } else {
      console.warn(`[dockerfile-optimizer] callback reçu pour un job absent du Map (probable redémarrage) : ${id} — fallback DB`);
    }

    const row = await this.analyses.findOneBy({ jobId: id });
    if (!row) {
      console.warn(`[dockerfile-optimizer] callback reçu pour un jobId totalement inconnu (ni Map ni DB) : ${id}`);
      return { received: false };
    }
    row.status = body.status === 'done' ? DockerfileAnalysisStatus.DONE : DockerfileAnalysisStatus.ERROR;
    row.result = body.result ?? null;
    row.reason = body.status === 'error' ? (body.reason || 'Erreur inconnue') : null;
    row.detail = body.detail ?? null;
    row.settledAt = new Date(settledAt);
    await this.analyses.save(row);

    return { received: true };
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([DockerfileAnalysis, Project])],
  controllers: [DockerfileOptimizerController],
})
export class DockerfileOptimizerModule {}
