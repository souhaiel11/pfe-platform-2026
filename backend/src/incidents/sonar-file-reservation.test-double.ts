// Doublure de test : `query` d'un EntityManager simulé dont la table des réservations de fichiers est vide.
// Les specs qui simulent la transaction d'approbation sans base réelle l'ajoutent à leur faux manager ;
// le comportement du verrou lui-même est couvert contre PostgreSQL par sonar-file-reservation.spec.ts.

/** Aucune réservation existante : chaque lecture voit une ligne libre, chaque écriture réussit. */
export const emptyReservationQuery = async (sql: string): Promise<any[]> =>
  /^\s*SELECT/i.test(sql) ? [{ id: 'reservation-test-double', claims: {} }] : [];
