// Expose le contrôle de vie /healthz, hors du préfixe /api.
import { Controller, Get } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Controller()
export class HealthController {
  /** Initialise les dépendances et l’état de ce composant. */
  constructor(private readonly dataSource: DataSource) {}
  /** Confirme que le serveur répond au contrôle de vie. */
  @Get('healthz')
  async health() {
    await this.dataSource.query('SELECT 1');
    return { status: 'ok' };
  }
}
