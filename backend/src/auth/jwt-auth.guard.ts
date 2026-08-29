import { Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  // Distinguishes a real JWT problem (expired/invalid token) from any other
  // 401 cause, so the frontend can tell whether it's safe to keep the session.
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
