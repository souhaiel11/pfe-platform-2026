// Assemble les contrôleurs et services de contexte.
import { Module } from '@nestjs/common';
import { RepositoryResearchService } from './repository-research.service';
import { ContextSufficiencyService } from './context-sufficiency.service';
import { ScopeLockService } from './scope-lock.service';

@Module({
  providers: [RepositoryResearchService, ContextSufficiencyService, ScopeLockService],
  exports: [RepositoryResearchService, ContextSufficiencyService, ScopeLockService],
})
export class ContextModule {}
