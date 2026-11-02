// Script (npm run seed) qui crée ou met à jour les projets de démonstration et leurs reports/incidents/bugs, de façon idempotente et isolée aux projets source='demo'.
import { seedDataSource } from './data-source';
import { Project } from '../projects/project.entity';
import { Incident, IncidentStatus } from '../incidents/incident.entity';
import { Report, ReportType } from '../reports/report.entity';
import { Bug, BugStatus, BugSource } from '../bugs/bug.entity';
import { DEMO_PROJECTS, DEMO_SOURCE, DEMO_CICD_TOOL, buildEnrichedData, riskLevelFor, DemoProjectDef } from './seed-data';
import { hashSeed, mulberry32 } from './rng';

const DAY_MS = 24 * 60 * 60 * 1000;

const BUG_STATUS_CYCLE = [BugStatus.OPEN, BugStatus.OPEN, BugStatus.AI_FIXING, BugStatus.PR_CREATED, BugStatus.RESOLVED, BugStatus.IGNORED];

/** Crée le projet de démonstration s'il n'existe pas encore (par jenkinsJobName), sinon met à jour ses champs. */
async function upsertProject(repo: import('typeorm').Repository<Project>, def: DemoProjectDef): Promise<Project> {
  let project = await repo.findOne({ where: { jenkinsJobName: def.jenkinsJobName } });
  const fields: Partial<Project> = {
    name: def.name,
    description: def.description,
    environment: def.environment,
    status: def.status,
    securityScore: def.securityScore,
    isActive: true,
    cicdTool: DEMO_CICD_TOOL,
    jenkinsJobName: def.jenkinsJobName,
    jenkinsUrl: null,
    jenkinsToken: null,
    source: DEMO_SOURCE,
  };
  if (project) {
    Object.assign(project, fields);
  } else {
    project = repo.create(fields);
  }
  return repo.save(project);
}

/** Construit les 3 reports de démonstration du projet (actuel + 2 historiques, mêmes chiffres, dates espacées de 7 jours). */
function seedReports(def: DemoProjectDef, project: Project): Partial<Report>[] {
  const now = Date.now();
  const riskLevel = riskLevelFor(def.securityScore);
  return [0, 1, 2].map(i => {
    const createdAt = new Date(now - i * 7 * DAY_MS);
    const buildNumber = def.build.number - i;
    const buildUrl = `http://jenkins.demo.local/job/${def.jenkinsJobName}/${buildNumber}/`;
    return {
      projectId: project.id,
      project,
      type: ReportType.COMBINED,
      rawData: { enrichedData: buildEnrichedData(def, buildNumber, createdAt.getTime(), buildUrl) },
      aiSummary: `Rapport combiné ${def.name} — score sécurité ${def.securityScore}/100 (${riskLevel}). ${def.trivyCves.length + def.owaspCves.length} CVE, ${def.sonar.bugs} bug(s) SonarQube.`,
      securityScore: def.securityScore,
      riskLevel,
      createdAt,
    } as any;
  });
}

/** Construit les incidents de démonstration du projet, répartis sur les ~35 derniers jours selon le PRNG fourni. */
function seedIncidents(def: DemoProjectDef, project: Project, rng: () => number): Partial<Incident>[] {
  const now = Date.now();
  const buckets: { status: IncidentStatus; titles: string[] }[] = [
    { status: IncidentStatus.PENDING, titles: def.incidentTitles.open },
    { status: IncidentStatus.ANALYZING, titles: def.incidentTitles.analyzing },
    { status: IncidentStatus.COMPLETED, titles: def.incidentTitles.resolved },
  ];

  const rows: Partial<Incident>[] = [];
  for (const bucket of buckets) {
    for (const title of bucket.titles) {
      const createdAt = new Date(now - Math.floor(rng() * 35) * DAY_MS - Math.floor(rng() * DAY_MS));
      let resolvedAt: Date | null = null;
      if (bucket.status === IncidentStatus.COMPLETED) {
        const resolutionMs = (2 * 60 * 60 * 1000) + Math.floor(rng() * (5 * DAY_MS - 2 * 60 * 60 * 1000));
        resolvedAt = new Date(Math.min(now, createdAt.getTime() + resolutionMs));
      }
      rows.push({
        projectId: project.id,
        project,
        title,
        status: bucket.status,
        source: DEMO_SOURCE,
        jenkinsJobName: def.jenkinsJobName,
        createdAt,
        resolvedAt,
      } as any);
    }
  }
  return rows;
}

/** Construit les bugs SonarQube de démonstration du projet, en recyclant les modèles de bug si leur nombre dépasse le pool. */
function seedBugs(def: DemoProjectDef, project: Project): Partial<Bug>[] {
  const rows: Partial<Bug>[] = [];
  for (let i = 0; i < def.sonar.bugs; i++) {
    const tpl = def.bugTemplates[i % def.bugTemplates.length];
    const pass = Math.floor(i / def.bugTemplates.length);
    rows.push({
      projectId: project.id,
      project,
      title: tpl.title,
      rawMessage: `${tpl.title} (${tpl.filePath}:${tpl.line + pass * 3})`,
      filePath: tpl.filePath,
      lineNumber: tpl.line + pass * 3,
      severity: tpl.severity,
      status: BUG_STATUS_CYCLE[i % BUG_STATUS_CYCLE.length],
      source: BugSource.SONARQUBE,
    } as any);
  }
  return rows;
}

/** Point d'entrée du script : upsert chaque projet de démonstration puis recrée ses reports/incidents/bugs. */
async function main() {
  await seedDataSource.initialize();
  const projectRepo = seedDataSource.getRepository(Project);
  const reportRepo = seedDataSource.getRepository(Report);
  const incidentRepo = seedDataSource.getRepository(Incident);
  const bugRepo = seedDataSource.getRepository(Bug);

  console.log(`Seed démo — ${DEMO_PROJECTS.length} projets (source='${DEMO_SOURCE}')\n`);

  for (const def of DEMO_PROJECTS) {
    const project = await upsertProject(projectRepo, def);

    await reportRepo.delete({ projectId: project.id });
    await incidentRepo.delete({ projectId: project.id });
    await bugRepo.delete({ projectId: project.id });

    const rng = mulberry32(hashSeed(project.jenkinsJobName));

    const reports = seedReports(def, project);
    await reportRepo.save(reportRepo.create(reports));

    const incidents = seedIncidents(def, project, rng);
    await incidentRepo.save(incidentRepo.create(incidents));

    const bugs = seedBugs(def, project);
    await bugRepo.save(bugRepo.create(bugs));

    const trivyTotal = def.trivyCves.length, owaspTotal = def.owaspCves.length;
    console.log(
      `✓ ${def.name.padEnd(22)} status=${project.status.padEnd(8)} score=${def.securityScore}  ` +
      `reports=${reports.length} incidents=${incidents.length} (${def.incidents.open}o/${def.incidents.analyzing}a/${def.incidents.resolved}r) ` +
      `bugs=${bugs.length}  cves=trivy:${trivyTotal}+owasp:${owaspTotal}=${trivyTotal + owaspTotal}`,
    );
  }

  console.log('\nTerminé.');
  await seedDataSource.destroy();
}

main().catch(async (err) => {
  console.error('Échec du seed :', err);
  if (seedDataSource.isInitialized) await seedDataSource.destroy();
  process.exit(1);
});
