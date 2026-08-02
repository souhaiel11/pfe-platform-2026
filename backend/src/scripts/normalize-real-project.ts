// Script ponctuel et réversible — normalise le report "combined" le plus récent
// de pfe-app-test (projet RÉEL) au format enrichedData v2.1, et réaligne les
// scores de sécurité incohérents (riskScore 92 alors que riskLevel=CRITICAL,
// safeToApply=false, 23 CVE critiques OWASP).
//
// Ne touche à AUCUNE autre donnée du projet : le JSON legacy existant
// (security/rootCause/remediation) est conservé tel quel, enrichedData est
// simplement ajouté à côté. Toutes les valeurs numériques ci-dessous sont
// recopiées depuis le report legacy existant ou lues en direct depuis
// l'API SonarQube (voir champ `note`) — aucune n'est inventée.
//
// Dry-run par défaut (affiche ce qui serait écrit). Écriture réelle avec --apply.
//   npx ts-node src/scripts/normalize-real-project.ts           (dry-run)
//   npx ts-node src/scripts/normalize-real-project.ts --apply   (écrit en base)
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { Project } from '../projects/project.entity';
import { Report } from '../reports/report.entity';

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

const PROJECT_NAME = 'pfe-app-test';

// ── Nouveau score, cohérent avec le risque réel (0 crit/10 high Trivy,
// 23 crit/58 high OWASP, quality gate ERROR) → CRITICAL (< 40). ──
const NEW_SCORE = 35;
const NEW_RISK_LEVEL = 'CRITICAL';
const NEW_STATUS = 'critical';

function buildEnrichedData() {
  return {
    note:
      "Normalisation v2.1 — trivy.critical/high (0/10) et owasp.critical/high (23/58) " +
      "sont les valeurs réelles lues dans securitySummary du report legacy. " +
      "Les tableaux cves[] ne listent QU'UN ÉCHANTILLON des CVE explicitement " +
      "nommées dans ce report (4/10 pour Trivy, 8/81 pour OWASP) — ils sont " +
      "PARTIELS et ne doivent pas être utilisés pour recalculer critical/high. " +
      "Sévérité par CVE : déductible à 100% pour Trivy (critical=0 ⇒ tout est HIGH) ; " +
      "indicative (HIGH par défaut) pour OWASP, la source ne détaillant pas la " +
      "répartition critique/élevé par CVE individuelle — seuls les totaux 23/58 sont garantis exacts. " +
      "sonar.bugs vérifié en direct via l'API SonarQube (composant 'pfe-app-test') le jour de la normalisation.",

    sonar: {
      quality_gate: 'ERROR',
      bugs: 0, // confirmé live via GET /api/measures/component (SonarQube)
      vulnerabilities: 2,
      code_smells: 16,
      coverage: 0,
      issues: [
        {
          severity: 'CRITICAL',
          type: 'VULNERABILITY',
          message: 'Persistent entity exposed in REST controller (java:S4684)',
          component: 'src/main/java/com/pfe/devsecops/controller/TaskController.java',
          line: 36,
        },
        {
          severity: 'CRITICAL',
          type: 'VULNERABILITY',
          message: 'Persistent entity exposed in REST controller (java:S4684)',
          component: 'src/main/java/com/pfe/devsecops/controller/TaskController.java',
          line: 41,
        },
      ],
    },

    trivy: {
      critical: 0,
      high: 10,
      cves_count: 10,
      cves: [
        { id: 'CVE-2026-56131', severity: 'HIGH', pkg: 'libexpat', installedVersion: null, fixedVersion: null, title: 'libexpat handler call depth tracking vulnerability', primaryUrl: 'https://nvd.nist.gov/vuln/detail/CVE-2026-56131', cvss: null, source: 'TRIVY' },
        { id: 'CVE-2026-56407', severity: 'HIGH', pkg: 'libexpat', installedVersion: null, fixedVersion: null, title: 'libexpat integer overflow in doProlog', primaryUrl: 'https://nvd.nist.gov/vuln/detail/CVE-2026-56407', cvss: null, source: 'TRIVY' },
        { id: 'CVE-2026-56408', severity: 'HIGH', pkg: 'libexpat', installedVersion: null, fixedVersion: null, title: 'libexpat integer overflow in copyString', primaryUrl: 'https://nvd.nist.gov/vuln/detail/CVE-2026-56408', cvss: null, source: 'TRIVY' },
        { id: 'CVE-2026-2100', severity: 'HIGH', pkg: 'p11-kit', installedVersion: null, fixedVersion: null, title: 'p11-kit NULL dereference via C_DeriveKey', primaryUrl: 'https://nvd.nist.gov/vuln/detail/CVE-2026-2100', cvss: null, source: 'TRIVY' },
      ],
    },

    owasp: {
      critical: 23,
      high: 58,
      cves_count: 81,
      cves: [
        { id: 'CVE-2023-6378', severity: 'HIGH', pkg: 'logback', installedVersion: null, fixedVersion: null, title: 'logback serialization vulnerability', primaryUrl: 'https://nvd.nist.gov/vuln/detail/CVE-2023-6378', cvss: null, source: 'OWASP' },
        { id: 'CVE-2025-52999', severity: 'HIGH', pkg: 'jackson-core', installedVersion: null, fixedVersion: null, title: 'jackson-core StackoverflowError potential', primaryUrl: 'https://nvd.nist.gov/vuln/detail/CVE-2025-52999', cvss: null, source: 'OWASP' },
        { id: 'GHSA-r7wm-3cxj-wff9', severity: 'HIGH', pkg: 'jackson-core', installedVersion: null, fixedVersion: null, title: 'jackson-core async parser maxNumberLength bypass', primaryUrl: 'https://github.com/advisories/GHSA-r7wm-3cxj-wff9', cvss: null, source: 'OWASP' },
        { id: 'CVE-2022-42003', severity: 'HIGH', pkg: 'jackson-databind', installedVersion: null, fixedVersion: null, title: 'jackson-databind deep wrapper array nesting', primaryUrl: 'https://nvd.nist.gov/vuln/detail/CVE-2022-42003', cvss: null, source: 'OWASP' },
        { id: 'CVE-2022-42004', severity: 'HIGH', pkg: 'jackson-databind', installedVersion: null, fixedVersion: null, title: 'jackson-databind resource exhaustion', primaryUrl: 'https://nvd.nist.gov/vuln/detail/CVE-2022-42004', cvss: null, source: 'OWASP' },
        { id: 'CVE-2022-45868', severity: 'HIGH', pkg: 'H2 Database', installedVersion: null, fixedVersion: null, title: 'H2 Database web console vulnerability', primaryUrl: 'https://nvd.nist.gov/vuln/detail/CVE-2022-45868', cvss: null, source: 'OWASP' },
        { id: 'CVE-2026-54512', severity: 'HIGH', pkg: 'jackson-databind', installedVersion: null, fixedVersion: null, title: 'jackson-databind general-purpose data-binding flaw', primaryUrl: 'https://nvd.nist.gov/vuln/detail/CVE-2026-54512', cvss: null, source: 'OWASP' },
        { id: 'CVE-2026-54513', severity: 'HIGH', pkg: 'jackson-databind', installedVersion: null, fixedVersion: null, title: 'jackson-databind general-purpose data-binding flaw', primaryUrl: 'https://nvd.nist.gov/vuln/detail/CVE-2026-54513', cvss: null, source: 'OWASP' },
      ],
    },

    zap: { alerts_high: 0, alerts_medium: 0, alerts_count: 0 },
  };
}

