import * as assert from 'node:assert/strict';
import { SecurityFindingResolverService } from './security-finding-resolver.service';

const PROJECT_ID = 'project-1';
const INCIDENT_ID = 'incident-1';
const TASK_ID = 'task-logback-1';
const REAL_SHA = 'a81be45709aba07da50d44206d073c2eb55892b5';

function fakeRepos(overrides: { tasks?: any[]; incidents?: any[]; projects?: any[] } = {}) {
  const tasks = overrides.tasks ?? [
    { id: TASK_ID, projectId: PROJECT_ID, incidentId: INCIDENT_ID, findingFingerprint: 'fp-logback-1', source: 'TRIVY', ruleOrCve: 'CVE-2023-6378', title: 'logback: serialization vulnerability',
      findingSnapshot: { component: 'ch.qos.logback:logback-classic', currentVersion: '1.2.11', fixedVersion: '1.3.12, 1.4.12, 1.2.13' } },
  ];
  const incidents = overrides.incidents ?? [
    { id: INCIDENT_ID, projectId: PROJECT_ID, metadata: { sourceCommitSha: REAL_SHA } },
  ];
  const projects = overrides.projects ?? [
    { id: PROJECT_ID, githubRepo: 'souhaiel11/pfe-app-test' },
  ];
  const tasksRepo: any = { findOne: async ({ where }: any) => tasks.find(t => t.id === where.id) || null };
  const incidentsRepo: any = { findOne: async ({ where }: any) => incidents.find(i => i.id === where.id) || null };
  const projectsRepo: any = { findOne: async ({ where }: any) => projects.find(p => p.id === where.id) || null };
  return { tasksRepo, incidentsRepo, projectsRepo };
}

