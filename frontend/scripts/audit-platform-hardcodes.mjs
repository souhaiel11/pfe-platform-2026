import {readFileSync,readdirSync,existsSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../../',import.meta.url));
const frontend=path.join(root,'frontend');
const walk=dir=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);
// A reproducible inventory of suspicious literal occurrences, not a claim
// that every number is an operational fact. CSS sizes/colors, labels, enum
// contracts, format rules, pagination limits and order weights are allowed.
const pattern=/https?:\/\/[^\s'"<>`)]+|\blocalhost\b|\b127\.0\.0\.1\b|\b[0-9a-f]{8}-[0-9a-f-]{27,}\b|\b(?:souhaiel11|pfe-app-test|pfe-devsecops-2026|theme-vermeg-reconciled|SHADOW|ENFORCED|main)\b|\b\d+(?:\.\d+)*\b/g;
const unsafe=/souhaiel11|pfe-app-test|3aa1c9b9-e114-40e4-884b-ebc7aa32e002|172\.31\.172\.61|llama3\.2:3b|WSL Ubuntu|PostgreSQL 16|origin\/main|http:\/\/n8n:5678|@Input\(\) baseBranch = 'main'|refInput\.set\('main'\)|ref:.*\|\| 'main'/;
const files=walk(path.join(frontend,'src')).filter(f=>/\.(?:ts|html|scss|json)$/.test(f));
files.push(...walk(path.join(frontend,'scripts')).filter(f=>/\.(?:mjs|json)$/.test(f)));
files.push(...readdirSync(frontend).filter(n=>/\.json$/.test(n)&&n!=='package-lock.json').map(n=>path.join(frontend,n)));
const entries=[];const remaining=[];
for(const file of files){const relative=path.relative(root,file);const source=readFileSync(file,'utf8');const fixture=/\/fixtures\/|\.spec\.mjs$|qa-platform-dynamicity\.mjs$/.test(relative);const documentation=relative.startsWith('frontend/scripts/') && !fixture;
 source.split('\n').forEach((line,i)=>{
  const comment=/^\s*(?:\/\/|\/\*|\*|<!--)/.test(line);
  if(!fixture&&!documentation&&!comment&&unsafe.test(line))remaining.push({file:relative,line:i+1});
  for(const match of line.matchAll(pattern))entries.push({file:relative,line:i+1,literal:match[0],classification:fixture?'VALID_TEST_FIXTURE':documentation||comment?'DOCUMENTATION':'LEGITIMATE_CONSTANT'});
 });
}
const summary={scope:'frontend/src TS/HTML/SCSS/JSON, scripts, root configuration excluding dependency lock registry data',total:entries.length,legitimateConstants:entries.filter(e=>e.classification==='LEGITIMATE_CONSTANT').length,testFixtures:entries.filter(e=>e.classification==='VALID_TEST_FIXTURE').length,documentation:entries.filter(e=>e.classification==='DOCUMENTATION').length,remainingRuntimeHardcodes:remaining};
if(process.argv.includes('--write')){writeFileSync(path.join(root,'docs/audits/platform-hardcode-inventory-2026-09-30.json'),JSON.stringify({summary,entries},null,2)+'\n');}
console.log(JSON.stringify(summary));
if(remaining.length)process.exitCode=1;
