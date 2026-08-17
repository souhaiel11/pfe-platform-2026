// Backfill ponctuel — recalcule Report.securityScore/riskLevel pour TOUS les
// reports existants avec le calcul déterministe (calculateSecurityScore sur
// normalizeReport(rawData)), pour remplacer les anciennes valeurs LLM
// (dto.securityScore/riskLevel) écrites avant ce fix. Met aussi à jour
// Project.securityScore/status depuis le dernier report "combined" de
// chaque projet, comme le fait reports.service.ts::create().
//
// Dry-run par défaut. Écriture réelle avec --apply.
//   npx ts-node src/scripts/recalculate-security-scores.ts           (dry-run)
//   npx ts-node src/scripts/recalculate-security-scores.ts --apply   (écrit en base)
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { Project } from '../projects/project.entity';
import { Report } from '../reports/report.entity';
import { normalizeReport } from '../common/report-normalizer';
import { calculateSecurityScore, getRiskLevel } from '../common/security-score';

const dataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5433', 10),
  username: process.env.DB_USER || 'devsecops',
  password: process.env.DB_PASS || 'devsecops123',
  database: process.env.DB_NAME || 'devsecops',
  entities: [Project, Report],
  synchronize: false,
});

function statusFor(score: number, incomplete = false): string {
  if (incomplete) return 'warning';
  return score >= 80 ? 'healthy' : score >= 40 ? 'warning' : 'critical';
}

async function main() {
  const apply = process.argv.includes('--apply');

  await dataSource.initialize();
  const projectRepo = dataSource.getRepository(Project);
  const reportRepo = dataSource.getRepository(Report);

  const reports = await reportRepo.find({ order: { createdAt: 'DESC' } });

  console.log('══════════════════════════════════════════════════');
  console.log(`${reports.length} report(s) trouvé(s).`);
  console.log('──────────────────────────────────────────────────');

  const latestCombinedByProject = new Map<string, Report & { _incomplete?: boolean }>();

  for (const report of reports) {
    const normalized = normalizeReport(report.rawData);
    const { score: newScore, incomplete, missingScanners } = calculateSecurityScore(normalized);
    const newRiskLevel = getRiskLevel(newScore, incomplete);

    console.log(
      `${report.id.slice(0, 8)} | ${report.type.padEnd(9)} | ${report.createdAt.toISOString().slice(0, 10)} | ` +
      `score ${report.securityScore} → ${newScore} | riskLevel ${report.riskLevel} → ${newRiskLevel}` +
      (incomplete ? ` | INCOMPLET (${missingScanners.join(',')})` : '')
    );

    if (apply) {
      await reportRepo.update(report.id, { securityScore: newScore, riskLevel: newRiskLevel });
    }

    if (report.type === 'combined' && !latestCombinedByProject.has(report.projectId)) {
      latestCombinedByProject.set(report.projectId, { ...report, securityScore: newScore, _incomplete: incomplete } as any);
    }
  }

  console.log('──────────────────────────────────────────────────');
  console.log('Projets (score/status depuis leur dernier report combined) :');
  for (const [projectId, report] of latestCombinedByProject) {
    const project = await projectRepo.findOne({ where: { id: projectId } });
    if (!project) continue;
    const newStatus = statusFor(report.securityScore, report._incomplete);
    console.log(
      `${project.name.padEnd(20)} | securityScore ${project.securityScore} → ${report.securityScore} | status ${project.status} → ${newStatus}`
    );
    if (apply) {
      await projectRepo.update(projectId, { securityScore: report.securityScore, status: newStatus as any });
    }
  }

  console.log('══════════════════════════════════════════════════');
  if (!apply) {
    console.log("\nDRY-RUN — rien n'a été écrit en base. Relancer avec --apply pour appliquer.");
  } else {
    console.log('\n✅ Appliqué en base.');
  }

  await dataSource.destroy();
}

main().catch(async (err) => {
  console.error(err);
  await dataSource.destroy();
  process.exit(1);
});
