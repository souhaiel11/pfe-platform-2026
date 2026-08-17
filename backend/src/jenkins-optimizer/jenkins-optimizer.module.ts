// ─────────────────────────────────────────────────────────────
//  Jenkins Optimizer — proxy vers le workflow n8n WF4
//  Fichier : src/jenkins-optimizer/jenkins-optimizer.module.ts
//  Enregistrement : ajouter JenkinsOptimizerModule aux imports de AppModule
// ─────────────────────────────────────────────────────────────
import { Module, Controller, Post, Get, Param, Body, Query, Headers, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { TypeOrmModule, InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { randomUUID } from 'crypto';
import { JenkinsAnalysis, JenkinsAnalysisStatus } from './jenkins-analysis.entity';
import { JenkinsApply, JenkinsApplyStatus } from './jenkins-apply.entity';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Project } from '../projects/project.entity';

const N8N_URL = process.env.N8N_URL || 'http://172.31.172.61:5678';
// Secret partagé pour /optimize/:id/callback ET /apply/:applyId/callback —
// tous deux appelés par n8n (WF4), pas par le navigateur. Volontairement
// pas de valeur par défaut : sans cette variable d'env définie, les deux
// callbacks rejettent TOUJOURS (fail-closed), plutôt que de laisser croire
// que c'est protégé alors que ça ne l'est pas.
const N8N_CALLBACK_SECRET = process.env.N8N_CALLBACK_SECRET;
const WEBHOOK = `${N8N_URL}/webhook/jenkinsfile-optimize`;
const APPLY_WEBHOOK = `${N8N_URL}/webhook/jenkinsfile-apply`;
const FETCH_WEBHOOK = `${N8N_URL}/webhook/jenkinsfile-fetch`;

// Régénération sélective (option B) : le développeur a coché un sous-
// ensemble des issues d'une analyse précédente. On ne demande PAS à l'agent
// de "retirer" les issues décochées d'un fichier déjà fusionné (impossible
// proprement, voir diagnostic — les issues se chevauchent structurellement),
// on repart du Jenkinsfile ORIGINAL avec une sélection structurée.
//
// Le texte d'instruction en langage naturel (auparavant construit ici et
// collé dans context.notes) est maintenant la responsabilité du node
// "Prepare - Optimizer Body" côté n8n — on ne lui envoie plus qu'une donnée
// structurée {kept, excluded}, ref = l'id d'issue (JF-x), pas de prose.
function buildSelection(
  retained: { id: string; title: string }[],
  discarded: { id: string; title: string }[],
) {
  return {
    kept: retained.map((i) => ({ ref: i.id, title: i.title })),
    excluded: discarded.map((i) => ({ ref: i.id, title: i.title })),
  };
}

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

// Un apply 'pending' au-delà de ce délai est considéré perdu (Apply Agent
// resté pendant côté n8n sans jamais atteindre un nœud terminal, donc sans
// jamais callback) — filet de sécurité backend, voir getApplyStatus().
const APPLY_STALE_MS = 12 * 60_000;

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
    @InjectRepository(JenkinsApply)
    private readonly applies: Repository<JenkinsApply>,
    @InjectRepository(Project)
    private readonly projects: Repository<Project>,
  ) {
    // Balayage en arrière-plan — le filet de péremption (APPLY_STALE_MS) ne
    // doit PAS dépendre qu'un client rappelle GET .../status après le délai :
    // sans ça, une ligne 'pending' orpheline (frontend qui a arrêté de
    // poller, onglet fermé) reste bloquée indéfiniment même si n8n ne
    // répondra plus jamais. Ce balayage marche même si n8n est totalement
    // mort et qu'aucun client n'interroge plus jamais l'API. Le check
    // paresseux dans getApplyStatus() reste en place à côté : il donne une
    // réponse immédiate à un poller actif sans attendre le prochain passage
    // du balayage (jusqu'à 2 min).
    setInterval(() => this.sweepStaleApplies(), 2 * 60_000);
  }

  private async sweepStaleApplies() {
    const staleBefore = new Date(Date.now() - APPLY_STALE_MS);
    const stale = await this.applies.find({
      where: { status: JenkinsApplyStatus.PENDING, createdAt: LessThan(staleBefore) },
    });
    for (const row of stale) {
      row.status = JenkinsApplyStatus.FAILED;
      row.result = { message: 'Délai dépassé, réessayez.' };
      row.settledAt = new Date();
      await this.applies.save(row);
      console.warn(`[jenkins-optimizer] apply ${row.applyId} péremption forcée par le balayage en arrière-plan (aucun callback n8n reçu après ${APPLY_STALE_MS / 60000} min)`);
    }
  }

  // Résout la branche par défaut du repo GitHub — Project ne stocke aucune
  // colonne "branche" (voir diagnostic), donc GitHub lui-même fait foi.
  // Fail-safe, jamais fail-loud : un échec (réseau, 404, repo privé sans
  // token, rate limit, timeout) ne doit JAMAIS bloquer l'analyse — seule
  // conséquence d'un échec ici, retomber sur 'main'. Même mécanisme d'auth
  // que ProjectsService.getGithubStats() (token par-projet, optionnel).
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
      return data.default_branch || 'main';
    } catch (e: any) {
      console.warn(`[jenkins-optimizer] default_branch fetch failed for ${owner}/${repo}, falling back to 'main' (${e?.message || e})`);
      return 'main';
    }
  }

  // Lance l'analyse en tâche de fond et renvoie un id immédiatement —
  // aucune requête HTTP ne reste jamais ouverte plus de quelques ms,
  // donc aucun timeout de proxy (nginx, tunnel de soutenance, etc.)
  // ne peut plus jamais couper cet appel.
  @Post('optimize')
  async optimize(@Body() body: {
    jenkinsfile?: string;
    projectId: string;
    projectName?: string;
    notes?: string;
    // Erreur réelle extraite du log console d'un build FAILURE (voir
    // webhooks.service.ts + console-log-errors.ts) — optionnel, absent pour
    // une analyse statique classique. Quand présent, WF4 priorise sa
    // correction plutôt que d'inventer ses propres constats.
    buildError?: string;
    // Régénération sélective : référence l'analyse dont on reprend le
    // Jenkinsfile ORIGINAL (jamais l'optimizedJenkinsfile déjà fusionné).
    priorJobId?: string;
    retainedIssues?: { id: string; title: string }[];
    discardedIssues?: { id: string; title: string }[];
  }) {
    if (!body?.projectId) {
      throw new HttpException('projectId requis', HttpStatus.BAD_REQUEST);
    }

    let jenkinsfile = body.jenkinsfile;
    let selection: ReturnType<typeof buildSelection> | undefined;

    if (body.priorJobId) {
      const prior = await this.analyses.findOneBy({ jobId: body.priorJobId });
      if (!prior) {
        throw new HttpException('Analyse de référence introuvable pour la régénération', HttpStatus.NOT_FOUND);
      }
      if (!prior.sourceJenkinsfile) {
        // Ligne antérieure à l'ajout de sourceJenkinsfile (colonne nullable) —
        // pas de fichier original à reprendre, pas de fallback silencieux.
        throw new HttpException(
          'Régénération impossible : Jenkinsfile source non disponible pour cette analyse, relancez une analyse complète.',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      jenkinsfile = prior.sourceJenkinsfile;
      if (Array.isArray(body.retainedIssues) && Array.isArray(body.discardedIssues)) {
        selection = buildSelection(body.retainedIssues, body.discardedIssues);
      }
    }

    if (!jenkinsfile || jenkinsfile.trim().length < 30) {
      throw new HttpException('Jenkinsfile vide ou trop court', HttpStatus.BAD_REQUEST);
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
        sourceJenkinsfile: jenkinsfile,
      }),
    );

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
    console.log(`[jenkins-optimizer] payload envoyé à n8n pour ${id} :`, JSON.stringify(n8nPayload));

    fetch(WEBHOOK, {
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

  // WF4 v4 : la branche APPLY régénère elle-même le fichier via un 2e agent
  // (Apply Agent) à partir du Jenkinsfile ORIGINAL + la sélection retenue/
  // écartée — on ne POSTe plus jamais un optimizedJenkinsfile pré-calculé.
  // On ne fait plus confiance au title/recommendation que le front pourrait
  // renvoyer : on recharge l'analyse par jobId et on reconstruit retained/
  // excluded depuis les issues RÉELLEMENT stockées (result.issues[]), le
  // front ne fournit que les refs (id) pour dire ce qui est coché.
  // Asynchrone, symétrique à optimize() — WF4 v4 a ajouté un vrai appel LLM
  // (Apply Agent) dans la branche APPLY, un aller-retour HTTP synchrone
  // n'est plus tenable (60s, puis 200s côté Nginx, tous les deux trop courts).
  @UseGuards(JwtAuthGuard)
  @Post('apply')
  async apply(@Body() body: {
    jobId: string;
    owner: string;
    repo: string;
    baseBranch?: string;
    filePath?: string;
    retainedIssues?: { id: string; title: string }[];
    discardedIssues?: { id: string; title: string }[];
  }) {
    if (!body?.jobId || !body?.owner || !body?.repo) {
      throw new HttpException('jobId, owner et repo sont requis', HttpStatus.BAD_REQUEST);
    }

    const analysis = await this.analyses.findOneBy({ jobId: body.jobId });
    if (!analysis) {
      throw new HttpException('Analyse introuvable pour cette PR', HttpStatus.NOT_FOUND);
    }
    if (!analysis.sourceJenkinsfile) {
      throw new HttpException('Analyse sans Jenkinsfile source, relancez l\'analyse', HttpStatus.BAD_REQUEST);
    }

    const storedIssues: any[] = analysis.result?.issues || [];
    const toFullIssue = (ref: string) => {
      const issue = storedIssues.find((i) => i.id === ref);
      // Repli défensif si une ref envoyée par le front ne correspond à
      // aucune issue stockée (ne devrait pas arriver) — jamais un crash.
      return issue
        ? { ref: issue.id, title: issue.title, recommendation: issue.recommendation }
        : { ref, title: ref, recommendation: '' };
    };
    const retained = (body.retainedIssues || []).map((i) => toFullIssue(i.id));
    const excluded = (body.discardedIssues || []).map((i) => toFullIssue(i.id));

    const applyId = randomUUID();

    // Écrite AVANT l'appel n8n, jamais après — même principe que optimize() :
    // le callback (ou le garde-fou de péremption, voir getApplyStatus())
    // doit toujours retrouver cette ligne, même si le backend redémarre
    // entre cette écriture et la réponse de n8n.
    await this.applies.save(
      this.applies.create({
        applyId,
        analysisJobId: body.jobId,
        status: JenkinsApplyStatus.PENDING,
      }),
    );

    const applyPayload = {
      // Requis par le nœud n8n "Send Apply Callback", qui lit
      // $('Webhook - Apply').first().json.body.applyId pour construire
      // l'URL du callback — sans ce champ, l'URL devient .../apply//callback
      // (404 systématique) et le callback n'arrive jamais, quel que soit
      // le sort de l'Apply Agent (bug constaté en E2E le 2026-08-04).
      applyId,
      owner: body.owner,
      repo: body.repo,
      baseBranch: body.baseBranch || 'main',
      filePath: body.filePath || 'Jenkinsfile',
      originalJenkinsfile: analysis.sourceJenkinsfile,
      retained,
      excluded,
    };
    // Preuve directe du contrat réellement envoyé — vérification WF4 v4.
    console.log(`[jenkins-optimizer] payload APPLY envoyé à n8n pour applyId=${applyId} :`, JSON.stringify(applyPayload));

    // Fire-and-forget — ce fetch ne sert QU'À déclencher le workflow, sa
    // réponse HTTP n'est JAMAIS la donnée réelle, seul le callback fait foi.
    // Signal court : ne détecte qu'un refus réseau IMMÉDIAT et vérifié, pas
    // un jugement sur la durée réelle de l'Apply Agent (même logique que
    // optimize(), voir son commentaire détaillé plus haut).
    fetch(APPLY_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(applyPayload),
      signal: AbortSignal.timeout(30000),
    }).catch(async (e: any) => {
      const NETWORK_REFUSAL_CODES = new Set([
        'ECONNREFUSED', 'ENOTFOUND', 'EHOSTUNREACH', 'ECONNRESET', 'ENETUNREACH',
      ]);
      const isVerifiedNetworkRefusal = NETWORK_REFUSAL_CODES.has(e?.cause?.code);
      if (!isVerifiedNetworkRefusal) {
        console.warn(
          `[jenkins-optimizer] fetch APPLY de déclenchement non confirmé pour ${applyId} ` +
          `(${e?.name || '?'}: ${e?.message || e}) — laissé 'pending', en attente du callback n8n`,
        );
        return;
      }
      const row = await this.applies.findOneBy({ applyId });
      if (!row || row.status !== JenkinsApplyStatus.PENDING) return;
      row.status = JenkinsApplyStatus.FAILED;
      row.result = { message: 'Workflow n8n injoignable' };
      row.settledAt = new Date();
      await this.applies.save(row);
    });

    return { applyId };
  }

  @Get('apply/:applyId/status')
  async getApplyStatus(@Param('applyId') applyId: string) {
    const row = await this.applies.findOneBy({ applyId });
    if (!row) {
      throw new HttpException('Apply introuvable ou expiré', HttpStatus.NOT_FOUND);
    }
    // Garde-fou : si n8n n'a jamais rappelé (Apply Agent resté pendant sans
    // jamais atteindre un nœud terminal), 'pending' ne dure pas pour
    // toujours. Calculé à la lecture — auto-guérissant dès le premier
    // polling après péremption, pas besoin d'une tâche de fond séparée.
    if (row.status === JenkinsApplyStatus.PENDING && Date.now() - row.createdAt.getTime() > APPLY_STALE_MS) {
      row.status = JenkinsApplyStatus.FAILED;
      row.result = { message: 'Délai dépassé, réessayez.' };
      row.settledAt = new Date();
      await this.applies.save(row);
    }
    return { status: row.status, result: row.result };
  }

  // Appelé PAR n8n (WF4 v4, branche APPLY) sur l'un des 3 nœuds terminaux :
  // succès (après Create Pull Request), gate bloqué (Format Apply Error),
  // ou échec technique de l'Apply Agent. Pas de JwtAuthGuard (même logique
  // que /optimize/:id/callback, appelé depuis n8n, pas depuis le navigateur)
  // — MAIS ce callback-ci écrit un prUrl affiché tel quel à l'utilisateur,
  // donc protégé en plus par un secret partagé (voir N8N_CALLBACK_SECRET),
  // contrairement aux autres callbacks de ce fichier.
  @Post('apply/:applyId/callback')
  async receiveApplyCallback(
    @Param('applyId') applyId: string,
    @Body() body: { status: 'success' | 'blocked' | 'failed'; result?: any },
    @Headers('x-callback-secret') secret?: string,
  ) {
    if (!N8N_CALLBACK_SECRET || secret !== N8N_CALLBACK_SECRET) {
      throw new HttpException('Callback non autorisé', HttpStatus.FORBIDDEN);
    }

    const row = await this.applies.findOneBy({ applyId });
    if (!row) {
      console.warn(`[jenkins-optimizer] callback APPLY reçu pour un applyId inconnu : ${applyId}`);
      return { received: false };
    }
    row.status = body.status as JenkinsApplyStatus;
    row.result = body.result ?? null;
    row.settledAt = new Date();
    await this.applies.save(row);
    return { received: true };
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([JenkinsAnalysis, JenkinsApply, Project])],
  controllers: [JenkinsOptimizerController],
})
export class JenkinsOptimizerModule {}
