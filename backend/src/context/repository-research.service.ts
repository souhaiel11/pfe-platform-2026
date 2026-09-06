// R22-A Phase 3 — Repository Research Agent.
//
// READ-ONLY. Never generates or modifies remediation code (no method here
// returns anything resembling a patch/diff/source edit). Every answer is
// grounded in `git show <sha>:<path>` against a real local checkout -- never
// an LLM guess about what a class "probably" contains. This is the
// deterministic-tool half of "AI proposes, deterministic tools prove."
//
// CRITICAL RULE this class exists to enforce mechanically: NOT_FOUND is a
// fact, not an instruction. `Task.dueDate` returning NOT_FOUND must never be
// interpreted upstream as "add dueDate to Task" -- this class has no
// mechanism to create anything, and callers must route a NOT_FOUND result
// for a field/method that a remediation seems to require into
// HUMAN_DECISION_REQUIRED (see ContextSufficiencyService), never into silent
// generation. Real-world worked example this was built from: PR-25's
// TaskDTO.dueDate/getDueDate/setDueDate referenced a field that never
// existed on Task at any commit -- R21-BA established this by hand via
// `git show <sha>:Task.java`; this service makes that exact lookup a typed,
// reusable, exact-SHA-gated operation.
import { Injectable } from '@nestjs/common';
import { execFileSync } from 'child_process';
import { ContextRequest, EvidenceEntry, ResearchResponse } from './context.types';

@Injectable()
export class RepositoryResearchService {
  /**
   * @param repoPath local path to an already-cloned git repository (never
   *   clones/fetches itself -- read-only against whatever is already there)
   * @param remediationRevisionSha the SHA the remediation candidate targets;
   *   every request must match it exactly or the answer fails closed
   */
  answer(request: ContextRequest, remediationRevisionSha: string, repoPath: string): ResearchResponse {
    if (request.revisionSha.toLowerCase() !== remediationRevisionSha.toLowerCase()) {
      return this.contradictory(request, 'RESEARCH_REVISION_MISMATCH: research request SHA does not match the remediation revision SHA');
    }

    switch (request.requestType) {
      case 'FIELD_EXISTS':
        return this.fieldExists(request, repoPath);
      case 'METHOD_SIGNATURE':
        return this.methodSignature(request, repoPath);
      case 'CONSTRUCTOR_SIGNATURE':
        return this.constructorSignature(request, repoPath);
      case 'RELATED_FILES':
        return this.relatedFiles(request, repoPath);
      default:
        // Not yet implemented in this phase (USAGES/CALLERS/CALLEES/
        // API_CONTRACT/DTO_CONTRACT/ENTITY_CONTRACT/TEST_EXPECTATION/
        // CONFIG_VALUE/SYMBOL_TYPE). Reporting NOT_FOUND with an honest
        // reason, never a fabricated answer -- Phase 10 explicitly defers
        // the remaining question classes to a later migration phase.
        return this.notFound(request, [], `Question class '${request.requestType}' is not yet implemented by RepositoryResearchService (R22-A Phase 1 foundation only)`);
    }
  }

