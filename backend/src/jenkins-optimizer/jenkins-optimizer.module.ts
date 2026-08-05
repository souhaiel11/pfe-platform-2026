// ─────────────────────────────────────────────────────────────
//  Jenkins Optimizer — proxy vers le workflow n8n WF4
//  Fichier : src/jenkins-optimizer/jenkins-optimizer.module.ts
//  Enregistrement : ajouter JenkinsOptimizerModule aux imports de AppModule
// ─────────────────────────────────────────────────────────────
import { Module, Controller, Post, Get, Param, Body, Query, Headers, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { TypeOrmModule, InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { JenkinsAnalysis, JenkinsAnalysisStatus } from './jenkins-analysis.entity';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

const N8N_URL = process.env.N8N_URL || 'http://172.31.172.61:5678';
// Secret partagé pour /optimize/:id/callback — appelé par n8n (WF4), pas
// par le navigateur. Volontairement pas de valeur par défaut : sans cette
// variable d'env définie, le callback rejette TOUJOURS (fail-closed).
const N8N_CALLBACK_SECRET = process.env.N8N_CALLBACK_SECRET;
const WEBHOOK = `${N8N_URL}/webhook/jenkinsfile-optimize`;
const APPLY_WEBHOOK = `${N8N_URL}/webhook/jenkinsfile-apply`;
const FETCH_WEBHOOK = `${N8N_URL}/webhook/jenkinsfile-fetch`;

// ─────────────────────────────────────────────────────────────
//  État des analyses en cours — Map en mémoire = cache rapide pour
//  le polling actif, PAS la source de vérité. La source de vérité
//  est JenkinsAnalysis en base (voir jenkins-analysis.entity.ts) :
//  une ligne 'pending' y est écrite dès la création du job, avant
//  même d'appeler n8n, pour que le callback et le polling puissent
//  toujours retrouver le job même si ce Map a été vidé par un
//  redémarrage backend. "pending" n'est JAMAIS purgé du Map, quel
//  que soit son âge (une analyse peut légitimement durer 10+ min —
//  donnée mesurée : voir diagnostic WF4). Seuls done/error anciens
//  sont purgés du Map (la ligne DB, elle, reste pour l'historique).
// ─────────────────────────────────────────────────────────────
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

@Controller('jenkins')
export class JenkinsOptimizerController {

  constructor(
    @InjectRepository(JenkinsAnalysis)
    private readonly analyses: Repository<JenkinsAnalysis>,
  ) {}

  // Lance l'analyse en tâche de fond et renvoie un id immédiatement —
  // aucune requête HTTP ne reste jamais ouverte plus de quelques ms,
  // donc aucun timeout de proxy (nginx, tunnel de soutenance, etc.)
  // ne peut plus jamais couper cet appel.
  @Post('optimize')
  async optimize(@Body() body: { jenkinsfile: string; projectId: string; projectName?: string; notes?: string }) {
    if (!body?.jenkinsfile || body.jenkinsfile.trim().length < 30) {
      throw new HttpException('Jenkinsfile vide ou trop court', HttpStatus.BAD_REQUEST);
    }
    if (!body?.projectId) {
      throw new HttpException('projectId requis', HttpStatus.BAD_REQUEST);
    }

    const id = randomUUID();
    jobs.set(id, { status: 'pending', createdAt: Date.now() });

    // Écrite AVANT l'appel n8n ci-dessous, jamais après : c'est ce qui
    // permet au callback (et au polling) de retrouver ce job même si le
    // backend redémarre entre cette ligne et la réception du callback.
    await this.analyses.save(
      this.analyses.create({
        jobId: id,
        projectId: body.projectId,
        status: JenkinsAnalysisStatus.PENDING,
      }),
    );

    // Fire-and-forget : on n'attend jamais cette promesse pour répondre
    // au frontend. Le résultat final arrive via /optimize/:id/callback,
    // appelé par n8n lui-même à la fin du workflow (succès ou erreur).
    //
    // Ce fetch ne sert QU'À déclencher le workflow n8n — sa réponse HTTP
    // (ou son échec) n'est JAMAIS la donnée réelle, seul le callback fait
    // foi. Sans `signal`, undici applique un timeout implicite de ~300s
    // (mesuré empiriquement : HeadersTimeoutError à 301s) sur cette
    // connexion tenue ouverte par le webhook n8n en responseMode
    // "responseNode" — ce qui faisait passer le job en 'error' à tort
    // après 5 min alors que l'analyse continuait légitimement. Un signal
    // explicite de 30s borne la socket sans en faire une preuve d'échec :
    // seul un refus réseau IMMÉDIAT et vérifié (ECONNREFUSED/ENOTFOUND/...)
    // constitue un vrai signal d'erreur ; un abandon par timeout ne dit
    // rien sur l'analyse et est ignoré (le job reste 'pending', le
    // callback n8n tranchera plus tard).
    fetch(WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jobId: id,
        jenkinsfile: body.jenkinsfile,
        projectName: body.projectName || 'projet',
        context: { notes: body.notes || '' },
      }),
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
        // Timeout du signal (TimeoutError/AbortError) ou toute autre
        // erreur ambiguë : on ne sait rien de l'état réel de l'analyse
        // côté n8n. On n'invente pas un échec — on logge et on laisse
        // 'pending', le callback (succès ou erreur explicite) tranchera.
        console.warn(
          `[jenkins-optimizer] fetch de déclenchement non confirmé pour ${id} ` +
          `(${e?.name || '?'}: ${e?.message || e}) — job laissé 'pending', en attente du callback n8n`,
        );
      }
    });

    return { id };
  }

  @Get('optimize/:id/status')
  async getOptimizeStatus(@Param('id') id: string) {
    const job = jobs.get(id);
    if (job) {
      return { status: job.status, result: job.result, reason: job.reason, detail: job.detail };
    }
    // Absent du Map (typiquement : backend redémarré depuis la création du
    // job) — fallback sur la ligne DB, source de vérité durable.
    const row = await this.analyses.findOneBy({ jobId: id });
    if (!row) {
      throw new HttpException('Analyse introuvable ou expirée', HttpStatus.NOT_FOUND);
    }
    return { status: row.status, result: row.result, reason: row.reason, detail: row.detail };
  }

  // Appelé PAR n8n (WF4) à la fin du workflow — succès ou échec explicite.
  // Pas de JwtAuthGuard (appelé depuis n8n, pas depuis le navigateur), mais
  // protégé par le même secret partagé que /apply/:applyId/callback : sans
  // ça, n'importe qui pouvait injecter un faux résultat d'optimisation
  // affiché ensuite tel quel au développeur.
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
      console.warn(`[jenkins-optimizer] callback reçu pour un job absent du Map (probable redémarrage) : ${id} — fallback DB`);
    }

    // Toujours écrire en DB, Map connu ou pas — c'est la ligne pending
    // créée par optimize() qui reçoit la mise à jour ici.
    const row = await this.analyses.findOneBy({ jobId: id });
    if (!row) {
      // Ligne jamais créée (callback rejoué, id invalide, etc.) — cas
      // résiduel distinct du redémarrage, qui lui est couvert ci-dessus.
      console.warn(`[jenkins-optimizer] callback reçu pour un jobId totalement inconnu (ni Map ni DB) : ${id}`);
      return { received: false };
    }
    row.status = body.status === 'done' ? JenkinsAnalysisStatus.DONE : JenkinsAnalysisStatus.ERROR;
    row.result = body.result ?? null;
    row.reason = body.status === 'error' ? (body.reason || 'Erreur inconnue') : null;
    row.detail = body.detail ?? null;
    row.settledAt = new Date(settledAt);
    await this.analyses.save(row);

    return { received: true };
  }

  // Historique complet des analyses d'un projet, plus récent d'abord —
  // le front prend [0] pour "la dernière analyse".
  @Get('analyses')
  @UseGuards(JwtAuthGuard)
  async listAnalyses(@Query('projectId') projectId?: string) {
    if (!projectId) {
      throw new HttpException('projectId requis', HttpStatus.BAD_REQUEST);
    }
    return this.analyses.find({ where: { projectId }, order: { createdAt: 'DESC' } });
  }

  @Post('fetch')
  async fetch(@Body() body: { owner: string; repo: string; filePath?: string; ref?: string }) {
    if (!body?.owner || !body?.repo) {
      throw new HttpException('owner et repo sont requis', HttpStatus.BAD_REQUEST);
    }
    try {
      const res = await fetch(FETCH_WEBHOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          owner: body.owner,
          repo: body.repo,
          filePath: body.filePath || 'Jenkinsfile',
          ref: body.ref || 'main',
        }),
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) {
        throw new HttpException(`Workflow n8n indisponible (${res.status})`, HttpStatus.BAD_GATEWAY);
      }
      const data = await res.json();
      const result = Array.isArray(data) ? data[0] : data;
      if (!result?.success) {
        throw new HttpException(result?.message || 'Jenkinsfile introuvable', HttpStatus.NOT_FOUND);
      }
      return result;
    } catch (e: any) {
      if (e instanceof HttpException) throw e;
      throw new HttpException(`Erreur d'appel au workflow : ${e.message}`, HttpStatus.BAD_GATEWAY);
    }
  }

  @UseGuards(JwtAuthGuard)
  @Post('apply')
  async apply(@Body() body: {
    owner: string; repo: string; optimizedJenkinsfile: string;
    baseBranch?: string; filePath?: string;
  }) {
    if (!body?.owner || !body?.repo || !body?.optimizedJenkinsfile) {
      throw new HttpException('owner, repo et optimizedJenkinsfile sont requis', HttpStatus.BAD_REQUEST);
    }
    try {
      const res = await fetch(APPLY_WEBHOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          owner: body.owner,
          repo: body.repo,
          optimizedJenkinsfile: body.optimizedJenkinsfile,
          baseBranch: body.baseBranch || 'main',
          filePath: body.filePath || 'Jenkinsfile',
        }),
        signal: AbortSignal.timeout(60000),
      });
      if (!res.ok) {
        throw new HttpException(`Workflow n8n indisponible (${res.status})`, HttpStatus.BAD_GATEWAY);
      }
      const data = await res.json();
      const result = Array.isArray(data) ? data[0] : data;
      if (!result?.success) {
        throw new HttpException(result?.message || 'Échec de création de la PR', HttpStatus.UNPROCESSABLE_ENTITY);
      }
      return result;
    } catch (e: any) {
      if (e instanceof HttpException) throw e;
      throw new HttpException(`Erreur d'appel au workflow : ${e.message}`, HttpStatus.BAD_GATEWAY);
    }
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([JenkinsAnalysis])],
  controllers: [JenkinsOptimizerController],
})
export class JenkinsOptimizerModule {}
