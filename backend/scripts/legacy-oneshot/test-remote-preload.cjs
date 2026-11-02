// Injecte les comportements distants simulés pour qualifier les outils legacy sans utiliser de véritables résultats GitHub/n8n.
'use strict';
if(process.env.CHAIN2B_R2_DISPOSABLE!=='network-none')throw Error('DISPOSABLE_ONLY');
/** Démarre l’écoute du service local. */
require('net').Server.prototype.listen=function(){throw Error('HTTP_OR_SOCKET_LISTENER_FORBIDDEN');};
require('reflect-metadata');require('ts-node').register({transpileOnly:true,project:require('path').resolve(__dirname,'../../tsconfig.json')});
const {legacyCatalog}=require('../../src/manual-remediation/legacy-reconciliation');
/** Envoie la requête et lit la réponse distante. */
global.fetch=async (url,options={})=>{
  url=String(url);const mode=process.env.TEST_REMOTE_MODE||'SETTLED';
  if(process.env.GITHUB_TOKEN&&url.startsWith('https://api.github.com/'))require('assert/strict').equal(options.headers.Authorization,'Bearer '+process.env.GITHUB_TOKEN);
  if(url.includes('/api/v1/executions'))require('assert/strict').equal(options.headers.Authorization,undefined);
  if(mode==='UNAVAILABLE')return new Response('{}',{status:503});
  if(url.includes('/api/v1/executions'))return Response.json({data:mode==='INFLIGHT'?[{workflowId:'RdYyfjVpOm2LxS95',status:'running'}]:[],nextCursor:null});
  if(url.includes('/branches'))return Response.json([{name:'main',commit:{sha:'a'.repeat(40)}},...(mode==='BRANCH'?[{name:legacyCatalog.remoteReferences[0].branch,commit:{sha:'a'.repeat(40)}}]:[])]);
  if(url.includes('/pulls?'))return Response.json(legacyCatalog.remoteReferences.map((r,i)=>({number:r.prNumber,state:mode==='OPEN'&&i===0?'open':'closed',head:{sha:mode==='DRIFT'&&i===0?'b'.repeat(40):r.headSha,ref:r.branch},closed_at:'2026-10-07T00:00:00Z',merged_at:mode==='MERGED'&&i===0?'2026-10-07T00:00:00Z':null})));
  throw Error('UNEXPECTED_TEST_REMOTE');
};
