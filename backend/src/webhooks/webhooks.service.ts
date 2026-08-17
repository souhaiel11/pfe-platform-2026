// webhooks.service.ts
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

// Base même processus — appel interne backend->backend (jamais franchit le
// réseau Docker), pas de dépendance à N8N_URL ni à un hostname de conteneur.
const SELF_API_URL = process.env.SELF_API_URL || 'http://localhost:3001/api';

// TTL de la garde anti-boucle (routed_builds) : un même échec (même projet,
// même type, même errorReason) ne re-déclenche pas WF4/WF5 pendant cette
// fenêtre. 24h par défaut — assez long pour absorber une rafale de rebuilds
// identiques (ex: les ~10 builds ZAP de ce soir), pas assez pour bloquer
// indéfiniment un échec qui persiste sur plusieurs jours.
const ROUTED_BUILD_TTL_MS = Number(process.env.ROUTED_BUILD_TTL_MS) || 24 * 60 * 60 * 1000;

@Injectable()
export class WebhooksService {
  constructor(
    private readonly bugs: BugsService,
    private readonly incidents: IncidentsService,
    private readonly projects: ProjectsService,
    private readonly jwt: JwtService,
    @InjectRepository(RoutedBuild) private readonly routedBuilds: Repository<RoutedBuild>,
  ) {}

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

