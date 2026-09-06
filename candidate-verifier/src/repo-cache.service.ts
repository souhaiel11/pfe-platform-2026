// R22-E — repository materialization for the CandidateVerification HTTP
// endpoint. CandidateVerificationService (R22-C) assumes an already-local
// clone exists (proven this session against manually-managed dev clones);
// a live caller (WF2, via HTTP) has no such clone, so this fills that one
// real gap: clone-once, fetch-thereafter, into a deterministic cache path.
//
// Deliberately minimal: public HTTPS clone only, no token handling. This
// platform's demo projects (pfe-app-test) are public; a private-repo
// extension would need an explicit, separate credential-binding decision
// (same caution as R22-D's Sonar-position audit) -- not silently assumed
// here.
import { Injectable, Optional, BadRequestException } from '@nestjs/common';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const DEFAULT_CACHE_ROOT = '/var/pfe-remediation-repos';
const SEGMENT_PATTERN = /^[A-Za-z0-9_.-]+$/;

function isValidRepositoryIdentifier(repository: string): boolean {
  const segments = repository.split('/');
  if (segments.length !== 2) return false;
  return segments.every(segment => segment.length > 0 && segment !== '.' && segment !== '..' && SEGMENT_PATTERN.test(segment));
}

@Injectable()
export class RepoCacheService {
  constructor(@Optional() private readonly cacheRoot: string = DEFAULT_CACHE_ROOT) {}

  /** Returns a local path with an up-to-date fetch of `repository` ("owner/name"). Clones on first use, fetches otherwise. */
  ensureRepo(repository: string): string {
    if (!isValidRepositoryIdentifier(repository)) {
      throw new BadRequestException(`Invalid repository identifier: ${JSON.stringify(repository)}`);
    }
    const cachePath = path.resolve(this.cacheRoot, repository.replace('/', '__'));
    const cacheRootResolved = path.resolve(this.cacheRoot) + path.sep;
    if (!cachePath.startsWith(cacheRootResolved)) {
      throw new BadRequestException('Computed repo cache path escapes the cache root.');
    }

    if (fs.existsSync(path.join(cachePath, '.git'))) {
      execFileSync('git', ['-C', cachePath, 'fetch', '--all', '--prune'], { stdio: ['ignore', 'pipe', 'pipe'] });
    } else {
      fs.mkdirSync(path.dirname(cachePath), { recursive: true });
      execFileSync('git', ['clone', `https://github.com/${repository}.git`, cachePath], { stdio: ['ignore', 'pipe', 'pipe'] });
    }
    return cachePath;
  }
}
