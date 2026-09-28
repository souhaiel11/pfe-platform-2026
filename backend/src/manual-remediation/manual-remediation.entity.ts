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
  // WF6 automated-remediation result (execution-2060 follow-up) — entirely
  // separate from status/scannerStatus above, which remain the MANUAL
  // human-tracking fields untouched by this column. Null until WF6 has ever
  // reported a result for this finding. Always the LATEST callback's
  // snapshot at the top level; `attempts` keeps every prior callback so no
  // history is lost across retries (same discipline as Sonar's own
  // fixRequest.attempts[], but scoped per-finding here, never per-report).
  @Column({ type: 'jsonb', nullable: true, default: null }) securityFindingRemediation: Record<string, any> | null;
  // Increment 1 (multi-CVE, one PR) — plain, indexed correlation key shared
  // by every ManualRemediationTask dispatched together in the SAME WF6
  // batch (one pom.xml patch, one build, one PR for N CVEs). Null for a
  // task never part of a batch dispatch (the overwhelming majority, and
  // every row that predates this column). Deliberately NOT inside the
  // securityFindingRemediation jsonb blob -- see 20260928_add_security_
  // remediation_batch_id.sql's own header comment for why a plain indexed
  // column earns its keep here (cheap "every task in batch X" lookup).
  @Column({ type: 'varchar', length: 64, nullable: true }) securityRemediationBatchId: string | null;
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}