async function main() {
  // Happy path.
  {
    const { tasksRepo, incidentsRepo, projectsRepo } = fakeRepos();
    const service = new SecurityFindingResolverService(tasksRepo, incidentsRepo, projectsRepo);
    const result: any = await service.resolve(PROJECT_ID, TASK_ID);
    assert.equal(result.ok, true, `happy path: ${JSON.stringify(result)}`);
    assert.equal(result.repository, 'souhaiel11/pfe-app-test');
    assert.equal(result.candidateBaseSha, REAL_SHA);
    assert.equal(result.finding.findingIdentity, 'fp-logback-1');
    assert.equal(result.finding.source, 'TRIVY');
    assert.equal(result.finding.package, 'ch.qos.logback:logback-classic');
    assert.equal(result.finding.expectedInstalledVersion, '1.2.11');
    assert.equal(result.finding.fixedVersion, '1.3.12, 1.4.12, 1.2.13');
    assert.equal(result.cveId, 'CVE-2023-6378', 'V1.5: cveId is threaded through, cosmetic only, real persisted ruleOrCve');
    assert.equal(result.title, 'logback: serialization vulnerability');
  }
  console.log('security-finding-resolver) happy path resolves trusted evidence from persisted rows: PASS');

  // E. unknown finding id -> reject.
  {
    const { tasksRepo, incidentsRepo, projectsRepo } = fakeRepos();
    const service = new SecurityFindingResolverService(tasksRepo, incidentsRepo, projectsRepo);
    const result: any = await service.resolve(PROJECT_ID, 'no-such-task');
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'UNKNOWN_FINDING');
  }
  console.log('security-finding-resolver E) unknown finding id -> UNKNOWN_FINDING: PASS');

  // F. finding/project mismatch -> reject.
  {
    const { tasksRepo, incidentsRepo, projectsRepo } = fakeRepos();
    const service = new SecurityFindingResolverService(tasksRepo, incidentsRepo, projectsRepo);
    const result: any = await service.resolve('some-other-project', TASK_ID);
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'FINDING_PROJECT_MISMATCH');
  }
  console.log('security-finding-resolver F) finding belongs to a different project -> FINDING_PROJECT_MISMATCH: PASS');

  // PROJECT_NOT_FOUND.
  {
    const { tasksRepo, incidentsRepo, projectsRepo } = fakeRepos({ projects: [] });
    const service = new SecurityFindingResolverService(tasksRepo, incidentsRepo, projectsRepo);
    const result: any = await service.resolve(PROJECT_ID, TASK_ID);
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'PROJECT_NOT_FOUND');
  }
  console.log('security-finding-resolver) unknown project -> PROJECT_NOT_FOUND: PASS');

  // MISSING_REPOSITORY_BINDING.
  {
    const { tasksRepo, incidentsRepo, projectsRepo } = fakeRepos({ projects: [{ id: PROJECT_ID, githubRepo: null }] });
    const service = new SecurityFindingResolverService(tasksRepo, incidentsRepo, projectsRepo);
    const result: any = await service.resolve(PROJECT_ID, TASK_ID);
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'MISSING_REPOSITORY_BINDING');
  }
  console.log('security-finding-resolver) project without githubRepo -> MISSING_REPOSITORY_BINDING: PASS');

  // INCIDENT_NOT_FOUND.
  {
    const { tasksRepo, incidentsRepo, projectsRepo } = fakeRepos({ incidents: [] });
    const service = new SecurityFindingResolverService(tasksRepo, incidentsRepo, projectsRepo);
    const result: any = await service.resolve(PROJECT_ID, TASK_ID);
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'INCIDENT_NOT_FOUND');
  }
  console.log('security-finding-resolver) dangling incidentId -> INCIDENT_NOT_FOUND: PASS');

  // G. repository/project mismatch (incident belongs to a different project
  // than the caller-supplied/task-recorded one) -> reject. A SECOND,
  // independent ownership check -- never relies on task.projectId alone.
  {
    const { tasksRepo, incidentsRepo, projectsRepo } = fakeRepos({ incidents: [{ id: INCIDENT_ID, projectId: 'a-different-project', metadata: { sourceCommitSha: REAL_SHA } }] });
    const service = new SecurityFindingResolverService(tasksRepo, incidentsRepo, projectsRepo);
    const result: any = await service.resolve(PROJECT_ID, TASK_ID);
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'INCIDENT_PROJECT_MISMATCH');
  }
  console.log('security-finding-resolver G) incident/project ownership mismatch -> INCIDENT_PROJECT_MISMATCH: PASS');

  // H. SHA missing / untrusted SHA -> fail closed. Three malformed shapes.
  for (const badSha of [undefined, null, 'main', 'not-a-sha', 'a'.repeat(39)]) {
    const { tasksRepo, incidentsRepo, projectsRepo } = fakeRepos({ incidents: [{ id: INCIDENT_ID, projectId: PROJECT_ID, metadata: { sourceCommitSha: badSha } }] });
    const service = new SecurityFindingResolverService(tasksRepo, incidentsRepo, projectsRepo);
    const result: any = await service.resolve(PROJECT_ID, TASK_ID);
    assert.equal(result.ok, false, `H: sourceCommitSha=${JSON.stringify(badSha)} must fail closed`);
    assert.equal(result.reason, 'MISSING_TRUSTED_SHA');
  }
  console.log('security-finding-resolver H) missing/malformed sourceCommitSha (undefined/null/"main"/garbage/39-char) -> MISSING_TRUSTED_SHA, never guessed: PASS');

  // INCOMPLETE_FINDING_EVIDENCE.
  {
    const { tasksRepo, incidentsRepo, projectsRepo } = fakeRepos({ tasks: [{ id: TASK_ID, projectId: PROJECT_ID, incidentId: INCIDENT_ID, findingFingerprint: 'fp-1', source: 'TRIVY', findingSnapshot: { component: null, currentVersion: '1.2.11' } }] });
    const service = new SecurityFindingResolverService(tasksRepo, incidentsRepo, projectsRepo);
    const result: any = await service.resolve(PROJECT_ID, TASK_ID);
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'INCOMPLETE_FINDING_EVIDENCE');
  }
  console.log('security-finding-resolver) missing package in snapshot -> INCOMPLETE_FINDING_EVIDENCE: PASS');

  // O (part 1) — same finding resolved twice -> byte-identical trusted output (no randomness).
  {
    const { tasksRepo, incidentsRepo, projectsRepo } = fakeRepos();
    const service = new SecurityFindingResolverService(tasksRepo, incidentsRepo, projectsRepo);
    const first = await service.resolve(PROJECT_ID, TASK_ID);
    const second = await service.resolve(PROJECT_ID, TASK_ID);
    assert.deepEqual(first, second, 'O: resolving the same finding twice must yield byte-identical trusted evidence');
  }
  console.log('security-finding-resolver O) repeated resolution of the same finding -> deterministic, identical trusted evidence: PASS');

  // C. OWASP finding, real always-null fixedVersion (V1's own confirmed
  // real-data fact) -- the resolver itself does not special-case source; it
  // faithfully passes null through (never coerces to "" or fabricates a
  // value) and lets the orchestrator's already-proven eligibility logic
  // (security-eligibility-classifier.ts, decisionService) reject it downstream.
  {
    const { tasksRepo, incidentsRepo, projectsRepo } = fakeRepos({ tasks: [{ id: TASK_ID, projectId: PROJECT_ID, incidentId: INCIDENT_ID, findingFingerprint: 'fp-owasp-1', source: 'OWASP', findingSnapshot: { component: 'ch.qos.logback:logback-classic', currentVersion: '1.2.11', fixedVersion: null } }] });
    const service = new SecurityFindingResolverService(tasksRepo, incidentsRepo, projectsRepo);
    const result: any = await service.resolve(PROJECT_ID, TASK_ID);
    assert.equal(result.ok, true, 'the resolver still resolves trusted evidence for OWASP -- it does not reject on source');
    assert.equal(result.finding.source, 'OWASP');
    assert.equal(result.finding.fixedVersion, null, 'C: real, always-null OWASP fixedVersion passed through faithfully, never fabricated');
  }
  console.log('security-finding-resolver C) OWASP finding, real always-null fixedVersion -> passed through faithfully: PASS');

  // D. ZAP finding -- same principle: resolver resolves trusted evidence
  // generically; source-based rejection is the classifier's job downstream.
  {
    const { tasksRepo, incidentsRepo, projectsRepo } = fakeRepos({ tasks: [{ id: TASK_ID, projectId: PROJECT_ID, incidentId: INCIDENT_ID, findingFingerprint: 'fp-zap-1', source: 'ZAP', findingSnapshot: { component: 'irrelevant-for-zap', currentVersion: '1.0.0', fixedVersion: null } }] });
    const service = new SecurityFindingResolverService(tasksRepo, incidentsRepo, projectsRepo);
    const result: any = await service.resolve(PROJECT_ID, TASK_ID);
    assert.equal(result.ok, true);
    assert.equal(result.finding.source, 'ZAP');
  }
  console.log('security-finding-resolver D) ZAP finding -> trusted evidence still resolved generically, rejection is the classifier\'s job: PASS');

  // P. V1.8 — a persisted v1_8Plan whose actualEditTarget matches THIS
  // task's own package is forwarded as pinnedTargetVersion.
  {
    const { tasksRepo, incidentsRepo, projectsRepo } = fakeRepos({ tasks: [{
      id: TASK_ID, projectId: PROJECT_ID, incidentId: INCIDENT_ID, findingFingerprint: 'fp-pinned-1', source: 'TRIVY', ruleOrCve: 'CVE-2024-22257',
      findingSnapshot: { component: 'org.springframework.security:spring-security-core', currentVersion: '5.6.4', fixedVersion: '5.7.12, 5.8.11, 6.1.8, 6.2.3' },
      securityFindingRemediation: { status: 'DISPATCHING', v1_8Plan: { editType: 'DEPENDENCY_VERSION', actualEditTarget: 'org.springframework.security:spring-security-core', fromVersion: '5.6.4', toVersion: '5.7.12', expectedResolvedDependency: '5.7.12' } },
    }] });
    const service = new SecurityFindingResolverService(tasksRepo, incidentsRepo, projectsRepo);
    const result: any = await service.resolve(PROJECT_ID, TASK_ID);
    assert.equal(result.ok, true);
    assert.equal(result.finding.pinnedTargetVersion, '5.7.12', 'P: matching v1_8Plan.actualEditTarget must be forwarded as pinnedTargetVersion');
  }
  console.log('security-finding-resolver P) V1.8 plan matching this package -> pinnedTargetVersion forwarded: PASS');

  // Q. V1.8 — a persisted v1_8Plan whose actualEditTarget names a DIFFERENT
  // coordinate, AND is not itself a PARENT_VERSION plan (e.g. a stale
  // DEPENDENCY_VERSION/PROPERTY_VERSION pin that names a different package)
  // must NEVER leak into this finding's own pinnedTargetVersion -- fail
  // closed to the existing pure-policy behavior.
  {
    const { tasksRepo, incidentsRepo, projectsRepo } = fakeRepos({ tasks: [{
      id: TASK_ID, projectId: PROJECT_ID, incidentId: INCIDENT_ID, findingFingerprint: 'fp-mismatch-1', source: 'TRIVY', ruleOrCve: 'CVE-2024-22257',
      findingSnapshot: { component: 'org.springframework.security:spring-security-core', currentVersion: '5.6.4', fixedVersion: '5.7.12, 5.8.11' },
      securityFindingRemediation: { status: 'DISPATCHING', v1_8Plan: { editType: 'DEPENDENCY_VERSION', actualEditTarget: 'org.yaml:snakeyaml', fromVersion: '1.29', toVersion: '1.31', expectedResolvedDependency: '1.31' } },
    }] });
    const service = new SecurityFindingResolverService(tasksRepo, incidentsRepo, projectsRepo);
    const result: any = await service.resolve(PROJECT_ID, TASK_ID);
    assert.equal(result.ok, true);
    assert.equal(result.finding.pinnedTargetVersion, undefined, 'Q: a DEPENDENCY_VERSION plan bound to a different actualEditTarget must never be forwarded for this package');
    assert.equal(result.finding.parentRemediationPlan, undefined, 'Q: not a PARENT_VERSION plan at all -- no parentRemediationPlan either');
  }
  console.log('security-finding-resolver Q) non-parent V1.8 plan for a DIFFERENT edit target -> never forwarded, fails closed to pure policy: PASS');

  // R. V1.8 Phase 7B — a PARENT_VERSION plan is forwarded as
  // parentRemediationPlan UNCONDITIONALLY (never gated on
  // actualEditTarget === this finding's own package): an owner/parent
  // remediation's whole point is that the edit target differs from the
  // finding's package (jackson-databind's CVE fixed by bumping the Spring
  // Boot parent, never jackson-databind's own declaration). pinnedTargetVersion
  // must stay undefined (mutually exclusive shapes).
  {
    const { tasksRepo, incidentsRepo, projectsRepo } = fakeRepos({ tasks: [{
      id: TASK_ID, projectId: PROJECT_ID, incidentId: INCIDENT_ID, findingFingerprint: 'fp-parent-1', source: 'OWASP', ruleOrCve: 'CVE-2022-42003',
      findingSnapshot: { component: 'com.fasterxml.jackson.core:jackson-databind', currentVersion: '2.13.3', fixedVersion: null },
      securityFindingRemediation: { status: 'DISPATCHING', v1_8Plan: { editType: 'PARENT_VERSION', actualEditTarget: 'org.springframework.boot:spring-boot-starter-parent', fromVersion: '2.7.0', toVersion: '2.7.18', expectedResolvedDependency: '2.13.5' } },
    }] });
    const service = new SecurityFindingResolverService(tasksRepo, incidentsRepo, projectsRepo);
    const result: any = await service.resolve(PROJECT_ID, TASK_ID);
    assert.equal(result.ok, true);
    assert.notEqual(result.finding.package, 'org.springframework.boot:spring-boot-starter-parent', 'R: sanity -- the finding\'s own package genuinely differs from the parent plan\'s target');
    assert.deepEqual(result.finding.parentRemediationPlan, { actualEditTarget: 'org.springframework.boot:spring-boot-starter-parent', fromVersion: '2.7.0', toVersion: '2.7.18', expectedResolvedDependency: '2.13.5' }, 'R: parent plan (incl. expectedResolvedDependency) forwarded unconditionally, package!=actualEditTarget is expected, not a mismatch');
    assert.equal(result.finding.pinnedTargetVersion, undefined, 'R: mutually exclusive with pinnedTargetVersion');
  }
  console.log('security-finding-resolver R) PARENT_VERSION plan forwarded unconditionally despite package != actualEditTarget: PASS');

  // S. a structurally incomplete PARENT_VERSION plan (missing toVersion)
  // must never be forwarded -- fail closed rather than hand the decision
  // service a partial plan it could misinterpret.
  {
    const { tasksRepo, incidentsRepo, projectsRepo } = fakeRepos({ tasks: [{
      id: TASK_ID, projectId: PROJECT_ID, incidentId: INCIDENT_ID, findingFingerprint: 'fp-parent-incomplete', source: 'OWASP', ruleOrCve: 'CVE-2022-42003',
      findingSnapshot: { component: 'com.fasterxml.jackson.core:jackson-databind', currentVersion: '2.13.3', fixedVersion: null },
      securityFindingRemediation: { status: 'DISPATCHING', v1_8Plan: { editType: 'PARENT_VERSION', actualEditTarget: 'org.springframework.boot:spring-boot-starter-parent', fromVersion: '2.7.0', toVersion: null, expectedResolvedDependency: null } },
    }] });
    const service = new SecurityFindingResolverService(tasksRepo, incidentsRepo, projectsRepo);
    const result: any = await service.resolve(PROJECT_ID, TASK_ID);
    assert.equal(result.ok, true);
    assert.equal(result.finding.parentRemediationPlan, undefined, 'S: an incomplete parent plan must never be forwarded');
  }
  console.log('security-finding-resolver S) structurally incomplete PARENT_VERSION plan (missing toVersion) -> never forwarded: PASS');

  // T. missing v1_8Plan entirely (task never dispatched under ENFORCED, or
  // SHADOW mode) -> no parentRemediationPlan, no pinnedTargetVersion --
  // decide() must take the normal path, never synthesize a parent edit.
  {
    const { tasksRepo, incidentsRepo, projectsRepo } = fakeRepos();
    const service = new SecurityFindingResolverService(tasksRepo, incidentsRepo, projectsRepo);
    const result: any = await service.resolve(PROJECT_ID, TASK_ID);
    assert.equal(result.ok, true);
    assert.equal(result.finding.parentRemediationPlan, undefined, 'T: no v1_8Plan at all -> no parentRemediationPlan');
  }
  console.log('security-finding-resolver T) no v1_8Plan at all -> no parentRemediationPlan forwarded: PASS');

  console.log('security-finding-resolver.service.spec.ts: ALL CHECKS PASS');
}

main().catch(err => { console.error(err); process.exitCode = 1; });
