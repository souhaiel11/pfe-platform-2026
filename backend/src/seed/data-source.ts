import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { Project } from '../projects/project.entity';
import { Incident } from '../incidents/incident.entity';
import { Report } from '../reports/report.entity';
import { Bug } from '../bugs/bug.entity';

// DataSource TypeORM autonome pour les scripts src/seed/*.
// Ne bootstrap pas l'app Nest (pas de gateways Socket.IO, pas de seed AuthService,
// pas d'appel n8n) : juste un accès direct aux repositories des 4 entités concernées.
// Les valeurs par défaut reprennent celles de backend/.env (dev local, hors Docker) ;
// surchargeables via les mêmes variables d'env que le backend.
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
