import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn
} from 'typeorm';

export enum ProjectStatus {
  HEALTHY  = 'healthy',
  WARNING  = 'warning',
  CRITICAL = 'critical',
}

export enum ProjectEnvironment {
  DEV     = 'dev',
  STAGING = 'staging',
  PROD    = 'prod',
}

export enum CicdTool {
  JENKINS = 'jenkins',
  GITLAB  = 'gitlab',
  GITHUB  = 'github',
  AZURE   = 'azure',
}

@Entity('projects')
export class Project {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // ── Général ───────────────────────────────────────────────
  @Column({ unique: true })
  name: string;

  @Column({ nullable: true })
  description: string;

  @Column({ type: 'enum', enum: ProjectEnvironment, default: ProjectEnvironment.DEV })
  environment: ProjectEnvironment;

  @Column({ type: 'enum', enum: ProjectStatus, default: ProjectStatus.HEALTHY })
  status: ProjectStatus;

  @Column({ type: 'float', default: 100 })
  securityScore: number;

  @Column({ default: true })
  isActive: boolean;

  @Column({ type: 'simple-array', nullable: true })
  tags: string[];

  // Origine des données ('demo' pour les projets de démo seedés ; null pour les projets réels)
  @Column({ nullable: true })
  source: string;

  // ── CI/CD ─────────────────────────────────────────────────
  @Column({ type: 'enum', enum: CicdTool, default: CicdTool.JENKINS })
  cicdTool: CicdTool;

  @Column({ nullable: true })
  jenkinsUrl: string;

  // Identité du job — utilisée pour le lookup webhook/n8n
  // (findByJobNameInternal, exact match), toujours la forme COURTE que
  // Jenkins envoie dans son payload. Ne jamais y mettre un chemin multibranch.
  @Column({ nullable: true })
  jenkinsJobName: string;

  // Chemin URL pour interroger le statut Jenkins (getJenkinsStatus) —
  // distinct de jenkinsJobName. Nécessaire pour un job multibranch
  // ("<dossier>/job/<branche>"), où l'identité du job (court, utilisée pour
  // le lookup) diffère du chemin réel de l'API Jenkins. Vide = fallback sur
  // jenkinsJobName (comportement inchangé pour un job non-multibranch).
  @Column({ nullable: true })
  jenkinsJobPath: string;

  @Column({ nullable: true })
  jenkinsToken: string;

  // ── GitHub ────────────────────────────────────────────────
  @Column({ nullable: true })
  githubRepo: string;

  @Column({ nullable: true })
  githubToken: string;

  // ── SonarQube ─────────────────────────────────────────────
  @Column({ nullable: true })
  sonarqubeUrl: string;

  @Column({ nullable: true })
  sonarqubeKey: string;

  @Column({ nullable: true })
  sonarqubeToken: string;

  // ── Notifications ─────────────────────────────────────────
  @Column({ default: false })
  emailEnabled: boolean;

  @Column({ nullable: true })
  emailRecipient: string;

  @Column({ default: false })
  slackEnabled: boolean;

  @Column({ nullable: true })
  slackChannel: string;

  @Column({ nullable: true })
  slackToken: string;

  // ── Validation status (calculé automatiquement) ───────────
  @Column({ type: 'jsonb', nullable: true })
  validationStatus: {
    sonarqube?: { valid: boolean; message: string; checkedAt: string };
    jenkins?:   { valid: boolean; message: string; checkedAt: string };
  };

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
