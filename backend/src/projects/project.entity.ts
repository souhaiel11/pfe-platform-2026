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

export interface AzureDeploymentConfig {
  provider: 'azure-container-instances';
  resourceGroup: string;
  targetName: string;
  registry: string;
  imageRepository: string;
  region?: string;
  subscriptionRef?: string;
  cpu?: string;
  memoryInGb?: string;
  ports?: string[];
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

  // default:100 s'applique seulement à la CRÉATION (avant tout report combined) ;
  // nullable pour permettre null après un report combined incomplete=true
  // (scanner requis sans résultat) — voir reports.service.ts::create. null
  // signifie "non vérifié", jamais assimilé à 0 ou 100 par un consommateur.
  @Column({ type: 'float', nullable: true, default: 100 })
  securityScore: number | null;

  @Column({ default: true })
  isActive: boolean;

  // Idempotence de la notification "prêt à déployer" (voir
  // reports.service.ts:syncDeployReadyNotification) — persisté plutôt que
  // recalculé à chaque écriture, pour ne créer la notif QUE sur la
  // transition non-prêt->prêt. Remis à false dès que le projet régresse,
  // pour permettre une re-notification au prochain passage au vert.
  @Column({ default: false })
  deployReadyNotified: boolean;

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

  // Configuration de cible non sensible. Les credentials Azure restent
  // exclusivement dans l'environnement de l'agent hôte.
  @Column({ type: 'jsonb', nullable: true })
  azureConfig: AzureDeploymentConfig | null;

  // Ledger minimal et durable pour rendre POST /azure-deploy/deploy
  // idempotent sans introduire de table parallèle.
  @Column({ type: 'jsonb', nullable: true })
  azureDeploymentState: {
    requestId: string;
    status: 'DISPATCHING' | 'DEPLOYED' | 'FAILED';
    imageTag: string;
    updatedAt: string;
    result?: Record<string, any>;
  } | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
