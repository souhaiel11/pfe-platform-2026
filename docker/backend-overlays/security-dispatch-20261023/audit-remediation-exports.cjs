const fs=require('fs');const path=require('path');const {createRequire}=require('module');const appRequire=createRequire('/app/package.json');appRequire('reflect-metadata');
const seen=new Set(),missing=[];
function visit(file){if(seen.has(file))return;seen.add(file);const s=fs.readFileSync(file,'utf8');const r=createRequire(file);
 for(const [,binding,target] of s.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*require\(["']([^"']+)["']\)/g)){
 if(!target.startsWith('.'))continue;
 const resolved=r.resolve(target);const m=r(target);
 for(const [,name]of s.matchAll(new RegExp('\\b'+binding+'\\.(\\w+)','g')))if(typeof m[name]==='undefined')missing.push({caller:file,module:target,export:name});
 if(resolved.startsWith('/app/dist/')&&resolved.endsWith('.js'))visit(resolved);
 }}
visit('/app/dist/manual-remediation/manual-remediation.service.js');console.log(JSON.stringify({checkedModules:seen.size,missing:[...new Map(missing.map(x=>[JSON.stringify(x),x])).values()]},null,2));process.exit(missing.length ? 1 : 0);
