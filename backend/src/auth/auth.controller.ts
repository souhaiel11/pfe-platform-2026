// auth.controller.ts
import { Controller, Post, Get, Delete, Param, Body, UseGuards, OnModuleInit } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';

@ApiTags('Auth')
@Controller('auth')
export class AuthController implements OnModuleInit {
  constructor(private readonly service: AuthService) {}
  async onModuleInit() { await this.service.seed(); }

  @Post('login') login(@Body() body: { email: string; password: string }) {
    return this.service.login(body.email, body.password);
  }
  @Post('register') register(@Body() body: { email: string; password: string; name: string }) {
    return this.service.register(body.email, body.password, body.name);
  }
  @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Get('users') findAll() { return this.service.findAll(); }
  @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Delete('users/:id') remove(@Param('id') id: string) { return this.service.remove(id); }
}
