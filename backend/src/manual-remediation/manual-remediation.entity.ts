import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export enum ManualRemediationStatus {
  TODO = 'TODO',
  DONE_BY_USER = 'DONE_BY_USER',
  VERIFIED = 'VERIFIED',
  REOPENED = 'REOPENED',
}

export enum ScannerFindingStatus {
  DETECTED = 'DETECTED',
  STILL_DETECTED = 'STILL_DETECTED',
  NOT_DETECTED = 'NOT_DETECTED',
  UNAVAILABLE = 'UNAVAILABLE',
}

export type ManualRemediationEvent = {
  at: string;
  actorId: string | null;
  actorDisplayName: string;
  oldStatus: ManualRemediationStatus | null;
  newStatus: ManualRemediationStatus;
  reason: 'CREATED' | 'COMPLETED_BY_USER' | 'REOPENED_BY_USER' | 'VERIFIED_BY_SCANNER' | 'REAPPEARED';
  buildNumber: number | null;
};

@Entity('manual_remediation_tasks')
@Index(['projectId', 'findingFingerprint'], { unique: true })
export class ManualRemediationTask {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid' }) projectId: string;
  @Column({ type: 'uuid', nullable: true }) incidentId: string | null;
  @Column({ nullable: true }) findingId: string | null;
  @Column({ length: 64 }) findingFingerprint: string;
  @Column() source: string;
  @Column({ nullable: true }) ruleOrCve: string | null;
  @Column({ type: 'text' }) title: string;
  @Column({ nullable: true }) severity: string | null;
  @Column({ nullable: true }) remediationType: string | null;
  @Column({ type: 'jsonb', default: {} }) findingSnapshot: Record<string, any>;
  @Column({ type: 'enum', enum: ManualRemediationStatus, default: ManualRemediationStatus.TODO }) status: ManualRemediationStatus;
  @Column({ type: 'enum', enum: ScannerFindingStatus, default: ScannerFindingStatus.DETECTED }) scannerStatus: ScannerFindingStatus;
  @Column({ nullable: true }) completedByUserId: string | null;
  @Column({ nullable: true }) completedByDisplayName: string | null;
  @Column({ type: 'timestamp', nullable: true }) completedAt: Date | null;
  @Column({ type: 'varchar', length: 500, nullable: true }) completionNote: string | null;
  @Column({ nullable: true }) lastSeenBuild: number | null;
  @Column({ nullable: true }) verifiedBuild: number | null;
  @Column({ type: 'timestamp', nullable: true }) verifiedAt: Date | null;
  @Column({ type: 'jsonb', default: [] }) events: ManualRemediationEvent[];
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}
