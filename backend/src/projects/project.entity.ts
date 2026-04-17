import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, OneToMany } from 'typeorm';

export enum ProjectStatus {
  HEALTHY = 'healthy',
  WARNING = 'warning',
  CRITICAL = 'critical',
}

export enum ProjectEnvironment {
  DEV = 'dev',
  STAGING = 'staging',
  PROD = 'prod',
}

@Entity('projects')
export class Project {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  name: string;

  @Column({ nullable: true })
  description: string;

  @Column({ nullable: true })
  githubRepo: string;

  @Column({ nullable: true })
  githubToken: string;

  @Column({ nullable: true })
  sonarqubeKey: string;

  @Column({ nullable: true })
  sonarqubeUrl: string;

  @Column({ nullable: true })
  sonarqubeToken: string;

  @Column({ nullable: true })
  jenkinsUrl: string;

  @Column({ nullable: true })
  jenkinsJobName: string;

  @Column({ nullable: true })
  jenkinsToken: string;

  @Column({ nullable: true })
  trivyEnabled: boolean;

  @Column({ nullable: true })
  dockerImage: string;

  @Column({ type: 'enum', enum: ProjectEnvironment, default: ProjectEnvironment.DEV })
  environment: ProjectEnvironment;

  @Column({ type: 'enum', enum: ProjectStatus, default: ProjectStatus.HEALTHY })
  status: ProjectStatus;

  @Column({ type: 'simple-array', nullable: true })
  tags: string[];

  @Column({ type: 'float', default: 100 })
  securityScore: number;

  @Column({ default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
