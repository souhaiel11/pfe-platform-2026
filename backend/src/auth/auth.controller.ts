// auth.controller.ts
import { Controller, Post, Get, Delete, Param, Body, UseGuards, OnModuleInit, BadRequestException, ForbiddenException, Req } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { UserRole } from './user.entity';

// Whitelist stricte — même principe fail-closed que le reste de la plateforme :
// un rôle fourni mais invalide est un 400 explicite (jamais silencieusement
// corrigé/ignoré) ; un rôle absent laisse le service appliquer son défaut
// sûr (DEVELOPER, le moins privilégié — jamais ADMIN par défaut).
const VALID_ROLES: string[] = [UserRole.ADMIN, UserRole.DEVELOPER, UserRole.VIEWER];

@ApiTags('Auth')
@Controller('auth')
export class AuthController implements OnModuleInit {
  constructor(private readonly service: AuthService) {}
  private assertAdmin(req: any) {
    if (String(req.user?.role || '').toLowerCase() !== UserRole.ADMIN) {
      throw new ForbiddenException('Administration réservée aux administrateurs');
    }
  }
  async onModuleInit() { await this.service.seed(); }

  @Post('login') login(@Body() body: { email: string; password: string }) {
    return this.service.login(body.email, body.password);
  }
  @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Post('register')
  register(@Body() body: { email: string; password: string; name?: string; username?: string; role?: string }, @Req() req: any) {
    this.assertAdmin(req);
    // Le front historique envoyait "username" ; la colonne réelle est "name".
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
  @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Get('users') findAll(@Req() req: any) { this.assertAdmin(req); return this.service.findAll(); }
  @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Delete('users/:id') remove(@Param('id') id: string, @Req() req: any) { this.assertAdmin(req); return this.service.remove(id); }
}
