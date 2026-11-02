// Garde anti-boucle du routage automatique vers WF4/WF5.
import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index,
} from 'typeorm';

@Entity('routed_builds')
export class RoutedBuild {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  hash: string;

  @Column()
  projectId: string;

  @Column()
  classificationType: string;

  @Column({ type: 'text' })
  errorReason: string;

  @CreateDateColumn()
  routedAt: Date;

  @Column({ type: 'timestamp' })
  expiresAt: Date;
}
