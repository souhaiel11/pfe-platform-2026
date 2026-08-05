import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';

// Pour les routes co-écrites par n8n ET le front (ex: PUT /incidents/:id).
// Chemin n8n : header X-Internal-Secret == N8N_INTERNAL_SECRET, fail-closed
// comme dans projects.controller.ts — si la variable d'env n'est pas définie
// côté serveur, ce chemin ne réussit JAMAIS (il ne devient pas "accepte
// tout"), on retombe simplement sur l'exigence JWT.
// Chemin humain : délégué au JwtAuthGuard existant, sans dupliquer sa logique.
const N8N_INTERNAL_SECRET = process.env.N8N_INTERNAL_SECRET;

@Injectable()
export class JwtOrInternalSecretGuard implements CanActivate {
  // Instancié directement plutôt qu'injecté : JwtAuthGuard n'a pas de
  // dépendance propre à résoudre (le mixin AuthGuard('jwt') s'appuie sur la
  // stratégie Passport globale, pas sur le conteneur DI de ce module), et
  // l'injecter forçait Nest à le chercher comme provider dans le module de
  // CHAQUE contrôleur qui utilise ce guard — pas enregistré partout, crash
  // au démarrage ("Nest can't resolve dependencies... in the IncidentsModule
  // context").
  private readonly jwtAuthGuard = new JwtAuthGuard();

  canActivate(context: ExecutionContext): boolean | Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const secret = req.headers['x-internal-secret'];
    if (N8N_INTERNAL_SECRET && secret === N8N_INTERNAL_SECRET) {
      return true;
    }
    return this.jwtAuthGuard.canActivate(context) as boolean | Promise<boolean>;
  }
}
