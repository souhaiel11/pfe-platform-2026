// V1.7 predeploy phase — the REAL execution adapter, moved here verbatim
// from candidate-verifier/src/security-artifact-validator.ts. This is now
// the ONLY place in the whole platform that execs podman/trivy, and the
// ONLY process that needs (validation-only, never production-applied
// without separate authorization) CAP_SYS_ADMIN. candidate-verifier's own
// decision logic (grounding, scope, patch, guard, candidate identity,
// write authorization) never runs in this process and never holds this
// capability -- see server.ts's own header comment for the full boundary.
//
// Nothing about the ADAPTER'S OWN internal logic changed in this move: same
// env allowlist, same rootless/version preflight, same --isolation=chroot
// (V1.7 runtime-provisioning finding: the default OCI/crun pivot_root()
// path is unconditionally denied by Docker's default seccomp profile when
// nested; chroot isolation avoids it entirely), same per-stage deadline
// budget gating, same cleanup-is-part-of-acceptance discipline, same
// ArtifactRuntimeError vocabulary.
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { performance } from 'perf_hooks';
import { SecurityArtifactScan, ArtifactRuntimeError, trackedSourceDigest, cveTargets, provesSecurityClosure } from '../../backend/src/security-remediation/security-artifact-scan';
import { MIN_STAGE_BUDGET_MS } from '../../backend/src/security-remediation/security-remediation-deadline-contract';

export { SecurityArtifactScan, ArtifactRuntimeError, trackedSourceDigest, cveTargets, provesSecurityClosure };

export interface SecurityArtifactValidator {
  inspect(workspace: string, budgetMs?: number): SecurityArtifactScan;
}

/**
 * Offline-capable execution adapter. Requires rootless Podman, uses no Docker
 * socket and forwards only an environment allowlist. Filesystem and network
 * isolation remain responsibilities of the enclosing worker runtime.
 * Missing tools/DB/build/report fail closed. Runtime provisioning is a separate
 * predeploy prerequisite; this does not install tools or alter running services.
 */
export const SECURITY_ARTIFACT_RUNTIME = Object.freeze({
  trivyVersion: '0.72.0',
  preflightTimeoutMs: 30_000,
  imageBuildTimeoutMs: 20 * 60_000,
  imageSaveTimeoutMs: 20 * 60_000,
  scanTimeoutMs: 20 * 60_000,
  cleanupTimeoutMs: 30_000,
});

export type ArtifactCommand = (command: string, args: string[], options: any) => string;

// V1.7 final predeploy phase, Phase F/G orphan-process sweep -- see the
// pidsBeforeBuild comment in inspect() for why this is needed. Reads
// /proc directly (no `ps`/`pgrep` dependency, which this minimal image
// does not install); best-effort, never throws on a process that exits
// mid-read.
function listLivePids(): Set<number> {
  const pids = new Set<number>();
  let entries: string[];
  try { entries = fs.readdirSync('/proc'); } catch { return pids; }
  for (const entry of entries) if (/^\d+$/.test(entry)) pids.add(Number(entry));
  return pids;
}

// V1.7 runtime stabilization phase, Phase A/D — parses a Dockerfile's own
// `FROM` lines to find every REAL external base image it references (a
// multi-stage `FROM <earlier-stage-alias>` is deliberately excluded, since
// that never contacts a registry at all). This lets `inspect()` pull each
// one as its OWN separately-timed stage, rather than lumping registry
// pull time into the same undifferentiated number as the build's actual
// RUN-step execution time -- pure, exported for direct unit testing.
export function parseBaseImages(dockerfileContent: string): string[] {
  const stageAliases = new Set<string>();
  const images: string[] = [];
  const seen = new Set<string>();
  for (const rawLine of dockerfileContent.split('\n')) {
    const match = /^\s*FROM\s+(?:--platform=\S+\s+)?(\S+)(?:\s+AS\s+(\S+))?/i.exec(rawLine);
    if (!match) continue;
    const [, ref, alias] = match;
    if (!stageAliases.has(ref) && !seen.has(ref)) { images.push(ref); seen.add(ref); }
    if (alias) stageAliases.add(alias);
  }
  return images;
}

export class TrivyImageArtifactValidator implements SecurityArtifactValidator {
  // Command injection is a fault-test seam, never part of an HTTP request.
  constructor(private readonly command: ArtifactCommand = (cmd, args, opts) => execFileSync(cmd, args, opts).toString()) {}

