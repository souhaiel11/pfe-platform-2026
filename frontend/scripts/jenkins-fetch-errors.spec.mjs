// Vérifie les messages de récupération sans exposer les détails techniques.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
class HttpErrorResponse {}
const exports = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../src/app/core/http-error-message.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports, require: () => ({ HttpErrorResponse }) });
const present = exports.userHttpError;
for (const code of ['JENKINSFILE_FETCH_TIMEOUT', 'JENKINSFILE_GIT_UNREACHABLE', 'JENKINSFILE_WORKFLOW_UNAVAILABLE', 'JENKINSFILE_INVALID_RESPONSE', 'JENKINSFILE_NOT_FOUND','DOCKERFILE_FETCH_TIMEOUT','DOCKERFILE_GIT_UNREACHABLE','DOCKERFILE_WORKFLOW_UNAVAILABLE','DOCKERFILE_INVALID_RESPONSE','DOCKERFILE_NOT_FOUND']) {
  const message = present({ status: 502, error: { code, message: 'stack secret' } });
  assert.doesNotMatch(message, /erreur interne|stack secret|JENKINSFILE_/);
  assert.match(message, /Jenkinsfile|Dockerfile|connexion|récupération/);
}
assert.match(present({ status: 500 }), /erreur interne/);
assert.match(present({ status: 401 }), /reconnecter/);
assert.match(present({ status: 400, error: { message: 'Branche requise' } }), /Branche requise/);
console.log('Messages GitHub précis ; erreurs génériques et authentification préservées.');
