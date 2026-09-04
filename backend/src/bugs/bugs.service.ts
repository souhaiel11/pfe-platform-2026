import { GoneException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Bug, BugStatus } from './bug.entity';
import { BugsGateway } from './bugs.gateway';
import { sanitizeEntityProject } from '../common/sanitize-project';

export const LEGACY_REMEDIATION_DISABLED = 'LEGACY_REMEDIATION_DISABLED';

@Injectable()
export class BugsService {
  constructor(
    @InjectRepository(Bug) private readonly repo: Repository<Bug>,
    private readonly gateway: BugsGateway,
  ) {}

  async findAll(projectId?: string) {
    const where: any = {};
    if (projectId) where.projectId = projectId;
    const bugs = await this.repo.find({ where, order: { createdAt: 'DESC' }, relations: ['project'] });
    return bugs.map(b => sanitizeEntityProject(b));
  }

  async findOne(id: string) {
    const bug = await this.repo.findOne({ where: { id }, relations: ['project'] });
    if (!bug) throw new NotFoundException('Anomalie introuvable.');
    return sanitizeEntityProject(bug);
  }

  async create(dto: Partial<Bug>) {
    const bug = this.repo.create(dto);
    const saved = await this.repo.save(bug);
    this.gateway.emitBugCreated(saved);
    return saved;
  }

  async triggerAiFix(_id: string): Promise<never> {
    throw new GoneException(LEGACY_REMEDIATION_DISABLED);
  }

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

  async remove(id: string) {
    const bug = await this.findOne(id);
    await this.repo.remove(bug);
    return { message: 'Anomalie supprimée.' };
  }

  async updateStatus(_id: string, _status: BugStatus): Promise<never> {
    throw new GoneException(LEGACY_REMEDIATION_DISABLED);
  }
}
