// Module de lecture seule et paginée des incidents/reports d'un projet, en transaction REPEATABLE READ / READ ONLY — aucune écriture possible, aucun appel à un service métier.
import { BadRequestException, Controller, Get, Injectable, Module, Query, UseGuards } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

export interface ReadPageQuery { projectId?: string; page?: string; pageSize?: string; analysisOnly?: string }

/** Valide et normalise les paramètres de pagination (projectId UUID, page, pageSize, analysisOnly) ; lève une erreur 400 sur toute valeur incohérente plutôt que de la corriger silencieusement. */
export function readPage(query: ReadPageQuery) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(query.projectId || '')) {
    throw new BadRequestException('A valid projectId is required');
  }
  /** Lit un entier valide ou signale une valeur absente. */
  const integer = (value: string | undefined, fallback: number, max: number) => {
    if (value === undefined) return fallback;
    if (!/^[1-9][0-9]*$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > max) {
      throw new BadRequestException('Invalid pagination');
    }
    return Number(value);
  };
  if (query.analysisOnly !== undefined && !['true', 'false'].includes(query.analysisOnly)) {
    throw new BadRequestException('Invalid analysisOnly');
  }
  const page = integer(query.page, 1, 1000000);
  const pageSize = integer(query.pageSize, 20, 100);
  return { projectId: query.projectId!, page, pageSize, offset: (page - 1) * pageSize, analysisOnly: query.analysisOnly === 'true' };
}

/** Réduit un `aiAnalysis` JSON complet à un aperçu ne gardant que build/build_number/decision ; renvoie '!invalid-analysis' si le JSON est absent ou invalide. */
export function analysisPreview(value: string | null): string | null {
  if (!value) return value;
  try {
    const parsed = JSON.parse(value);
    if (parsed === null) return '!invalid-analysis';
    const preview: any = {};
    for (const key of ['build', 'build_number', 'decision']) {
      if (Object.prototype.hasOwnProperty.call(parsed, key)) preview[key] = parsed[key];
    }
    return JSON.stringify(preview);
  } catch { return '!invalid-analysis'; }
}

@Injectable()
export class ProjectReadsService {
  /** Initialise les dépendances et l’état de ce composant. */
  constructor(private readonly db: DataSource) {}

  /** Lit une page d'incidents ou de reports pour un projet en transaction REPEATABLE READ / READ ONLY — comptage et page sur un instantané cohérent, sans aucune écriture possible. */
  async list(kind: 'incidents' | 'reports', query: ReadPageQuery) {
    const p = readPage(query);
    const where = '"projectId" = $1' + (kind === 'reports' ? ' AND "archived" = false' :
      p.analysisOnly ? ' AND "aiAnalysis" IS NOT NULL AND "aiAnalysis" <> \'\'' : '');
    const fields = kind === 'incidents'
      ? '"id", "projectId", "title", "status", "source", "createdAt", "updatedAt", "buildNumber", "aiAnalysis"'
      : '"id", "projectId", "type", "createdAt", "securityScore", "riskLevel", "judgeDecision", "judgeConfidence", "rawData" #> \'{enrichedData,build,number}\' AS "buildNumber"';
    return this.db.transaction('REPEATABLE READ', async manager => {
      await manager.query('SET TRANSACTION READ ONLY');
      const [count] = await manager.query(`SELECT count(*)::int AS total FROM "${kind}" WHERE ${where}`, [p.projectId]);
      const rows = await manager.query(`SELECT ${fields} FROM "${kind}" WHERE ${where} ORDER BY "createdAt" DESC, "id" DESC LIMIT $2 OFFSET $3`, [p.projectId, p.pageSize, p.offset]);
      const items = kind === 'incidents' ? rows.map(row => ({ ...row, aiAnalysis: analysisPreview(row.aiAnalysis), summaryOnly: true })) : rows;
      return { items, total: count.total, page: p.page, pageSize: p.pageSize, hasNext: p.offset + rows.length < count.total };
    });
  }
}

@Controller('project-reads')
@UseGuards(JwtAuthGuard)
export class ProjectReadsController {
  /** Initialise les dépendances et l’état de ce composant. */
  constructor(private readonly reads: ProjectReadsService) {}

  /** Renvoie une page paginée des incidents d'un projet. */
  @Get('incidents') incidents(@Query() query: ReadPageQuery) { return this.reads.list('incidents', query); }

  /** Renvoie une page paginée des reports d'un projet. */
  @Get('reports') reports(@Query() query: ReadPageQuery) { return this.reads.list('reports', query); }
}

@Module({ controllers: [ProjectReadsController], providers: [ProjectReadsService] })
export class ProjectReadsModule {}
