#!/usr/bin/env node
// Read-only static audit of source copied from the installed 2.14.2 package.
// Usage: node wf6-n8n-compatibility.spec.mjs [/tmp/wf6-]
// No container commands, n8n execution, network, import or activation here.
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {test} from 'node:test';
import vm from 'node:vm';
const prefix=process.argv[2] || '/tmp/wf6-';
const sources = Object.fromEntries(['n8n-package.json','HttpRequest.js','HttpRequestV3.js','HttpDescription.js','IfV2.js','Code.js','js-task-runner.js','RespondToWebhook.js','Webhook.js','WebhookUtils.js'].map(name=>[name,readFileSync(prefix+name,'utf8')]));
const [w]=JSON.parse(readFileSync(new URL('../pending-live-update/wf6-security-remediation-maven.OFFLINE-DRAFT.json',import.meta.url)));
test('audit uses n8n 2.14.2 source',()=>assert.equal(JSON.parse(sources['n8n-package.json']).version,'2.14.2'));
test('all emitted node versions supported, workflow inactive',()=>{
 const versions={httpRequest:4.2,if:2.2,code:2,respondToWebhook:1.1,webhook:2};
 const checks={'HttpRequest.js':/4\.2: new HttpRequestV3/,'IfV2.js':/version: \[2, 2\.1, 2\.2/,'Code.js':/version: \[1, 2\]/,'RespondToWebhook.js':/version: \[1, 1\.1/,'Webhook.js':/version: \[1, 1\.1, 2,/};
 for(const [file,pattern] of Object.entries(checks))assert.match(sources[file],pattern);
 for(const n of w.nodes)assert.equal(n.typeVersion,versions[n.type.split('.')[1]]);
 assert.equal(w.active,false);
});
test('HTTP JSON bodies explicitly use specifyBody=json',()=>{
 assert.match(sources['HttpDescription.js'],/name: 'specifyBody'/);assert.match(sources['HttpDescription.js'],/name: 'jsonBody'/);
 for(const n of w.nodes.filter(n=>n.parameters.jsonBody))assert.equal(n.parameters.specifyBody,'json');
});
test('full response preserves empty/nonempty PR arrays in one item',()=>{
 assert.match(sources['HttpRequestV3.js'],/const fullResponseProperties = \['body', 'headers', 'statusCode', 'statusMessage'\]/);
 assert.match(sources['HttpRequestV3.js'],/json: returnItem/);
 for(const n of w.nodes.filter(n=>n.type.endsWith('.httpRequest')))assert.equal(n.parameters.options.response.response.fullResponse,true);
});
test('neverError, continueOnFail and timeout allow explicit failure routing',()=>{
 assert.match(sources['HttpRequestV3.js'],/requestOptions.simple = false/);
 assert.match(sources['HttpRequestV3.js'],/this.continueOnFail\(\)/);
 for(const n of w.nodes.filter(n=>n.type.endsWith('.httpRequest'))){assert.equal(n.continueOnFail,true);assert.equal(n.parameters.options.timeout,30000);assert.equal(n.parameters.options.response.response.neverError,true);}
});
test('redirect nesting disables default HTTP redirects',()=>{
 assert.match(sources['HttpRequestV3.js'],/defaultRedirect = nodeVersion >= 4 && redirect === undefined/);
 assert.match(sources['HttpRequestV3.js'],/redirect\?\.redirect\?\.followRedirects/);
 for(const n of w.nodes.filter(n=>n.type.endsWith('.httpRequest')))assert.equal(n.parameters.options.redirect.redirect.followRedirects,false);
});
test('IF 2.2 uses condition schema v2, exactly true boolean and two outputs',()=>{
 assert.match(sources['IfV2.js'],/\$nodeVersion >= 2\.2 \? 2 : 1/);
 for(const n of w.nodes.filter(n=>n.type.endsWith('.if'))){assert.equal(n.parameters.conditions.options.version,2);assert.equal(n.parameters.conditions.conditions[0].operator.operation,'true');assert.equal(w.connections[n.name].main.length,2);}
});
test('Code v2 all-items mode and Buffer available without external modules',()=>{
 assert.match(sources['Code.js'],/value: 'runOnceForAllItems'/);assert.match(sources['js-task-runner.js'],/\n\s+Buffer,/);
 for(const n of w.nodes.filter(n=>n.type.endsWith('.code'))){assert.equal(n.parameters.mode,'runOnceForAllItems');assert.doesNotMatch(n.parameters.jsCode,/require\(|fetch\(|\$env/);}
});
test('respondToWebhook JSON mode is available and webhook waits for response node',()=>{
 assert.match(sources['RespondToWebhook.js'],/value: 'json'/);assert.match(sources['RespondToWebhook.js'],/name: 'responseBody'/);
 assert.equal(w.nodes.find(n=>n.type.endsWith('.webhook')).parameters.responseMode,'responseNode');
 for(const n of w.nodes.filter(n=>n.type.endsWith('.respondToWebhook')))assert.equal(n.parameters.respondWith,'json');
});
console.log('N8N_STATIC_SOURCE_SHA256 = '+JSON.stringify(Object.fromEntries(Object.entries(sources).map(([name,s])=>[name,createHash('sha256').update(s).digest('hex')]))));

// Exercise the installed 2.14.2 authentication function with synthetic headers
// and synthetic credentials. This never calls n8n or its Webhook endpoint.
const authSource=sources['WebhookUtils.js'];
const authFunction=authSource.slice(authSource.indexOf('async function validateWebhookAuthentication('),authSource.indexOf('async function handleFormData('));
assert.ok(authFunction.startsWith('async function validateWebhookAuthentication('));
class AuthError extends Error {constructor(code,message){super(message);this.responseCode=code;}}
const validateInbound=vm.runInNewContext('('+authFunction+')',{error_1:{WebhookAuthorizationError:AuthError}});
const hook=w.nodes.find(n=>n.type.endsWith('.webhook'));
function authContext(headers,missing=false){return {
 getNodeParameter:()=>hook.parameters.authentication,getRequestObject:()=>({headers}),getHeaderData:()=>headers,
 getCredentials:async type=>{assert.equal(type,'httpHeaderAuth');if(missing)throw new Error('missing offline credential');return {name:'X-WF6-Offline-Test',value:'offline-only-fixture'};},
};}
for(const [label,headers] of [['anonymous',{}],['invalid',{'x-wf6-offline-test':'wrong'}]])test(`${label} header auth rejected before business flow`,async()=>{
 let businessCalls=0;await assert.rejects(async()=>{await validateInbound(authContext(headers),'authentication');businessCalls++;},e=>e.responseCode===403);assert.equal(businessCalls,0);
});
test('valid synthetic managed header auth allows entry, no real workflow execution',async()=>{
 let businessCalls=0;await validateInbound(authContext({'x-wf6-offline-test':'offline-only-fixture'}),'authentication');businessCalls++;assert.equal(businessCalls,1);
});
test('unavailable managed inbound credential fails closed',async()=>{
 await assert.rejects(validateInbound(authContext({},true),'authentication'),e=>e.responseCode===500);
});
test('native Webhook auth rejects once before output is prepared; managed GitHub HTTP supported',()=>{
 assert.equal(hook.parameters.authentication,'headerAuth');assert.ok(hook.credentials.httpHeaderAuth.id);
 const s=sources['Webhook.js'];assert.ok(s.indexOf('await this.validateAuth(context)')<s.indexOf('const prepareOutput'));
 assert.match(s,/resp.writeHead\(error.responseCode/);assert.match(s,/resp.end\(error.message\)/);assert.match(s,/return \{ noWebhookResponse: true \}/);
 assert.match(sources['HttpRequestV3.js'],/authentication === 'predefinedCredentialType'/);
 assert.match(sources['HttpRequestV3.js'],/this.helpers.requestWithAuthentication.call\(this, nodeCredentialType/);
});
