import { Body, Controller, Delete, Param, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { IntegrationFixturesService, Wf2FixtureInput } from './integration-fixtures.service';

@Controller('integration-fixtures')
@UseGuards(JwtAuthGuard)
export class IntegrationFixturesController {
  constructor(private readonly fixtures: IntegrationFixturesService) {}

  @Post('wf2-context')
  provision(@Body() input: Wf2FixtureInput, @Req() request: any) {
    return this.fixtures.provisionWf2Context(input, request.user);
  }

  @Delete(':fixtureId')
  cleanup(@Param('fixtureId') fixtureId: string, @Req() request: any) {
    return this.fixtures.cleanup(fixtureId, request.user);
  }
}
