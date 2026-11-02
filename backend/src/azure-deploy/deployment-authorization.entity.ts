// Définit les données persistées pour déploiement autorisation.
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

export type DeploymentAuthorizationMode = 'NORMAL' | 'CONDITIONAL_EXCEPTION' | 'CRITICAL_OVERRIDE';
export type DeploymentAuthorizationStatus = 'CREATED' | 'CONSUMED' | 'EXPIRED' | 'REVOKED';

@Entity('deployment_authorizations')
@Index('IDX_deployment_authorization_project_status', ['projectId', 'status'])
export class DeploymentAuthorization {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column() projectId: string;
  @Column({ nullable: true }) incidentId: string | null;
  @Column() mainBuildNumber: number;

  @Column() commitSha: string;
  @Column() artifactDigest: string;
  @Column() registry: string;
  @Column() repository: string;
  @Column() artifactTag: string;
  @Column() environmentIdentityHash: string;

  @Column({ type: 'text' }) decisionAtAuthorization: string;
  @Column({ type: 'text' }) securityValidationApplicability: string;
  @Column({ type: 'jsonb' }) riskSnapshot: Record<string, any>;
  @Column({ type: 'jsonb' }) failedControls: string[];
  @Column({ type: 'jsonb', default: [] }) warnings: string[];

  @Column() requestedByUserId: string;
  @Column() requestedByRole: string;

  @Column({ type: 'enum', enum: ['NORMAL', 'CONDITIONAL_EXCEPTION', 'CRITICAL_OVERRIDE'] })
  authorizationMode: DeploymentAuthorizationMode;

  @Column({ type: 'text', nullable: true }) reason: string | null;

  @Column({ type: 'jsonb', nullable: true }) acknowledgements: Record<string, boolean> | null;

  @Column() authorizationIdentityHash: string;

  @Column({ type: 'enum', enum: ['CREATED', 'CONSUMED', 'EXPIRED', 'REVOKED'], default: 'CREATED' })
  status: DeploymentAuthorizationStatus;

  @CreateDateColumn() createdAt: Date;
  @Column({ type: 'timestamp', nullable: true }) consumedAt: Date | null;
  @Column({ type: 'timestamp', nullable: true }) expiresAt: Date | null;
}
