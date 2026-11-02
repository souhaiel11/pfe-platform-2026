// Applique les fichiers proposés sur le commit de base du candidat.
import { Injectable, Optional } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { CandidateFile, CandidateManifest } from '../../backend/src/candidate-verification/candidate-verification.types';
import { computeContentSha256 } from '../../backend/src/candidate-verification/candidate-digest';
import { ScopeLockService } from '../../backend/src/context/scope-lock.service';

export class MaterializationError extends Error {
  /** Initialise l’erreur avec son contexte. */
  constructor(message: string, public readonly failureClass: 'CANDIDATE_MANIFEST_INVALID' | 'CANDIDATE_MATERIALIZATION_FAILED' | 'CANDIDATE_CONTENT_MISMATCH') {
    super(message);
    this.name = 'MaterializationError';
  }
}

@Injectable()
export class CandidateMaterializer {
  /** Initialise les dépendances et l’état de ce composant. */
  constructor(@Optional() private readonly scopeLock: ScopeLockService = new ScopeLockService()) {}

  /** Prépare les fichiers du candidat dans son espace de travail. */
  materialize(workspacePath: string, manifest: CandidateManifest, allowedPaths?: string[]): void {
    const resolvedRoot = path.resolve(workspacePath) + path.sep;

    if (allowedPaths) {
      const scope = this.scopeLock.evaluate({ approvedFindingFiles: allowedPaths, provenRegressionFiles: [], proposedFiles: manifest.files.map(f => f.path) });
      if (!scope.allInScope) {
        throw new MaterializationError(`Candidate touches out-of-scope file(s): ${scope.outOfScopeFiles.join(', ')}`, 'CANDIDATE_MANIFEST_INVALID');
      }
    }

    for (const file of manifest.files) {
      this.validatePath(file.path, resolvedRoot);
      this.writeOne(workspacePath, resolvedRoot, file);
    }
  }

  /** Refuse un chemin qui sort du périmètre autorisé. */
  private validatePath(candidatePath: string, resolvedRoot: string): void {
    if (path.isAbsolute(candidatePath)) {
      throw new MaterializationError(`Absolute path rejected: ${candidatePath}`, 'CANDIDATE_MANIFEST_INVALID');
    }
    const normalized = candidatePath.replace(/\\/g, '/');
    const segments = normalized.split('/');
    if (segments.includes('..') || segments.includes('.')) {
      throw new MaterializationError(`Path traversal segment rejected: ${candidatePath}`, 'CANDIDATE_MANIFEST_INVALID');
    }
    if (segments[0] === '.git') {
      throw new MaterializationError(`Write into .git/ rejected: ${candidatePath}`, 'CANDIDATE_MANIFEST_INVALID');
    }
    const resolvedTarget = path.resolve(resolvedRoot, candidatePath);
    if (!resolvedTarget.startsWith(resolvedRoot)) {
      throw new MaterializationError(`Path escapes workspace: ${candidatePath}`, 'CANDIDATE_MANIFEST_INVALID');
    }
  }

  /** Écrit élément. */
  private writeOne(workspacePath: string, resolvedRoot: string, file: CandidateFile): void {
    const targetPath = path.resolve(resolvedRoot, file.path);
    const existsOnDisk = fs.existsSync(targetPath);

    if (file.operation === 'MODIFY') {
      if (!existsOnDisk) {
        throw new MaterializationError(`MODIFY target does not exist at candidateBaseSha: ${file.path}`, 'CANDIDATE_MATERIALIZATION_FAILED');
      }
    } else if (file.operation === 'CREATE') {
      if (existsOnDisk) {
        throw new MaterializationError(`CREATE target already exists at candidateBaseSha: ${file.path}`, 'CANDIDATE_MATERIALIZATION_FAILED');
      }
    } else {
      // DELETE (or anything else) is unsupported this phase — reject
      // explicitly rather than silently no-op'ing or reinterpreting it as
      // MODIFY/CREATE.
      throw new MaterializationError(`Unsupported candidate file operation '${(file as any).operation}' for ${file.path} (DELETE is not supported in R22-C)`, 'CANDIDATE_MANIFEST_INVALID');
    }

    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, file.content, 'utf8');

    // POST-MATERIALIZATION DIGEST PROOF: read back what actually landed on
    // disk and hash IT, never trust file.content's own claimed hash. This
    // is the single mechanism that also catches a manifest whose `content`
    // was tampered with relative to its own declared contentSha256 -- the
    // written bytes simply won't match either way.
    const writtenContent = fs.readFileSync(targetPath, 'utf8');
    const actualSha256 = computeContentSha256(writtenContent);
    if (actualSha256 !== file.contentSha256) {
      throw new MaterializationError(
        `Post-write content hash mismatch for ${file.path}: expected ${file.contentSha256}, got ${actualSha256}`,
        'CANDIDATE_CONTENT_MISMATCH',
      );
    }
  }
}
