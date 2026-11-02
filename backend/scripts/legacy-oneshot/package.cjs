// Décrit l'environnement d'exécution et les commandes de l'outillage ponctuel legacy.
'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto'),assert=require('assert/strict');
require('./runner.cjs');
const root=path.resolve(__dirname,'../..'),destination=process.argv[2];
assert(destination&&path.isAbsolute(destination),'ABSOLUTE_NEW_OUTPUT_DIRECTORY_REQUIRED');fs.mkdirSync(destination,{recursive:false,mode:0o700});
const required=Object.keys(require.cache).filter(p=>p.startsWith(root+'/src/')).map(p=>path.relative(root,p));
const files=[...required,'src/dependency-compatibility/v1_8-evidence-store.json','scripts/legacy-oneshot/runner.cjs','scripts/legacy-oneshot/database.cjs','scripts/legacy-oneshot/plan.cjs','scripts/legacy-oneshot/approved-plan.json','scripts/legacy-oneshot/prepare-receipts.cjs','scripts/legacy-oneshot/quiescence.cjs','scripts/legacy-oneshot/phase4g-preflight.cjs','migrations/20261006_add_remediation_target_reservations.sql','tsconfig.json','package.json','package-lock.json'].sort();
const manifest=[];
files.push('scripts/legacy-oneshot/remote.cjs');files.sort();
for(const relative of files){const target=path.join(destination,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(root,relative),target);manifest.push({file:relative,sha256:crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex')});}
fs.writeFileSync(path.join(destination,'source-manifest.json'),JSON.stringify({entrypoint:'scripts/legacy-oneshot/runner.cjs',daemon:false,autostart:false,httpListener:false,files:manifest},null,2)+'\n');
console.log(JSON.stringify({destination,files:files.length}));