  private readFileAtSha(repoPath: string, sha: string, filePath: string): string | null {
    try {
      // stderr silenced: a missing path at this SHA is an expected,
      // frequent outcome (that is the whole point of FIELD_EXISTS/
      // METHOD_SIGNATURE returning NOT_FOUND), not a tool malfunction worth
      // surfacing to the process's own stderr on every such lookup.
      return execFileSync('git', ['-C', repoPath, 'show', `${sha}:${filePath}`], {
        encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch {
      return null;
    }
  }

  /** symbolOrFile format: "<repo-relative-file-path>#<fieldName>" */
  private fieldExists(request: ContextRequest, repoPath: string): ResearchResponse {
    const [filePath, fieldName] = request.symbolOrFile.split('#');
    if (!filePath || !fieldName) {
      return this.contradictory(request, 'FIELD_EXISTS requires symbolOrFile in the form "<file>#<fieldName>"');
    }
    const content = this.readFileAtSha(repoPath, request.revisionSha, filePath);
    if (content == null) {
      return this.notFound(request, [], `File '${filePath}' does not exist at ${request.revisionSha}`);
    }
    // Field declaration heuristic: a line with a type + the exact field name
    // followed by ';' or '=' or annotation-decorated, but never a method
    // (which always has '(' before the terminator).
    const fieldPattern = new RegExp(
      `^\\s*(?:@\\w+(?:\\([^)]*\\))?\\s*)*(?:private|public|protected|static|final|transient|volatile|\\s)*[\\w<>\\[\\],.]+\\s+${escapeRegExp(fieldName)}\\s*(=[^;]*)?;\\s*$`,
      'm',
    );
    const lines = content.split('\n');
    const matchIndex = lines.findIndex(line => fieldPattern.test(line) && !line.includes('('));
    const evidence: EvidenceEntry[] = [{ file: filePath, revisionSha: request.revisionSha, subject: fieldName }];
    if (matchIndex === -1) {
      return this.notFound(request, evidence, `No field named '${fieldName}' found in '${filePath}' at ${request.revisionSha}`);
    }
    const declaration = lines[matchIndex].trim();
    const typeMatch = declaration.match(new RegExp(`([\\w<>\\[\\],.]+)\\s+${escapeRegExp(fieldName)}\\s*(?:=|;)`));
    return {
      requestId: request.requestId,
      revisionSha: request.revisionSha,
      state: 'RESOLVED',
      facts: [{ exists: true, fieldName, type: typeMatch ? typeMatch[1] : null, declaration }],
      evidence,
    };
  }

  /** symbolOrFile format: "<repo-relative-file-path>#<methodName>" */
  private methodSignature(request: ContextRequest, repoPath: string): ResearchResponse {
    const [filePath, methodName] = request.symbolOrFile.split('#');
    if (!filePath || !methodName) {
      return this.contradictory(request, 'METHOD_SIGNATURE requires symbolOrFile in the form "<file>#<methodName>"');
    }
    const content = this.readFileAtSha(repoPath, request.revisionSha, filePath);
    const evidence: EvidenceEntry[] = [{ file: filePath, revisionSha: request.revisionSha, subject: methodName }];
    if (content == null) {
      return this.notFound(request, [], `File '${filePath}' does not exist at ${request.revisionSha}`);
    }
    const methodPattern = new RegExp(
      `([\\w<>\\[\\],.]+)\\s+${escapeRegExp(methodName)}\\s*\\(([^)]*)\\)`,
    );
    const match = content.match(methodPattern);
    if (!match) {
      return this.notFound(request, evidence, `No method named '${methodName}' found in '${filePath}' at ${request.revisionSha}`);
    }
    return {
      requestId: request.requestId,
      revisionSha: request.revisionSha,
      state: 'RESOLVED',
      facts: [{ exists: true, methodName, returnType: match[1], parameters: match[2].trim() }],
      evidence,
    };
  }

  /** symbolOrFile format: "<repo-relative-file-path>#<ClassName>" */
  private constructorSignature(request: ContextRequest, repoPath: string): ResearchResponse {
    const [filePath, className] = request.symbolOrFile.split('#');
    if (!filePath || !className) {
      return this.contradictory(request, 'CONSTRUCTOR_SIGNATURE requires symbolOrFile in the form "<file>#<ClassName>"');
    }
    const content = this.readFileAtSha(repoPath, request.revisionSha, filePath);
    const evidence: EvidenceEntry[] = [{ file: filePath, revisionSha: request.revisionSha, subject: className }];
    if (content == null) {
      return this.notFound(request, [], `File '${filePath}' does not exist at ${request.revisionSha}`);
    }
    const ctorPattern = new RegExp(`(?:public|private|protected)\\s+${escapeRegExp(className)}\\s*\\(([^)]*)\\)`, 'g');
    const matches = [...content.matchAll(ctorPattern)];
    if (matches.length === 0) {
      return this.notFound(request, evidence, `No explicit constructor found for '${className}' in '${filePath}' at ${request.revisionSha} (may rely on an implicit/generated no-arg constructor or a Lombok annotation, which this heuristic does not resolve)`);
    }
    return {
      requestId: request.requestId,
      revisionSha: request.revisionSha,
      state: 'RESOLVED',
      facts: matches.map(m => ({ exists: true, className, parameters: m[1].trim() })),
      evidence,
    };
  }

  /** symbolOrFile format: "<search term>" -- files under repoPath referencing it at the exact SHA. */
  private relatedFiles(request: ContextRequest, repoPath: string): ResearchResponse {
    const term = request.symbolOrFile;
    let output: string;
    try {
      output = execFileSync('git', ['-C', repoPath, 'grep', '-l', '-I', term, request.revisionSha, '--'], { encoding: 'utf8' });
    } catch (err: any) {
      // git grep exits 1 with empty stdout when nothing matches -- that is a
      // real NOT_FOUND, not a tool error.
      if (err?.status === 1) {
        return this.notFound(request, [], `No files reference '${term}' at ${request.revisionSha}`);
      }
      return this.contradictory(request, `git grep failed unexpectedly: ${err?.message || 'unknown error'}`);
    }
    const files = output.split('\n').map(line => line.replace(`${request.revisionSha}:`, '')).filter(Boolean);
    return {
      requestId: request.requestId,
      revisionSha: request.revisionSha,
      state: 'RESOLVED',
      facts: files.map(file => ({ file })),
      evidence: files.map(file => ({ file, revisionSha: request.revisionSha, subject: term })),
    };
  }

  private notFound(request: ContextRequest, evidence: EvidenceEntry[], reason: string): ResearchResponse {
    return { requestId: request.requestId, revisionSha: request.revisionSha, state: 'NOT_FOUND', facts: [{ reason }], evidence };
  }

  private contradictory(request: ContextRequest, reason: string): ResearchResponse {
    return { requestId: request.requestId, revisionSha: request.revisionSha, state: 'CONTRADICTORY', facts: [{ reason }], evidence: [] };
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
