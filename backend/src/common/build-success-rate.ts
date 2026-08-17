// Source unique du calcul de fiabilité des builds — utilisée par
// projects.service.ts::getJenkinsStatus() (onglet Jenkins) ET
// dashboard.service.ts::getJenkinsGlobal() (dashboard), pour qu'un même
// projet ne puisse jamais afficher deux taux différents. Jamais appelée sur
// des builds issus de getMockJenkinsStatus() (fabriqués) — voir _liveData
// dans getJenkinsStatus().
export interface BuildLike {
  result?: string | null;
}

// null si aucun build (jamais 0% inventé sur échantillon vide).
export function computeBuildSuccessRate(builds: BuildLike[]): number | null {
  if (!builds || builds.length === 0) return null;
  const successCount = builds.filter(b => b.result === 'SUCCESS').length;
  return Math.round((successCount / builds.length) * 100);
}
