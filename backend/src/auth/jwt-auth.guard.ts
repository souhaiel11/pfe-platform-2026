// Garde d'authentification JWT pour les utilisateurs humains, basée sur Passport, avec une gestion d'erreur explicite distinguant un jeton expiré d'un jeton invalide.
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  /** Transforme un échec Passport-JWT en code d'erreur explicite (jeton expiré ou invalide) pour que le frontend sache s'il doit rafraîchir la session ou renvoyer au login. */
  handleRequest(err: any, user: any, info: any) {
    if (err || !user) {
      const name = info?.name;
      if (name === 'TokenExpiredError') {
        throw new UnauthorizedException({ statusCode: 401, code: 'TOKEN_EXPIRED', message: 'Votre session a expiré. Veuillez vous reconnecter.' });
      }
      if (name === 'JsonWebTokenError' || name === 'NotBeforeError') {
        throw new UnauthorizedException({ statusCode: 401, code: 'TOKEN_INVALID', message: 'Authentification invalide. Veuillez vous reconnecter.' });
      }
      throw err || new UnauthorizedException();
    }
    return user;
  }
}
