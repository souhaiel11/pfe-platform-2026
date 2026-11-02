// DataSource TypeORM autonome pour les scripts de seed (hors bootstrap NestJS) : accès direct aux repositories Project/Incident/Report/Bug.
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { Project } from '../projects/project.entity';
import { Incident } from '../incidents/incident.entity';
import { Report } from '../reports/report.entity';
import { Bug } from '../bugs/bug.entity';

export const seedDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5433', 10),
  username: process.env.DB_USER || 'devsecops',
  password: process.env.DB_PASS || 'devsecops123',
  database: process.env.DB_NAME || 'devsecops',
  entities: [Project, Incident, Report, Bug],
  synchronize: true,
});
