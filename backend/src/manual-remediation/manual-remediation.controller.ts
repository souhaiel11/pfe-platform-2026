import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ManualRemediationService } from './manual-remediation.service';

@ApiTags('Manual remediation')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('manual-remediation')
export class ManualRemediationController {
  constructor(private readonly service: ManualRemediationService) {}
  @Get() list(@Query('projectId') projectId: string, @Query('status') status?: string, @Query('source') source?: string, @Query('severity') severity?: string) { return this.service.list(projectId, { status, source, severity }); }
  @Get('summary') summary(@Query('projectId') projectId: string) { return this.service.summary(projectId); }
  @Patch(':id/complete') complete(@Param('id') id: string, @Body() body: { note?: string }, @Req() req: any) { return this.service.complete(id, req.user, body?.note); }
  @Patch(':id/reopen') reopen(@Param('id') id: string, @Req() req: any) { return this.service.reopen(id, req.user); }
  // Increment 1 — multi-CVE remediation, one candidate/build/scan/PR for N
  // selected findings. See ManualRemediationService.launchBatchRemediation()
  // for validation/idempotence/conflict-precheck details.
  @Post('launch-batch') launchBatch(@Body() body: { projectId: string; findingTaskIds: string[] }, @Req() req: any) {
    return this.service.launchBatchRemediation(body?.projectId, body?.findingTaskIds, req.user);
  }
}
