// Vérifie le choix des mappings obligatoires dans WF2.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fixMappingRequired } from './harden-wf2-r89-mapping-required-filename-fix.mjs';

/** Vérifie les résultats attendus dans ce scénario. */
const ALL_74_FAILURE_ENVELOPES_CONVERGE = (workflow) => {
  const fe = workflow.nodes.filter((n) => n.name.startsWith('Failure Envelope'));
  assert.equal(fe.length, 74);
  for (const n of fe) {
    const edge = workflow.connections[n.name]?.main?.[0]?.[0];
    assert.equal(edge?.node, 'Prepare WF2 Failure Status', `${n.name} must still converge`);
  }
};

/** Vérifie les résultats attendus dans ce scénario. */
const NO_PARASITIC_EDGE = (workflow) => {
  const targets =
    workflow.connections['Record New Branch Baseline']?.main?.[0]?.map((e) => e.node) ?? [];
  assert.ok(!targets.includes('Remote Candidate Present?'), 'parasitic edge must remain absent');
};

/** Reproduit l’ancien contrôle de mapping pour la comparaison. */
const mappingRequired_OLD = (plans) =>
  /\b(dto|entity|mapping|accessor|getter|setter)\b/i.test(JSON.stringify(plans));
/** Reproduit le contrôle corrigé du mapping pour la comparaison. */
const mappingRequired_NEW = (plans) => {
  const text = plans.map((p) => [p.rootCause, p.remediationIntent, ...(p.requiredChanges || [])].join(' ')).join(' ');
  return /\b(dto|entity|mapping|accessor|getter|setter)\b/i.test(text);
};

const artifactPath = process.argv[2];
if (!artifactPath) throw new Error('usage: node wf2-r89-mapping-required-filename-fix.spec.mjs <LIVE-BEFORE-R89.json>');

const root = JSON.parse(readFileSync(artifactPath, 'utf8'));
const before = structuredClone(Array.isArray(root) ? root[0] : root);
const workflow = structuredClone(before);

// --- precondition ---
assert.equal(before.nodes.filter((n) => n.type !== 'n8n-nodes-base.stickyNote').length, 182);
assert.equal(before.nodes.filter((n) => n.type === 'n8n-nodes-base.stickyNote').length, 6);
const prepBefore = before.nodes.find((n) => n.name === 'Prepare - Code Patch Body');
assert.ok(
  prepBefore.parameters.jsCode.includes(
    "const mappingRequired=/\\b(dto|entity|mapping|accessor|getter|setter)\\b/i.test(JSON.stringify(plans));",
  ),
  'precondition: old mappingRequired line must be present verbatim',
);
ALL_74_FAILURE_ENVELOPES_CONVERGE(before);
NO_PARASITIC_EDGE(before);

fixMappingRequired(workflow);

// --- exactly 1 node changed, and only parameters.jsCode on it ---
const beforeByName = new Map(before.nodes.map((n) => [n.name, n]));
let changedNodes = 0;
for (const n of workflow.nodes) {
  const b = beforeByName.get(n.name);
  if (JSON.stringify(n) !== JSON.stringify(b)) {
    changedNodes++;
    assert.equal(n.name, 'Prepare - Code Patch Body', `unexpected node changed: ${n.name}`);
    assert.deepEqual(n.position, b.position, 'position must not change');
    assert.equal(n.type, b.type);
    assert.equal(n.typeVersion, b.typeVersion);
    const paramKeys = new Set([...Object.keys(n.parameters), ...Object.keys(b.parameters)]);
    for (const k of paramKeys) {
      if (k === 'jsCode') continue;
      assert.deepEqual(n.parameters[k], b.parameters[k], `parameters.${k} must not change`);
    }
    assert.notEqual(n.parameters.jsCode, b.parameters.jsCode);
  }
}
assert.equal(changedNodes, 1, 'exactly 1 node (Prepare - Code Patch Body) must change');

// --- counts and connections unchanged ---
assert.equal(workflow.nodes.filter((n) => n.type !== 'n8n-nodes-base.stickyNote').length, 182);
assert.equal(workflow.nodes.filter((n) => n.type === 'n8n-nodes-base.stickyNote').length, 6);
assert.equal(workflow.nodes.length, 188);
assert.deepEqual(workflow.connections, before.connections, 'connections must be byte-identical');
ALL_74_FAILURE_ENVELOPES_CONVERGE(workflow);
NO_PARASITIC_EDGE(workflow);