  async handleJenkins(projectId: string, payload: any) {
    // Créer un incident pour tout payload Jenkins valide
    const buildNumber = payload?.build_number || payload?.build?.number || payload?.buildNumber || null;
    const buildStatus = payload?.status || payload?.build?.status || 'UNKNOWN';
    const jobName     = payload?.job || payload?.jenkinsJobName || null;
    const title       = payload?.title
                      || (jobName ? `Jenkins Build #${buildNumber}: ${buildStatus}` : 'Jenkins Build');

    // Pas de valeur SUCCESS/UNSTABLE dédiée dans IncidentStatus : un build vert
    // -> COMPLETED (rien à traiter), tout le reste (FAILURE/UNSTABLE/ABORTED/
    // inconnu) -> FAILED, ça mérite un regard même si "unstable" n'est pas un
    // arrêt dur.
    const incidentStatus = String(buildStatus).toUpperCase() === 'SUCCESS'
      ? IncidentStatus.COMPLETED
      : IncidentStatus.FAILED;

    const buildUrl = payload?.build_url || payload?.build?.url || payload?.metadata?.buildUrl || '';

    // Le message d'erreur venant du Jenkinsfile (payload.error_message) ne
    // peut jamais contenir le vrai texte d'un échec de step sh (Jenkins ne
    // capture que "script returned exit code N" à ce niveau — voir
    // diagnostic). Sur un build FAILURE, on va chercher la vraie cause dans
    // le log console lui-même. Fail-safe : un fetch raté ne bloque jamais la
    // création de l'incident, juste un warning + repli sur error_message.
    let errorReason: string | null = payload?.error_message || null;
    if (String(buildStatus).toUpperCase() === 'FAILURE' && buildUrl) {
      try {
        const res = await fetch(`${buildUrl}consoleText`, { signal: AbortSignal.timeout(15000) });
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

    // Routage automatique WF4/WF5 — fire-and-forget : ne DOIT jamais retarder
    // ni faire échouer la réponse au webhook Jenkins (voir catch ci-dessous).
    // Le seul appel LLM impliqué est celui de WF4/WF5 eux-mêmes ; classify()
    // et la garde anti-boucle (voir routeToOptimizer) sont 100% déterministes.
    if (incidentStatus === IncidentStatus.FAILED && errorReason) {
      // jobName Jenkins multibranche = "<job>/<branche>" (ex:
      // "vuln-testapp/ci/ma-branche") — tout ce qui suit le 1er segment est
      // la branche réelle. Sans ça, fetch() retomberait toujours sur 'main'
      // par défaut et ne reproduirait jamais un bug qui n'existe que sur la
      // branche qui a réellement échoué.
      const branch = jobName && jobName.includes('/') ? jobName.split('/').slice(1).join('/') : undefined;
      this.routeToOptimizer(projectId, incident.id, errorReason, branch).catch((e: any) => {
        console.warn(`[webhooks] routage auto WF4/WF5 échoué pour incident ${incident.id} : ${e?.message || e}`);
      });
    }

    return { received: true, incidentId: incident.id, id: incident.id };
  }

  // Routage automatique déterministe (classify(), zéro LLM pour DÉCIDER) vers
  // WF4/WF5 — le seul "penseur" LLM reste WF4/WF5 eux-mêmes, jamais ce
  // routeur. GARDE-FOU CRITIQUE : uniquement 'jenkinsfile'/'dockerfile'
  // déclenchent quelque chose ; 'vulnerability'/'code'/'infra'/'unknown' ne
  // déclenchent JAMAIS rien automatiquement — l'incident reste en attente
  // d'une analyse WF1 à la demande (bloc suivant), jamais d'auto-fix sur une
  // vraie vulnérabilité ou un problème hors du périmètre Jenkinsfile/Dockerfile.
  private async routeToOptimizer(projectId: string, incidentId: string, errorReason: string, branch?: string) {
    const classification = classify(errorReason);
    if (classification.type !== 'jenkinsfile' && classification.type !== 'dockerfile') return;

    // Garde anti-boucle : hash(projectId + type + errorReason) + TTL, table
    // routed_builds — se souvient de TOUT hash déjà routé (pas seulement le
    // dernier incident), donc insensible à ce qui s'est passé entre deux
    // occurrences du même échec (ex: les ~10 builds ZAP identiques de ce
    // soir, entrecoupés d'autres tests). TTL = ROUTED_BUILD_TTL_MS, pour ne
    // pas bloquer indéfiniment un échec qui persiste sur plusieurs jours.
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
      // WF4 : /jenkins/optimize a besoin du contenu, pas seulement du
      // chemin — un fetch préalable est requis (WF4 ne le fait pas lui-même,
      // contrairement à WF5). Pas de JwtAuthGuard sur cette route (voir
      // jenkins-optimizer.module.ts, non modifié) — aucun token nécessaire.
      const fetchRes = await fetch(`${SELF_API_URL}/jenkins/fetch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId, projectName: project?.name, jenkinsfile: fetchData.jenkinsfile, buildError: errorReason,
        }),
        signal: AbortSignal.timeout(30000),
      });
      await this.markRouted(hash, projectId, classification.type, errorReason);
      console.log(`[webhooks] routage auto WF4 déclenché pour incident ${incidentId}`);
      return;
    }

    // classification.type === 'dockerfile' — WF5 fetch le Dockerfile
    // lui-même côté backend, un seul appel suffit. /dockerfile/optimize est
    // protégé par JwtAuthGuard (voir dockerfile-optimizer.module.ts, non
    // modifié) : un appel serveur->serveur n'a pas de session à réutiliser,
    // on signe un token de service à la volée (même secret que AuthModule,
    // voir webhooks.module.ts) plutôt que de toucher WF5.
    const internalToken = this.jwt.sign({
      sub: 'internal-webhook-router', email: 'internal-router@devsecops.local', role: 'admin',
    });
    await fetch(`${SELF_API_URL}/dockerfile/optimize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${internalToken}` },
      body: JSON.stringify({ owner, repo, projectId, projectName: project?.name, buildError: errorReason, ref: branch || undefined }),
      signal: AbortSignal.timeout(30000),
    });
    await this.markRouted(hash, projectId, classification.type, errorReason);
    console.log(`[webhooks] routage auto WF5 déclenché pour incident ${incidentId}`);
  }

  // Écrit la ligne routed_builds APRÈS que l'appel optimize() ait réussi à
  // partir (pas avant) : si le fetch/optimize échoue (repo introuvable,
  // n8n injoignable), on ne marque rien comme "routé" — un vrai retry sur
  // le prochain rebuild reste possible plutôt qu'un faux blocage silencieux.
  private async markRouted(hash: string, projectId: string, classificationType: string, errorReason: string) {
    const routedAt = new Date();
    const expiresAt = new Date(routedAt.getTime() + ROUTED_BUILD_TTL_MS);
    await this.routedBuilds.save(
      this.routedBuilds.create({ hash, projectId, classificationType, errorReason, expiresAt }),
    );
  }

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

  private mapSonarSeverity(s: string): BugSeverity {
    const map: any = { BLOCKER: BugSeverity.CRITICAL, CRITICAL: BugSeverity.HIGH, MAJOR: BugSeverity.MEDIUM, MINOR: BugSeverity.LOW };
    return map[s] || BugSeverity.LOW;
  }
}
