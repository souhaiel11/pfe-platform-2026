// Types de profil de contrôle de dépendance.

export type VersionControl =
  | 'DIRECT_EXPLICIT'
  | 'PROPERTY'
  | 'DEPENDENCY_MANAGEMENT'
  | 'IMPORTED_BOM'
  | 'PARENT'
  | 'TRANSITIVE_MANAGED'
  | 'UNKNOWN';

export interface DependencyControlProfile {
  groupId: string;
  artifactId: string;
  installedVersion: string;

  dependencyKind: 'DIRECT' | 'TRANSITIVE';
  versionControl: VersionControl;

  declarationPom: string | null;
  propertyName: string | null;
  managementOwner: string | null;
  managementOwnerVersion: string | null;

  bomGroupId: string | null;
  bomArtifactId: string | null;
  bomVersion: string | null;

  parentGroupId: string | null;
  parentArtifactId: string | null;
  parentVersion: string | null;

  javaVersion: string | null;
  springBootVersion: string | null;

  evidence: string[];
}
