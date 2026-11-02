// Entité d'un rapport de scan (Sonar/Trivy/Jenkins/combiné) : données brutes, résumé IA, score de
// sécurité déterministe et décision du Judge Agent. Aucune fonction ici, juste la définition de table.
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

  // Décision du Judge Agent (BLOCK/AUTO_FIX/NOTIFY_ONLY) et sa confiance.
  @Column({ nullable: true })
  judgeDecision: string;

  @Column({ type: 'float', nullable: true })
  judgeConfidence: number;

  // Archivage manuel uniquement (jamais automatique à la création).
  @Column({ default: false })
  archived: boolean;

  @CreateDateColumn()
  createdAt: Date;
}
