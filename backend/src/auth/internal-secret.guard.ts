// Garde d'accès réservée aux appels internes (n8n) : vérifie un secret partagé transmis par en-tête, jamais une authentification utilisateur.
import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';

const N8N_INTERNAL_SECRET = process.env.N8N_INTERNAL_SECRET;

@Injectable()
export class InternalSecretGuard implements CanActivate {
  /** Autorise la requête uniquement si l'en-tête x-internal-secret correspond exactement au secret serveur (refuse toujours si celui-ci est absent). */
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const secret = req.headers['x-internal-secret'];
    return !!N8N_INTERNAL_SECRET && secret === N8N_INTERNAL_SECRET;
  }
}
