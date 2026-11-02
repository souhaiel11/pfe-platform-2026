// Agent de recherche en lecture seule sur le dépôt.
import { Injectable } from '@nestjs/common';
import { execFileSync } from 'child_process';
import { ContextRequest, EvidenceEntry, ResearchResponse } from './context.types';

@Injectable()
export class RepositoryResearchService {
  /** Répond à une question de recherche sur le dépôt (existence d'un champ, signature d'une méthode/constructeur, fichiers liés) en lisant le vrai contenu du dépôt à l'exact SHA demandé. */
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
        return this.notFound(request, [], `Question class '${request.requestType}' is not yet implemented by RepositoryResearchService (R22-A Phase 1 foundation only)`);
    }
  }

  // Lit le contenu d'un fichier à un SHA précis via `git show`, ou `null` si le
  // fichier n'existe pas à ce SHA (cas attendu, pas une erreur).
  private readFileAtSha(repoPath: string, sha: string, filePath: string): string | null {
    try {
      return execFileSync('git', ['-C', repoPath, 'show', `${sha}:${filePath}`], {
        encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch {
      return null;
    }
  }

  // Cherche si un champ existe dans un fichier à un SHA donné, par une heuristique de
  // déclaration (type + nom + `;`/`=`, jamais une méthode). symbolOrFile : "<fichier>#<nomChamp>".
  private fieldExists(request: ContextRequest, repoPath: string): ResearchResponse {
    const [filePath, fieldName] = request.symbolOrFile.split('#');
    if (!filePath || !fieldName) {
      return this.contradictory(request, 'FIELD_EXISTS requires symbolOrFile in the form "<file>#<fieldName>"');
    }
    const content = this.readFileAtSha(repoPath, request.revisionSha, filePath);
    if (content == null) {
      return this.notFound(request, [], `File '${filePath}' does not exist at ${request.revisionSha}`);
    }
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

  // Cherche la signature (type de retour + paramètres) d'une méthode dans un fichier à un
  // SHA donné. symbolOrFile : "<fichier>#<nomMéthode>".
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

  // Cherche tous les constructeurs explicites d'une classe dans un fichier à un SHA
  // donné (ne résout pas un constructeur implicite/Lombok). symbolOrFile : "<fichier>#<NomClasse>".
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

  // Liste les fichiers du dépôt qui référencent un terme de recherche à l'exact SHA
  // demandé, via `git grep`. symbolOrFile : le terme recherché.
  private relatedFiles(request: ContextRequest, repoPath: string): ResearchResponse {
    const term = request.symbolOrFile;
    let output: string;
    try {
      output = execFileSync('git', ['-C', repoPath, 'grep', '-l', '-I', term, request.revisionSha, '--'], { encoding: 'utf8' });
    } catch (err: any) {
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

  // Construit une réponse « fait absent » : NOT_FOUND est un fait constaté, jamais
  // une instruction de création implicite.
  private notFound(request: ContextRequest, evidence: EvidenceEntry[], reason: string): ResearchResponse {
    return { requestId: request.requestId, revisionSha: request.revisionSha, state: 'NOT_FOUND', facts: [{ reason }], evidence };
  }

  // Construit une réponse « contradictoire » : la requête elle-même est invalide ou
  // incohérente avec son propre contrat.
  private contradictory(request: ContextRequest, reason: string): ResearchResponse {
    return { requestId: request.requestId, revisionSha: request.revisionSha, state: 'CONTRADICTORY', facts: [{ reason }], evidence: [] };
  }
}

// Échappe les caractères spéciaux d'une chaîne pour l'utiliser littéralement dans une RegExp.
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
