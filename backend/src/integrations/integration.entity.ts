import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export enum IntegrationTool {
  GRAFANA    = 'grafana',
  PROMETHEUS = 'prometheus',
  KUBERNETES = 'kubernetes',
  NEXUS      = 'nexus',
}

export enum IntegrationStatus {
  CONNECTED    = 'connected',
  DISCONNECTED = 'disconnected',
  ERROR        = 'error',
}

@Entity('integrations')
export class Integration {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'enum', enum: IntegrationTool, unique: true })
  toolType: IntegrationTool;

  @Column()
  name: string;

  @Column()
  url: string;

  @Column({ nullable: true })
  token: string;

  @Column({ nullable: true })
  username: string;

  @Column({ nullable: true })
  password: string;

  @Column({ default: true })
  enabled: boolean;

  @Column({ type: 'enum', enum: IntegrationStatus, default: IntegrationStatus.DISCONNECTED })
  status: IntegrationStatus;

  @Column({ type: 'timestamp', nullable: true })
  lastChecked: Date;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any>;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
