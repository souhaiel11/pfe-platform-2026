// Vérifie que seules les cases cochées sont envoyées à la correction.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const exports={};
const signal=value=>Object.assign(()=>value,{set:v=>value=v});
vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../src/app/features/projects/dockerfile-optimizer.component.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,experimentalDecorators:true}}).outputText,{exports,encodeURIComponent,crypto:{randomUUID:()=> 'qa-request'},require:name=>name==='@angular/core'?{Component:()=>x=>x,Input:()=>()=>{},signal}:name.includes('http-error-message')?{userHttpError:()=> 'Erreur'}:{}});
let posts=[],observer;
const c=new exports.DockerfileOptimizerComponent({post:(url,body)=>{posts.push({url,body});return {subscribe:o=>observer=o}}});
c.projectId='qa-project';c.baseBranch='main';c.ownerInput.set('owner');c.repoInput.set('repo');c.dockerfileSource.set('FROM base');
const issues=[{id:'duplicate',description:'Premier problème'},{id:'duplicate',description:'Autre problème'},{id:'third',description:'Troisième problème'}];const result={score:22,issues};c.setAnalysisResult(result);
assert.equal(c.selectedFindings().length,3);c.toggleIssue(issues[0]);assert.equal(c.isIssueSelected(issues[0]),false);assert.equal(c.isIssueSelected(issues[1]),true);assert.equal(c.selectedFindings().length,2);
c.clearIssueSelection();c.apply(result);assert.equal(posts.length,0);assert.match(c.applyError(),/Sélectionnez/);
c.toggleIssue(issues[1]);c.apply(result);assert.equal(posts.length,1);assert.equal(posts[0].url,'/api/dockerfile/apply');assert.equal(posts[0].body.findings.length,1);assert.equal(posts[0].body.findings[0],issues[1]);assert.equal(posts[0].body.dockerfile,'FROM base');
c.clearIssueSelection();c.toggleIssue(issues[0]);assert.equal(c.selectedFindings().length,1);c.apply(result);assert.equal(posts.length,1,'pas de double envoi pendant la correction');
observer.next({success:true});c.selectAllIssues();assert.equal(c.selectedFindings().length,3);c.reset();assert.equal(c.selectedFindings().length,0);
const source=fs.readFileSync(new URL('../src/app/features/projects/dockerfile-optimizer.component.ts',import.meta.url),'utf8');assert.match(source,/type="checkbox"/);assert.match(source,/uniquement les problèmes sélectionnés/);
console.log('PASS : sélection indépendante, sélection vide, payload exact, verrouillage, tout sélectionner et reset.');
