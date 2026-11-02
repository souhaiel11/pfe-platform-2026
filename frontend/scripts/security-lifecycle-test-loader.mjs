// Vérifie sécurité cycle de vie test loader dans le frontend.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const dependencyRequire = createRequire(import.meta.url);
const ts = dependencyRequire('typescript');
export const angular = {
  /** Simule le décorateur de composant Angular. */
  Component: () => value => value,
  /** Simule le décorateur de service Angular. */
  Injectable: () => value => value,
  /** Simule une entrée de composant Angular. */
  Input: () => () => {},
  /** Simule une sortie de composant Angular. */
  Output: () => () => {},
  /** Simule une référence à un élément de vue Angular. */
  ViewChild: () => () => {},
  EventEmitter: class {
  /** Diffuse ou construit le résultat prévu. */
  emit(value) { this.value = value; } },
  /** Prépare une valeur réactive pour le scénario. */
  signal: value => {
  /** Renvoie les contrôles du formulaire. */
  const f = () => value;
  /** Affecte la valeur prévue au champ. */
  f.set = v => value = v; return f; },
  /** Prépare le calcul réactif du scénario. */
  computed: f => f,
};
/** Prépare la dépendance partagée par les éléments. */
export function sharedDependency(name) {
  if (name === 'rxjs') return dependencyRequire('rxjs');
  const file = name.split('/').pop();
  if (['security-remediation-presentation','security-findings-view','security-finding-fingerprint','cve-selection-eligibility','v1-8-compatibility-presentation','status-labels','wf6-remediation-badge','data-truth'].includes(file)) {
    return loadFrontend(`../src/app/shared/${file}.ts`);
  }
  return undefined;
}
/** Charge Frontend. */
export function loadFrontend(path, dependencies = {}, globals = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(path, import.meta.url),'utf8'), {
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,experimentalDecorators:true},
  }).outputText, {exports,
  /** Charge la dépendance prévue pour le scénario. */
  require: name => dependencies[name] || sharedDependency(name) ||
    (name === '@angular/core' ? angular : {}), console, TextEncoder, Uint8Array, DataView,
    /** Définit délai dépassé. */
    setTimeout:()=>0, ...globals});
  return exports;
}
