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

  // Décision du Judge Agent (BLOCK/AUTO_FIX/NOTIFY_ONLY) et sa confiance —
  // exposées séparément du score, jamais mélangées dedans (voir
  // calculateSecurityScore : 100% technique, aucune valeur LLM).
  @Column({ nullable: true })
  judgeDecision: string;

  @Column({ type: 'float', nullable: true })
  judgeConfidence: number;

  // Archivage MANUEL uniquement — create() ne le met jamais à true tout
  // seul. L'historique complet est conservé par défaut (aucune suppression
  // ni archivage automatique) ; ce champ existe pour un archivage à la
  // demande, futur, pas encore branché à une action.
  @Column({ default: false })
  archived: boolean;

  @CreateDateColumn()
  createdAt: Date;
}
