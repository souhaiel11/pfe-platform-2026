// Expose la création et la suppression de fixtures WF2 jetables, utilisées uniquement pour tester l'environnement — jamais en production.
import { Body, Controller, Delete, Param, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { IntegrationFixturesService, Wf2FixtureInput } from './integration-fixtures.service';

@Controller('integration-fixtures')
@UseGuards(JwtAuthGuard)
export class IntegrationFixturesController {
  /** Initialise les dépendances et l’état de ce composant. */
  constructor(private readonly fixtures: IntegrationFixturesService) {}

  /** Crée un projet et un incident jetables portant un fixRequest WF2 prêt à l'emploi. */
  @Post('wf2-context')
  provision(@Body() input: Wf2FixtureInput, @Req() request: any) {
    return this.fixtures.provisionWf2Context(input, request.user);
  }

  /** Supprime une fixture jetable et son projet associé. */
  @Delete(':fixtureId')
  cleanup(@Param('fixtureId') fixtureId: string, @Req() request: any) {
    return this.fixtures.cleanup(fixtureId, request.user);
  }
}
