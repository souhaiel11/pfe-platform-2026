import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne } from 'typeorm';
import { Project } from '../projects/project.entity';

export enum ReportType {
  SONARQUBE = 'sonarqube',
  TRIVY = 'trivy',
  JENKINS = 'jenkins',
  COMBINED = 'combined',
}

@Entity('reports')
export class Report {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Project, { onDelete: 'CASCADE' })
  project: Project;

  @Column()
  projectId: string;

  @Column({ type: 'enum', enum: ReportType })
  type: ReportType;

  @Column({ type: 'jsonb' })
  rawData: Record<string, any>;

  @Column({ type: 'text', nullable: true })
  aiSummary: string;

  @Column({ type: 'float', nullable: true })
  securityScore: number;

  @Column({ nullable: true })
  riskLevel: string;

  @CreateDateColumn()
  createdAt: Date;
}
