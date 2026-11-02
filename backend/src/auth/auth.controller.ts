// Contrôleur d'authentification : connexion, création de compte et gestion des utilisateurs (liste, suppression).
import { Controller, Post, Get, Delete, Param, Body, UseGuards, BadRequestException, ForbiddenException, Req, HttpCode } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { UserRole } from './user.entity';

const VALID_ROLES: string[] = [UserRole.ADMIN, UserRole.DEVELOPER, UserRole.VIEWER];

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  /** Initialise les dépendances et l’état de ce composant. */
  constructor(private readonly service: AuthService) {}

  /** Vérifie que l'utilisateur authentifié de la requête a le rôle ADMIN, sinon lève une erreur 403. */
  private assertAdmin(req: any) {
    if (String(req.user?.role || '').toLowerCase() !== UserRole.ADMIN) {
      throw new ForbiddenException('Administration réservée aux administrateurs');
    }
  }


  /** Authentifie un utilisateur à partir de son email et mot de passe, et renvoie son jeton JWT. */
  @Post('login') login(@Body() body: { email: string; password: string }) {
    return this.service.login(body.email, body.password);
  }

  /** Crée un nouvel utilisateur (réservé aux administrateurs) ; valide le rôle fourni et accepte l'ancien champ "username" comme alias de "name". */
  @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Post('register')
  register(@Body() body: { email: string; password: string; name?: string; username?: string; role?: string }, @Req() req: any) {
    this.assertAdmin(req);
    const name = body.name ?? body.username;
    let role: UserRole | undefined;
    if (body.role !== undefined && body.role !== null) {
      if (!VALID_ROLES.includes(body.role)) {
        throw new BadRequestException(`role invalide : "${body.role}" (valeurs autorisées : ${VALID_ROLES.join(', ')})`);
      }
      role = body.role as UserRole;
    }
    return this.service.register(body.email, body.password, name as string, role);
  }

  /** Change le mot de passe de l'utilisateur connecté (mot de passe actuel exigé). */
  @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Post('change-password') @HttpCode(200)
  changePassword(@Body() body: { currentPassword: string; newPassword: string }, @Req() req: any) {
    return this.service.changePassword(String(req.user?.id || ''), body?.currentPassword, body?.newPassword);
  }

  /** Liste tous les utilisateurs existants (réservé aux administrateurs). */
  @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Get('users') findAll(@Req() req: any) { this.assertAdmin(req); return this.service.findAll(); }

  /** Supprime un utilisateur par son identifiant (réservé aux administrateurs). */
  @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Delete('users/:id') remove(@Param('id') id: string, @Req() req: any) { this.assertAdmin(req); return this.service.remove(id); }
}
