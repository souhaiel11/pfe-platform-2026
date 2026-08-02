import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { DashboardService } from './dashboard.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@ApiTags('Dashboard')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly service: DashboardService) {}

  @Get('global') getGlobal() { return this.service.getGlobalStats(); }
  @Get('jenkins-global') getJenkinsGlobal() { return this.service.getJenkinsGlobal(); }
  @Get('security-global') getSecurityGlobal() { return this.service.getSecurityGlobal(); }
  @Get('risk-indicators') getRiskIndicators() { return this.service.getRiskIndicators(); }
  @Get('project/:id') getProject(@Param('id') id: string) { return this.service.getProjectDashboard(id); }
}
