// Définit les données persistées pour déploiement tentative.
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

export type DeploymentAttemptStatus = 'DISPATCHING' | 'DEPLOYED' | 'FAILED';

@Entity('deployment_attempts')
@Index('IDX_deployment_attempt_project', ['projectId'])
@Index('IDX_deployment_attempt_authorization', ['authorizationId'])
export class DeploymentAttempt {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Column() authorizationId: string;
  @Column() requestId: string;

  @Column() projectId: string;
  @Column({ nullable: true }) incidentId: string | null;
  @Column() mainBuildNumber: number;

  @Column() actorUserId: string;
  @Column() actorRole: string;

  @Column() commitSha: string;
  @Column() artifactDigest: string;
  @Column() registry: string;
  @Column() repository: string;
  @Column() environmentIdentityHash: string;

  @Column({ type: 'text' }) governanceDecision: string;
  @Column({ type: 'text' }) authorizationMode: string;
  @Column({ type: 'text', nullable: true }) reason: string | null;
  @Column({ type: 'jsonb' }) riskSnapshot: Record<string, any>;

  @Column({ type: 'enum', enum: ['DISPATCHING', 'DEPLOYED', 'FAILED'], default: 'DISPATCHING' })
  dispatchStatus: DeploymentAttemptStatus;
  @Column({ type: 'jsonb', nullable: true }) dispatchResult: Record<string, any> | null;

  @CreateDateColumn() createdAt: Date;
  @Column({ type: 'timestamp', nullable: true }) completedAt: Date | null;
}
