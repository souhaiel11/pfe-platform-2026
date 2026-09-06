// R22-C/R22-E — additive. Depends on ContextModule's ScopeLockService
// (R22-A) via direct import of the class, not module import, since
// CandidateMaterializer constructs its own default instance when not
// DI-supplied (same @Optional() pattern as WorkspaceManager) -- avoids a
// cross-module NestJS dependency for a service with zero constructor
// dependencies of its own.
//
// R22-E adds the one new HTTP surface this whole migration needed: an
// InternalSecretGuard-protected controller so n8n (WF2) can call the
// verification engine, write guard, and remote-head-drift check as plain
// HTTP requests instead of duplicating their logic as Code-node JS that
// could drift from the tested backend version. No route here is reachable
// without N8N_INTERNAL_SECRET, same as every other n8n->backend call in
// this codebase.
import { Module } from '@nestjs/common';
import { WorkspaceManager } from './workspace-manager.service';
import { CandidateMaterializer } from './candidate-materializer.service';
import { CandidateVerificationService } from './candidate-verification.service';
import { RepoCacheService } from './repo-cache.service';
import { CandidateVerificationController } from './candidate-verification.controller';

@Module({
  controllers: [CandidateVerificationController],
  providers: [WorkspaceManager, CandidateMaterializer, CandidateVerificationService, RepoCacheService],
  exports: [WorkspaceManager, CandidateMaterializer, CandidateVerificationService, RepoCacheService],
})
export class CandidateVerificationModule {}