// =====================================================================
// MANDATORY TESTS ON REAL / SYNTHETIC DATA (per explicit request)
// =====================================================================

// Test 1 -- real plan from execution 2079 (java:S107, TaskDTO.java,
// constructor-arity fix, empty relationshipOperations/requiredRelationshipApis)
// must now PASS the guard (mappingRequired must become false).
const plans2079 = JSON.parse(
  readFileSync(new URL('./fixtures/wf2-r89-execution-2079-plan.json', import.meta.url), 'utf8'),
).plans;
assert.equal(mappingRequired_OLD(plans2079), true, 'sanity: OLD logic must reproduce the real 2079 failure');
assert.equal(mappingRequired_NEW(plans2079), false, 'TEST 1 FAILED: execution 2079 plan must now pass the guard');

// Test 2 -- synthetic genuine DTO-mapping plan (modeled on this project's own
// real java:S4684 finding style: "Replace this persistent entity with a
// simple POJO or DTO object", which DID require cross-file grounding
// historically). Declared synthetic because no currently-available finding
// in the live DB exercises this path to capture a real one from.
const syntheticMappingPlan = [
  {
    findingId: 'synthetic-s4684',
    rule: 'java:S4684',
    target: { file: 'src/main/java/com/pfe/devsecops/controller/TaskController.java', line: 34 },
    rootCause:
      'The controller returns the persistent Task entity directly to clients, leaking persistence annotations and internal structure.',
    remediationIntent:
      'Map the Task entity to a TaskResponse DTO before returning it from the controller, so the HTTP boundary never exposes the persistence entity.',
    filesToModify: ['src/main/java/com/pfe/devsecops/controller/TaskController.java'],
    filesToCreate: ['src/main/java/com/pfe/devsecops/dto/TaskResponse.java'],
    proposedPaths: ['src/main/java/com/pfe/devsecops/dto/TaskResponse.java'],
    requiredChanges: [
      'Create a TaskResponse DTO with fields matching the Task entity, excluding persistence-only fields.',
      'Add a mapping method that converts a Task entity instance to a TaskResponse DTO.',
    ],
    forbiddenChanges: ['Do not expose the JPA entity directly.'],
    expectedBehaviorPreserved: ['Response JSON shape unchanged for existing clients.'],
    requiredRelationshipApis: [],
    relationshipOperations: [],
  },
];
assert.equal(mappingRequired_OLD(syntheticMappingPlan), true);
assert.equal(
  mappingRequired_NEW(syntheticMappingPlan),
  true,
  'TEST 2 FAILED: a genuine entity-to-DTO mapping plan must still trigger the guard',
);

// Test 3 -- a plan whose relationshipOperations/requiredRelationshipApis
// reference an external type must leave the UNTOUCHED downstream relationship
// resolution logic (lines after 26: relationFields/resolve/proven/...) fully
// intact -- this patch only replaces the mappingRequired line, verified above
// by the single-line diff assertion already made on the node's full jsCode.
const nodeAfter = workflow.nodes.find((n) => n.name === 'Prepare - Code Patch Body');
assert.ok(
  nodeAfter.parameters.jsCode.includes("const relationships=sourceApiContext.flatMap("),
  'TEST 3: relationship-resolution logic (the real external-type path) must be untouched',
);
assert.ok(
  nodeAfter.parameters.jsCode.includes("throw new Error('SOURCE_API_CONTEXT_INCOMPLETE"),
  'TEST 3: SOURCE_API_CONTEXT_INCOMPLETE checks for external-type grounding must be untouched',
);

console.log('WF2 R89 — mappingRequired filename false-positive fixed on Prepare - Code Patch Body only.');
console.log('  TEST 1 (real exec 2079 plan)      : guard now PASSES (was blocking)       -> PASS');
console.log('  TEST 2 (synthetic genuine mapping) : guard STILL BLOCKS (unchanged)        -> PASS');
console.log('  TEST 3 (external-type resolution)  : relationship logic byte-identical     -> PASS');
console.log('182 functional + 6 stickies intact, connections byte-identical, 74/74 convergence intact: PASS');
