// incident.entity.ts
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne } from 'typeorm';
import { Project } from '../projects/project.entity';

export enum IncidentStatus {
  PENDING = 'pending', ANALYZING = 'analyzing', ANALYZED = 'analyzed',
  FIX_GENERATED = 'fix_generated', VALIDATING = 'validating',
  APPROVED = 'approved', COMPLETED = 'completed', BLOCKED = 'blocked', FAILED = 'failed', REJECTED = 'rejected',
}

@Entity('incidents')
export class Incident {
  @PrimaryGeneratedColumn('uuid') id: string;
  @ManyToOne(() => Project, { onDelete: 'CASCADE' }) project: Project;
  @Column() projectId: string;
  @Column() title: string;
  @Column({ type: 'text', nullable: true }) description: string;
  @Column({ type: 'enum', enum: IncidentStatus, default: IncidentStatus.PENDING }) status: IncidentStatus;
  @Column({ nullable: true }) source: string;
  @Column({ type: 'jsonb', nullable: true }) metadata: Record<string, any>;
  @Column({ nullable: true }) prUrl: string;
  @Column({ nullable: true }) jenkinsJobName: string;
  @Column({ nullable: true }) buildNumber: number;
  @Column({ nullable: true }) aiAnalysis: string;
  // Raison honnête d'un statut 'failed' (ou d'un échec partiel sur un statut
  // intermédiaire) — écrits par les workflows n8n (WF1/WF2) via PUT :id, sur
  // le même modèle que JenkinsAnalysis.reason/detail. Nullable, jamais
  // rétro-remplis : un incident existant sans ces champs reste simplement
  // sans erreur affichée, ce n'est pas un état particulier à gérer.
  @Column({ nullable: true }) errorReason: string;
  @Column({ type: 'text', nullable: true }) errorDetail: string;
  @Column({ nullable: true }) errorStep: string;
  @Column({ type: 'timestamp', nullable: true }) resolvedAt: Date;
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}
