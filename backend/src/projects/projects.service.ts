import { Injectable, Logger, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Project } from './project.entity';
import { Incident, IncidentStatus } from '../incidents/incident.entity';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { sanitizeProject } from '../common/sanitize-project';
import { resolveJenkinsInternalUrl, assertValidJenkinsUrlInput } from '../common/jenkins-url';
import { computeBuildSuccessRate } from '../common/build-success-rate';

const OPEN_STATUSES = [IncidentStatus.PENDING, IncidentStatus.BLOCKED, IncidentStatus.FAILED];
const ANALYZING_STATUSES = [IncidentStatus.ANALYZING, IncidentStatus.ANALYZED, IncidentStatus.FIX_GENERATED, IncidentStatus.VALIDATING];
const RESOLVED_STATUSES = [IncidentStatus.APPROVED, IncidentStatus.COMPLETED];

function normalizeLogCode(value: unknown): string {
  const text = String(value ?? '').trim();
  return /^[A-Za-z0-9._-]{1,40}$/.test(text) ? text : 'n/a';
}

function normalizeHttpStatus(value: unknown): string {
  const status = Number(value);
  return Number.isInteger(status) && status >= 100 && status <= 599 ? String(status) : 'n/a';
}

function normalizeContentType(value: unknown): string {
  const mediaType = String(value ?? '').split(';', 1)[0].trim().toLowerCase();
  return /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(mediaType) ? mediaType : 'n/a';
}

@Injectable()
export class ProjectsService {
  private readonly logger = new Logger(ProjectsService.name);

  constructor(
    @InjectRepository(Project)
    private readonly repo: Repository<Project>,
    @InjectRepository(Incident)
    private readonly incidentRepo: Repository<Incident>,
    private readonly http: HttpService,
  ) {}

  private sanitizeProject(project: Project) {
    return sanitizeProject(project);
  }

  private normalizeAzureConfig(input: any) {
    if (input === null) return null;
    if (!input || input.provider !== 'azure-container-instances') throw new BadRequestException('Ce fournisseur de déploiement Azure n’est pas pris en charge.');
    for (const key of ['resourceGroup', 'targetName', 'registry', 'imageRepository']) {
      if (typeof input[key] !== 'string' || !input[key].trim()) throw new BadRequestException(`Le champ technique azureConfig.${key} est requis.`);
    }
    // Allow-list stricte : aucun token/password/credential arbitraire ne peut
    // être persisté dans Project.azureConfig.
    let healthCheck;
    if (input.healthCheck !== undefined) {
      const h = input.healthCheck;
      const port = String(h?.port ?? '8080');
      const ports = Array.isArray(input.ports) ? input.ports.map(String) : ['8080'];
      if (!h || typeof h !== 'object' || Array.isArray(h)
        || Object.keys(h).some(k => !['path', 'port', 'client', 'expectedBody'].includes(k))
        || typeof h.path !== 'string' || !/^\/[A-Za-z0-9/_-]{0,255}$/.test(h.path)
        || !ports.includes(port) || !['curl', 'wget'].includes(h.client ?? 'curl')
        || typeof h.expectedBody !== 'string' || !/^[A-Za-z0-9 _.-]{1,128}$/.test(h.expectedBody)) {
        throw new BadRequestException('azureConfig.healthCheck invalide.');
      }
      healthCheck = { path: h.path, port, client: h.client ?? 'curl', expectedBody: h.expectedBody };
    }
    return {
      provider: 'azure-container-instances' as const,
      resourceGroup: input.resourceGroup.trim(), targetName: input.targetName.trim(),
      registry: input.registry.trim(), imageRepository: input.imageRepository.trim(),
      ...(input.region ? { region: String(input.region).trim() } : {}),
      ...(input.subscriptionRef ? { subscriptionRef: String(input.subscriptionRef).trim() } : {}),
      ...(input.cpu ? { cpu: String(input.cpu) } : {}),
      ...(input.memoryInGb ? { memoryInGb: String(input.memoryInGb) } : {}),
      ...(Array.isArray(input.ports) ? { ports: input.ports.map(String) } : {}),
      ...(healthCheck ? { healthCheck } : {}),
    };
  }

