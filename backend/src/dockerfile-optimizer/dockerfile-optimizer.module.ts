// ─────────────────────────────────────────────────────────────
//  Dockerfile Optimizer — proxy vers le workflow n8n WF5
//  Fichier : src/dockerfile-optimizer/dockerfile-optimizer.module.ts
//  Enregistrement : ajouter DockerfileOptimizerModule aux imports de AppModule
//
//  Jumeau architectural de jenkins-optimizer/jenkins-optimizer.module.ts —
//  même mode async (fire-and-forget + polling + callback).
//
//  Couche 2 (branche analyse) : la branche n8n "dockerfile-optimize" ne
//  fetch RIEN elle-même — elle reçoit dockerfile + pomXml + appConfig déjà
//  en texte. C'est CE module qui appelle jusqu'à 3 fois la branche fetch
//  existante (dockerfile-fetch) avant de déclencher l'analyse : Dockerfile
//  (obligatoire), pom.xml (optionnel, RC-1/RC-3), application.properties/.yml
//  (optionnel, RC-2) — un échec sur ces deux derniers n'est JAMAIS une
//  erreur, les checks concernés s'abstiennent simplement (voir Runtime
//  Coherence Checker côté n8n). Choix (a) plutôt que (b) : réutilise 100% de
//  la branche fetch déjà prouvée, la branche optimize reste pure (texte in,
//  findings out), symétrique à jenkinsfile-optimize côté WF4.
// ─────────────────────────────────────────────────────────────
import { Module, Controller, Post, Get, Param, Body, Headers, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { TypeOrmModule, InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { DockerfileAnalysis, DockerfileAnalysisStatus } from './dockerfile-analysis.entity';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

const N8N_URL = process.env.N8N_URL || 'http://172.31.172.61:5678';
const N8N_CALLBACK_SECRET = process.env.N8N_CALLBACK_SECRET;
const FETCH_WEBHOOK = `${N8N_URL}/webhook/dockerfile-fetch`;
const OPTIMIZE_WEBHOOK = `${N8N_URL}/webhook/dockerfile-optimize`;

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

  constructor(
    @InjectRepository(DockerfileAnalysis)
    private readonly analyses: Repository<DockerfileAnalysis>,
  ) {}

  // Protégé JWT : contrairement à jenkins-optimizer/fetch (appelé nulle
  // part côté front pour l'instant), cette branche est destinée à être
  // appelée directement par le front dès son intégration.
  @UseGuards(JwtAuthGuard)
  @Post('fetch')
  async fetch(@Body() body: { owner: string; repo: string; filePath?: string; ref?: string }) {
    if (!body?.owner || !body?.repo) {
      throw new HttpException('owner et repo sont requis', HttpStatus.BAD_REQUEST);
    }
    const result = await this.callFetch(body.owner, body.repo, body.filePath || 'Dockerfile', body.ref);
    if (!result?.success) {
      throw new HttpException(result?.message || 'Dockerfile introuvable', HttpStatus.NOT_FOUND);
    }
    return result;
  }

  // Essaie chaque chemin candidat jusqu'au premier succès — utilisé pour
  // application.properties/.yml (RC-2) dont le chemin/format varie selon le
  // projet. Aucun trouvé → chaîne vide, jamais une erreur (voir optimize()).
  private async fetchFirstAvailable(owner: string, repo: string, candidates: string[], ref?: string): Promise<string> {
    for (const filePath of candidates) {
      const res = await this.callFetch(owner, repo, filePath, ref);
      if (res?.success) return res.content;
    }
    return '';
  }

  // Appelle la branche n8n dockerfile-fetch déjà prouvée — jamais throw :
  // un échec (fichier absent) est un résultat normal ({success:false,...}),
  // c'est à l'appelant de décider si c'est bloquant (Dockerfile) ou pas
  // (pom.xml, application config, voir optimize()).
  private async callFetch(owner: string, repo: string, filePath: string, ref?: string): Promise<any> {
    try {
      const res = await fetch(FETCH_WEBHOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ owner, repo, filePath, ref: ref || 'main' }),
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) return { success: false, message: `Workflow n8n indisponible (${res.status})` };
      const data = await res.json();
      return Array.isArray(data) ? data[0] : data;
    } catch (e: any) {
      return { success: false, message: e.message };
    }
  }

  // Lance l'analyse en tâche de fond et renvoie un id immédiatement — même
  // principe que jenkins-optimizer/optimize() (voir ses commentaires pour
  // le détail du traitement des erreurs réseau vs timeout ambigu).
  // Nommée optimize() (pas analyze()) pour matcher le webhook n8n
  // "dockerfile-optimize" et la convention du jumeau jenkins-optimizer
  // (/jenkins/optimize ↔ jenkinsfile-optimize) — voir commit de réalignement.
  @UseGuards(JwtAuthGuard)
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
  }) {
    if (!body?.owner || !body?.repo || !body?.projectId) {
      throw new HttpException('owner, repo et projectId sont requis', HttpStatus.BAD_REQUEST);
    }

    const dockerfileRes = await this.callFetch(body.owner, body.repo, body.dockerfilePath || 'Dockerfile', body.ref);
    if (!dockerfileRes?.success) {
      throw new HttpException(dockerfileRes?.message || 'Dockerfile introuvable', HttpStatus.NOT_FOUND);
    }

    // pom.xml optionnel — absent (projet non-Java, ou chemin différent) ne
    // lève JAMAIS d'erreur ici : RC-1/RC-3 s'abstiennent simplement si vide
    // (voir "Prepare - Optimizer Body" côté n8n).
    let pomXml = '';
    const pomRes = await this.callFetch(body.owner, body.repo, body.pomPath || 'pom.xml', body.ref);
    if (pomRes?.success) pomXml = pomRes.content;

    // application.properties/.yml optionnel (RC-2, port) — même logique :
    // absent n'est jamais une erreur, RC-2 s'abstient. appConfigPath permet
    // de forcer un chemin précis (tests, projets non standards) ; sinon on
    // essaie les emplacements Spring Boot usuels dans l'ordre.
    const appConfig = body.appConfigPath
      ? (await this.callFetch(body.owner, body.repo, body.appConfigPath, body.ref))?.content || ''
      : await this.fetchFirstAvailable(body.owner, body.repo, APP_CONFIG_CANDIDATES, body.ref);

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

  @UseGuards(JwtAuthGuard)
  @Get('optimize/:id/status')
  async getOptimizeStatus(@Param('id') id: string) {
    const job = jobs.get(id);
    if (job) {
      return { status: job.status, result: job.result, reason: job.reason, detail: job.detail };
    }
    const row = await this.analyses.findOneBy({ jobId: id });
    if (!row) {
      throw new HttpException('Analyse introuvable ou expirée', HttpStatus.NOT_FOUND);
    }
    return { status: row.status, result: row.result, reason: row.reason, detail: row.detail };
  }

  // Appelé PAR n8n (WF5) à la fin du workflow — succès ou échec explicite.
  // Pas de JwtAuthGuard (appelé depuis n8n, pas depuis le navigateur), mais
  // protégé par le même secret partagé que les callbacks jenkins-optimizer.
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
  imports: [TypeOrmModule.forFeature([DockerfileAnalysis])],
  controllers: [DockerfileOptimizerController],
})
export class DockerfileOptimizerModule {}
