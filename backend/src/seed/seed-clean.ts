// Supprime UNIQUEMENT les projets de démo (source='demo') et, via CASCADE
// (onDelete: 'CASCADE' sur Report/Incident/Bug → Project), leurs reports,
// incidents et bugs. Ne touche jamais un projet dont source est null/autre
// (ex. pfe-app-test).
//
// Usage : npm run seed:clean   (depuis backend/)
import { seedDataSource } from './data-source';
import { Project } from '../projects/project.entity';
import { DEMO_SOURCE } from './seed-data';

async function main() {
  await seedDataSource.initialize();
  const projectRepo = seedDataSource.getRepository(Project);

  const demoProjects = await projectRepo.find({ where: { source: DEMO_SOURCE } });
  if (demoProjects.length === 0) {
    console.log(`Aucun projet source='${DEMO_SOURCE}' trouvé — rien à supprimer.`);
  } else {
    for (const p of demoProjects) {
      console.log(`✗ suppression ${p.name} (${p.id}) — cascade reports/incidents/bugs`);
    }
    await projectRepo.remove(demoProjects);
    console.log(`\n${demoProjects.length} projet(s) démo supprimé(s).`);
  }

  await seedDataSource.destroy();
}

main().catch(async (err) => {
  console.error('Échec du nettoyage :', err);
  if (seedDataSource.isInitialized) await seedDataSource.destroy();
  process.exit(1);
});
