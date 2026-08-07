// ─────────────────────────────────────────────────────────────
//  Dockerfile Optimizer — proxy vers le workflow n8n WF5
//  Fichier : src/dockerfile-optimizer/dockerfile-optimizer.module.ts
//  Enregistrement : ajouter DockerfileOptimizerModule aux imports de AppModule
//
//  Couche 1 (branche fetch uniquement) — jumeau architectural de
//  jenkins-optimizer/jenkins-optimizer.module.ts. Pas encore de branches
//  analyse/apply, donc pas encore d'entités JenkinsAnalysis/JenkinsApply-like.
// ─────────────────────────────────────────────────────────────
import { Module, Controller, Post, Body, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

const N8N_URL = process.env.N8N_URL || 'http://172.31.172.61:5678';
const FETCH_WEBHOOK = `${N8N_URL}/webhook/dockerfile-fetch`;

@Controller('dockerfile')
export class DockerfileOptimizerController {

  // Protégé JWT : contrairement à jenkins-optimizer/fetch (appelé nulle
  // part côté front pour l'instant), cette branche est destinée à être
  // appelée directement par le front dès son intégration.
  @UseGuards(JwtAuthGuard)
  @Post('fetch')
  async fetch(@Body() body: { owner: string; repo: string; filePath?: string; ref?: string }) {
    if (!body?.owner || !body?.repo) {
      throw new HttpException('owner et repo sont requis', HttpStatus.BAD_REQUEST);
    }
    try {
      const res = await fetch(FETCH_WEBHOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          owner: body.owner,
          repo: body.repo,
          filePath: body.filePath || 'Dockerfile',
          ref: body.ref || 'main',
        }),
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) {
        throw new HttpException(`Workflow n8n indisponible (${res.status})`, HttpStatus.BAD_GATEWAY);
      }
      const data = await res.json();
      const result = Array.isArray(data) ? data[0] : data;
      if (!result?.success) {
        throw new HttpException(result?.message || 'Dockerfile introuvable', HttpStatus.NOT_FOUND);
      }
      return result;
    } catch (e: any) {
      if (e instanceof HttpException) throw e;
      throw new HttpException(`Erreur d'appel au workflow : ${e.message}`, HttpStatus.BAD_GATEWAY);
    }
  }
}

@Module({
  controllers: [DockerfileOptimizerController],
})
export class DockerfileOptimizerModule {}
