import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
// The default dist directory is bound into live nginx: offline builds must
// always target a fresh system temporary directory, never frontend/dist.
const outputPath=mkdtempSync(join(tmpdir(),'security-frontend-offline-'));
const frontend=fileURLToPath(new URL('..',import.meta.url));
const cli=join(frontend,'node_modules/@angular/cli/bin/ng.js');
const result=spawnSync(process.execPath,[cli,'build','--configuration','production','--output-path',outputPath],{cwd:frontend,stdio:'inherit'});
console.log(`OFFLINE_BUILD_ARTIFACT = ${outputPath}`);
if(result.error) throw result.error;
process.exit(result.status ?? 1);