async function main() {
  const apply = process.argv.includes('--apply');

  await dataSource.initialize();
  const projectRepo = dataSource.getRepository(Project);
  const reportRepo = dataSource.getRepository(Report);

  const project = await projectRepo.findOne({ where: { name: PROJECT_NAME } });
  if (!project) {
    console.error(`Projet "${PROJECT_NAME}" introuvable.`);
    await dataSource.destroy();
    process.exit(1);
  }

  const report = await reportRepo.findOne({
    where: { projectId: project.id, type: 'combined' as any },
    order: { createdAt: 'DESC' },
  });
  if (!report) {
    console.error(`Aucun report "combined" trouvé pour "${PROJECT_NAME}".`);
    await dataSource.destroy();
    process.exit(1);
  }

  const enrichedData = buildEnrichedData();
  const newRawData = { ...report.rawData, enrichedData };

  console.log('══════════════════════════════════════════════════');
  console.log(`Projet        : ${project.name} (${project.id})`);
  console.log(`Report visé   : ${report.id} (createdAt ${report.createdAt.toISOString()})`);
  console.log('──────────────────────────────────────────────────');
  console.log('enrichedData généré :');
  console.log(JSON.stringify(enrichedData, null, 2));
  console.log('──────────────────────────────────────────────────');
  console.log(`Project.securityScore : ${project.securityScore} → ${NEW_SCORE}`);
  console.log(`Project.status        : ${project.status} → ${NEW_STATUS}`);
  console.log(`Report.securityScore  : ${report.securityScore} → ${NEW_SCORE}`);
  console.log(`Report.riskLevel      : ${report.riskLevel} → ${NEW_RISK_LEVEL}`);
  console.log('(rawData.security.riskScore=92 dans le JSON legacy N\'EST PAS modifié — hors périmètre)');
  console.log('══════════════════════════════════════════════════');

  if (!apply) {
    console.log('\nDRY-RUN — rien n\'a été écrit en base. Relancer avec --apply pour appliquer.');
    await dataSource.destroy();
    return;
  }

  await reportRepo.update(report.id, {
    rawData: newRawData as any,
    securityScore: NEW_SCORE,
    riskLevel: NEW_RISK_LEVEL,
  });
  await projectRepo.update(project.id, {
    securityScore: NEW_SCORE,
    status: NEW_STATUS as any,
  });

  console.log('\n✅ Appliqué en base.');
  await dataSource.destroy();
}

main().catch(async (err) => {
  console.error(err);
  await dataSource.destroy();
  process.exit(1);
});
