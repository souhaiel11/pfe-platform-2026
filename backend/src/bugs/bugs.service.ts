// Logique du module legacy "bugs".
import { GoneException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Bug, BugStatus } from './bug.entity';
import { BugsGateway } from './bugs.gateway';
import { sanitizeEntityProject } from '../common/sanitize-project';

export const LEGACY_REMEDIATION_DISABLED = 'LEGACY_REMEDIATION_DISABLED';

@Injectable()
export class BugsService {
  /** Initialise les dépendances et l’état de ce composant. */
  constructor(
    @InjectRepository(Bug) private readonly repo: Repository<Bug>,
    private readonly gateway: BugsGateway,
  ) {}

  // Liste les bugs (filtrables par projet), avec le projet associé assaini.
  async findAll(projectId?: string) {
    const where: any = {};
    if (projectId) where.projectId = projectId;
    const bugs = await this.repo.find({ where, order: { createdAt: 'DESC' }, relations: ['project'] });
    return bugs.map(b => sanitizeEntityProject(b));
  }

  // Récupère un bug par id, ou lève une 404 s'il n'existe pas.
  async findOne(id: string) {
    const bug = await this.repo.findOne({ where: { id }, relations: ['project'] });
    if (!bug) throw new NotFoundException('Anomalie introuvable.');
    return sanitizeEntityProject(bug);
  }

  // Crée un bug et notifie les clients connectés via la passerelle websocket.
  async create(dto: Partial<Bug>) {
    const bug = this.repo.create(dto);
    const saved = await this.repo.save(bug);
    this.gateway.emitBugCreated(saved);
    return saved;
  }

  // Ancien déclencheur de correction IA — toujours refusé, ce chemin est désactivé.
  async triggerAiFix(_id: string): Promise<never> {
    throw new GoneException(LEGACY_REMEDIATION_DISABLED);
  }

  // Ancien callback de résultat de correction IA (venant de n8n) — toujours refusé, ce chemin est désactivé.
  async updateFromN8n(_id: string, _data: {
    humanReadableExplanation?: string;
    aiFixSuggestion?: string;
    prUrl?: string;
    prNumber?: number;
    fixConfidence?: number;
    status?: BugStatus;
  }) {
    throw new GoneException(LEGACY_REMEDIATION_DISABLED);
  }

  // Supprime un bug.
  async remove(id: string) {
    const bug = await this.findOne(id);
    await this.repo.remove(bug);
    return { message: 'Anomalie supprimée.' };
  }

  // Ancien changement de statut manuel — toujours refusé, ce chemin est désactivé.
  async updateStatus(_id: string, _status: BugStatus): Promise<never> {
    throw new GoneException(LEGACY_REMEDIATION_DISABLED);
  }
}
