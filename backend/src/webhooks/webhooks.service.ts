// Traite les webhooks bruts SonarQube/Jenkins/Trivy : crée bugs/incidents, et route automatiquement
// certains échecs Jenkins classifiés vers les optimiseurs Jenkinsfile (WF4) / Dockerfile (WF5).
import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHash } from 'crypto';
import { BugsService } from '../bugs/bugs.service';
import { IncidentsService } from '../incidents/incidents.service';
import { ProjectsService } from '../projects/projects.service';
import { BugSource, BugSeverity } from '../bugs/bug.entity';
import { IncidentStatus } from '../incidents/incident.entity';
import { extractErrorFromConsoleLog } from './console-log-errors';
import { classify } from './jenkins-known-fixes';
import { RoutedBuild } from './routed-build.entity';
import { trustedJenkinsConsoleUrl } from './trusted-jenkins-url';

const SELF_API_URL = process.env.SELF_API_URL || 'http://localhost:3001/api';
// Appels internes du routeur (WF4/WF5) : secret interne n8n. Un JWT fabriqué pour un compte
// inexistant est refusé depuis que la stratégie JWT exige un utilisateur réel en base.
const INTERNAL_HEADERS = () => ({ 'Content-Type': 'application/json', 'X-Internal-Secret': process.env.N8N_INTERNAL_SECRET || '' });

const ROUTED_BUILD_TTL_MS = Number(process.env.ROUTED_BUILD_TTL_MS) || 24 * 60 * 60 * 1000;

@Injectable()
export class WebhooksService {
  /** Initialise les dépendances et l’état de ce composant. */
  constructor(
    private readonly bugs: BugsService,
    private readonly incidents: IncidentsService,
    private readonly projects: ProjectsService,
    private readonly jwt: JwtService,
    @InjectRepository(RoutedBuild) private readonly routedBuilds: Repository<RoutedBuild>,
  ) {}

  // Convertit chaque issue SonarQube du payload (limité à 20) en bug.
  async handleSonarqube(projectId: string, payload: any) {
    const issues = payload?.issues || [];
    for (const issue of issues.slice(0, 20)) {
      await this.bugs.create({
        projectId,
        title: issue.message || 'SonarQube Issue',
        rawMessage: JSON.stringify(issue),
        filePath: issue.component,
        lineNumber: issue.line,
        ruleId: issue.rule,
        severity: this.mapSonarSeverity(issue.severity),
        source: BugSource.SONARQUBE,
        metadata: issue,
      });
    }
    return { processed: issues.length };
  }

  // Crée un incident à partir d'un payload Jenkins, va chercher la vraie cause d'échec dans le log
  // console si besoin, puis déclenche (en fire-and-forget) le routage automatique vers WF4/WF5.
  async handleJenkins(projectId: string, payload: any) {
    const buildNumber = payload?.build_number || payload?.build?.number || payload?.buildNumber || null;
    const buildStatus = payload?.status || payload?.build?.status || 'UNKNOWN';
    const jobName     = payload?.job || payload?.jenkinsJobName || null;
    const title       = payload?.title
                      || (jobName ? `Jenkins Build #${buildNumber}: ${buildStatus}` : 'Jenkins Build');

    const incidentStatus = String(buildStatus).toUpperCase() === 'SUCCESS'
      ? IncidentStatus.COMPLETED
      : IncidentStatus.FAILED;

    const buildUrl = payload?.build_url || payload?.build?.url || payload?.metadata?.buildUrl || '';

    let errorReason: string | null = payload?.error_message || null;
    // SSRF : build_url vient du payload ; on ne lit que le log d'un build du Jenkins configuré du projet.
    // Lecture authentifiée (Jenkins refuse l'anonyme) : le token n'est envoyé qu'à l'URL interne validée ci-dessus.
    const jenkinsProject = String(buildStatus).toUpperCase() === 'FAILURE' && buildUrl
      ? await this.projects.findOneWithSecrets(projectId).catch(() => null) : null;
    const consoleUrl = jenkinsProject ? trustedJenkinsConsoleUrl(buildUrl, jenkinsProject) : null;
    const consoleHeaders: Record<string, string> = jenkinsProject?.jenkinsToken
      ? { Authorization: 'Basic ' + Buffer.from(jenkinsProject.jenkinsToken).toString('base64') } : {};
    if (buildUrl && String(buildStatus).toUpperCase() === 'FAILURE' && !consoleUrl) {
      console.warn(`[webhooks] build_url refusé (hors du Jenkins configuré du projet) : ${buildUrl}`);
    }
    if (consoleUrl) {
      try {
        const res = await fetch(consoleUrl, { headers: consoleHeaders, signal: AbortSignal.timeout(15000), redirect: 'error' });
        if (res.ok) {
          const log = await res.text();
          const extracted = extractErrorFromConsoleLog(log);
          if (extracted) errorReason = extracted;
        } else {
          console.warn(`[webhooks] consoleText Jenkins indisponible (${res.status}) pour ${buildUrl}`);
        }
      } catch (e: any) {
        console.warn(`[webhooks] échec de récupération du log Jenkins pour ${buildUrl} : ${e?.message || e}`);
      }
    }

    const incident = await this.incidents.create({
      projectId,
      title,
      description: buildUrl,
      source: 'jenkins',
      jenkinsJobName: jobName,
      buildNumber: buildNumber ? parseInt(buildNumber) : null,
      status: incidentStatus,
      metadata: payload,
      errorStep: payload?.failed_stage || null,
      errorReason,
    });

    if (incidentStatus === IncidentStatus.FAILED && errorReason) {
      const branch = jobName && jobName.includes('/') ? jobName.split('/').slice(1).join('/') : undefined;
      this.routeToOptimizer(projectId, incident.id, errorReason, branch).catch((e: any) => {
        console.warn(`[webhooks] routage auto WF4/WF5 échoué pour incident ${incident.id} : ${e?.message || e}`);
      });
    }

    return { received: true, incidentId: incident.id, id: incident.id };
  }

