// Gère les projets et leurs paramètres, protège les secrets dans les réponses et vérifie l'exclusivité des cibles Azure.
import { Injectable, Logger, NotFoundException, ConflictException, BadRequestException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { buildDefaultAzureConfig, readPlatformDeploymentDefaults } from '../azure-deploy/default-deployment-target';
import { Project } from './project.entity';
import { isEncryptedToken } from './token-crypto';
import { Incident, IncidentStatus } from '../incidents/incident.entity';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { sanitizeProject } from '../common/sanitize-project';
import { resolveJenkinsInternalUrl, assertValidJenkinsUrlInput } from '../common/jenkins-url';
import { computeBuildSuccessRate } from '../common/build-success-rate';
import {
  JenkinsBuildDetail, normalizeJenkinsBuildDetail, tailConsoleLines, unavailableBuildDetail,
} from '../common/jenkins-build-detail';

const OPEN_STATUSES = [IncidentStatus.PENDING, IncidentStatus.BLOCKED, IncidentStatus.FAILED];
const ANALYZING_STATUSES = [IncidentStatus.ANALYZING, IncidentStatus.ANALYZED, IncidentStatus.FIX_GENERATED, IncidentStatus.VALIDATING];
const RESOLVED_STATUSES = [IncidentStatus.APPROVED, IncidentStatus.COMPLETED];

/** Normalise le code de disponibilité des journaux. */
function normalizeLogCode(value: unknown): string {
  const text = String(value ?? '').trim();
  return /^[A-Za-z0-9._-]{1,40}$/.test(text) ? text : 'n/a';
}

/** Normalise le statut HTTP reçu. */
function normalizeHttpStatus(value: unknown): string {
  const status = Number(value);
  return Number.isInteger(status) && status >= 100 && status <= 599 ? String(status) : 'n/a';
}

/** Normalise le type de contenu de la réponse. */
function normalizeContentType(value: unknown): string {
  const mediaType = String(value ?? '').split(';', 1)[0].trim().toLowerCase();
  return /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(mediaType) ? mediaType : 'n/a';
}

@Injectable()
export class ProjectsService implements OnModuleInit {
  private readonly logger = new Logger(ProjectsService.name);

  /** Initialise les dépendances et l’état de ce composant. */
  constructor(
    @InjectRepository(Project)
    private readonly repo: Repository<Project>,
    @InjectRepository(Incident)
    private readonly incidentRepo: Repository<Incident>,
    private readonly http: HttpService,
  ) {}

  /** Au démarrage, chiffre les secrets de projet encore stockés en clair (migration idempotente). */
  async onModuleInit() {
    if (!process.env.TOKEN_ENCRYPTION_KEY) {
      this.logger.warn('TOKEN_ENCRYPTION_KEY absente : les secrets de projet existants restent en clair.');
      return;
    }
    const fields = ['jenkinsToken', 'githubToken', 'sonarqubeToken', 'slackToken'] as const;
    const rows: any[] = await this.repo.query(`SELECT id, "jenkinsToken", "githubToken", "sonarqubeToken", "slackToken" FROM projects`);
    let migrated = 0;
    for (const row of rows) {
      const patch: Partial<Project> = {};
      for (const field of fields) if (row[field] && !isEncryptedToken(row[field])) (patch as any)[field] = row[field];
      if (Object.keys(patch).length) { await this.repo.update(row.id, patch); migrated++; }
    }
    if (migrated) this.logger.log(`Secrets de projet chiffrés au repos pour ${migrated} projet(s).`);
  }

  /** Retire les informations sensibles de le projet. */
  private sanitizeProject(project: Project) {
    return sanitizeProject(project);
  }

  /** Normalise Azure configuration. */
  private normalizeAzureConfig(input: any) {
    if (input === null) return null;
    if (!input || input.provider !== 'azure-container-instances') throw new BadRequestException('Ce fournisseur de déploiement Azure n’est pas pris en charge.');
    for (const key of ['resourceGroup', 'targetName', 'registry', 'imageRepository']) {
      if (typeof input[key] !== 'string' || !input[key].trim()) throw new BadRequestException(`Le champ technique azureConfig.${key} est requis.`);
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,126}$/.test(input.resourceGroup.trim())
      || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(input.targetName.trim())
      || !/^[a-zA-Z0-9]{5,50}$/.test(input.registry.trim())
      || !/^[a-z0-9][a-z0-9._/-]{0,254}$/.test(input.imageRepository.trim())
      || (input.cpu !== undefined && !['0.5', '1', '2', '4'].includes(String(input.cpu)))
      || (input.memoryInGb !== undefined && !['0.5', '1', '1.5', '2', '3', '4', '8'].includes(String(input.memoryInGb)))
      || (input.ports !== undefined && (!Array.isArray(input.ports) || !input.ports.length
        || input.ports.some(p => !/^\d+$/.test(String(p)) || Number(p) < 1 || Number(p) > 65535)))) {
      throw new BadRequestException('Configuration Azure invalide (cible, registre, dépôt, ressources ou ports).');
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

  /** Vérifie Exclusive Azure cible. */
  private assertExclusiveAzureTarget(config: Project['azureConfig'], projects: Pick<Project, 'azureConfig'>[]) {
    if (!config) return;
    /** Convertit le texte en minuscules. */
    const lower = (v: string) => String(v ?? '').trim().toLowerCase();
    if (projects.some(({ azureConfig: other }) => other && (
      (lower(other.resourceGroup) === lower(config.resourceGroup) && lower(other.targetName) === lower(config.targetName)) ||
      (lower(other.registry) === lower(config.registry) && lower(other.imageRepository) === lower(config.imageRepository))
    ))) throw new ConflictException('Cette cible Azure ou ce dépôt d’images appartient déjà à un autre projet.');
  }

  /** Liste les éléments selon les filtres demandés. */
  async findAll(jenkinsJobName?: string) {
    const where = jenkinsJobName ? { jenkinsJobName } : {};
    const projects = await this.repo.find({ where, order: { createdAt: "DESC" } });
    const counts = await this.getIncidentCountsByProject(projects.map(p => p.id));
    return projects.map(p => ({
      ...this.sanitizeProject(p),
      ...(counts.get(p.id) ?? { openIncidents: 0, analyzingIncidents: 0, resolvedIncidents: 0 }),
    }));
  }

  /** Renvoie incident Counts par projet. */
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

  /** Recherche l’élément correspondant à l’identifiant. */
  async findOne(id: string) {
    const p = await this.repo.findOne({ where: { id } });
    if (!p) throw new NotFoundException('Projet introuvable.');
    return this.sanitizeProject(p);
  }

  /** Recherche l’élément complet pour un traitement interne. */
  /** Projet complet, secrets compris (usage serveur uniquement, jamais renvoyé à un client). */
  async findOneWithSecrets(id: string) {
    return this.findOneInternal(id);
  }

  private async findOneInternal(id: string) {
    const p = await this.repo.findOne({ where: { id } });
    if (!p) throw new NotFoundException('Projet introuvable.');
    return p;
  }

  /** Résout SonarQube corrélation. */
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
    /** Attend le délai prévu avant de poursuivre. */
    const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    for (let attempt = 1; attempt <= 60; attempt++) {
      let response: any;
      try {
        response = await firstValueFrom(this.http.get(`${baseUrl}/api/ce/task`, {
          params: { id: ceTaskId }, headers, timeout: 10_000,
          /** Valide le statut. */
          validateStatus: () => true,
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
          params: { analysisId }, headers, timeout: 10_000,
          /** Valide le statut. */
          validateStatus: () => true,
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

  /** Valide Jenkins URL champs. */
  private validateJenkinsUrlFields(dto: { jenkinsInternalUrl?: string; jenkinsPublicUrl?: string }) {
    try {
      if (dto.jenkinsInternalUrl) assertValidJenkinsUrlInput(dto.jenkinsInternalUrl, 'jenkinsInternalUrl');
      if (dto.jenkinsPublicUrl) assertValidJenkinsUrlInput(dto.jenkinsPublicUrl, 'jenkinsPublicUrl');
    } catch (e: any) {
      throw new BadRequestException(e.message);
    }
  }

  /** Crée et enregistre un nouvel élément. */
  async create(dto: CreateProjectDto) {
    if (dto.jenkinsJobName) {
      const existing = await this.repo.findOne({ where: { jenkinsJobName: dto.jenkinsJobName } });
      if (existing) throw new ConflictException(`Un projet avec le job Jenkins "${dto.jenkinsJobName}" existe déjà`);
    }
    this.validateJenkinsUrlFields(dto);
    const payload: any = { ...dto };
    for (const field of ['jenkinsToken', 'sonarqubeToken', 'githubToken', 'slackToken']) delete payload[field];
    // 2026-10-19 — un projet qui vient d'être créé n'a jamais été analysé : il n'a donc pas de score de sécurité.
    payload.securityScore = null;
    if (Object.prototype.hasOwnProperty.call(payload, 'azureConfig')) payload.azureConfig = this.normalizeAzureConfig(payload.azureConfig);
    const saved = await this.repo.manager.transaction(async manager => {
      // Serialize target allocation across backend processes, including updates.
      await manager.query("SELECT pg_advisory_xact_lock(73421, 1)");
      const repository = manager.getRepository(Project);
      const projects = await repository.find({ select: ['id', 'azureConfig'] });
      if (!Object.prototype.hasOwnProperty.call(payload, 'azureConfig')) {
        const derived = buildDefaultAzureConfig({
          projectName: payload.name,
          defaults: readPlatformDeploymentDefaults(),
          takenTargetNames: projects.map(p => p.azureConfig?.targetName).filter(Boolean),
          takenRepositories: projects.map(p => p.azureConfig?.imageRepository).filter(Boolean),
        });
        if (derived.ok === true) payload.azureConfig = this.normalizeAzureConfig(derived.azureConfig);
        else if (derived.failureCode !== 'PLATFORM_DEFAULTS_NOT_CONFIGURED') {
          throw new ConflictException({ code: derived.failureCode, message: derived.reason });
        }
      }
      this.assertExclusiveAzureTarget(payload.azureConfig, projects);
      return repository.save(repository.create(payload as Partial<Project>));
    });
    return this.sanitizeProject(saved);
  }

  /** Applique les modifications autorisées à l’élément. */
  async update(id: string, dto: UpdateProjectDto) {
    await this.findOneInternal(id);
    this.validateJenkinsUrlFields(dto);

    // Un champ token vide signifie "ne pas modifier", pas "effacer".
    // Le frontend ne recoit jamais les tokens en clair : il enverrait
    // sinon des chaines vides qui ecraseraient les vraies valeurs.
    const payload: any = { ...dto };
    for (const field of ['jenkinsToken', 'sonarqubeToken', 'githubToken', 'slackToken']) delete payload[field];
    if (Object.prototype.hasOwnProperty.call(payload, 'azureConfig')) payload.azureConfig = this.normalizeAzureConfig(payload.azureConfig);

    await this.repo.manager.transaction(async manager => {
      await manager.query("SELECT pg_advisory_xact_lock(73421, 1)");
      const repository = manager.getRepository(Project);
      if (payload.azureConfig) {
        const projects = await repository.find({ select: ['id', 'azureConfig'] });
        this.assertExclusiveAzureTarget(payload.azureConfig, projects.filter(p => p.id !== id));
      }
      await repository.update(id, payload);
    });
    return this.findOne(id);
  }

  /** ADMIN-ONLY, appelé par PUT /projects/:id/jenkins-credentials — jamais par l'update() général de configuration projet. */
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

  /** Supprime l’élément ciblé et gère ses dépendances. */
  async remove(id: string) {
    const p = await this.findOneInternal(id);
    await this.repo.remove(p);
    return { message: 'Projet supprimé.' };
  }

  /** Valide le projet. */
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

  /** /** Jeton Sonar effectif pour ce projet. */
  private resolveJenkinsCredential(project: Project): string | null {
    const own = String(project.jenkinsToken || '').trim();
    if (own) return own;
    const platform = String(process.env.JENKINS_TOKEN || '').trim();
    return platform || null;
  }

  /** Résout SonarQube jeton. */
  private resolveSonarToken(project: Project): string | null {
    const own = String(project.sonarqubeToken || '').trim();
    if (own) return own;
    const platform = String(process.env.SONAR_TOKEN || '').trim();
    return platform || null;
  }

  /** Mesures Sonar reelles, plus le controle qualite. */
  async getSonarMetrics(id: string) {
    const project = await this.findOneInternal(id);
    /** Construit le résultat indisponible. */
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
    /** Récupère les données demandées. */
    const get = (path: string, params: any) => firstValueFrom(this.http.get(`${baseUrl}${path}`, {
      params, headers, timeout: 10_000,
      /** Valide le statut. */
      validateStatus: () => true,
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

  /** Renvoie l’état Jenkins. */
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

  /** État dégradé honnête — jamais un build fabriqué. */
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

  // ── Détail d'UN build ───────────────────────────────────── Pourquoi une route distincte de getJenkinsStatus().
  private static readonly BUILD_DETAIL_TIMEOUT_MS = 6000;
  private static readonly BUILD_CONSOLE_TIMEOUT_MS = 15000;
  private static readonly BUILD_CONSOLE_MAX_BYTES = 8 * 1024 * 1024;

  /** Contexte d'appel Jenkins pour un projet, ou null quand le projet n'est pas configuré. */
  private jenkinsRequestContext(project: Project): { baseUrl: string; headers: Record<string, string>; jobPath: string } | null {
    const baseUrl = resolveJenkinsInternalUrl(project);
    if (!baseUrl || !project.jenkinsJobName) return null;
    const credential = this.resolveJenkinsCredential(project);
    const [user, token] = (credential || ':').split(':');
    const headers = credential
      ? { Authorization: `Basic ${Buffer.from(`${user}:${token}`).toString('base64')}` }
      : {};
    // Chemin URL du job (multibranch : "<dossier>/job/<branche>") — distinct
    // de jenkinsJobName, qui est l'identité du job côté webhook.
    return { baseUrl, headers, jobPath: project.jenkinsJobPath || project.jenkinsJobName };
  }

  /** Référence de build acceptée : un numéro, ou « last » pour le dernier. Tout le reste est refusé — ce fragment entre dans un chemin d'URL Jenkins, il n'est jamais interpolé tel quel. */
  private resolveBuildRef(raw: unknown): string | null {
    const value = String(raw ?? '').trim();
    if (!value || value === 'last' || value === 'lastBuild') return 'lastBuild';
    return /^[1-9][0-9]{0,8}$/.test(value) ? value : null;
  }

  /** Transforme une réponse Jenkins en diagnostic exploitable. */
  private jenkinsHttpFailure(status: number): { reason: string; message: string } {
    if (status === 404) return { reason: 'BUILD_NOT_FOUND', message: 'Ce build n’existe pas (ou plus) dans Jenkins.' };
    if (status === 401 || status === 403) {
      return { reason: 'JENKINS_UNAUTHORIZED', message: 'Jenkins refuse l’accès : identifiant ou jeton manquant pour ce projet.' };
    }
    return { reason: `JENKINS_API_STATUS_${status}`, message: `Jenkins a répondu ${status}.` };
  }

  /** Renvoie les détails du build. */
  async getBuildDetail(id: string, rawRef: string): Promise<JenkinsBuildDetail> {
    const project = await this.findOneInternal(id);
    const ref = this.resolveBuildRef(rawRef);
    if (!ref) throw new BadRequestException('La référence de build doit être un numéro ou « last ».');

    const context = this.jenkinsRequestContext(project);
    if (!context) {
      return unavailableBuildDetail(project.jenkinsJobName, 'JENKINS_NOT_CONFIGURED', 'Jenkins non configuré pour ce projet');
    }

    const jobUrl = `${context.baseUrl}/job/${context.jobPath}`;
    const timeout = ProjectsService.BUILD_DETAIL_TIMEOUT_MS;
    /** Récupère les données demandées. */
    const get = (path: string) => firstValueFrom(this.http.get(`${jobUrl}/${path}`, {
      headers: context.headers, timeout,
      /** Valide le statut. */
      validateStatus: () => true,
    }));

    try {
      const build = await get(`${ref}/api/json`);
      if (build.status < 200 || build.status >= 300) {
        const failure = this.jenkinsHttpFailure(build.status);
        return unavailableBuildDetail(project.jenkinsJobName, failure.reason, failure.message);
      }

      // Enrichissements FACULTATIFS : l'échec de l'un n'invalide pas le build
      // déjà obtenu. Les étages viennent du plugin Stage View (wfapi), absent
      // des jobs non-pipeline ; les builds voisins ne servent qu'à naviguer.
      const [workflow, history] = await Promise.all([
        get(`${ref}/wfapi/describe`).catch(() => null),
        get('api/json?tree=builds[number,result,building,timestamp]{0,20}').catch(() => null),
      ]);
      /** Vérifie si la valeur reçue peut être utilisée. */
      const usable = (response: any) => (response && response.status >= 200 && response.status < 300 ? response.data : null);

      return normalizeJenkinsBuildDetail({
        build: build.data,
        workflow: usable(workflow),
        history: usable(history),
        jobName: project.jenkinsJobName,
        // Deux checkouts git coexistent (bibliothèque partagée + application) :
        // le dépôt du projet est ce qui permet de désigner le bon commit.
        repoHint: project.githubRepo,
      });
    } catch {
      return unavailableBuildDetail(project.jenkinsJobName, 'JENKINS_UNREACHABLE', 'Jenkins est injoignable depuis la plateforme.');
    }
  }

  /** Fin du journal de console d'un build — la preuve brute, telle que Jenkins la détient. */
  async getBuildConsole(id: string, rawRef: string, rawTail: unknown) {
    const project = await this.findOneInternal(id);
    const ref = this.resolveBuildRef(rawRef);
    if (!ref) throw new BadRequestException('La référence de build doit être un numéro ou « last ».');
    const requested = Number(rawTail);
    const tail = Number.isInteger(requested) && requested > 0 ? Math.min(requested, 1000) : 200;

    /** Construit le résultat indisponible. */
    const unavailable = (reason: string, message: string) => ({
      available: false, reason, message,
      jobName: project.jenkinsJobName || null,
      number: ref === 'lastBuild' ? null : Number(ref),
      lines: [] as string[], truncated: false, totalLines: null as number | null, tail,
    });

    const context = this.jenkinsRequestContext(project);
    if (!context) return unavailable('JENKINS_NOT_CONFIGURED', 'Jenkins non configuré pour ce projet');

    try {
      const response = await firstValueFrom(this.http.get(`${context.baseUrl}/job/${context.jobPath}/${ref}/consoleText`, {
        headers: context.headers,
        timeout: ProjectsService.BUILD_CONSOLE_TIMEOUT_MS,
        /** Valide le statut. */
        validateStatus: () => true,
        responseType: 'text',
        transformResponse: [(data: any) => data],
        maxContentLength: ProjectsService.BUILD_CONSOLE_MAX_BYTES,
      }));
      if (response.status < 200 || response.status >= 300) {
        const failure = this.jenkinsHttpFailure(response.status);
        return unavailable(failure.reason, failure.message);
      }
      const window = tailConsoleLines(response.data, tail);
      return {
        available: true, reason: null, message: null,
        jobName: project.jenkinsJobName || null,
        number: ref === 'lastBuild' ? null : Number(ref),
        tail, ...window,
      };
    } catch {
      return unavailable('JENKINS_UNREACHABLE', 'Jenkins est injoignable depuis la plateforme.');
    }
  }

  /** Trivy n'est pas interrogeable par API : ses resultats arrivent par le rapport de build, dans l'evidence de l'incident. */
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

  /** Renvoie les statistiques GitHub. */
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
    /** Convertit la note reçue en valeur exploitable. */
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

  /** Renvoie indisponible GitHub statistiques pour le traitement ou l’affichage. */
  private unavailableGithubStats(reason: string) {
    return { available: false, reason, openPRs: null, mergedPRs: null, totalPRs: null, recentPRs: null };
  }

  /** Résout par Job nom. */
  async resolveByJobName(jenkinsJobName: string) {
    const exact = await this.repo.find({ where: { jenkinsJobName }, order: { createdAt: "DESC" } });
    if (exact.length > 0) return exact;

    const shortName = jenkinsJobName.split('/')[0];
    if (shortName === jenkinsJobName) return [];
    return this.repo.find({ where: { jenkinsJobName: shortName }, order: { createdAt: "DESC" } });
  }

  /** Recherche par Job nom interne. */
  async findByJobNameInternal(jenkinsJobName: string) {
    return this.resolveByJobName(jenkinsJobName);
  }
}
