// Entité TypeORM : registre append-only prouvant qu'un digest d'artefact appartient à un commit/build précis.
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index, Unique } from 'typeorm';
import { ArtifactIdentitySource, ArtifactPublicationSource, PublicationFailureCode } from './publication-provenance';

export type DeploymentArtifactSource = 'JENKINS_PIPELINE' | 'MANUAL_REGISTERED' | 'UNKNOWN';

@Entity('deployment_artifacts')
@Unique('UQ_deployment_artifact_digest', ['registry', 'repository', 'digest'])
@Index('IDX_deployment_artifact_project_build', ['projectId', 'buildNumber'])
export class DeploymentArtifact {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  projectId: string;

  @Column()
  buildNumber: number;

  @Column()
  commitSha: string;

  @Column()
  registry: string;

  @Column()
  repository: string;

  @Column()
  tag: string;

  @Column()
  digest: string;

  @Column({ type: 'enum', enum: ['JENKINS_PIPELINE', 'MANUAL_REGISTERED', 'UNKNOWN'] })
  source: DeploymentArtifactSource;

  @Column({ type: 'enum', enum: ['PIPELINE_BUILT', 'UNKNOWN'], default: 'UNKNOWN' })
  artifactIdentitySource: ArtifactIdentitySource;

  @Column({ type: 'enum', enum: ['PIPELINE_VERIFIED', 'MANUAL_ATTESTED', 'UNKNOWN'], default: 'UNKNOWN' })
  publicationSource: ArtifactPublicationSource;

  @Column({ type: 'text', nullable: true })
  publicationEvidence: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  publicationFailureCode: PublicationFailureCode | null;

  @Column({ type: 'jsonb', nullable: true })
  publicationReceipt: Record<string, unknown> | null;

  @Column({ default: false })
  provenanceVerified: boolean;

  @Column({ type: 'text', nullable: true })
  provenanceEvidence: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
