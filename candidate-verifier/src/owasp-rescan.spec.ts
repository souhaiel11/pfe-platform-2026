// Teste le composant « owasp-rescan » et ses cas d’erreur.
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as cp from 'child_process';
import { OwaspRescanner, validateOwaspReport } from './owasp-rescan';
import { ArtifactRuntimeError, trackedSourceDigest } from './security-artifact-validator';
import { RemoteBuilderArtifactValidator } from './remote-builder-artifact-validator';
const target='CVE-2099-12345';
/** Prépare les données nécessaires à ce scénario. */
const native=(present=false):any=>({reportSchema:'1.1',scanInfo:{engineVersion:'12.2.2',dataSource:[{name:'NVD'}]},dependencies:[{fileName:'example.jar',sha256:'a'.repeat(64),vulnerabilities:present?[{name:target}]:[]}]});
validateOwaspReport(native(),[target]);
assert.throws(()=>validateOwaspReport(native(true),[target]),/OWASP_TARGET_FINDING_STILL_PRESENT/);
for(const r of [{}, {...native(),dependencies:[]}, {...native(),scanInfo:{engineVersion:'12.2.2',dataSource:[],analysisExceptions:['error']}}]) assert.throws(()=>validateOwaspReport(r,[target]),ArtifactRuntimeError);
const suppressed=native();suppressed.dependencies[0].suppressedVulnerabilities=[{name:target}];assert.throws(()=>validateOwaspReport(suppressed,[target]),/STILL_PRESENT/);
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'owasp-unit-')),workspace=path.join(temp,'source'),db=path.join(temp,'db');fs.mkdirSync(workspace);fs.mkdirSync(db);fs.writeFileSync(path.join(db,'odc.mv.db'),'test-only');fs.writeFileSync(path.join(workspace,'source.txt'),'source');cp.execFileSync('git',['init','-q'],{cwd:workspace});cp.execFileSync('git',['add','source.txt'],{cwd:workspace});
try {
 /** Vérifie les résultats attendus dans ce scénario. */
 const command:any=(_cmd:string,args:string[],options:any)=>{assert.equal(_cmd,'mvn');assert.ok(options.timeout<=5000);assert.equal(options.env.BUILDER_INTERNAL_SECRET,undefined);const config=fs.readFileSync(args[args.indexOf('-f')+1],'utf8');assert.ok(config.includes('<failOnError>true</failOnError>'));assert.ok(config.includes('<skip>false</skip>'));fs.writeFileSync(path.join(options.cwd,'dependency-check-report.json'),JSON.stringify(native()));return ''};
 const scanner=new OwaspRescanner(command,db),proof=scanner.inspect(workspace,[target],5000);assert.equal(proof.targetFindingRemoved,true);assert.equal(proof.sourceDigest,trackedSourceDigest(workspace));
 assert.throws(()=>new OwaspRescanner(command,path.join(temp,'missing')).inspect(workspace,[target],5000),/OWASP_DATABASE/);
 for(const error of [Object.assign(new Error('execution'),{status:1}),Object.assign(new Error('missing'),{code:'ENOENT'}),Object.assign(new Error('timeout'),{code:'ETIMEDOUT',signal:'SIGKILL'})]) {
  assert.throws(()=>new OwaspRescanner((()=>{throw error}) as any,db).inspect(workspace,[target],5000),(e:any)=>e instanceof ArtifactRuntimeError && (error.message==='timeout'?e.code==='RUNTIME_OPERATION_TIMEOUT':e.code==='RUNTIME_COMMAND_FAILED'));
 }
 assert.throws(()=>new OwaspRescanner((()=> '') as any,db).inspect(workspace,[target],5000),/OWASP_REPORT/);
 const mutable:any=require('child_process'),original=mutable.execFileSync;let owaspCalls=0,trivyPass=true,owaspPass=true;
 const fake:any={
 /** Inspecte les données ou l’artefact pour en tirer des preuves. */
 inspect:()=>{owaspCalls++;if(!owaspPass)throw Error('OWASP_TARGET_FINDING_STILL_PRESENT');return proof}};
 try {
  /** Prépare les données nécessaires à ce scénario. */
  mutable.execFileSync=(cmd:string,args:any,options:any)=>cmd==='curl'?JSON.stringify(trivyPass?{ok:true,scan:{sourceDigest:proof.sourceDigest}}:{ok:false,code:'RUNTIME_COMMAND_FAILED',stage:'TRIVY_SCAN'}):original(cmd,args,options);
  const validator=new RemoteBuilderArtifactValidator('http://unused','test-only',fake);
  assert.ok((validator.inspect(workspace,5000,[target]) as any).owasp);assert.equal(owaspCalls,1);
  trivyPass=false;assert.throws(()=>validator.inspect(workspace,5000,[target]),/TRIVY_SCAN/);assert.equal(owaspCalls,1);
  trivyPass=true;owaspPass=false;assert.throws(()=>validator.inspect(workspace,5000,[target]),/OWASP_TARGET_FINDING_STILL_PRESENT/);
 } finally {mutable.execFileSync=original;}
 console.log('Dual scanner pass/fail, report integrity, unavailable/error/timeout and target retention: PASS');
} finally {fs.rmSync(temp,{recursive:true,force:true});}
