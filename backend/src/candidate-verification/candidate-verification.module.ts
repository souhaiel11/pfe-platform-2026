// R22-C — purely additive: no controller, no HTTP surface, no wiring into
// WF2's live control flow (explicitly deferred to a later phase per R22-B).
// Depends on ContextModule's ScopeLockService (R22-A) via direct import of
// the class, not module import, since CandidateMaterializer constructs its
// own default instance when not DI-supplied (same @Optional() pattern as
// WorkspaceManager) -- avoids a cross-module NestJS dependency for a
// service with zero constructor dependencies of its own.
import { Module } from '@nestjs/common';
import { WorkspaceManager } from './workspace-manager.service';
import { CandidateMaterializer } from './candidate-materializer.service';
import { CandidateVerificationService } from './candidate-verification.service';

@Module({
  providers: [WorkspaceManager, CandidateMaterializer, CandidateVerificationService],
  exports: [WorkspaceManager, CandidateMaterializer, CandidateVerificationService],
})
export class CandidateVerificationModule {}
