import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne } from 'typeorm';
import { Project } from '../projects/project.entity';

export enum BugSeverity {
  CRITICAL = 'critical',
  HIGH = 'high',
  MEDIUM = 'medium',
  LOW = 'low',
}

export enum BugStatus {
  OPEN = 'open',
  AI_FIXING = 'ai_fixing',
  PR_CREATED = 'pr_created',
  RESOLVED = 'resolved',
  IGNORED = 'ignored',
}

export enum BugSource {
  SONARQUBE = 'sonarqube',
  TRIVY = 'trivy',
  JENKINS = 'jenkins',
  MANUAL = 'manual',
  WEBHOOK = 'webhook',
}

@Entity('bugs')
export class Bug {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Project, { onDelete: 'CASCADE' })
  project: Project;

  @Column()
  projectId: string;

  @Column()
  title: string;

  @Column({ type: 'text', nullable: true })
  rawMessage: string;

  @Column({ type: 'text', nullable: true })
  humanReadableExplanation: string;

  @Column({ type: 'text', nullable: true })
  aiFixSuggestion: string;

  @Column({ nullable: true })
  filePath: string;

  @Column({ nullable: true })
  lineNumber: number;

  @Column({ nullable: true })
  ruleId: string;

  @Column({ type: 'enum', enum: BugSeverity, default: BugSeverity.MEDIUM })
  severity: BugSeverity;

  @Column({ type: 'enum', enum: BugStatus, default: BugStatus.OPEN })
  status: BugStatus;

  @Column({ type: 'enum', enum: BugSource, default: BugSource.MANUAL })
  source: BugSource;

  @Column({ nullable: true })
  prUrl: string;

  @Column({ nullable: true })
  prNumber: number;

  @Column({ type: 'float', nullable: true })
  fixConfidence: number;

  @Column({ nullable: true })
  n8nWorkflowId: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any>;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
