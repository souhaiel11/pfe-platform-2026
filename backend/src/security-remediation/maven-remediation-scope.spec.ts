import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { computeGitBlobSha1 } from '../candidate-verification/candidate-digest';
import { localMavenControls, applyMavenControls, deriveMavenRemediationScope, MavenScopeEvidence, graphClosesScope } from './maven-remediation-scope';
import { writeSecurityPatch } from './maven-security-patch-writer';
import { assertSecurityPatchSafeToWrite } from './security-patch-guard';
import { computeSecurityCandidateIdentity } from './security-candidate-identity';
const f = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/v17/logback.json'), 'utf8'));
const pkg = 'ch.qos.logback:logback-classic', target = '1.2.13';
const controls = localMavenControls(f.source, pkg, target);
const evidence: MavenScopeEvidence = {
  targetCve: 'CVE-2023-6378', evaluatedSha: f.sha, originalBlobSha: computeGitBlobSha1(f.source),
  baselineTree: f.baseTree, baselineEffectivePom: f.baseEffective,
  cveTargets: ['classic', 'core'].map(n => ({ package: 'ch.qos.logback:logback-' + n, installedVersion: '1.2.11', fixedVersions: ['1.3.12', '1.4.12', target], location: 'app.jar' })),
  experiments: controls.map(c => { const data = f[c.kind === 'LOCAL_PROPERTY' ? 'property-only' : 'v16'];
    return { control: c, sourceSha256: createHash('sha256').update(data.source).digest('hex'), dependencyTree: data.tree, effectivePom: data.effective }; }),
};
const derive = (e = evidence) => deriveMavenRemediationScope(f.source, pkg, target, 'pom.xml', e);
const scope = derive();
assert.equal(scope.kind, 'COORDINATED_SAME_FILE');
assert.equal(scope.controls.length, 2);
assert.equal(applyMavenControls(f.source, scope.controls), f.coordinated.source);
assert.equal(graphClosesScope(f.baseTree, f.v16.tree, scope), false);
assert.equal(graphClosesScope(f.baseTree, f.coordinated.tree, scope), true);
const req: any = { findingIdentity: 'finding', evaluatedSha: f.sha, ecosystem: 'MAVEN', provenanceKind: 'DIRECT_EXPLICIT', package: pkg,
  installedVersion: '1.2.11', targetVersion: target, controllingFile: 'pom.xml', controllingElement: '<version>1.2.11</version>',
  controllingProperty: null, sourceContent: f.source, remediationScope: scope, scopeEvidence: evidence };
const decision: any = { findingIdentity: 'finding', evaluatedSha: f.sha, provenance: { installedVersion: '1.2.11' }, remediationType: 'AUTO_FIX_ELIGIBLE', selectedTargetVersion: target, remediationScope: scope };
const result = writeSecurityPatch(req); assert.equal(result.ok, true);
const candidate = (result as any).candidate;
assert.equal(assertSecurityPatchSafeToWrite(decision, req, candidate).ok, true);
const dependencyBlocks = [...f.coordinated.source.matchAll(/<dependency>[\s\S]*?<\/dependency>/g)].map(m => m[0]);
const reorderedDependencies = f.coordinated.source.replace(dependencyBlocks[0], '__FIRST_DEPENDENCY__')
  .replace(dependencyBlocks[1], dependencyBlocks[0]).replace('__FIRST_DEPENDENCY__', dependencyBlocks[1]);
