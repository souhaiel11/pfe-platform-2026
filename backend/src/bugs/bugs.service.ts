import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Bug, BugStatus } from './bug.entity';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { BugsGateway } from './bugs.gateway';
import { sanitizeEntityProject } from '../common/sanitize-project';

@Injectable()
export class BugsService {
  constructor(
    @InjectRepository(Bug) private readonly repo: Repository<Bug>,
    private readonly http: HttpService,
    private readonly config: ConfigService,
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
    if (!bug) throw new NotFoundException('Bug not found');
    return sanitizeEntityProject(bug);
  }

  async create(dto: Partial<Bug>) {
    const bug = this.repo.create(dto);
    const saved = await this.repo.save(bug);
    this.gateway.emitBugCreated(saved);
    return saved;
  }

  async triggerAiFix(id: string) {
    const bug = await this.findOne(id);
    bug.status = BugStatus.AI_FIXING;
    await this.repo.save(bug);
    this.gateway.emitBugUpdated(bug);

    // Trigger n8n workflow
    const n8nUrl = this.config.get('N8N_URL', 'http://n8n:5678');
    const webhookPath = this.config.get('N8N_BUG_FIX_WEBHOOK', '/webhook/bug-fix');
    try {
      await firstValueFrom(
        this.http.post(`${n8nUrl}${webhookPath}`, {
          bugId: bug.id,
          projectId: bug.projectId,
          title: bug.title,
          rawMessage: bug.rawMessage,
          filePath: bug.filePath,
          lineNumber: bug.lineNumber,
          severity: bug.severity,
          source: bug.source,
          metadata: bug.metadata,
        }),
      );
    } catch (e) {
      // n8n might not be running, simulate for demo
      setTimeout(() => this.simulateAiFix(id), 3000);
    }

    return { message: 'AI fix triggered', bugId: id };
  }

  async updateFromN8n(id: string, data: {
    humanReadableExplanation?: string;
    aiFixSuggestion?: string;
    prUrl?: string;
    prNumber?: number;
    fixConfidence?: number;
    status?: BugStatus;
  }) {
    const bug = await this.findOne(id);
    Object.assign(bug, data);
    const saved = await this.repo.save(bug);
    this.gateway.emitBugUpdated(saved);
    return saved;
  }

  async remove(id: string) {
    const bug = await this.findOne(id);
    await this.repo.remove(bug);
    return { message: 'Bug deleted' };
  }

  async updateStatus(id: string, status: BugStatus) {
    const bug = await this.findOne(id);
    bug.status = status;
    const saved = await this.repo.save(bug);
    this.gateway.emitBugUpdated(saved);
    return saved;
  }

  private async simulateAiFix(id: string) {
    try {
      const bug = await this.findOne(id);
      bug.status = BugStatus.PR_CREATED;
      bug.humanReadableExplanation = `Ce bug est causé par une mauvaise validation des entrées utilisateur. L'application ne vérifie pas correctement les paramètres avant de les utiliser, ce qui peut causer des comportements inattendus.`;
      bug.aiFixSuggestion = `Ajouter une validation stricte des entrées avec des guards NestJS et des DTOs avec class-validator. Utiliser @IsString(), @IsNotEmpty() et sanitiser les données avant traitement.`;
      bug.prUrl = `https://github.com/example/repo/pull/${Math.floor(Math.random() * 100)}`;
      bug.prNumber = Math.floor(Math.random() * 100);
      bug.fixConfidence = Math.floor(75 + Math.random() * 20);
      await this.repo.save(bug);
      this.gateway.emitBugUpdated(bug);
    } catch {}
  }
}
