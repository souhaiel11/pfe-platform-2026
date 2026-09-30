import * as assert from 'node:assert/strict';
import { platformCapabilities } from './platform-capabilities';
import { LIVE_WRITER_SUPPORTED_EDIT_TYPES } from '../dependency-compatibility/v1_8-security-remediation-gate';
import { v1_8EnforcementMode } from '../dependency-compatibility/v1_8-enforcement-mode';
const previous = process.env.V1_8_SECURITY_ENFORCEMENT;
try {
  for (const mode of ['SHADOW', 'ENFORCED']) {
    process.env.V1_8_SECURITY_ENFORCEMENT = mode;
    const empty = platformCapabilities([], [], {});
    assert.equal(empty.remediation.enforcementMode, v1_8EnforcementMode());
    assert.deepEqual(empty.remediation.supportedEditTypes, [...LIVE_WRITER_SUPPORTED_EDIT_TYPES].sort());
    assert.equal(empty.security.length, 0);
    assert.equal(empty.deployment.agentConfigured, false);
  }
  const project = {id:'second',cicdTool:'jenkins',jenkinsJobName:'other-job',jenkinsInternalUrl:'http://ci.test',azureConfig:{resourceGroup:'other'}};
  const report = {projectId:'second',createdAt:'2026-09-30T12:00:00Z',rawData:{enrichedData:{stages:{trivy:{stage:'trivy',status:'PASSED'}},trivy:{status:'COMPLETED',cves:[],cves_count:0}}}};
  const result = platformCapabilities([project], [report], {AZURE_DEPLOY_AGENT_SECRET:'test-only'});
  assert.equal(result.security.length, 1);assert.equal(result.security[0].id,'trivy');assert.equal(result.security[0].projectsCompleted,1);
  assert.equal(result.ci.configuredProjects,1);assert.equal(result.deployment.configuredProjects,1);
  assert.ok(!JSON.stringify(result).includes('test-only'));
  report.rawData.enrichedData.trivy.status='NOT_RUN';
  assert.equal(platformCapabilities([project],[report],{}).security[0].projectsCompleted,0);
  assert.equal(platformCapabilities([], [report], {}).security.length,0,'reports outside project scope are ignored');
  console.log('Read-only capability projection uses real stages/configuration and canonical V1.8 sources: PASS');
} finally { if(previous === undefined) delete process.env.V1_8_SECURITY_ENFORCEMENT; else process.env.V1_8_SECURITY_ENFORCEMENT=previous; }
