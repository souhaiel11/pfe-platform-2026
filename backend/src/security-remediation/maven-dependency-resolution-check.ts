/** Vérifie, dans une sortie texte réelle de `mvn dependency:tree`, si une coordonnée Maven donnée est effectivement résolue à une version donnée. */

/** Échappe les caractères spéciaux d'une chaîne pour l'utiliser littéralement dans une expression régulière. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Vérifie, dans la sortie texte d'un vrai `mvn dependency:tree`, qu'une coordonnée groupId:artifactId est bien résolue à la version attendue. */
export function dependencyTreeResolvesTo(treeText: string, groupArtifact: string, version: string): boolean {
  if (!treeText || !groupArtifact || !version) return false;
  const pattern = new RegExp(`${escapeRegExp(groupArtifact)}:jar:${escapeRegExp(version)}(?:[:\\s]|$)`, 'm');
  return pattern.test(treeText);
}