  // Classe l'erreur (déterministe, sans LLM) et déclenche WF4 (Jenkinsfile) ou WF5 (Dockerfile)
  // uniquement pour ces deux types, en respectant la garde anti-boucle (table routed_builds).
  private async routeToOptimizer(projectId: string, incidentId: string, errorReason: string, branch?: string) {
    const classification = classify(errorReason);
    if (classification.type !== 'jenkinsfile' && classification.type !== 'dockerfile') return;

    const hash = createHash('sha256')
      .update(`${projectId}:${classification.type}:${errorReason}`)
      .digest('hex');
    const now = new Date();
    const activeMatch = await this.routedBuilds
      .createQueryBuilder('rb')
      .where('rb.hash = :hash', { hash })
      .andWhere('rb.expiresAt > :now', { now })
      .orderBy('rb.routedAt', 'DESC')
      .getOne();
    if (activeMatch) {
      console.log(`[webhooks] routage auto ignoré pour incident ${incidentId} : hash déjà routé le ${activeMatch.routedAt.toISOString()} (expire ${activeMatch.expiresAt.toISOString()})`);
      return;
    }

    const project = await this.projects.findOne(projectId);
    const githubRepo = String(project?.githubRepo || '').replace('https://github.com/', '');
    const [owner, repo] = githubRepo.split('/');
    if (!owner || !repo) {
      console.warn(`[webhooks] routage auto impossible pour incident ${incidentId} : dépôt GitHub non configuré sur le projet`);
      return;
    }

    if (classification.type === 'jenkinsfile') {
      const fetchRes = await fetch(`${SELF_API_URL}/jenkins/fetch`, {
        method: 'POST',
        headers: INTERNAL_HEADERS(),
        body: JSON.stringify({ owner, repo, filePath: 'Jenkinsfile', ref: branch || undefined }),
        signal: AbortSignal.timeout(30000),
      });
      const fetchData = await fetchRes.json();
      if (!fetchData?.jenkinsfile) {
        console.warn(`[webhooks] routage auto WF4 : Jenkinsfile introuvable pour incident ${incidentId}`);
        return;
      }
      await fetch(`${SELF_API_URL}/jenkins/optimize`, {
        method: 'POST',
        headers: INTERNAL_HEADERS(),
        body: JSON.stringify({
          projectId, projectName: project?.name, jenkinsfile: fetchData.jenkinsfile, buildError: errorReason,
        }),
        signal: AbortSignal.timeout(30000),
      });
      await this.markRouted(hash, projectId, classification.type, errorReason);
      console.log(`[webhooks] routage auto WF4 déclenché pour incident ${incidentId}`);
      return;
    }
    await fetch(`${SELF_API_URL}/dockerfile/optimize`, {
      method: 'POST',
      headers: INTERNAL_HEADERS(),
      body: JSON.stringify({ owner, repo, projectId, projectName: project?.name, buildError: errorReason, ref: branch || undefined }),
      signal: AbortSignal.timeout(30000),
    });
    await this.markRouted(hash, projectId, classification.type, errorReason);
    console.log(`[webhooks] routage auto WF5 déclenché pour incident ${incidentId}`);
  }

  // Enregistre un échec comme "routé" (avec expiration), seulement après que l'appel d'optimisation a
  // réussi à partir — un appel qui échoue n'est jamais marqué, pour laisser un vrai retry possible.
  private async markRouted(hash: string, projectId: string, classificationType: string, errorReason: string) {
    const routedAt = new Date();
    const expiresAt = new Date(routedAt.getTime() + ROUTED_BUILD_TTL_MS);
    await this.routedBuilds.save(
      this.routedBuilds.create({ hash, projectId, classificationType, errorReason, expiresAt }),
    );
  }

  // Convertit chaque vulnérabilité Trivy critique/haute du payload (limité à 10) en bug.
  async handleTrivy(projectId: string, payload: any) {
    const vulns = payload?.Results?.flatMap((r: any) => r.Vulnerabilities || []) || [];
    for (const v of vulns.filter((v: any) => ['CRITICAL', 'HIGH'].includes(v.Severity)).slice(0, 10)) {
      await this.bugs.create({
        projectId,
        title: `${v.VulnerabilityID}: ${v.Title || v.PkgName}`,
        rawMessage: v.Description,
        ruleId: v.VulnerabilityID,
        severity: v.Severity === 'CRITICAL' ? BugSeverity.CRITICAL : BugSeverity.HIGH,
        source: BugSource.TRIVY,
        metadata: v,
      });
    }
    return { processed: vulns.length };
  }

  // Convertit une sévérité SonarQube (BLOCKER/CRITICAL/MAJOR/MINOR) en sévérité interne BugSeverity.
  private mapSonarSeverity(s: string): BugSeverity {
    const map: any = { BLOCKER: BugSeverity.CRITICAL, CRITICAL: BugSeverity.HIGH, MAJOR: BugSeverity.MEDIUM, MINOR: BugSeverity.LOW };
    return map[s] || BugSeverity.LOW;
  }
}
