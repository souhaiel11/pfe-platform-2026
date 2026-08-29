// auth.service.ts
import { Injectable, UnauthorizedException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { User, UserRole } from './user.entity';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private readonly repo: Repository<User>,
    private readonly jwt: JwtService,
  ) {}

  async login(email: string, password: string) {
    const user = await this.repo.findOne({ where: { email } });
    if (!user || !await bcrypt.compare(password, user.password))
      throw new UnauthorizedException('Adresse e-mail ou mot de passe incorrect.');
    const token = this.jwt.sign({ sub: user.id, email: user.email, role: user.role });
    return { token, user: { id: user.id, email: user.email, name: user.name, role: user.role } };
  }

  async register(email: string, password: string, name: string, role = UserRole.DEVELOPER) {
    const exists = await this.repo.findOne({ where: { email } });
    if (exists) throw new ConflictException('Un compte utilise déjà cette adresse e-mail.');
    const hashed = await bcrypt.hash(password, 10);
    const user = this.repo.create({ email, password: hashed, name, role });
    const saved = await this.repo.save(user);
    const token = this.jwt.sign({ sub: saved.id, email: saved.email, role: saved.role });
    return { token, user: { id: saved.id, email: saved.email, name: saved.name, role: saved.role } };
  }

  async seed() { return; // DISABLED
    const exists = await this.repo.findOne({ where: { email: 'admin@devsecops.local' } });
    if (!exists) {
      await this.register('admin@devsecops.local', 'Admin@123', 'Administrator', UserRole.ADMIN);
      await this.register('dev@devsecops.local', 'Dev@123', 'Developer', UserRole.DEVELOPER);
      console.log('✅ Seed users created');
    }
  }

  findAll() { return this.repo.find({ select: ['id', 'email', 'name', 'role', 'isActive', 'createdAt'] }); }

  async remove(id: string) {
    await this.repo.delete(id);
    return { message: 'Utilisateur supprimé.' };
  }
}
