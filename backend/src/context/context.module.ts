// R22-A Phase 2/3/4/5 — foundation module. Purely additive: no controller,
// no HTTP surface, no wiring into IncidentsModule/WF2/WF3 this phase (Phase
// 10 explicitly defers replacing the existing PR Git write path and any
// automatic loop). Exists so these services are real, injectable, testable
// units ready for a later phase to consume, not dead code sitting outside
// Nest's DI graph.
import { Module } from '@nestjs/common';
import { RepositoryResearchService } from './repository-research.service';
import { ContextSufficiencyService } from './context-sufficiency.service';
import { ScopeLockService } from './scope-lock.service';

@Module({
  providers: [RepositoryResearchService, ContextSufficiencyService, ScopeLockService],
  exports: [RepositoryResearchService, ContextSufficiencyService, ScopeLockService],
})
export class ContextModule {}
