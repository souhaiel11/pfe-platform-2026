// user.entity.ts
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

export enum UserRole { ADMIN = 'admin', DEVELOPER = 'developer', VIEWER = 'viewer' }

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ unique: true }) email: string;
  @Column() password: string;
  @Column({ nullable: true }) name: string;
  @Column({ type: 'enum', enum: UserRole, default: UserRole.DEVELOPER }) role: UserRole;
  @Column({ default: true }) isActive: boolean;
  @CreateDateColumn() createdAt: Date;
}
