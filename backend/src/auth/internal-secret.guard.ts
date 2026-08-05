import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';

// Pour les routes appelées UNIQUEMENT par n8n, jamais par le front (ex:
// POST /incidents/:id/validation). Fail-closed : si N8N_INTERNAL_SECRET
// n'est pas défini côté serveur, ce guard refuse TOUJOURS.
const N8N_INTERNAL_SECRET = process.env.N8N_INTERNAL_SECRET;

@Injectable()
export class InternalSecretGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const secret = req.headers['x-internal-secret'];
    return !!N8N_INTERNAL_SECRET && secret === N8N_INTERNAL_SECRET;
  }
}
