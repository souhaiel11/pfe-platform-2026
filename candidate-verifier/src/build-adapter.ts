// R22-C — generic build-adapter contract. Nothing pfe-app-test-specific
// lives at this layer; MavenBuildAdapter is the only implementation this
// phase, but the interface is shaped so Gradle/npm adapters (R22-B Phase 6:
// NEEDS_ADAPTER) can be added later without touching
// CandidateVerificationService.
import { RegressionTestResult } from '../../backend/src/candidate-verification/candidate-verification.types';

export interface CompileResult {
  status: 'SUCCESS' | 'FAILED';
  exitCode: number | null;
  durationMs: number;
  evidenceTail: string;
}

export interface BuildAdapter {
  readonly buildType: string;
  supports(workspacePath: string): boolean;
  compile(workspacePath: string, timeoutMs: number): CompileResult;
  runRegressionTests(workspacePath: string, timeoutMs: number): RegressionTestResult;
}
