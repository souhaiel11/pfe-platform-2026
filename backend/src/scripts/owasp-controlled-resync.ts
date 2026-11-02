// Regroupe les traitements de OWASP controlled resync.
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { Project } from '../projects/project.entity';
import { Incident } from '../incidents/incident.entity';
import { ManualRemediationTask } from '../manual-remediation/manual-remediation.entity';
import { ManualRemediationService } from '../manual-remediation/manual-remediation.service';

const INCIDENT_ID = 'a1cee307-dcca-49b4-a490-5d1fdfe55fb8';

const dataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5433', 10),
  username: process.env.DB_USER || 'devsecops',
  password: process.env.DB_PASS || 'devsecops123',
  database: process.env.DB_NAME || 'devsecops',
  entities: [Project, Incident, ManualRemediationTask],
  synchronize: false,
});

/** Point d'entrée du script : charge l'incident, rejoue syncIncident() dans une transaction, et ne commite que si --apply est passé. */
async function main() {
  const apply = process.argv.includes('--apply');
  await dataSource.initialize();

  const incidentRepo = dataSource.getRepository(Incident);
  const taskRepo = dataSource.getRepository(ManualRemediationTask);

  const incident = await incidentRepo.findOne({ where: { id: INCIDENT_ID } });
  if (!incident) {
    console.error(`Incident ${INCIDENT_ID} introuvable.`);
    await dataSource.destroy();
    process.exit(1);
  }

  const before = await taskRepo.find({ where: { projectId: incident.projectId, source: 'OWASP' } });
  console.log('══════════════════════════════════════════════════');
  console.log(`Incident      : ${incident.id} (build ${incident.buildNumber})`);
  console.log(`Project       : ${incident.projectId}`);
  console.log(`OWASP tasks before : ${before.length}`);
  console.log(`Mode          : ${apply ? 'APPLY (writes committed)' : 'DRY-RUN (transaction rolled back)'}`);
  console.log('──────────────────────────────────────────────────');

  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const scopedTaskRepo = runner.manager.getRepository(ManualRemediationTask);
    const scopedIncidentRepo = runner.manager.getRepository(Incident);
    const service = new ManualRemediationService(scopedTaskRepo as any, scopedIncidentRepo as any, {
      /** Transmet la demande au service chargé de l’exécuter. */
      dispatch: async () => { throw new Error('WF6 must never be dispatched by this resync script'); },
    } as any);

    await service.syncIncident(incident);

    const after = await scopedTaskRepo.find({ where: { projectId: incident.projectId, source: 'OWASP' } });
    console.log(`OWASP tasks after  : ${after.length}`);

    const mavenIdentity = after.filter(t => /^[A-Za-z0-9_.-]+:[A-Za-z0-9_.-]+$/.test(String(t.findingSnapshot?.component || ''))).length;
    const legacyPreserved = after.filter(t => !!t.findingSnapshot?.legacyPackage).length;
    const installedResolved = after.filter(t => !!t.findingSnapshot?.installedVersion).length;
    const withTarget = after.filter(t => !!t.findingSnapshot?.fixedVersion).length;
    const multi = after.filter(t => !t.findingSnapshot?.fixedVersion && t.findingSnapshot?.fixedVersionUnavailableReason === 'MULTIPLE_CANDIDATES').length;
    const noMatch = after.filter(t => !t.findingSnapshot?.fixedVersion && t.findingSnapshot?.fixedVersionUnavailableReason === 'NO_TRIVY_MATCH').length;
    const closedAfter = after.find(t => t.findingSnapshot?.ruleOrCve === 'CVE-2022-25857');

    console.log(`MAVEN_IDENTITY     : ${mavenIdentity}/${after.length}`);
    console.log(`LEGACY_PACKAGE     : ${legacyPreserved}/${after.length}`);
    console.log(`INSTALLED_VERSION  : ${installedResolved}/${after.length}`);
    console.log(`FIXED_VERSION      : ${withTarget}/${after.length}`);
    console.log(`MULTIPLE_CANDIDATES: ${multi}`);
    console.log(`NO_TRIVY_MATCH     : ${noMatch}`);
    console.log(`CVE-2022-25857 status=${closedAfter?.securityFindingRemediation?.status} pr=${closedAfter?.securityFindingRemediation?.prNumber} component=${closedAfter?.findingSnapshot?.component} fixedVersion=${closedAfter?.findingSnapshot?.fixedVersion}`);

    const idsBefore = before.map(t => t.id).sort();
    const idsAfter = after.map(t => t.id).sort();
    console.log(`TASK_IDS_PRESERVED : ${JSON.stringify(idsBefore) === JSON.stringify(idsAfter)} (${idsAfter.length}/${idsBefore.length})`);

    if (apply) {
      await runner.commitTransaction();
      console.log('\n✅ APPLIED — transaction committed.');
    } else {
      await runner.rollbackTransaction();
      console.log('\nDRY-RUN — transaction rolled back, nothing written. Re-run with --apply to commit.');
    }
  } catch (err) {
    await runner.rollbackTransaction();
    throw err;
  } finally {
    await runner.release();
    await dataSource.destroy();
  }
}

main().catch(async (err) => {
  console.error(err);
  process.exit(1);
});
