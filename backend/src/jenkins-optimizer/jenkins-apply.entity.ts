import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn,
} from 'typeorm';

export enum JenkinsApplyStatus {
  PENDING = 'pending',
  SUCCESS = 'success',
  BLOCKED = 'blocked',
  FAILED = 'failed',
}

// Suivi asynchrone d'une création de PR (WF4 v4, branche APPLY) — même
// principe que JenkinsAnalysis : une ligne 'pending' est écrite AVANT
// l'appel au webhook n8n, jamais après, pour que le callback (ou le
// garde-fou de péremption dans GET /apply/:applyId/status) retrouve
// toujours l'état même si le backend redémarre entre-temps.
@Entity('jenkins_applies')
export class JenkinsApply {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Identifiant de corrélation avec le polling frontend et le callback n8n —
  // équivalent du jobId de JenkinsAnalysis, mais pour une opération APPLY.
  @Column({ unique: true })
  applyId: string;

  // jobId de l'analyse dont sourceJenkinsfile/issues ont servi à construire
  // originalJenkinsfile + retained/excluded. Traçabilité seulement — pas de
  // FK stricte : cette ligne doit rester lisible même si l'analyse d'origine
  // disparaissait un jour (pas de cascade, pas de couplage de cycle de vie).
  @Column()
  analysisJobId: string;

  @Column({ type: 'enum', enum: JenkinsApplyStatus, default: JenkinsApplyStatus.PENDING })
  status: JenkinsApplyStatus;

  // success -> { prUrl, prNumber, branch }
  // blocked -> { message, violations: [{ref, pattern}] }
  // failed  -> { message }
  @Column({ type: 'jsonb', nullable: true })
  result: Record<string, any>;

  @CreateDateColumn()
  createdAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  settledAt: Date;
}
