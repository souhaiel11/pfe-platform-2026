import { createHash } from 'crypto';
import { computeGitBlobSha1 } from '../candidate-verification/candidate-digest';
import { parseVersion, majorOf } from './version-selection-policy';

export interface MavenControl {
  kind: 'DEPENDENCY_VERSION' | 'LOCAL_PROPERTY';
  key: string;
  start: number;
  end: number;
  oldVersion: string;
  targetVersion: string;
}
export interface CveTarget {
  package: string;
  installedVersion: string;
  fixedVersions: string[];
  location: string;
}
export interface ControlExperiment {
  control: MavenControl;
  sourceSha256: string;
  dependencyTree: string;
  effectivePom: string;
}
export interface MavenScopeEvidence {
  targetCve: string;
  evaluatedSha: string;
  originalBlobSha: string;
  baselineTree: string;
  baselineEffectivePom: string;
  cveTargets: CveTarget[];
  experiments: ControlExperiment[];
}
export interface MavenRemediationScope {
  kind: 'SINGLE_CONTROL' | 'COORDINATED_SAME_FILE';
  targetCve: string;
  evaluatedSha: string;
  controllingFile: string;
  originalBlobSha: string;
  affectedPackages: { package: string; installedVersion: string; targetVersion: string }[];
  controls: MavenControl[];
}
interface XmlNode { name: string; children: XmlNode[]; start: number; end: number; textStart: number; textEnd: number; value: string }
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
function requireProof(ok: unknown, reason: string): asserts ok { if (!ok) throw new Error(reason); }

