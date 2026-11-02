// Construit Harness cible.
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
export const baselineUrl = new URL('../pending-live-update/WF6-SAFE-ATTEMPT-LIFECYCLE.OFFLINE.json', import.meta.url);
export const targetUrl = new URL('../pending-live-update/WF6-SAFE-RETRY-E2E-HARNESS.OFFLINE.json', import.meta.url);
/** Construit Harness cible. */
export function buildHarnessTarget() {
  const [baseline] = JSON.parse(readFileSync(baselineUrl));
  const target = structuredClone(baseline);
  const gate = structuredClone(target.nodes.find(n => n.name === 'Evaluation Not Technical Failure?'));
  gate.name = 'Operator Test Barrier?'; gate.id = 'wf6-operator-test-barrier';
  gate.position = [gate.position[0], gate.position[1] - 220];
  gate.parameters.conditions.conditions[0].id = 'operator-test-barrier';
  // Never reads webhook/body input. Authoritative response from authenticated backend call only.
  gate.parameters.conditions.conditions[0].leftValue = '={{ $("Evaluate Security Remediation").first().json.body?.operatorTestBarrier === true && $("Evaluate Security Remediation").first().json.body?.status === "OPERATOR_TEST_STOPPED" }}';
  target.nodes.push(gate);
  target.connections['Evaluation HTTP OK?'].main[0] = [{node: gate.name, type:'main', index:0}];
  target.connections[gate.name] = {main: [[{node:'Respond - Not Eligible',type:'main',index:0}],
    [{node:'Evaluation Not Technical Failure?',type:'main',index:0}]]};
  return { baseline, target };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  writeFileSync(targetUrl, JSON.stringify([buildHarnessTarget().target],null,2)+'\n');
}
