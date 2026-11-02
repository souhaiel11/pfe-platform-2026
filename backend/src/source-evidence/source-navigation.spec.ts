// Teste le composant « source-navigation » et ses cas d’erreur.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { jenkinsBuildEvidence, rebaseOnto, resolveJenkinsBrowserUrl, resolveSonarqubeBrowserUrl } from '../common/source-evidence';
import { buildProjectEvidence } from './source-evidence.assembler';

test('public platform addresses precede stale legacy IPs, explicit public project addresses stay authoritative', () => {
  const env = { JENKINS_PUBLIC_URL: 'http://localhost:8082', SONARQUBE_PUBLIC_URL: 'http://localhost:9000' };
  assert.equal(resolveJenkinsBrowserUrl({jenkinsUrl:'http://172.26.174.59:8082'}, env),'http://localhost:8082');
  assert.equal(resolveJenkinsBrowserUrl({jenkinsPublicUrl:'https://ci.example.org/jenkins',jenkinsUrl:'http://jenkins:8080'}, env),'https://ci.example.org/jenkins');
  assert.equal(resolveSonarqubeBrowserUrl({sonarqubeUrl:'http://172.26.1.3:9000'}, env),'http://localhost:9000');
});
test('Jenkins build links preserve the public context path once and designate the requested build', () => {
  const base = {baseUrl:'https://ci.example.org/jenkins',jobPath:'folder/job/app/job/main',buildNumber:17};
  for (const recordedBuildUrl of ['http://jenkins:8080/job/folder/job/app/job/main/17/', 'http://old.example/old/job/folder/job/app/job/main/17/']) {
    assert.equal(jenkinsBuildEvidence({...base,recordedBuildUrl}).url,'https://ci.example.org/jenkins/job/folder/job/app/job/main/17/');
  }
  for (const recordedBuildUrl of ['http://jenkins:8080/', 'http://jenkins:8080/job/app/16/', 'javascript:alert(1)']) {
    assert.equal(jenkinsBuildEvidence({...base,recordedBuildUrl}).url,'https://ci.example.org/jenkins/job/folder/job/app/job/main/17/');
  }
  assert.equal(jenkinsBuildEvidence({...base,buildNumber:null,recordedBuildUrl:'http://jenkins:8080/job/a/17/'}).url,null);
  assert.equal(rebaseOnto('https://ci.example.org/jenkins','http://jenkins:8080/jenkins/job/a/17/'),'https://ci.example.org/jenkins/job/a/17/');
});
test('Azure portal links use an explicit display default without modifying deployment configuration', () => {
  const project = {id:'a',name:'A',azureConfig:{resourceGroup:'group with space',targetName:'aci-a',registry:'registrya'}};
  const before=JSON.stringify(project);
  const subscription='11111111-2222-3333-4444-555555555555';
  const view=buildProjectEvidence({project,latest:null,artifact:null,env:{AZURE_PORTAL_SUBSCRIPTION_ID:subscription}});
  assert.ok(view.slots.AZURE_TARGET.url?.includes('/subscriptions/'+subscription+'/'));
  assert.ok(view.slots.AZURE_RESOURCE_GROUP.url?.includes('/resourceGroups/group%20with%20space/overview'));
  assert.equal(view.slots.ACR_REGISTRY.availability,'LINK');
  assert.equal(JSON.stringify(project),before);
  const absent=buildProjectEvidence({project,latest:null,artifact:null,env:{}});
  assert.equal(absent.slots.AZURE_TARGET.url,null);
  assert.equal(absent.slots.AZURE_RESOURCE_GROUP.url,null);
});
