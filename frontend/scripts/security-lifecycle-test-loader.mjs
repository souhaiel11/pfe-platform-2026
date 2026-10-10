import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const dependencyRequire = createRequire(import.meta.url);
const ts = dependencyRequire('typescript');
export const angular = {
  Component: () => value => value, Injectable: () => value => value,
  Input: () => () => {}, Output: () => () => {}, ViewChild: () => () => {},
  EventEmitter: class { emit(value) { this.value = value; } },
  signal: value => { const f = () => value; f.set = v => value = v; return f; }, computed: f => f,
};
export function sharedDependency(name) {
  if (name === 'rxjs') return dependencyRequire('rxjs');
  const file = name.split('/').pop();
  if (['security-remediation-presentation','security-findings-view','security-finding-fingerprint','cve-selection-eligibility','v1-8-compatibility-presentation','status-labels','wf6-remediation-badge','data-truth'].includes(file)) {
    return loadFrontend(`../src/app/shared/${file}.ts`);
  }
  return undefined;
}
export function loadFrontend(path, dependencies = {}, globals = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(path, import.meta.url),'utf8'), {
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,experimentalDecorators:true},
  }).outputText, {exports, require: name => dependencies[name] || sharedDependency(name) ||
    (name === '@angular/core' ? angular : {}), console, TextEncoder, Uint8Array, DataView, setTimeout:()=>0, ...globals});
  return exports;
}