/** Small rejecting XML reader. Never resolves entities or guesses namespace/profile semantics. */
function xml(text: string, effectiveModel = false): XmlNode {
  requireProof(!/<!DOCTYPE|<!ENTITY|<!\[CDATA\[|<\w+:/.test(text), 'UNSUPPORTED_XML');
  const stack: XmlNode[] = [], roots: XmlNode[] = [];
  const tags = /<!--[\s\S]*?-->|<\?xml[\s\S]*?\?>|<\/?[A-Za-z_][^>]*>/g;
  let m: RegExpExecArray | null, last = 0;
  while ((m = tags.exec(text))) {
    requireProof(!text.slice(last, m.index).includes('<'), 'MALFORMED_XML');
    if (!stack.length) requireProof(!text.slice(last, m.index).trim(), 'XML_OUTSIDE_ROOT');
    last = tags.lastIndex;
    if (m[0].startsWith('<!--') || m[0].startsWith('<?')) continue;
    const close = m[0].startsWith('</'), self = /\/\s*>$/.test(m[0]);
    const name = /^<\/?([\w.-]+)/.exec(m[0])![1];
    if (close) {
      const n = stack.pop(); requireProof(n && n.name === name && /^<\/[\w.-]+\s*>$/.test(m[0]), 'MALFORMED_XML');
      n.end = tags.lastIndex; n.textEnd = m.index;
      n.value = text.slice(n.textStart, n.textEnd).trim();
    } else {
      // Maven emits plugin configuration attributes in the effective model.
      // They carry no authority over the dependency/version nodes read here;
      // source POMs still use the stricter attribute policy.
      requireProof(name === 'project' || /^<[\w.-]+\s*\/?>$/.test(m[0])
        || (effectiveModel && stack.some(n => n.name === 'configuration')), 'UNSUPPORTED_XML_ATTRIBUTES');
      const n: XmlNode = { name, children: [], start: m.index, end: tags.lastIndex, textStart: tags.lastIndex, textEnd: tags.lastIndex, value: '' };
      if (stack.length) stack[stack.length - 1].children.push(n); else roots.push(n);
      if (!self) stack.push(n);
    }
  }
  requireProof(!stack.length && roots.length === 1 && roots[0].name === 'project' && !text.slice(last).trim(), 'MALFORMED_XML');
  return roots[0];
}
function one(n: XmlNode, name: string): XmlNode | undefined {
  const a = n.children.filter(x => x.name === name); requireProof(a.length <= 1, 'AMBIGUOUS_' + name); return a[0];
}
function value(n: XmlNode, name: string): string { const c = one(n, name); requireProof(!c || !c.children.length, 'NESTED_VALUE'); return c?.value ?? ''; }
function dependencies(root: XmlNode): XmlNode[] { return one(root, 'dependencies')?.children.filter(x => x.name === 'dependency') ?? []; }
function coordinate(d: XmlNode): string { return value(d, 'groupId') + ':' + value(d, 'artifactId'); }
function versions(root: XmlNode, effectiveModel = false): Map<string, string> {
  const out = new Map<string, string>();
  for (const d of dependencies(root)) {
    const k = coordinate(d), v = value(d, 'version');
    // Maven management may repeat a coordinate for jar/test-jar/classifiers.
    // Only identical resolved versions can collapse in the effective model.
    requireProof(!out.has(k) || (effectiveModel && out.get(k) === v), 'AMBIGUOUS_DEPENDENCY'); out.set(k, v);
  }
  return out;
}
function numeric(s: string): boolean { return /^\d+(?:\.\d+)+(?:[-.][A-Za-z0-9]+)*$/.test(s) && !!parseVersion(s); }
function control(n: XmlNode, text: string, kind: MavenControl['kind'], key: string, targetVersion: string): MavenControl {
  requireProof(!n.children.length && numeric(n.value), 'NON_LITERAL_CONTROL');
  const start = n.textStart + text.slice(n.textStart, n.textEnd).indexOf(n.value);
  return { kind, key, start, end: start + n.value.length, oldVersion: n.value, targetVersion };
}

/** Enumerate bounded local controls, never edits by groupId or property name convention. */
export function localMavenControls(source: string, targetPackage: string, target: string): MavenControl[] {
  const root = xml(source);
  requireProof(!one(root, 'profiles') && !one(root, 'modules'), 'PROFILES_OR_MODULES_UNSUPPORTED');
  const localManagement = one(root, 'dependencyManagement');
  requireProof(!localManagement || !dependencies(localManagement).some(d => value(d, 'scope') === 'import'), 'LOCAL_BOM_IMPORT_UNSUPPORTED');
  const ds = dependencies(root); versions(root); // Reject duplicate dependency declarations.
  const d = ds.filter(x => coordinate(x) === targetPackage);
  requireProof(d.length === 1, 'TARGET_NOT_DIRECT');
  const v = one(d[0], 'version'); requireProof(v, 'TARGET_NOT_LOCALLY_CONTROLLED');
  const props = one(root, 'properties');
  const propertyNames = props?.children.map(x => x.name) ?? [];
  requireProof(new Set(propertyNames).size === propertyNames.length, 'AMBIGUOUS_PROPERTY');
  const ref = /^\$\{([\w.-]+)\}$/.exec(v.value);
  let primary: MavenControl;
  if (ref) {
    const pn = props && one(props, ref[1]); requireProof(pn, 'INHERITED_PROPERTY_UNSUPPORTED');
    primary = control(pn, source, 'LOCAL_PROPERTY', ref[1], target);
  } else primary = control(v, source, 'DEPENDENCY_VERSION', targetPackage, target);
  const all = [primary];
  for (const pn of props?.children ?? []) {
    if (numeric(pn.value) && pn.value === primary.oldVersion && pn.value !== target && majorOf(parseVersion(pn.value)!) === majorOf(parseVersion(target)!)
      && !(primary.kind === 'LOCAL_PROPERTY' && primary.key === pn.name)) {
      all.push(control(pn, source, 'LOCAL_PROPERTY', pn.name, target));
    }
  }
  requireProof(all.length <= 8, 'TOO_MANY_LOCAL_CONTROLS');
  return all;
}
export function applyMavenControls(source: string, controls: MavenControl[]): string {
  let out = source, end = source.length;
  for (const c of [...controls].sort((a, b) => b.start - a.start)) {
    requireProof(c.start >= 0 && c.end <= end && c.end > c.start && source.slice(c.start, c.end) === c.oldVersion, 'CONTROL_OFFSET_MISMATCH');
    requireProof(numeric(c.targetVersion) && numeric(c.oldVersion) && majorOf(parseVersion(c.oldVersion)!) === majorOf(parseVersion(c.targetVersion)!), 'CROSS_MAJOR_CONTROL');
    out = out.slice(0, c.start) + c.targetVersion + out.slice(c.end); end = c.start;
  }
  return out;
}
/** Full resolved coordinate/version map, rejecting duplicate/conflicting graph entries. */
export function mavenGraph(tree: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of tree.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const m = /^(?:(?:\|  |   ))*[+\\]- ([^\s:]+):([^\s:]+):([^\s:]+):(?:(?:[^\s:]+):)?([^\s:]+):(compile|runtime|test|provided|system)$/.exec(line);
    if (!m) { requireProof(!/[+\\]-/.test(line), 'UNSUPPORTED_DEPENDENCY_TREE'); continue; }
    const key = m[1] + ':' + m[2]; requireProof(!out.has(key), 'DUPLICATE_RESOLVED_DEPENDENCY'); out.set(key, m[4]);
  }
  requireProof(out.size > 0, 'EMPTY_DEPENDENCY_TREE'); return out;
}
function changes(a: Map<string, string>, b: Map<string, string>): string[] {
  requireProof(a.size === b.size && [...a.keys()].every(k => b.has(k)), 'DEPENDENCY_SET_CHANGED');
  return [...a.keys()].filter(k => a.get(k) !== b.get(k)).sort();
}
export function deriveMavenRemediationScope(
  source: string, targetPackage: string, target: string, file: string, evidence: MavenScopeEvidence,
): MavenRemediationScope {
  requireProof(file === 'pom.xml' && /^[0-9a-f]{40}$/.test(evidence.evaluatedSha)
    && /^CVE-\d{4}-\d{4,}$/.test(evidence.targetCve)
    && computeGitBlobSha1(source) === evidence.originalBlobSha, 'SCOPE_NOT_GROUNDED');
  const controls = localMavenControls(source, targetPackage, target);
  const base = mavenGraph(evidence.baselineTree);
  const affected = new Map<string, string>();
  for (const t of evidence.cveTargets) {
    requireProof(t.package.split(':')[0] === targetPackage.split(':')[0], 'CVE_OUTSIDE_LOCAL_FAMILY');
    requireProof(base.get(t.package) === t.installedVersion && t.fixedVersions.includes(target)
      && numeric(t.installedVersion) && numeric(target)
      && majorOf(parseVersion(t.installedVersion)!) === majorOf(parseVersion(target)!), 'NO_COMMON_SAME_MAJOR_FIXED_TARGET');
    requireProof(!affected.has(t.package) || affected.get(t.package) === t.installedVersion, 'AMBIGUOUS_SCANNER_VERSION');
    affected.set(t.package, t.installedVersion);
  }
  requireProof(affected.has(targetPackage), 'TARGET_CVE_NOT_PROVEN_IN_BASE');
  const model = xml(evidence.baselineEffectivePom, true), modelVersions = versions(model, true);
  const managed = one(model, 'dependencyManagement');
  const managedVersions = managed ? versions(managed, true) : new Map<string, string>();
  const candidates: { c: MavenControl; covers: string[] }[] = [];
  for (const c of controls) {
    const experiments = evidence.experiments.filter(e => JSON.stringify(e.control) === JSON.stringify(c));
    requireProof(experiments.length === 1, 'CONTROL_EXPERIMENT_MISSING_OR_AMBIGUOUS');
    const e = experiments[0];
    requireProof(e.sourceSha256 === sha(applyMavenControls(source, [c])), 'EXPERIMENT_SOURCE_MISMATCH');
    const graph = mavenGraph(e.dependencyTree);
    let diff: string[];
    try { diff = changes(base, graph); } catch { continue; }
    if (!diff.length || diff.some(k => !affected.has(k) || graph.get(k) !== target)) continue;
    const changedModel = xml(e.effectivePom, true), nextVersions = versions(changedModel, true);
    const nextManagedNode = one(changedModel, 'dependencyManagement');
    const nextManaged = nextManagedNode ? versions(nextManagedNode, true) : new Map<string, string>();
    // Prove effective-model participation as well as graph causality.
    requireProof(diff.every(k => (nextVersions.get(k) === target && modelVersions.get(k) !== target)
      || (nextManaged.get(k) === target && managedVersions.get(k) !== target)), 'EFFECTIVE_MODEL_NOT_CORROBORATED');
    candidates.push({ c, covers: diff });
  }
  requireProof(candidates.some(x => JSON.stringify(x.c) === JSON.stringify(controls[0])), 'PRIMARY_CONTROL_NOT_PROVEN');
  const solutions: MavenControl[][] = [];
  for (let mask = 1; mask < (1 << candidates.length); mask++) {
    const chosen = candidates.filter((_, i) => mask & (1 << i));
    if (chosen.length > 4 || !chosen.some(x => JSON.stringify(x.c) === JSON.stringify(controls[0]))) continue;
    const covered = new Set(chosen.flatMap(x => x.covers));
    if ([...affected.keys()].every(k => covered.has(k))) solutions.push(chosen.map(x => x.c));
  }
  requireProof(solutions.length > 0, 'CVE_CONTROLS_INCOMPLETE');
  const size = Math.min(...solutions.map(x => x.length)), minimal = solutions.filter(x => x.length === size);
  requireProof(minimal.length === 1, 'AMBIGUOUS_CONTROL_PLAN');
  return {
    kind: size === 1 ? 'SINGLE_CONTROL' : 'COORDINATED_SAME_FILE', targetCve: evidence.targetCve,
    evaluatedSha: evidence.evaluatedSha, controllingFile: file, originalBlobSha: evidence.originalBlobSha,
    affectedPackages: [...affected].sort(([a], [b]) => a.localeCompare(b)).map(([pkg, installedVersion]) => ({ package: pkg, installedVersion, targetVersion: target })),
    controls: minimal[0].sort((a, b) => a.start - b.start),
  };
}
export function graphClosesScope(before: string, after: string, scope: MavenRemediationScope): boolean {
  try {
    const a = mavenGraph(before), b = mavenGraph(after);
    const allowed = new Set(scope.affectedPackages.map(x => x.package));
    return changes(a, b).every(k => allowed.has(k))
      && scope.affectedPackages.every(x => b.get(x.package) === x.targetVersion);
  } catch { return false; }
}
