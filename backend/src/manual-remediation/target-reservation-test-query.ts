/** Faux exécuteur SQL en mémoire imitant juste assez `remediation_target_reservations` pour les anciens tests unitaires. */
/** Simule les requêtes de réservation de cible pour les tests. */
/** Simule les requêtes de réservation de cible pour les tests. */
export function targetReservationTestQuery() {
  const rows = new Map<string, any>();
  return async (sql: string, args: any[] = []) => {
    if (sql.includes('INSERT INTO remediation_target_reservations')) {
      const [id, projectId, targetKey, targetFile, ownerTaskId, claims] = args;
      if (!rows.has(projectId + targetKey)) rows.set(projectId + targetKey, { id, projectId, targetKey, targetFile, ownerTaskId, claims: JSON.parse(claims) });
    }
    if (sql.includes('SELECT * FROM remediation_target_reservations')) return [rows.get(args[0] + args[1])].filter(Boolean);
    return [];
  };
}
