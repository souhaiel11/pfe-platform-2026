// Teste le composant « project-reads » et ses cas d’erreur.
import * as assert from 'node:assert/strict';
import { analysisPreview, readPage, ProjectReadsService } from './project-reads.module';
const id = '00000000-0000-0000-0000-000000000001';
/** Exécute les étapes principales de ce programme. */
async function main() {
  for (const query of [{}, { projectId: 'invalid' }, { projectId: id, page: '0' }, { projectId: id, pageSize: '101' }, { projectId: id, page: '1;SELECT' }, {projectId:id,analysisOnly:'yes'}]) assert.throws(() => readPage(query));
  assert.equal(readPage({projectId:id}).pageSize,20);
  assert.equal(readPage({projectId:id,page:'2',pageSize:'5'}).offset,5);
  assert.equal(analysisPreview(null), null);
  assert.equal(analysisPreview('broken'), '!invalid-analysis');
  assert.equal(analysisPreview('{"build":8,"decision":"BLOCK","rawData":{"huge":true}}'), '{"build":8,"decision":"BLOCK"}');
  const calls:any[]=[];
  const db:any={
  /** Exécute les opérations dans le cadre transactionnel prévu. */
  transaction:async(isolation,fn)=>{assert.equal(isolation,'REPEATABLE READ');return fn({
  /** Renvoie les termes de recherche courants. */
  query:async(sql,args)=>{
    calls.push({sql,args});if(sql.startsWith('SET'))return [];
    if(sql.includes('count(*)'))return [{total:22}];return [{id:'row',aiAnalysis:'{"build":8,"rawData":{"large":true}}'}];
  }})}};
  const service=new ProjectReadsService(db);
  const page=await service.list('incidents',{projectId:id,analysisOnly:'true',page:'2',pageSize:'20'});
  assert.equal(page.total,22);assert.equal(page.page,2);assert.equal(page.hasNext,true);
  assert.equal(page.items[0].aiAnalysis,'{"build":8}');assert.equal(page.items[0].summaryOnly,true);
  assert.match(calls[0].sql,/READ ONLY/);assert.match(calls[1].sql,/aiAnalysis.*IS NOT NULL/);
  assert.deepEqual(calls[2].args,[id,20,20]);assert.ok(!calls[2].sql.includes('metadata'));assert.ok(!calls[2].sql.includes('JOIN'));
  calls.length=0;await service.list('reports',{projectId:id});assert.match(calls[2].sql,/rawData.*#>/);assert.match(calls[1].sql,/archived.*false/);
  const broken:any={
  /** Exécute les opérations dans le cadre transactionnel prévu. */
  transaction:async()=>{throw Error('DB unavailable')}};await assert.rejects(()=>new ProjectReadsService(broken).list('incidents',{projectId:id}),/DB unavailable/);
  console.log('PASS: pagination validation, authoritative counts, parameterized SQL, small projections, archive/analysis filters, readonly snapshot, failure propagation');
}
main().catch(e=>{console.error(e);process.exitCode=1});
