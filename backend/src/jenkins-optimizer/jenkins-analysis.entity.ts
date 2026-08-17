import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, ManyToOne,
} from 'typeorm';
import { Project } from '../projects/project.entity';

export enum JenkinsAnalysisStatus {
  PENDING = 'pending',
  DONE = 'done',
  ERROR = 'error',
}

// Historique complet des analyses de l'optimiseur Jenkinsfile (WF4),
// rattaché au projet — voir jenkins-optimizer.module.ts pour le flux.
// Une ligne 'pending' est écrite AVANT l'appel au webhook n8n, jamais
// après : c'est ce qui permet au callback de retrouver le job même si
// le backend a redémarré entre-temps (le Map en mémoire, lui, est perdu).
@Entity('jenkins_analyses')
export class JenkinsAnalysis {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Project, { onDelete: 'CASCADE' })
  project: Project;

  @Column()
  projectId: string;

  // Corrélation avec le job en mémoire (Map) et avec le callback n8n —
  // c'est le même id que celui retourné par POST /optimize.
  @Column({ unique: true })
  jobId: string;

  // Jenkinsfile ORIGINAL envoyé à l'agent pour cette analyse — nécessaire
  // pour pouvoir régénérer plus tard à partir du fichier propre (pas de
  // optimizedJenkinsfile déjà modifié). Sans ça, "Régénérer" ne fonctionne
  // qu'à l'intérieur de la même session (source() en mémoire côté front) et
  // casse après un simple F5. Nullable : les lignes créées avant cette
  // colonne n'en ont pas — dégradation propre, pas une erreur.
  @Column({ type: 'text', nullable: true })
  sourceJenkinsfile: string;

  @Column({ type: 'enum', enum: JenkinsAnalysisStatus, default: JenkinsAnalysisStatus.PENDING })
  status: JenkinsAnalysisStatus;

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
