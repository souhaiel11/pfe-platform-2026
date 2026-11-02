// Service d'authentification : vérification des identifiants, création de compte, listing et suppression des utilisateurs. Les mots de passe sont toujours stockés hachés (bcrypt).
import { Injectable, UnauthorizedException, ConflictException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { User, UserRole } from './user.entity';
import { passwordPolicyViolations } from './password-policy';

@Injectable()
export class AuthService {
  /** Initialise les dépendances et l’état de ce composant. */
  constructor(
    @InjectRepository(User) private readonly repo: Repository<User>,
    private readonly jwt: JwtService,
  ) {}

  /** Vérifie l'email et le mot de passe fournis contre la base (comparaison du hash bcrypt) et renvoie un JWT signé avec le profil utilisateur. */
  async login(email: string, password: string) {
    const user = await this.repo.findOne({ where: { email } });
    if (!user || !await bcrypt.compare(password, user.password))
      throw new UnauthorizedException('Adresse e-mail ou mot de passe incorrect.');
    const token = this.jwt.sign({ sub: user.id, email: user.email, role: user.role });
    return { token, user: { id: user.id, email: user.email, name: user.name, role: user.role } };
  }

  /** Crée un nouvel utilisateur en refusant un email déjà pris, hache le mot de passe et renvoie un JWT signé. */
  async register(email: string, password: string, name: string, role = UserRole.DEVELOPER) {
    const exists = await this.repo.findOne({ where: { email } });
    if (exists) throw new ConflictException('Un compte utilise déjà cette adresse e-mail.');
    this.assertStrongPassword(password, email);
    const hashed = await bcrypt.hash(password, 10);
    const user = this.repo.create({ email, password: hashed, name, role });
    const saved = await this.repo.save(user);
    const token = this.jwt.sign({ sub: saved.id, email: saved.email, role: saved.role });
    return { token, user: { id: saved.id, email: saved.email, name: saved.name, role: saved.role } };
  }

  /** Change le mot de passe de l'utilisateur connecté : exige le mot de passe actuel et applique la politique de robustesse. */
  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await this.repo.findOne({ where: { id: userId } });
    if (!user || typeof currentPassword !== 'string' || !await bcrypt.compare(currentPassword, user.password))
      throw new UnauthorizedException('Mot de passe actuel incorrect.');
    if (newPassword === currentPassword) throw new BadRequestException('Le nouveau mot de passe doit être différent de l’actuel.');
    this.assertStrongPassword(newPassword, user.email);
    await this.repo.update(user.id, { password: await bcrypt.hash(newPassword, 10) });
    return { message: 'Mot de passe modifié.' };
  }

  /** Refuse un mot de passe qui ne respecte pas la politique (longueur, classes de caractères, valeurs par défaut). */
  private assertStrongPassword(password: string, email: string) {
    const violations = passwordPolicyViolations(password, email);
    if (violations.length) throw new BadRequestException(`Mot de passe trop faible : ${violations.join(', ')}.`);
  }

  /** Liste tous les utilisateurs enregistrés, sans renvoyer leur mot de passe. */
  findAll() { return this.repo.find({ select: ['id', 'email', 'name', 'role', 'isActive', 'createdAt'] }); }

  /** Supprime définitivement un utilisateur à partir de son identifiant. */
  async remove(id: string) {
    await this.repo.delete(id);
    return { message: 'Utilisateur supprimé.' };
  }
}