for (const content of [
  f.v16.source,
  reorderedDependencies,
  f.coordinated.source.replace('<java.version>11</java.version>', '<java.version>17</java.version>'),
  f.coordinated.source.replace('<version>1.2.13</version>', '<version>1.2.14</version>'),
  f.coordinated.source.replace('</dependencies>', '<dependency><groupId>x</groupId><artifactId>y</artifactId></dependency></dependencies>'),
  f.coordinated.source.replace('</dependency>', '<exclusions><exclusion><groupId>ch.qos.logback</groupId><artifactId>logback-core</artifactId></exclusion></exclusions></dependency>'),
  f.coordinated.source.replace('</properties>', '<maven.test.skip>true</maven.test.skip></properties>'),
  f.coordinated.source.replace('<failBuildOnCVSS>9</failBuildOnCVSS>', '<failBuildOnCVSS>11</failBuildOnCVSS>'),
  f.coordinated.source.replace(/<dependency>[\s\S]*?<\/dependency>/, ''),
]) assert.equal(assertSecurityPatchSafeToWrite(decision, req, { ...candidate, file: { ...candidate.file, content } }).ok, false);
assert.equal(writeSecurityPatch({ ...req, remediationScope: { ...scope, controls: scope.controls.slice(0, 1) } }).ok, false);
assert.equal(assertSecurityPatchSafeToWrite(decision, { ...req, remediationScope: undefined }, candidate).ok, false);
const noCommon = JSON.parse(JSON.stringify(evidence)); noCommon.cveTargets[1].fixedVersions = ['2.0.0'];
assert.throws(() => derive(noCommon), /NO_COMMON/);
// Same group, different advisory: changing its version is not authorized.
const unrelated = { ...evidence, cveTargets: evidence.cveTargets.slice(0, 1) };
const single = derive(unrelated); assert.equal(single.controls.length, 1); assert.equal(single.controls[0].kind, 'DEPENDENCY_VERSION');
const id = { findingIdentity: 'finding', evaluatedSha: f.sha, package: pkg, installedVersion: '1.2.11', targetVersion: target, controllingFile: 'pom.xml' };
assert.notEqual(computeSecurityCandidateIdentity(id), computeSecurityCandidateIdentity({ ...id, remediationScope: scope }));
assert.notEqual(computeSecurityCandidateIdentity({ ...id, remediationScope: single }), computeSecurityCandidateIdentity({ ...id, remediationScope: scope }));
assert.equal(computeSecurityCandidateIdentity({ ...id, remediationScope: derive() }), computeSecurityCandidateIdentity({ ...id, remediationScope: scope }));
for (const bad of [
  f.source.replace('</properties>', '<logback.version>1.2.11</logback.version></properties>'),
  f.source.replace('</dependencies>', '<dependency><groupId>ch.qos.logback</groupId><artifactId>logback-classic</artifactId><version>1.2.11</version></dependency></dependencies>'),
  f.source.replace('</project>', '<profiles/></project>'),
]) assert.throws(() => localMavenControls(bad, pkg, target));
const reordered = JSON.parse(JSON.stringify(evidence)); reordered.experiments.reverse();
assert.deepEqual(derive(reordered), scope);
// Property-managed single-control behavior remains valid without changing provenance.
const propertySource = '<project><properties><v>1.2.11</v></properties><dependencies><dependency><groupId>g</groupId><artifactId>a</artifactId><version>${v}</version></dependency></dependencies></project>';
const pc = localMavenControls(propertySource, 'g:a', target)[0], patched = applyMavenControls(propertySource, [pc]);
const model = (v: string) => '<project><dependencies><dependency><groupId>g</groupId><artifactId>a</artifactId><version>' + v + '</version></dependency></dependencies></project>';
const tree = (v: string) => 'root:p:jar:1\n+- g:a:jar:' + v + ':compile\n';
const pe: MavenScopeEvidence = { targetCve: 'CVE-2023-6378', evaluatedSha: f.sha, originalBlobSha: computeGitBlobSha1(propertySource), baselineTree: tree('1.2.11'), baselineEffectivePom: model('1.2.11'),
 cveTargets: [{ package: 'g:a', installedVersion: '1.2.11', fixedVersions: [target], location: 'app.jar' }],
 experiments: [{ control: pc, sourceSha256: createHash('sha256').update(patched).digest('hex'), dependencyTree: tree(target), effectivePom: model(target) }] };
assert.equal(deriveMavenRemediationScope(propertySource, 'g:a', target, 'pom.xml', pe).kind, 'SINGLE_CONTROL');
console.log('V1.7 scope: real Logback controls, complete graph, bounded byte guard, common target, unrelated advisory, identity, ambiguity and single-property cases PASS');
