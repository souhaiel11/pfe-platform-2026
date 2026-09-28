// Real subprocesses with a deterministic mvn stand-in. No network, no WF6.
// This tests sequencing and classification, not real Maven performance.
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { MavenBuildAdapter } from './maven-build-adapter';
import { resolveDependencyTreeOffline } from './maven-dependency-warmup';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'option-b-'));
const baseline = path.join(root, 'baseline');
const candidate = path.join(root, 'candidate');
const bin = path.join(root, 'bin');
for (const dir of [baseline, candidate, bin]) fs.mkdirSync(dir);
const trace = path.join(root, 'trace');
const originalPath = process.env.PATH;
const gav = 'com.example:missing:jar:2.0.0';
const miss = `Cannot access central (https://repo.maven.apache.org/maven2) in offline mode and the artifact ${gav} has not been downloaded from it before.`;
// A non-network plugin-resolution failure representative of MDEP-82.
const pluginMiss = '[ERROR] Failed to execute goal org.apache.maven.plugins:maven-dependency-plugin:3.3.0:go-offline (default-cli): Could not find artifact org.example:plugin-dependency:jar:1.0 in central (https://repo.maven.apache.org/maven2)';
const quote = (s: string) => "'" + s.replace(/'/g, "'\\''") + "'";
function install(warm: string, tree: string, target = 'exit 0') {
  fs.writeFileSync(trace, '');
  fs.writeFileSync(path.join(bin, 'mvn'), `#!/bin/sh
printf '%s|%s\\n' "$PWD" "$*" >> ${quote(trace)}
case "$*" in
*dependency:go-offline*) ${warm} ;;
*dependency:get*) ${target} ;;
*dependency:tree*) ${tree} ;;
*) exit 99 ;;
esac
`, { mode: 0o755 });
}
const fail = (message: string) => `echo ${quote(message)} >&2; exit 1`;
const success = 'echo TREE_STDOUT; for a in "$@"; do case "$a" in -DoutputFile=*) echo "com.example:root:jar:1.0" > "${a#-DoutputFile=}" ;; esac; done; exit 0';
const warmOk = 'echo WARM_STDOUT; exit 0';
const adapter = new MavenBuildAdapter();
let count = 0;
try {
  process.env.PATH = `${bin}:${originalPath}`;
  for (const [name, warm, tree, expected, code] of [
    ['healthy sufficient cache', warmOk, success, 'ANALYSIS_SUCCESS', undefined],
    ['2059 regression: plugin failure, sufficient cache', fail(pluginMiss), success, 'ANALYSIS_SUCCESS', undefined],
    ['network failure, sufficient cache', fail('Connection reset by peer'), success, 'ANALYSIS_SUCCESS', undefined],
    ['unknown failure, sufficient cache', fail('Unexpected warm-up failure'), success, 'ANALYSIS_SUCCESS', undefined],
    ['network failure, insufficient cache', fail('Connection reset by peer'), fail(miss), 'INFRASTRUCTURE_FAILURE', 'WARMUP_NETWORK_FAILURE'],
    ['healthy warm-up, insufficient cache', warmOk, fail(miss), 'ANALYSIS_FAILED', undefined],
    ['non-network resolution failure, insufficient cache', fail(pluginMiss), fail(miss), 'ANALYSIS_FAILED', undefined],
    ['not-found warning cannot explain unrelated failure', fail('Could not find artifact org.example:x:jar:1 in central (https://repo.maven.apache.org/maven2)\n[ERROR] Unexpected internal error'), fail(miss), 'INFRASTRUCTURE_FAILURE', 'WARMUP_FAILED'],
    ['unknown failure remains infrastructure', fail('Unexpected warm-up failure'), fail(miss), 'INFRASTRUCTURE_FAILURE', 'WARMUP_FAILED'],
    ['cached negative is ambiguous', fail(pluginMiss + ' failure was cached in the local repository'), fail(miss), 'INFRASTRUCTURE_FAILURE', 'WARMUP_FAILED'],
    ['transfer failure overrides not-found', fail(pluginMiss + ' Could not transfer artifact: PKIX validation failed'), fail(miss), 'INFRASTRUCTURE_FAILURE', 'WARMUP_FAILED'],
    ['tree exit zero without output remains closed', warmOk, 'echo NO_OUTPUT; exit 0', 'ANALYSIS_FAILED', undefined],
    ['unrelated tree error stays closed', warmOk, fail('Invalid POM'), 'ANALYSIS_FAILED', undefined],
  ]) {
    install(warm!, tree!);
    const result = resolveDependencyTreeOffline(adapter, baseline, candidate, []);
    assert.equal(result.outcome, expected, name);
    assert.equal(result.infrastructureFailure?.code, code, name);
    const calls = fs.readFileSync(trace, 'utf8').trim().split('\n');
    assert.equal(calls.length, 2, name);
    assert.ok(calls[0].startsWith(`${baseline}|dependency:go-offline -B`));
    assert.ok(calls[1].startsWith(`${candidate}|-o dependency:tree -B`));
    assert.ok(!calls.join('\n').includes('silent'));
    assert.ok(result.baselineWarmup.evidenceTail.length > 0);
    assert.ok(result.analysis.evidenceTail.length > 0);
    if (tree === fail(miss)) assert.equal(result.analysis.offlineFailure?.primaryMissingArtifact, gav);
    if (result.infrastructureFailure) assert.equal(result.infrastructureFailure.retryable, true);
    count++;
  }

  install(fail('https://deploy:secret-test@repo.example.test/x Connection reset by peer'), fail(miss));
  const redacted = resolveDependencyTreeOffline(adapter, baseline, candidate, []);
  assert.ok(!JSON.stringify(redacted).includes('secret-test'));
  assert.ok(redacted.baselineWarmup.evidenceTail.includes('***'));
  count++;

  // A real SIGKILL timeout still leaves time for the mandatory offline probe.
  for (const tree of [success, fail(miss)]) {
    install('echo "Downloading from central: https://repo.maven.apache.org/maven2/x.pom"; exec sleep 19.837', tree);
    const started = Date.now();
    const result = resolveDependencyTreeOffline(adapter, baseline, candidate, [], 800);
    assert.equal(result.baselineWarmup.timedOut, true);
    assert.equal(result.baselineWarmup.timeoutEvidence?.lastArtifact, 'central: https://repo.maven.apache.org/maven2/x.pom');
    assert.equal(result.outcome, tree === success ? 'ANALYSIS_SUCCESS' : 'INFRASTRUCTURE_FAILURE');
    assert.equal(result.infrastructureFailure?.code, tree === success ? undefined : 'WARMUP_TIMEOUT');
    assert.ok(Date.now() - started < 1_200, 'probe budget is reserved, not rearmed');
    assert.equal(fs.readFileSync(trace, 'utf8').trim().split('\n').length, 2);
    count++;
  }

  // Baseline failure must not skip approved targets; target infrastructure
  // failure must outrank the baseline's non-network resolution failure.
  install(fail(pluginMiss), fail(miss), fail('Connection reset by peer'));
  const result = resolveDependencyTreeOffline(adapter, baseline, candidate, ['org.example:target:2']);
  assert.equal(result.targetWarmups.length, 1);
  assert.equal(result.infrastructureFailure?.code, 'WARMUP_NETWORK_FAILURE');
  assert.ok(fs.readFileSync(trace, 'utf8').includes(`${baseline}|dependency:get -B -Dartifact=org.example:target:2 -Dtransitive=false`));
  count++;

  // Budget contract, including multiple targets, without waiting minutes.
  const budgets: number[] = [];
  const ok = { status: 'SUCCESS' as const, timedOut: false, durationMs: 0, exitCode: 0, evidenceTail: 'ok' };
  const budgetAdapter = {
    dependencyGoOffline: (_: string, ms: number) => { budgets.push(ms); return ok; },
    resolveArtifact: (_: string, __: string, ms: number) => { budgets.push(ms); return ok; },
    dependencyTree: (_: string, ms: number, options: { offline: boolean }) => {
      budgets.push(ms); assert.equal(options.offline, true);
      return { status: 'SUCCESS' as const, text: 'tree', timedOut: false, evidenceTail: 'ok' };
    },
  } as MavenBuildAdapter;
  resolveDependencyTreeOffline(budgetAdapter, baseline, candidate, ['g:a:1', 'g:b:1'], 300_000);
  assert.ok(budgets[0] <= 80_000);
  assert.ok(budgets.slice(0, 3).every(ms => ms > 0 && ms <= 120_000));
  assert.ok(budgets[3] > 0 && budgets[3] <= 60_000);
  count++;
  console.log(`maven-dependency-warmup: PASS (${count} scenarios)`);
} finally {
  process.env.PATH = originalPath;
  fs.rmSync(root, { recursive: true, force: true });
}
