// Lit le JWT dans Authorization: Bearer, vérifie sa signature puis recharge le compte en base.
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './user.entity';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  /** Initialise les dépendances et l’état de ce composant. */
  constructor(
    config: ConfigService,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: config.get('JWT_SECRET', 'devsecops-secret-2024'),
    });
  }

  /** Vérifie que le compte associé au JWT existe toujours et est actif en base, et renvoie le rôle réel stocké en base (jamais celui porté par le token). */
  async validate(payload: any) {
    const id = payload?.sub;
    if (!id || typeof id !== 'string') throw new UnauthorizedException('Jeton sans sujet exploitable.');
    const user = await this.users.findOne({ where: { id } });
    if (!user) throw new UnauthorizedException('Compte introuvable — jeton révoqué.');
    if (user.isActive === false) throw new UnauthorizedException('Compte désactivé — jeton révoqué.');
    return { id: user.id, email: user.email, role: user.role };
  }
}
