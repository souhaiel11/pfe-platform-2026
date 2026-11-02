/** Modèle et entité TypeORM d'un plan de test E2E opérateur : son état, ses deux tentatives contrôlées, et son journal d'événements. */
import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { AttemptCorrelation } from '../manual-remediation/security-remediation-lifecycle';
export interface RetryE2ETestPlan {
  enabled: true;
  projectId: string; taskId: string;
  attempt1Mode: 'FORCE_VERIFIER_TIMEOUT_ONCE';
  attempt2Mode: 'STOP_BEFORE_GIT_WRITE_ONCE';
  expiresAt: string;
  consumedAttempt1: boolean; consumedAttempt2: boolean;
  attempt1?: AttemptCorrelation; attempt2?: AttemptCorrelation;
  events: { hook: string; at: string; attemptId?: string; batchId?: string }[];
}
@Entity('security_remediation_retry_e2e_plans')
export class RetryE2ETestPlanEntity {
  @PrimaryColumn('uuid') id: string;
  @Column('uuid') projectId: string;
  @Column('uuid') taskId: string;
  @Column({ type: 'varchar', length: 16 }) state: 'ACTIVE' | 'COMPLETED' | 'REVOKED' | 'EXPIRED';
  @Column({ type: 'jsonb' }) plan: RetryE2ETestPlan;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt: Date;
}
