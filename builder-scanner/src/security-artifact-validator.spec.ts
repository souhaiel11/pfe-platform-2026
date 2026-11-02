// Teste le composant « security-artifact-validator » et ses cas d’erreur.
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { ArtifactRuntimeError, SECURITY_ARTIFACT_RUNTIME, TrivyImageArtifactValidator, provesSecurityClosure } from './security-artifact-validator';
import { MIN_STAGE_BUDGET_MS } from '../../backend/src/security-remediation/security-remediation-deadline-contract';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v17-runtime-faults-'));
const repo = path.join(root, 'repo');
execFileSync('git', ['clone', '--no-hardlinks', process.env.SECURITY_TEST_REPO || '/home/souhaiel/pfe-2026/pfe-app-test', repo], { stdio: 'pipe' });
const f = JSON.parse(fs.readFileSync(path.join(__dirname, '../../backend/src/security-remediation/fixtures/v17/logback.json'), 'utf8'));
const secrets = ['DB_PASS', 'JWT_SECRET', 'N8N_INTERNAL_SECRET', 'GITHUB_TOKEN', 'JENKINS_TOKEN', 'SONAR_TOKEN', 'N8N_API_KEY', 'DOCKER_HOST', 'CONTAINER_HOST', 'TRIVY_IGNORE_UNFIXED', 'HTTPS_PROXY'];
const saved = Object.fromEntries(secrets.map(k => [k, process.env[k]]));
for (const key of secrets) process.env[key] = 'synthetic-secret-must-not-reach-scanner';
const codes: Record<string, string> = {
 'podman-unavailable': 'RUNTIME_EXECUTABLE_UNAVAILABLE', 'invalid-rootless': 'ROOTLESS_BUILDER_REQUIRED',
 'trivy-unavailable': 'RUNTIME_EXECUTABLE_UNAVAILABLE', 'wrong-version': 'TRIVY_VERSION_MISMATCH',
 'scanner-nonzero': 'RUNTIME_COMMAND_FAILED', 'build-timeout': 'RUNTIME_OPERATION_TIMEOUT',
 'scanner-timeout': 'RUNTIME_OPERATION_TIMEOUT', 'malformed-json': 'MALFORMED_SCANNER_JSON',
 'incomplete-report': 'INCOMPLETE_SCANNER_REPORT', 'build-failure': 'RUNTIME_COMMAND_FAILED',
 'cleanup-failure': 'RUNTIME_CLEANUP_FAILED',
 // V1.7 runtime stabilization phase, Phase A — the new explicit
 // per-base-image `podman pull` stage is its own real failure surface now
 // (a real registry unreachable/timeout), never silently swallowed.
 'base-image-pull-timeout': 'RUNTIME_OPERATION_TIMEOUT', 'base-image-pull-failure': 'RUNTIME_COMMAND_FAILED',
};
try {
 for (const scenario of ['success', 'residual-cve', ...Object.keys(codes)]) {
  let imagePresent = false, scratch = '', buildAttempted = false;
  const calls: any[] = [];
  /** Prépare les données nécessaires à ce scénario. */
  const fail = (status = 2, code?: string): never => { throw Object.assign(Error('injected'), { status, code }); };
  const adapter = new TrivyImageArtifactValidator((command, args, options) => {
   calls.push({ command, args, options }); scratch = options.cwd;
   assert.ok(Number.isFinite(options.timeout) && options.timeout > 0);
   assert.equal(options.killSignal, 'SIGKILL');
   assert.ok(!secrets.some(k => k in options.env));
   assert.ok(!args.includes('--privileged') && !args.some(a => a.includes('docker.sock')));
   // V1.7 chroot-isolation build mode is scoped to the build command ONLY --
   // info/save/image-exists/image-rm remain byte-for-byte unchanged.
   assert.equal(args.includes('--isolation=chroot'), command === 'podman' && args[0] === 'build');
   if (command === 'podman' && args[0] === 'info') {
    if (scenario === 'podman-unavailable') fail(0, 'ENOENT');
    return scenario === 'invalid-rootless' ? 'false' : 'true';
   }
   if (command === 'trivy' && args[0] === '--version') {
    if (scenario === 'trivy-unavailable') fail(0, 'ENOENT');
    return scenario === 'wrong-version' ? 'Version: 0.69.3' : 'Version: 0.72.0';
   }
   if (command === 'podman' && args[0] === 'pull') {
    // V1.7 runtime stabilization phase, Phase A/D — the real Logback
    // fixture's own Dockerfile has exactly 2 real external FROM images
    // (maven:3.8.6-openjdk-11, eclipse-temurin:11-jre-alpine); this stage
    // runs once per image, BEFORE the build, freshly resolving each --
    // same security property as the pre-existing implicit `--pull=true`
    // default, just separately timed and attributed.
    assert.equal(args.length, 2, 'podman pull <image>, nothing else');
    if (scenario === 'base-image-pull-timeout') fail(0, 'ETIMEDOUT');
    if (scenario === 'base-image-pull-failure') fail();
    return '';
   }
   if (command === 'podman' && args[0] === 'build') {
    buildAttempted = true; imagePresent = true;
    // V1.7 chroot-isolation build mode: exact, deterministic argument
    // construction (not just presence checks) -- proves --isolation=chroot
    // is really the build command actually issued, in a fixed position,
    // every single scenario, never conditionally omitted.
    assert.deepEqual(args.slice(0, 5), ['build', '--isolation=chroot', '--rm=true', '--force-rm=true', '--layers=false']);
    // V1.7 runtime stabilization phase — the build itself never re-pulls:
    // PODMAN_BASE_IMAGE_PULL above already did, explicitly and freshly.
    assert.ok(args.includes('--pull=never'), 'the build must not ALSO implicitly re-pull -- PODMAN_BASE_IMAGE_PULL already did, explicitly');
    assert.ok(!args.some(a => a.startsWith('--security-opt')), 'no seccomp override on the build call');
    assert.ok(!args.includes('--cap-add'), 'no additional capability requested by application code');
    assert.equal(options.timeout, SECURITY_ARTIFACT_RUNTIME.imageBuildTimeoutMs);
    if (scenario === 'build-timeout') fail(0, 'ETIMEDOUT');
    if (scenario === 'build-failure') fail();
    return '';
   }
   if (command === 'podman' && args[0] === 'save') { fs.writeFileSync(args[args.indexOf('--output') + 1], 'synthetic-image'); return ''; }
   if (command === 'trivy' && args[0] === 'image') {
    assert.equal(options.timeout, SECURITY_ARTIFACT_RUNTIME.scanTimeoutMs);
    for (const flag of ['--offline-scan', '--skip-db-update', '--skip-java-db-update', '--skip-check-update', '--skip-version-check', '--list-all-pkgs']) assert.ok(args.includes(flag));
    assert.equal(fs.readFileSync(args[args.indexOf('--ignorefile') + 1], 'utf8'), '');
    if (scenario === 'scanner-nonzero') fail();
    if (scenario === 'scanner-timeout') fail(0, 'ETIMEDOUT');
    fs.writeFileSync(args[args.indexOf('--output') + 1], scenario === 'malformed-json' ? '{bad'
      : JSON.stringify(scenario === 'incomplete-report' ? {} : scenario === 'residual-cve' ? f.v16Report : f.coordinatedReport));
    return '';
   }
   if (command === 'podman' && args[0] === 'image' && args[1] === 'exists') { if (!imagePresent) fail(1); return ''; }
   if (command === 'podman' && args[0] === 'image' && args[1] === 'rm') {
    if (scenario === 'cleanup-failure') fail(); imagePresent = false; return '';
   }
   throw Error('Unexpected command: ' + command + ' ' + args.join(' '));
  });
  if (codes[scenario]) assert.throws(() => adapter.inspect(repo), (e: any) => e instanceof ArtifactRuntimeError && e.code === codes[scenario], scenario);
  else {
   const result = adapter.inspect(repo);
   assert.equal(provesSecurityClosure(result, { targetCve: 'CVE-2023-6378', affectedPackages: ['classic', 'core'].map(n => ({ package: 'ch.qos.logback:logback-' + n, targetVersion: '1.2.13' })) } as any), scenario === 'success');
   assert.ok(result.timings!.TOTAL_ARTIFACT_DURATION_MS >= 0);
  }
  assert.equal(fs.existsSync(scratch), false, scenario + ': temporary reports removed');
  if (scenario !== 'cleanup-failure') assert.equal(imagePresent, false, scenario + ': temporary image absent');
  if (buildAttempted) assert.ok(calls.some(c => c.args[0] === 'image' && c.args[1] === 'rm'), scenario + ': cleanup attempted, even after failed build');
 }
 // V1.7 Blocker B — `budgetMs` (the caller's remaining overall-deadline
 // budget) is exercised here at the artifact-validator level, one layer
 // below the orchestrator's own deadline.spec.ts integration coverage
 // (candidate-verifier/src/security-remediation-orchestrator.deadline.spec.ts).
 {
  // #5 (remaining-budget exhaustion prevents starting another expensive
  // phase), at its smallest granularity: a budget already below
  // MIN_STAGE_BUDGET_MS when inspect() is entered must refuse to run even
  // the FIRST stage (podman preflight) -- zero subprocess calls, never a
  // 0ms/negative timeout handed to execFileSync.
  const calls: any[] = [];
  const adapter = new TrivyImageArtifactValidator((command, args, options) => { calls.push({ command, args }); return 'true'; });
  assert.throws(() => adapter.inspect(repo, MIN_STAGE_BUDGET_MS - 1),
    (e: any) => e instanceof ArtifactRuntimeError && e.code === 'WORKER_DEADLINE_EXCEEDED' && e.stage === 'PODMAN_PREFLIGHT');
  assert.equal(calls.length, 0, 'budget already exhausted: not even the first (cheap) preflight command is attempted');
 }
 {
  // Budget propagation: a budget that comfortably covers preflight but is
  // far SHORTER than the fixed 20-minute imageBuildTimeoutMs default must
  // shrink the actual `podman build` timeout accordingly -- never the old
  // fixed per-call cap once a deadline is in play.
  const seen: number[] = [];
  const budgetMs = 5_000;
  const adapter = new TrivyImageArtifactValidator((command, args, options) => {
   if (command === 'podman' && args[0] === 'build') { seen.push(options.timeout); return ''; }
   if (command === 'podman' && args[0] === 'info') return 'true';
   // Image de base déclarée ABSENTE (code 1) : ce test porte sur la
   // propagation du budget au build, et veut donc conserver le chemin
   // complet pull -> build, pas le raccourci « déjà en cache ».
   if (command === 'podman' && args[0] === 'image' && args[1] === 'exists') throw Object.assign(Error('absent'), { status: 1 });
   if (command === 'podman' && args[0] === 'pull') return '';
   if (command === 'trivy' && args[0] === '--version') return 'Version: 0.72.0';
   throw new ArtifactRuntimeError('RUNTIME_COMMAND_FAILED', 'STOP_AFTER_BUILD_TIMEOUT_CHECK');
  });
  assert.throws(() => adapter.inspect(repo, budgetMs));
  assert.equal(seen.length, 1, 'the build stage was reached and its timeout captured');
  assert.ok(seen[0] < SECURITY_ARTIFACT_RUNTIME.imageBuildTimeoutMs, 'build timeout was shrunk to the remaining budget, not the fixed 20-minute default');
  assert.ok(seen[0] <= budgetMs, 'build timeout never exceeds the caller-supplied budget');
 }
 {
  // budgetMs omitted entirely (legacy call shape, still used by every
  // existing scenario above via adapter.inspect(repo)) must behave EXACTLY
  // as before this phase: each stage gets its own fixed default, unchanged.
  const adapter = new TrivyImageArtifactValidator((command, args, options) => {
   if (command === 'podman' && args[0] === 'info') { assert.equal(options.timeout, SECURITY_ARTIFACT_RUNTIME.preflightTimeoutMs); return 'true'; }
   throw new ArtifactRuntimeError('RUNTIME_COMMAND_FAILED', 'STOP_AFTER_PREFLIGHT_CHECK');
  });
  assert.throws(() => adapter.inspect(repo));
 }
 // ── Image de base déjà en cache local -> le pull est SAUTÉ ────────────────
 // Motivation réelle : l'étape de fermeture de sécurité échouait en
 // RUNTIME_COMMAND_FAILED:PODMAN_BASE_IMAGE_PULL (« TLS handshake timeout »
 // vers registry-1.docker.io, 3/3 tentatives) alors que les deux images de
 // base étaient DÉJÀ dans le store podman. Le build tournant avec
 // `--pull=never`, exiger un accès registre pour une image déjà présente
 // rendait toute la chaîne dépendante d'une sortie réseau dont elle n'a pas
 // besoin. Ce test fixe le contrat : présence locale prouvée -> aucun pull.
 {
  const calls: any[] = [];
  let imagePresent = false;
  const adapter = new TrivyImageArtifactValidator((command, args, options) => {
   calls.push({ command, args });
   if (command === 'podman' && args[0] === 'info') return 'true';
   if (command === 'trivy' && args[0] === '--version') return 'Version: 0.72.0';
   // Toutes les images de base répondent « présente » AVANT le build :
   // c'est précisément la situation constatée en production.
   if (command === 'podman' && args[0] === 'image' && args[1] === 'exists') {
    const isTemporaryBuildTag = String(args[2] ?? '').startsWith('localhost/security-closure:');
    if (isTemporaryBuildTag && !imagePresent) throw Object.assign(Error('absent'), { status: 1 });
    return '';
   }
   if (command === 'podman' && args[0] === 'build') { imagePresent = true; return ''; }
   if (command === 'podman' && args[0] === 'save') { fs.writeFileSync(args[args.indexOf('--output') + 1], 'synthetic-image'); return ''; }
   if (command === 'trivy' && args[0] === 'image') {
    fs.writeFileSync(args[args.indexOf('--output') + 1], JSON.stringify(f.coordinatedReport));
    return '';
   }
   if (command === 'podman' && args[0] === 'image' && args[1] === 'rm') { imagePresent = false; return ''; }
   throw Error('Unexpected command: ' + command + ' ' + args.join(' '));
  });
  const result = adapter.inspect(repo);
  assert.equal(calls.some(c => c.command === 'podman' && c.args[0] === 'pull'), false,
    'image de base déjà présente localement : aucun `podman pull` ne doit être tenté');
  assert.ok(calls.some(c => c.command === 'podman' && c.args[0] === 'build'),
    'le build doit quand même avoir lieu -- sauter le pull ne doit pas sauter le build');
  assert.ok(result.timings!.BASE_IMAGE_EXISTS >= 0, 'la vérification de présence est chronométrée séparément');
  assert.equal(result.timings!.PODMAN_BASE_IMAGE_PULL, undefined,
    'aucun temps de pull ne doit être compté quand le pull est sauté');
 }
 // Et le contrôle négatif indissociable : image ABSENTE -> le pull reste
 // obligatoire, et son échec reste bloquant. Sauter le pull ne doit jamais
 // devenir « scanner une image qu'on n'a pas ».
 {
  const calls: any[] = [];
  const adapter = new TrivyImageArtifactValidator((command, args, options) => {
   calls.push({ command, args });
   if (command === 'podman' && args[0] === 'info') return 'true';
   if (command === 'trivy' && args[0] === '--version') return 'Version: 0.72.0';
   if (command === 'podman' && args[0] === 'image' && args[1] === 'exists') throw Object.assign(Error('absent'), { status: 1 });
   if (command === 'podman' && args[0] === 'pull') throw Object.assign(Error('injected'), { status: 2 });
   if (command === 'podman' && args[0] === 'image' && args[1] === 'rm') return '';
   throw Error('Unexpected command: ' + command + ' ' + args.join(' '));
  });
  assert.throws(() => adapter.inspect(repo),
    (e: any) => e instanceof ArtifactRuntimeError && e.stage === 'PODMAN_BASE_IMAGE_PULL' && e.code === 'RUNTIME_COMMAND_FAILED',
    'image de base absente : l\'échec du pull doit rester bloquant');
  assert.equal(calls.some(c => c.command === 'podman' && c.args[0] === 'build'), false,
    'aucun build ne doit suivre un pull échoué');
 }
 console.log('Base image cache: PASS (présence locale -> pull sauté, build conservé ; absence -> pull obligatoire et bloquant, aucun build)');
 console.log('Default artifact adapter: PASS (15 fault/success scenarios; secret allowlist, pinned version, cleanup and residual-CVE rejection; command-injected tests; V1.7 deadline-budget propagation and pre-stage refusal; runtime-stabilization-phase base-image-pull fault injection)');
} finally {
 for (const key of secrets) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; }
 fs.rmSync(root, { recursive: true, force: true });
}
