// incidents.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Incident, IncidentStatus } from './incident.entity';
import { IncidentsGateway } from './incidents.gateway';

@Injectable()
export class IncidentsService {
  constructor(
    @InjectRepository(Incident) private readonly repo: Repository<Incident>,
    private readonly gateway: IncidentsGateway,
  ) {}

  findAll(projectId?: string) {
    const where: any = {};
    if (projectId) where.projectId = projectId;
    return this.repo.find({ where, order: { createdAt: 'DESC' }, relations: ['project'] });
  }

  async findOne(id: string) {
    const i = await this.repo.findOne({ where: { id }, relations: ['project'] });
    if (!i) throw new NotFoundException('Incident not found');
    return i;
  }

  async create(dto: Partial<Incident>) {
    const incident = this.repo.create(dto);
    const saved = await this.repo.save(incident);
    this.gateway.emit('incident:created', saved);
    return saved;
  }

  async update(id: string, dto: Partial<Incident>) {
    await this.repo.update(id, dto);
    const updated = await this.findOne(id);
    this.gateway.emit('incident:updated', updated);
    return updated;
  }

  async remove(id: string) {
    const i = await this.findOne(id);
    await this.repo.remove(i);
    return { message: 'Incident deleted' };
  }
}