  async findAll(jenkinsJobName?: string) {
    const where = jenkinsJobName ? { jenkinsJobName } : {};
    const projects = await this.repo.find({ where, order: { createdAt: "DESC" } });
    const counts = await this.getIncidentCountsByProject(projects.map(p => p.id));
    return projects.map(p => ({
      ...this.sanitizeProject(p),
      ...(counts.get(p.id) ?? { openIncidents: 0, analyzingIncidents: 0, resolvedIncidents: 0 }),
    }));
  }

  private async getIncidentCountsByProject(projectIds: string[]) {
    const counts = new Map<string, { openIncidents: number; analyzingIncidents: number; resolvedIncidents: number }>();
    if (projectIds.length === 0) return counts;

    const rows = await this.incidentRepo
      .createQueryBuilder('incident')
      .select('incident.projectId', 'projectId')
      .addSelect('incident.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .where('incident.projectId IN (:...projectIds)', { projectIds })
      .groupBy('incident.projectId')
      .addGroupBy('incident.status')
      .getRawMany<{ projectId: string; status: IncidentStatus; count: string }>();

    for (const row of rows) {
      const entry = counts.get(row.projectId) ?? { openIncidents: 0, analyzingIncidents: 0, resolvedIncidents: 0 };
      const n = parseInt(row.count, 10);
      if (OPEN_STATUSES.includes(row.status)) entry.openIncidents += n;
      else if (ANALYZING_STATUSES.includes(row.status)) entry.analyzingIncidents += n;
      else if (RESOLVED_STATUSES.includes(row.status)) entry.resolvedIncidents += n;
      counts.set(row.projectId, entry);
    }
    return counts;
  }

  async findOne(id: string) {
    const p = await this.repo.findOne({ where: { id } });
    if (!p) throw new NotFoundException('Projet introuvable.');
    return this.sanitizeProject(p);
  }

  private async findOneInternal(id: string) {
    const p = await this.repo.findOne({ where: { id } });
    if (!p) throw new NotFoundException('Projet introuvable.');
    return p;
  }

  async resolveSonarCorrelation(projectId: string, ceTaskId: string) {
    const project = await this.findOneInternal(projectId);
    if (!ceTaskId || !/^[A-Za-z0-9_-]{8,128}$/.test(ceTaskId)) {
      throw new BadRequestException('Un identifiant technique ceTaskId valide est requis.');
    }
    const sonarToken = this.resolveSonarToken(project);
    if (!sonarToken) {
      return { ceTaskId, analysisId: null, qualityGate: 'QUALITY_GATE_UNAVAILABLE', correlationVerified: false, state: 'SONAR_NOT_CONFIGURED' };
    }

    // L'URL interne est l'adresse de service de la plateforme, déjà utilisée
    // par WF1. Le projectKey/token restent strictement propres au projet.
    const baseUrl = (project.sonarqubeUrl || 'http://sonarqube:9000').replace(/\/$/, '');
    const headers = { Authorization: `Basic ${Buffer.from(`${sonarToken}:`).toString('base64')}` };
    const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    for (let attempt = 1; attempt <= 60; attempt++) {
      let response: any;
      try {
        response = await firstValueFrom(this.http.get(`${baseUrl}/api/ce/task`, {
          params: { id: ceTaskId }, headers, timeout: 10_000, validateStatus: () => true,
        }));
      } catch {
        return { ceTaskId, analysisId: null, qualityGate: 'API_ERROR', correlationVerified: false, state: 'API_ERROR', attempts: attempt };
      }
      if (response.status < 200 || response.status >= 300 || !response.data?.task) {
        return { ceTaskId, analysisId: null, qualityGate: 'API_ERROR', correlationVerified: false, state: 'API_ERROR', attempts: attempt };
      }

      const task = response.data.task;
      const state = String(task.status || '').toUpperCase();
      if (state === 'PENDING' || state === 'IN_PROGRESS') {
        if (attempt < 60) await sleep(5_000);
        continue;
      }
      if (state === 'FAILED' || state === 'CANCELED') {
        return { ceTaskId, analysisId: null, qualityGate: state === 'FAILED' ? 'SONAR_ANALYSIS_FAILED' : 'SONAR_ANALYSIS_CANCELED', correlationVerified: false, state, attempts: attempt };
      }
      if (state !== 'SUCCESS' || !task.analysisId) {
        return { ceTaskId, analysisId: null, qualityGate: 'QUALITY_GATE_NOT_COMPUTED', correlationVerified: false, state: state || 'UNKNOWN', attempts: attempt };
      }

      const analysisId = String(task.analysisId);
      try {
        const gate = await firstValueFrom(this.http.get(`${baseUrl}/api/qualitygates/project_status`, {
          params: { analysisId }, headers, timeout: 10_000, validateStatus: () => true,
        }));
        const status = String(gate.data?.projectStatus?.status || '').toUpperCase();
        if (gate.status < 200 || gate.status >= 300) {
          return { ceTaskId, analysisId, qualityGate: 'API_ERROR', correlationVerified: false, state: 'API_ERROR', attempts: attempt };
        }
        if (!status) {
          return { ceTaskId, analysisId, qualityGate: 'QUALITY_GATE_NOT_COMPUTED', correlationVerified: false, state: 'SUCCESS', attempts: attempt };
        }
        return { ceTaskId, analysisId, qualityGate: status, projectStatus: gate.data.projectStatus, correlationVerified: true, state: 'SUCCESS', attempts: attempt };
      } catch {
        return { ceTaskId, analysisId, qualityGate: 'API_ERROR', correlationVerified: false, state: 'API_ERROR', attempts: attempt };
      }
    }
    return { ceTaskId, analysisId: null, qualityGate: 'SONAR_ANALYSIS_TIMEOUT', correlationVerified: false, state: 'TIMEOUT', attempts: 60 };
  }

  private validateJenkinsUrlFields(dto: { jenkinsInternalUrl?: string; jenkinsPublicUrl?: string }) {
    try {
      if (dto.jenkinsInternalUrl) assertValidJenkinsUrlInput(dto.jenkinsInternalUrl, 'jenkinsInternalUrl');
      if (dto.jenkinsPublicUrl) assertValidJenkinsUrlInput(dto.jenkinsPublicUrl, 'jenkinsPublicUrl');
    } catch (e: any) {
      throw new BadRequestException(e.message);
    }
  }

  async create(dto: CreateProjectDto) {
    if (dto.jenkinsJobName) {
      const existing = await this.repo.findOne({ where: { jenkinsJobName: dto.jenkinsJobName } });
      if (existing) throw new ConflictException(`Un projet avec le job Jenkins "${dto.jenkinsJobName}" existe déjà`);
    }
    this.validateJenkinsUrlFields(dto);
    const payload: any = { ...dto };
    for (const field of ['jenkinsToken', 'sonarqubeToken', 'githubToken', 'slackToken']) delete payload[field];
    if (Object.prototype.hasOwnProperty.call(payload, 'azureConfig')) payload.azureConfig = this.normalizeAzureConfig(payload.azureConfig);
    const p = this.repo.create(payload as Partial<Project>);
    const saved = await this.repo.save(p);
    return this.sanitizeProject(saved);
  }

  async update(id: string, dto: UpdateProjectDto) {
    await this.findOneInternal(id);
    this.validateJenkinsUrlFields(dto);

    // Un champ token vide signifie "ne pas modifier", pas "effacer".
    // Le frontend ne recoit jamais les tokens en clair : il enverrait
    // sinon des chaines vides qui ecraseraient les vraies valeurs.
    const payload: any = { ...dto };
    for (const field of ['jenkinsToken', 'sonarqubeToken', 'githubToken', 'slackToken']) delete payload[field];
    if (Object.prototype.hasOwnProperty.call(payload, 'azureConfig')) payload.azureConfig = this.normalizeAzureConfig(payload.azureConfig);

    await this.repo.update(id, payload);
    return this.findOne(id);
  }

  // ADMIN-ONLY, appelé par PUT /projects/:id/jenkins-credentials — jamais
  // par l'update() général de configuration projet. Le nouveau credential
  // n'est persisté QUE si une vérification lecture-seule réelle contre
  // Jenkins (whoAmI) confirme une authentification effective — jamais un
  // simple HTTP 200 (whoAmI répond 200 même en anonyme, avec
  // authenticated:false). Le token n'est jamais journalisé, jamais
  // renvoyé, jamais inclus dans une réponse GET.
  async updateJenkinsCredentials(id: string, dto: { username: string; token: string }) {
    const project = await this.findOneInternal(id);
    const jenkinsInternalUrl = resolveJenkinsInternalUrl(project);
    if (!jenkinsInternalUrl) {
      throw new BadRequestException('Aucune URL Jenkins interne n’est configurée pour ce projet.');
    }
    const authHeader = `Basic ${Buffer.from(`${dto.username}:${dto.token}`).toString('base64')}`;
    let identityName: string | null = null;
    try {
      const { data } = await firstValueFrom(
        this.http.get(`${jenkinsInternalUrl}/whoAmI/api/json`, {
          headers: { Authorization: authHeader }, timeout: 8000,
        }),
      );
      if (!data || data.authenticated !== true) {
        throw new Error('not authenticated');
      }
      identityName = typeof data.name === 'string' ? data.name : null;
    } catch (error: any) {
      this.logger.warn(
        `jenkins-credentials validation-failed projectId=${normalizeLogCode(id)} ` +
        `httpStatus=${normalizeHttpStatus(error?.response?.status)} ` +
        `transportCode=${normalizeLogCode(error?.code)} ` +
        `contentType=${normalizeContentType(error?.response?.headers?.['content-type'])}`,
      );
      throw new ConflictException('Les identifiants Jenkins sont invalides.');
    }
    await this.repo.update(id, { jenkinsToken: `${dto.username}:${dto.token}` } as any);
    this.logger.debug(`jenkins-credentials validation-success projectId=${normalizeLogCode(id)}`);
    return { success: true, message: 'Connexion Jenkins vérifiée.', jenkinsUsername: identityName };
  }

  async remove(id: string) {
    const p = await this.findOneInternal(id);
    await this.repo.remove(p);
    return { message: 'Projet supprimé.' };
  }

  // ── Validation Jenkins + SonarQube ────────────────────────
  async validateProject(id: string) {
    const project = await this.findOneInternal(id);
    const results: any = {};
    const now = new Date().toISOString();

    // Validation SonarQube
    if (project.sonarqubeUrl && project.sonarqubeToken) {
      try {
        const headers = {
          Authorization: `Basic ${Buffer.from(project.sonarqubeToken + ':').toString('base64')}`
        };
        const auth = await firstValueFrom(
          this.http.get(`${project.sonarqubeUrl}/api/authentication/validate`, { headers, timeout: 5000 })
        );
        if (auth.data?.valid !== true) throw new Error('Authentication rejected');
        const lookup = await firstValueFrom(
          this.http.get(`${project.sonarqubeUrl}/api/projects/search`, { headers, timeout: 5000, params: { projects: project.sonarqubeKey } })
        );
        if (!lookup.data?.components?.some((component: any) => component.key === project.sonarqubeKey)) throw new Error('Project not found');
        results.sonarqube = { valid: true, message: 'SonarQube connecté — projet trouvé', checkedAt: now };
      } catch (e) {
        results.sonarqube = { valid: false, message: 'Échec de la vérification SonarQube. Vérifiez la configuration et les autorisations.', checkedAt: now };
      }
    }

    // Validation Jenkins
    const validateJenkinsUrl = resolveJenkinsInternalUrl(project);
    if (validateJenkinsUrl && project.jenkinsToken) {
      try {
        const [user, token] = project.jenkinsToken.split(':');
        const headers = {
          Authorization: `Basic ${Buffer.from(`${user}:${token}`).toString('base64')}`
        };
        const job = await firstValueFrom(
          this.http.get(`${validateJenkinsUrl}/job/${project.jenkinsJobPath || project.jenkinsJobName}/api/json`, { headers, timeout: 5000 })
        );
        if (!job.data || typeof job.data.name !== 'string' || !job.data.name) throw new Error('Job not found');
        results.jenkins = { valid: true, message: 'Jenkins connecté — job trouvé', checkedAt: now };
      } catch (e) {
        results.jenkins = { valid: false, message: 'Échec de la vérification Jenkins. Vérifiez la configuration et les autorisations.', checkedAt: now };
      }
    }

    await this.repo.update(id, { validationStatus: results });

    const allValid = Object.keys(results).length > 0 && Object.values(results).every((r: any) => r.valid);
    return {
      projectId: id,
      projectName: project.name,
      overallValid: allValid,
      results,
      checkedAt: now,
    };
  }

  // ── Métriques SonarQube ───────────────────────────────────
  /**
   * Jeton Sonar effectif pour ce projet.
   *
   * Un jeton SonarQube est un jeton d'UTILISATEUR, pas un secret propre a un
   * projet : la plateforme peut donc en porter un seul, exactement comme
   * Jenkins le fait avec son credential SONAR_TOKEN. Sans ce repli, tout
   * projet onboarde sans jeton propre voyait son controle qualite rapporte
   * QUALITY_GATE_UNAVAILABLE alors que SonarQube le calculait bel et bien --
   * et aucune route d'API ne permet de poser un sonarqubeToken (update() le
   * retire volontairement pour ne jamais ecraser un secret existant).
   *
   * Le jeton du projet reste prioritaire : le repli ne s'applique qu'a son
   * absence, jamais en remplacement.
   */
  /**
   * Identifiant Jenkins effectif pour ce projet.
   *
   * Exactement le même raisonnement que resolveSonarToken() : la plateforme
   * parle à UN Jenkins, avec un identifiant d'utilisateur. Le jeton du projet
   * reste prioritaire ; le repli ne s'applique qu'à son absence et ne rend
   * jamais un projet « configuré » (getJenkinsStatus exige un jenkinsJobName).
   *
   * Format attendu : "utilisateur:jeton", comme le champ par projet.
   */
  private resolveJenkinsCredential(project: Project): string | null {
    const own = String(project.jenkinsToken || '').trim();
    if (own) return own;
    const platform = String(process.env.JENKINS_TOKEN || '').trim();
    return platform || null;
  }

  private resolveSonarToken(project: Project): string | null {
    const own = String(project.sonarqubeToken || '').trim();
    if (own) return own;
    const platform = String(process.env.SONAR_TOKEN || '').trim();
    return platform || null;
  }

  /**
   * Mesures Sonar reelles, plus le controle qualite.
   *
   * Cette methode ne fabrique RIEN. Quand la source autoritaire ne repond pas,
   * elle le dit (`available: false` + `reason`) au lieu de renvoyer des valeurs
   * plausibles. La version precedente retombait sur des mesures inventees
   * (couverture 85 %, 12 code smells, 1500 lignes) indistinguables de vraies
   * donnees -- une valeur absente redevenait ainsi un constat propre.
   *
   * Le statut d'EXECUTION de l'analyse et le CONTROLE QUALITE sont deux choses
   * distinctes : ils sont donc rapportes separement, jamais fusionnes.
   */
  async getSonarMetrics(id: string) {
    const project = await this.findOneInternal(id);
    const unavailable = (reason: string) => ({
      available: false, reason,
      projectKey: project.sonarqubeKey || null,
      bugs: null, vulnerabilities: null, codeSmells: null, coverage: null,
      duplications: null, securityRating: null, reliabilityRating: null,
      maintainabilityRating: null, linesOfCode: null, securityHotspots: null,
      qualityGate: null, lastAnalysisAt: null,
    });

    // R47 — ce qui rend un projet « configure pour Sonar », c'est sa projectKey.
    // L'URL, elle, est l'adresse de service de la plateforme : waitForSonarQualityGate()
    // lui applique deja le meme repli. Exiger en plus une URL par projet faisait
    // rapporter SONAR_NOT_CONFIGURED a des projets dont SonarQube detenait de
    // vraies mesures -- une donnee perdue par la plateforme, pas une donnee absente.
    if (!project.sonarqubeKey) return unavailable('SONAR_NOT_CONFIGURED');
    const sonarToken = this.resolveSonarToken(project);
    if (!sonarToken) return unavailable('SONAR_TOKEN_UNAVAILABLE');

    const baseUrl = (project.sonarqubeUrl || 'http://sonarqube:9000').replace(/\/$/, '');
    const headers = { Authorization: `Basic ${Buffer.from(`${sonarToken}:`).toString('base64')}` };
    const get = (path: string, params: any) => firstValueFrom(this.http.get(`${baseUrl}${path}`, {
      params, headers, timeout: 10_000, validateStatus: () => true,
    }));

    try {
      const measures = await get('/api/measures/component', {
        component: project.sonarqubeKey,
        metricKeys: 'bugs,vulnerabilities,code_smells,coverage,duplicated_lines_density,security_rating,reliability_rating,sqale_rating,ncloc,security_hotspots',
      });
      if (measures.status === 404) return unavailable('SONAR_PROJECT_NOT_FOUND');
      if (measures.status < 200 || measures.status >= 300) return unavailable(`SONAR_API_STATUS_${measures.status}`);

      // Controle qualite et date d'analyse : deux appels distincts, chacun
      // facultatif. Leur echec n'invente jamais une mesure, il laisse null.
      const [gate, analyses] = await Promise.all([
        get('/api/qualitygates/project_status', { projectKey: project.sonarqubeKey }).catch(() => null),
        get('/api/project_analyses/search', { project: project.sonarqubeKey, ps: 1 }).catch(() => null),
      ]);
      const qualityGate = (gate && gate.status >= 200 && gate.status < 300)
        ? (String(gate.data?.projectStatus?.status || '').toUpperCase() || null) : null;
      const lastAnalysisAt = (analyses && analyses.status >= 200 && analyses.status < 300)
        ? (analyses.data?.analyses?.[0]?.date ?? null) : null;

      return { available: true, reason: null, projectKey: project.sonarqubeKey,
        ...this.parseSonarMetrics(measures.data), qualityGate, lastAnalysisAt };
    } catch {
      return unavailable('SONAR_API_ERROR');
    }
  }

  // ── Status Jenkins ────────────────────────────────────────
  // JENKINS_STATUS_TIMEOUT_MS : borne les deux appels HTTP directs (hors
  // dashboard, qui a déjà son propre timeout via getJenkinsStatusWithTimeout)
  // pour qu'un Jenkins lent (pas juste injoignable) ne fasse jamais attendre
  // l'onglet Jenkins indéfiniment.
  private static readonly JENKINS_STATUS_TIMEOUT_MS = 5000;

  async getJenkinsStatus(id: string) {
    const project = await this.findOneInternal(id);
    const jenkinsInternalUrl = resolveJenkinsInternalUrl(project);
    if (!jenkinsInternalUrl || !project.jenkinsJobName) {
      return this.emptyJenkinsStatus(project, 'Jenkins non configuré pour ce projet');
    }
    try {
      // R48 — repli plateforme, même principe que resolveSonarToken() : un
      // identifiant Jenkins est un identifiant d'UTILISATEUR de la plateforme,
      // pas un secret par projet. Le jeton du projet reste prioritaire.
      const jenkinsCredential = this.resolveJenkinsCredential(project);
      const [user, token] = (jenkinsCredential || ':').split(':');
      const headers = jenkinsCredential
        ? { Authorization: `Basic ${Buffer.from(`${user}:${token}`).toString('base64')}` }
        : {};
      const timeout = ProjectsService.JENKINS_STATUS_TIMEOUT_MS;
      // Chemin URL du job (multibranch : "<dossier>/job/<branche>") — distinct
      // de jenkinsJobName (identité du job, utilisée pour le lookup webhook).
      // Vide = fallback sur jenkinsJobName, comportement inchangé.
      const jobPath = project.jenkinsJobPath || project.jenkinsJobName;
      const lastUrl = `${jenkinsInternalUrl}/job/${jobPath}/lastBuild/api/json`;
      const { data: last } = await firstValueFrom(this.http.get(lastUrl, { headers, timeout }));
      // {0,20} : capture tout l'historique dispo aujourd'hui (15 builds/projet
      // vérifiés en réel) avec marge, plutôt qu'une fenêtre calendaire qui
      // risquerait un échantillon vide sur un historique ancien.
      const histUrl = `${jenkinsInternalUrl}/job/${jobPath}/api/json?tree=builds[number,result,duration,timestamp,url]{0,20}`;
      const { data: hist } = await firstValueFrom(this.http.get(histUrl, { headers, timeout }));
      const builds = (hist.builds || []).map((b: any) => ({
        number: b.number, result: b.result,
        duration: Math.round((b.duration || 0) / 1000),
        timestamp: b.timestamp, url: b.url,
      }));
      return {
        result: last.result, duration: last.duration,
        timestamp: last.timestamp, url: last.url,
        building: last.building, buildNumber: last.number,
        jobName: project.jenkinsJobName, builds,
        buildSuccessRate: computeBuildSuccessRate(builds),
        sampleSize: builds.length,
        _liveData: true,
      };
    } catch {
      return this.emptyJenkinsStatus(project, 'Données Jenkins temporairement indisponibles');
    }
  }

  // État dégradé honnête — jamais un build fabriqué. message distingue les 2
  // causes possibles (non configuré vs injoignable/timeout/erreur), pour que
  // l'utilisateur sache quoi faire plutôt qu'un "Non disponible" générique.
  private emptyJenkinsStatus(project: Project, message: string) {
    return {
      result: null, duration: null, timestamp: null, url: null,
      building: false, buildNumber: null,
      jobName: project.jenkinsJobName || null,
      builds: [] as any[],
      buildSuccessRate: null,
      sampleSize: 0,
      _liveData: false,
      message,
    };
  }

  /**
   * Trivy n'est pas interrogeable par API : ses resultats arrivent par le
   * rapport de build, dans l'evidence de l'incident. Cette route ne peut donc
   * rien produire d'autoritaire, et le dit explicitement.
   *
   * La version precedente renvoyait INCONDITIONNELLEMENT un rapport invente
   * (3 elevees, 12 moyennes, 24 faibles) sans meme tenter un appel.
   */
  async getTrivyReport(id: string) {
    await this.findOneInternal(id);
    return {
      available: false,
      reason: 'TRIVY_NOT_QUERYABLE_BY_API',
      source: 'evidence du rapport de build (enrichedData.trivy)',
      critical: null, high: null, medium: null, low: null, unknown: null,
      vulnerabilities: null,
    };
  }

  async getGithubStats(id: string) {
    const project = await this.findOneInternal(id);
    if (!project.githubRepo) return this.unavailableGithubStats('GITHUB_REPO_NOT_CONFIGURED');
    try {
      const [owner, repo] = project.githubRepo.replace('https://github.com/', '').split('/');
      const headers: any = { 'User-Agent': 'DevSecOps-Platform' };
      if (project.githubToken) headers['Authorization'] = `token ${project.githubToken}`;
      const { data: prs } = await firstValueFrom(
        this.http.get(`https://api.github.com/repos/${owner}/${repo}/pulls?state=all&per_page=20`, { headers }),
      );
      return {
        openPRs: prs.filter((p: any) => p.state === 'open').length,
        mergedPRs: prs.filter((p: any) => p.merged_at).length,
        totalPRs: prs.length,
        recentPRs: prs.slice(0, 5).map((p: any) => ({
          title: p.title, state: p.state, number: p.number,
          url: p.html_url, createdAt: p.created_at, mergedAt: p.merged_at,
        })),
      };
    } catch {
      return this.unavailableGithubStats('GITHUB_API_ERROR');
    }
  }

  // ── Helpers privés ────────────────────────────────────────
  private parseSonarMetrics(data: any) {
    const measures: any = {};
    data?.component?.measures?.forEach((m: any) => { measures[m.metric] = m.value; });
    // Une mesure absente reste absente. Substituer 0 ou 'A' rendait une
    // metrique non calculee indistinguable d'une metrique reellement bonne.
    const num = (raw: unknown) => {
      const value = Number(raw);
      return raw === undefined || raw === null || raw === '' || !Number.isFinite(value) ? null : value;
    };
    const rating = (raw: unknown) => {
      const letters: Record<string, string> = { '1': 'A', '2': 'B', '3': 'C', '4': 'D', '5': 'E' };
      const key = String(raw ?? '').trim().split('.')[0];
      return letters[key] ?? null;
    };
    return {
      bugs: num(measures.bugs),
      vulnerabilities: num(measures.vulnerabilities),
      codeSmells: num(measures.code_smells),
      coverage: num(measures.coverage),
      duplications: num(measures.duplicated_lines_density),
      securityRating: rating(measures.security_rating),
      reliabilityRating: rating(measures.reliability_rating),
      maintainabilityRating: rating(measures.sqale_rating),
      linesOfCode: num(measures.ncloc),
      securityHotspots: num(measures.security_hotspots),
    };
  }

  // Les trois replis fabriques precedents sont supprimes. Ils renvoyaient des
  // valeurs plausibles -- couverture 85 %, 12 code smells, 1500 lignes, 3 CVE
  // elevees, 18 PR fusionnees -- indistinguables de vraies donnees par
  // n'importe quel consommateur. Une donnee absente doit se presenter comme
  // absente, avec son motif.
  private unavailableGithubStats(reason: string) {
    return { available: false, reason, openPRs: null, mergedPRs: null, totalPRs: null, recentPRs: null };
  }

  /**
   * Usage INTERNE uniquement (n8n via /api/projects/internal/by-job/:jobName).
   * Retourne volontairement les tokens : la plateforme doit s'authentifier
   * aupres de Jenkins/Sonar/GitHub au nom du projet.
   * Cette route ne doit jamais etre exposee publiquement.
   */
  /**
   * Résolution partagée jobName Jenkins -> projet(s), source unique de
   * vérité utilisée par TOUS les points d'entrée internes (GET
   * internal/by-job, POST webhooks/jenkins/by-job — voir leurs contrôleurs
   * respectifs). Deux niveaux, jamais plus :
   *   1. Match EXACT sur jenkinsJobName tel quel (couvre un jenkinsJobName
   *      qui contiendrait déjà la forme complète, cas rare mais possible).
   *   2. Repli sur la forme COURTE (premier segment) — Jenkins envoie le
   *      JOB_NAME complet pour un pipeline multibranche ("<job>/<branche>"),
   *      jamais stocké tel quel en base (jenkinsJobName y est toujours la
   *      forme courte, voir le commentaire sur l'entité).
   * Aucun appelant n'a besoin de connaître ce format — WF1 comme le webhook
   * direct passent le jobName brut de Jenkins, point.
   */
  async resolveByJobName(jenkinsJobName: string) {
    const exact = await this.repo.find({ where: { jenkinsJobName }, order: { createdAt: "DESC" } });
    if (exact.length > 0) return exact;

    const shortName = jenkinsJobName.split('/')[0];
    if (shortName === jenkinsJobName) return [];
    return this.repo.find({ where: { jenkinsJobName: shortName }, order: { createdAt: "DESC" } });
  }

  async findByJobNameInternal(jenkinsJobName: string) {
    return this.resolveByJobName(jenkinsJobName);
  }
}
