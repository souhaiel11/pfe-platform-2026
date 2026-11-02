// Source unique du calcul de fiabilité des builds, partagée par l'onglet Jenkins d'un projet et le dashboard, pour qu'un même projet ne puisse jamais afficher deux taux différents.
export interface BuildLike {
  result?: string | null;
}

/** Calcule le taux de succès (%) sur une liste de builds, ou null si la liste est vide (jamais 0% inventé). */
export function computeBuildSuccessRate(builds: BuildLike[]): number | null {
  if (!builds || builds.length === 0) return null;
  const successCount = builds.filter(b => b.result === 'SUCCESS').length;
  return Math.round((successCount / builds.length) * 100);
}