  inspect(workspace: string, budgetMs?: number): SecurityArtifactScan {
    const started = performance.now(), timings: Record<string, number> = {};
    const sourceDigest = trackedSourceDigest(workspace);
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'security-closure-'));
    const tag = 'localhost/security-closure:' + path.basename(scratch).toLowerCase();
    const env: NodeJS.ProcessEnv = {};
    // Deliberately exclude proxy variables, TRIVY_* option overrides,
    // CONTAINER_HOST, DOCKER_HOST and all platform credentials.
    for (const k of ['PATH', 'HOME', 'XDG_RUNTIME_DIR', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'LANG'])
      if (process.env[k]) env[k] = process.env[k];
    // V1.7 Blocker B: `budgetMs` (the caller's remaining overall-deadline
    // budget when inspect() was entered) is tracked against inspect()'s OWN
    // elapsed clock and re-checked before every stage, so a slow build
    // cannot silently consume the entire remaining budget before the scan
    // even starts -- each stage gets min(its fixed cap, what is actually
    // left), and a stage whose remaining share has already dropped below
    // MIN_STAGE_BUDGET_MS is never started (never handed a 0ms/negative
    // execFileSync timeout, which Node treats as "no timeout" instead of
    // "no time left").
    const inspectStarted = performance.now();
    const remainingBudget = (): number | undefined =>
      budgetMs === undefined ? undefined : Math.max(0, budgetMs - (performance.now() - inspectStarted));
    // V1.7 runtime stabilization phase, Phase A — accumulates rather than
    // overwrites so a stage called more than once (e.g. PODMAN_BASE_IMAGE_
    // PULL, once per FROM in a multi-stage Dockerfile) reports its TOTAL
    // time, not just its last call's. Every EXISTING stage in this file is
    // still called exactly once, so this is a no-op for all of them.
    const run = (stage: string, cmd: string, args: string[], cap: number) => {
      const remaining = remainingBudget();
      if (remaining !== undefined && remaining < MIN_STAGE_BUDGET_MS) {
        timings[stage] = timings[stage] ?? 0;
        throw new ArtifactRuntimeError('WORKER_DEADLINE_EXCEEDED', stage);
      }
      const timeout = remaining === undefined ? cap : Math.min(cap, Math.floor(remaining));
      const began = performance.now();
      try {
        return this.command(cmd, args, { cwd: scratch, env, encoding: 'utf8', timeout,
          killSignal: 'SIGKILL', maxBuffer: 20 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (error: any) {
        const code = error?.code === 'ENOENT' ? 'RUNTIME_EXECUTABLE_UNAVAILABLE'
          : error?.code === 'ETIMEDOUT' ? 'RUNTIME_OPERATION_TIMEOUT' : 'RUNTIME_COMMAND_FAILED';
        throw new ArtifactRuntimeError(code, stage, typeof error?.status === 'number' ? error.status : undefined);
      } finally { timings[stage] = (timings[stage] ?? 0) + Math.round(performance.now() - began); }
    };
    // Cleanup is teardown of something ALREADY started, not new candidate-
    // evaluation work -- it must never be refused for lack of remaining
    // budget (that would leave a real image/container behind, the exact
    // orphan-resource outcome the deadline exists to prevent). It still
    // carries its own fixed, bounded timeout (cleanupTimeoutMs) so a truly
    // wedged Podman cannot hang forever either.
    const runCleanup = (stage: string, cmd: string, args: string[], cap: number) => {
      const began = performance.now();
      try {
        return this.command(cmd, args, { cwd: scratch, env, encoding: 'utf8', timeout: cap,
          killSignal: 'SIGKILL', maxBuffer: 20 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (error: any) {
        const code = error?.code === 'ENOENT' ? 'RUNTIME_EXECUTABLE_UNAVAILABLE'
          : error?.code === 'ETIMEDOUT' ? 'RUNTIME_OPERATION_TIMEOUT' : 'RUNTIME_COMMAND_FAILED';
        throw new ArtifactRuntimeError(code, stage, typeof error?.status === 'number' ? error.status : undefined);
      } finally { timings[stage] = Math.round(performance.now() - began); }
    };
    const cfg = SECURITY_ARTIFACT_RUNTIME;
    let buildAttempted = false;
    let result: SecurityArtifactScan | undefined, failure: unknown;
    // V1.7 final predeploy phase, Phase F/G real finding: `execFileSync`'s
    // own `timeout`/`killSignal` only ever signals the ONE tracked child
    // pid (`podman build` itself) -- it has no way to also reach that
    // child's OWN descendants. With `--isolation=chroot`, a build's `RUN`
    // step process (e.g. a nested `mvn`) shares this container's OWN pid
    // namespace rather than getting one of its own, so when a SIGKILLed
    // `podman build` never gets the chance to run its own `--force-rm`
    // teardown, that RUN-step process is orphaned -- reparented to this
    // container's PID 1, left running (or, once it exits on its own,
    // stuck as an unreaped zombie, since this image's PID 1 is `node`, not
    // an init that reaps children it did not itself spawn). Discovered for
    // real: a `mvn dependency:go-offline` process was still consuming real
    // CPU and network minutes after the `podman build` that spawned it had
    // already been reported as killed. A snapshot-before/kill-new-orphans-
    // after sweep closes this for any STILL-LIVE runaway process (the
    // Dockerfile's own `init: true`-equivalent -- see docker-compose.yml's
    // builder-scanner service -- separately ensures already-dead orphans
    // are reaped as zombies instead of accumulating forever).
    const pidsBeforeBuild = listLivePids();
    try {
      if (run('PODMAN_PREFLIGHT', 'podman', ['info', '--format', '{{.Host.Security.Rootless}}'], cfg.preflightTimeoutMs).trim() !== 'true')
        throw new ArtifactRuntimeError('ROOTLESS_BUILDER_REQUIRED', 'PODMAN_PREFLIGHT');
      const scannerVersion = run('TRIVY_PREFLIGHT', 'trivy', ['--version'], cfg.preflightTimeoutMs).trim();
      if (!/^Version: 0\.72\.0(?:\r?\n|$)/m.test(scannerVersion))
        throw new ArtifactRuntimeError('TRIVY_VERSION_MISMATCH', 'TRIVY_PREFLIGHT');
      if (!fs.existsSync(path.join(workspace, 'Dockerfile')))
        throw new ArtifactRuntimeError('IMAGE_BUILD_CONTRACT_MISSING', 'IMAGE_BUILD');
      buildAttempted = true;
      // V1.7 runtime stabilization phase, Phase A/D — pull every REAL base
      // image referenced by this Dockerfile as its OWN explicit, timed
      // stage (PODMAN_BASE_IMAGE_PULL) BEFORE building, rather than
      // letting `podman build`'s own implicit pull-check (Podman 4.3.1's
      // default here: `--pull=true`, "always attempt to pull") lump
      // registry-contact time into the same undifferentiated IMAGE_BUILD
      // number as actual RUN-step execution. This does NOT change the
      // freshness/security property at all -- the registry is still
      // contacted fresh on every single evaluation, exactly as before;
      // only the TIMING ATTRIBUTION changes. The build itself then runs
      // with `--pull=never` (we already just resolved every base image
      // ourselves, explicitly and freshly), so its own IMAGE_BUILD number
      // now reflects pure build-execution work.
      for (const image of parseBaseImages(fs.readFileSync(path.join(workspace, 'Dockerfile'), 'utf8')))
        run('PODMAN_BASE_IMAGE_PULL', 'podman', ['pull', image], cfg.imageBuildTimeoutMs);
      // V1.7 runtime stabilization phase, Phase B — bind-mount the
      // persistent Maven cache straight into the nested build's DEFAULT
      // local-repo location (`/root/.m2`, since the target repository's
      // own build stage runs as root -- verified against the real
      // Logback fixture's Dockerfile) via a plain `--volume`, never by
      // rewriting that repository's own Dockerfile. Optional: skipped
      // (never a hard failure) if MAVEN_CACHE_DIR is unset, e.g. in a
      // local dev/test run without the persistent volume configured.
      const mavenCache = process.env.MAVEN_CACHE_DIR;
      run('IMAGE_BUILD', 'podman', ['build', '--isolation=chroot', '--rm=true', '--force-rm=true', '--layers=false',
        '--pull=never',
        ...(mavenCache ? ['--volume', `${mavenCache}:/root/.m2`] : []),
        '--tag', tag, workspace], cfg.imageBuildTimeoutMs);
      const archive = path.join(scratch, 'image.tar'), reportPath = path.join(scratch, 'report.json');
      run('IMAGE_SAVE', 'podman', ['save', '--format', 'docker-archive', '--output', archive, tag], cfg.imageSaveTimeoutMs);
      fs.writeFileSync(path.join(scratch, 'ignore'), '');
      fs.writeFileSync(path.join(scratch, 'config.yaml'), '{}\n');
      const cache = process.env.SECURITY_TRIVY_CACHE_DIR;
      run('TRIVY_SCAN', 'trivy', ['image', '--input', archive, '--scanners', 'vuln,misconfig',
        '--config', path.join(scratch, 'config.yaml'), '--ignorefile', path.join(scratch, 'ignore'),
        ...(cache ? ['--cache-dir', cache] : []),
        '--skip-db-update', '--skip-java-db-update', '--skip-check-update', '--skip-version-check', '--offline-scan',
        '--list-all-pkgs', '--exit-code', '0', '--format', 'json', '--no-progress',
        '--timeout', '20m', '--output', reportPath], cfg.scanTimeoutMs);
      if (trackedSourceDigest(workspace) !== sourceDigest) throw new ArtifactRuntimeError('SCANNER_MUTATED_SOURCE', 'SOURCE_CHECK');
      const raw = fs.readFileSync(reportPath);
      let report: any;
      try { report = JSON.parse(raw.toString()); } catch { throw new ArtifactRuntimeError('MALFORMED_SCANNER_JSON', 'REPORT_PARSE'); }
      result = { mode: 'TRIVY_IMAGE_ARCHIVE', sourceDigest,
        artifactDigest: createHash('sha256').update(fs.readFileSync(archive)).digest('hex'),
        reportDigest: createHash('sha256').update(raw).digest('hex'), buildPassed: true, scannerVersion, report, timings };
      try { cveTargets(result, ''); } catch { throw new ArtifactRuntimeError('INCOMPLETE_SCANNER_REPORT', 'REPORT_PARSE'); }
    } catch (error) {
      failure = error instanceof ArtifactRuntimeError ? error : new ArtifactRuntimeError('RUNTIME_IO_FAILED', 'ARTIFACT_VALIDATION');
    }
    // Cleanup is part of acceptance. Even a successfully scanned candidate
    // cannot return success when its temporary image cannot be removed.
    try {
      if (buildAttempted) {
        const exists = () => {
          try { runCleanup('IMAGE_EXISTS', 'podman', ['image', 'exists', tag], cfg.cleanupTimeoutMs); return true; }
          catch (error) {
            if (error instanceof ArtifactRuntimeError && error.exitCode === 1) return false;
            throw error;
          }
        };
        if (exists()) runCleanup('IMAGE_CLEANUP', 'podman', ['image', 'rm', '--force', tag], cfg.cleanupTimeoutMs);
        if (exists()) throw new ArtifactRuntimeError('RUNTIME_CLEANUP_FAILED', 'IMAGE_CLEANUP');
      }
    } catch { failure = new ArtifactRuntimeError('RUNTIME_CLEANUP_FAILED', 'IMAGE_CLEANUP'); }
    // Orphan-process sweep (see the comment above pidsBeforeBuild): any
    // process alive now that was NOT alive before this build attempt is
    // unambiguously something that build's own command tree spawned --
    // this builder handles exactly one request at a time (its own
    // execFileSync calls block the entire event loop, so no other request
    // can ever be interleaved), so a pre/post PID-set diff alone already
    // scopes this correctly, with no risk of mistaking a concurrent,
    // unrelated process for this one's. Deliberately NOT also filtered to
    // "ppid == 1": some environments interpose a process-subreaper
    // (`PR_SET_CHILD_SUBREAPER`) above literal PID 1, so a genuine orphan
    // may be reparented to that subreaper instead of straight to init --
    // requiring ppid==1 exactly would silently skip exactly the real
    // orphans this sweep exists to catch in such an environment (found via
    // this phase's own real reproduction test).
    // Best-effort: a process that exits between the check and the kill is
    // not an error.
    if (buildAttempted) {
      for (const pid of listLivePids()) {
        if (pidsBeforeBuild.has(pid)) continue;
        try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
      }
    }
    try { fs.rmSync(scratch, { recursive: true, force: true }); }
    catch { failure = new ArtifactRuntimeError('RUNTIME_CLEANUP_FAILED', 'SCRATCH_CLEANUP'); }
    timings.TOTAL_ARTIFACT_DURATION_MS = Math.round(performance.now() - started);
    if (failure) throw failure;
    return result!;
  }
}
