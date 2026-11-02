// Script (npm run seed:clean) qui supprime uniquement les projets de démonstration (source='demo') et, par cascade, leurs reports, incidents et bugs — ne touche jamais un projet réel.
import { seedDataSource } from './data-source';
import { Project } from '../projects/project.entity';
import { DEMO_SOURCE } from './seed-data';

/** Supprime tous les projets de démonstration trouvés en base, avec leurs lignes enfants en cascade. */
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
