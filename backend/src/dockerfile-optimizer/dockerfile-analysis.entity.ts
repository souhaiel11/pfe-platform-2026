import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, ManyToOne,
} from 'typeorm';
import { Project } from '../projects/project.entity';

export enum DockerfileAnalysisStatus {
  PENDING = 'pending',
  DONE = 'done',
  ERROR = 'error',
}

// Historique complet des analyses de l'optimiseur Dockerfile (WF5),
// rattaché au projet — voir dockerfile-optimizer.module.ts pour le flux.
// Même logique que JenkinsAnalysis : une ligne 'pending' est écrite AVANT
// l'appel au webhook n8n, jamais après, pour que le callback retrouve le
// job même après un redémarrage backend (le Map en mémoire, lui, est perdu).
@Entity('dockerfile_analyses')
export class DockerfileAnalysis {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Project, { onDelete: 'CASCADE' })
  project: Project;

  @Column()
  projectId: string;

  // Corrélation avec le job en mémoire (Map) et avec le callback n8n —
  // c'est le même id que celui retourné par POST /analyze.
  @Column({ unique: true })
  jobId: string;

  // Dockerfile ORIGINAL envoyé à l'agent pour cette analyse.
  @Column({ type: 'text', nullable: true })
  sourceDockerfile: string;

  // pom.xml envoyé pour la détection CAT-JDK — nullable : absent quand le
  // dépôt n'est pas un projet Maven (pas une erreur, juste CAT-JDK sauté).
  @Column({ type: 'text', nullable: true })
  sourcePomXml: string;

  @Column({ type: 'enum', enum: DockerfileAnalysisStatus, default: DockerfileAnalysisStatus.PENDING })
  status: DockerfileAnalysisStatus;

  @Column({ type: 'jsonb', nullable: true })
  result: Record<string, any>;

  @Column({ nullable: true })
  reason: string;

  @Column({ nullable: true })
  detail: string;

  @CreateDateColumn()
  createdAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  settledAt: Date;
}
