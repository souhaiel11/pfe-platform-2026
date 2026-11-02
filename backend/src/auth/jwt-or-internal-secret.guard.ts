// Garde d'accès pour les routes partagées entre n8n et les utilisateurs humains.
import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';

const N8N_INTERNAL_SECRET = process.env.N8N_INTERNAL_SECRET;

@Injectable()
export class JwtOrInternalSecretGuard implements CanActivate {
  private readonly jwtAuthGuard = new JwtAuthGuard();

  /** Accepte soit le secret interne n8n (en-tête x-internal-secret), soit un JWT humain valide, et enregistre sur la requête le canal d'authentification utilisé. */
  canActivate(context: ExecutionContext): boolean | Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const secret = req.headers['x-internal-secret'];
    if (N8N_INTERNAL_SECRET && secret === N8N_INTERNAL_SECRET) {
      req.authChannel = 'INTERNAL_SECRET';
      return true;
    }
    req.authChannel = 'JWT';
    return this.jwtAuthGuard.canActivate(context) as boolean | Promise<boolean>;
  }
}
