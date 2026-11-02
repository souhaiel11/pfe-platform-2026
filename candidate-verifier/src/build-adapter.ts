// Regroupe les traitements de construction adaptateur.
import { RegressionTestResult, VerificationMode } from '../../backend/src/candidate-verification/candidate-verification.types';

export interface CompileResult {
  status: 'SUCCESS' | 'FAILED';
  exitCode: number | null;
  durationMs: number;
  evidenceTail: string;
}

export interface BuildAdapter {
  readonly buildType: string;
  /** Indique si cet adaptateur prend en charge les données. */
  supports(workspacePath: string): boolean;
  /** Indique si ce mode est pris en charge. */
  supportsMode?(mode: VerificationMode): boolean;
  /** Compile le projet dans le délai disponible. */
  compile(workspacePath: string, timeoutMs: number): CompileResult;
  /** Compile les tests du projet. */
  compileTests?(workspacePath: string, timeoutMs: number): CompileResult;
  /** Exécute les tests pour détecter les régressions. */
  runRegressionTests(workspacePath: string, timeoutMs: number): RegressionTestResult;
}
