/** Adaptateur de test : simule une transaction TypeORM pour réutiliser les fixtures de régression existantes sans vraie base. */
import { targetReservationTestQuery } from './target-reservation-test-query';
import { Project } from '../projects/project.entity';
/** Branche un faux `manager.transaction()` sur un repository de test, pour réutiliser les fixtures de régression existantes sans vraie transaction TypeORM. */
export function attachLifecycleTestTransaction(repo: any, projectRepo?: any) {
  const query = targetReservationTestQuery();
  repo.manager = { 
  /** Exécute les opérations dans le cadre transactionnel prévu. */
  transaction: async (fn: any) => fn({ query, 
  /** Renvoie le dépôt. */
  getRepository: (entity: any) => entity === Project
    ? projectRepo || { 
    /** Recherche l’élément correspondant à l’identifiant. */
    findOne: async ({where}: any) => ({id:where.id}) } : repo }) };
}
