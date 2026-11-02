/** Modèle de provenance d'une dépendance Maven : d'où vient réellement sa version effective (déclaration directe, propriété, BOM, parent, transitive...). */
export type DependencyProvenanceKind =
  | 'DIRECT_EXPLICIT'
  | 'PROPERTY_MANAGED'
  | 'BOM_MANAGED'
  | 'TRANSITIVE'
  | 'PLUGIN'
  | 'UNRESOLVED'
  | 'PARENT_MANAGED';

export interface DependencyProvenance {
  ecosystem: 'MAVEN';
  kind: DependencyProvenanceKind;
  /** groupId:artifactId — la coordonnée Maven canonique, jamais un nom de fichier jar. */
  package: string;
  installedVersion: string;
  controllingFile: string | null;
  controllingElement: string | null;
  controllingProperty: string | null;
  /** SHA git complet (40 caractères) contre lequel la provenance a été résolue. */
  groundedSha: string;
  /** Trace lisible courte de la façon dont `kind` a été déterminé (ligne dependency:tree ou fragment pom.xml exact). */
  evidence: string;
}
