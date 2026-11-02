// Contrôle la cohérence du gate avec les profils de contrôle Maven au cours de la qualification.
import { canDispatchSecurityRemediationV1_8, LIVE_WRITER_SUPPORTED_EDIT_TYPES } from './v1_8-security-remediation-gate';
import { V1_8CompatibilityDecisionService } from './v1_8-compatibility-decision.service';

const service = new V1_8CompatibilityDecisionService();

console.log('══════════════════════════════════════════════════');
console.log('V1.8 Phase 6 — Phase 2: control gate verification (SnakeYAML, real live task context)');
console.log('══════════════════════════════════════════════════');
{
  const evidence = service.lookup('OWASP', 'CVE-2022-25857', 'org.yaml:snakeyaml', '1.29');
  console.log('state:', evidence.state);
  console.log('sandboxValidated:', evidence.sandboxValidated);
  console.log('targetCveClosed:', evidence.targetCveClosed);
  console.log('newHighCriticalCount:', evidence.newHighCriticalCount);
  console.log('requiresDeveloperReview:', evidence.requiresDeveloperReview);
  console.log('editType:', evidence.editType);
  console.log('writerSupported:', LIVE_WRITER_SUPPORTED_EDIT_TYPES.has(evidence.editType!));

  // Real live task context: manual_remediation_tasks row
  // 306e8b84-90fe-4344-8fd6-5c38fcabcf40 (OWASP), project
  // 3aa1c9b9-e114-40e4-884b-ebc7aa32e002 (souhaiel11/pfe-app-test), incident
  // a1cee307-dcca-49b4-a490-5d1fdfe55fb8, evaluatedSha (from its own
  // securityFindingRemediation.evaluatedSha) 7ae0f954f99628b69ce9b42f42c1e2acc8568d99.
  const realTaskContext = {
    repository: 'souhaiel11/pfe-app-test', commitSha: '7ae0f954f99628b69ce9b42f42c1e2acc8568d99',
    source: 'OWASP', cve: 'CVE-2022-25857', component: 'org.yaml:snakeyaml', installedVersion: '1.29',
    statusPermitsDispatch: true,
  };
  const gate = canDispatchSecurityRemediationV1_8(realTaskContext, evidence);
  console.log('commit evidence exact-match:', evidence.validatedCommitSha === realTaskContext.commitSha);
  console.log('GATE:', gate.decision, gate.reason);
}

console.log();
console.log('══════════════════════════════════════════════════');
console.log('Phase 4/10 — negative safety checks (evaluation ONLY, no dispatch)');
console.log('══════════════════════════════════════════════════');
/** Contrôle Blocked. */
function checkBlocked(label: string, source: 'OWASP' | 'TRIVY', cve: string, pkg: string, installedVersion: string) {
  const evidence = service.lookup(source, cve, pkg, installedVersion);
  const context = { repository: evidence.repository, commitSha: evidence.validatedCommitSha, source: evidence.findingSource, cve: evidence.cve, component: evidence.component, installedVersion: evidence.installedVersion, statusPermitsDispatch: true };
  const gate = canDispatchSecurityRemediationV1_8(context, evidence);
  console.log(`${label}: ${gate.decision} (${gate.reason})`);
}
checkBlocked('H2 (CVE-2022-45868)', 'OWASP', 'CVE-2022-45868', 'com.h2database:h2', '2.1.212');
checkBlocked('spring-web (CVE-2024-22259)', 'TRIVY', 'CVE-2024-22259', 'org.springframework:spring-web', '5.3.20');
checkBlocked('Tomcat CVE-2024-24549', 'OWASP', 'CVE-2024-24549', 'org.apache.tomcat.embed:tomcat-embed-core', '9.0.63');
checkBlocked('PARENT_VERSION VALIDATED_RECOMMENDED (jackson-databind CVE-2022-42003)', 'OWASP', 'CVE-2022-42003', 'com.fasterxml.jackson.core:jackson-databind', '2.13.3');

console.log('\nv1_8_phase6_control_gate_check.ts: DONE');
