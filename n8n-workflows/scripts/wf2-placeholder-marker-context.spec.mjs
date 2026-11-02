// Teste le composant « wf2-placeholder-marker-context » et ses cas d’erreur.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInSandbox } from './wf2-code-node-sandbox.spec.mjs';

const wf = JSON.parse(readFileSync(new URL('../pending-live-update/wf2-git-patch-pr-u3eeMwTuhCsetfcS.PROMOTION-TARGET.json', import.meta.url)))[0];
const preflight = wf.nodes.find(node => node.name === 'Generic Candidate Preflight');
assert.ok(preflight);

const target = 'src/main/java/com/pfe/devsecops/dto/TaskDTO.java';
/** Prépare les données nécessaires à ce scénario. */
const fixture = ({ candidate, baseline = '', operation = 'CREATE' }) => ({
  targetFile: target,
  fileOperation: operation,
  sourceContent: operation === 'CREATE' ? '' : baseline,
  patchedCode: candidate,
  repositoryPolicy: {
    existingFiles: operation === 'MODIFY' ? [target] : [],
    permittedRoots: ['src/main/java/'],
    suggestedCommands: [],
  },
  completePlan: {
    allPlannedFiles: [{ path: target, operation }],
    sourceApiContext: operation === 'MODIFY' ? [{ file: target, content: baseline }] : [],
  },
  approvedFindingsForFile: [],
  applicablePlans: [],
});

/** Exécute le traitement et collecte son résultat. */
const run = input => runInSandbox(preflight.parameters.jsCode, {
  $json: input,
  /** Simule l’accès à un nœud n8n pour le scénario. */
  $: () => { throw new Error('unexpected node lookup'); },
  Buffer,
}).json;
/** Vérifie les résultats attendus dans ce scénario. */
const pass = input => assert.equal(run(input).genericPreflightPassed, true);
/** Vérifie les résultats attendus dans ce scénario. */
const block = input => assert.throws(() => run(input), /PLACEHOLDER_MARKER/);
/** Prépare les données nécessaires à ce scénario. */
const java = body => `package com.pfe.devsecops.dto;\npublic class TaskDTO {\n${body}\n}\n`;

block(fixture({ candidate: java('// TODO: implement this\nvoid work() {}') }));
block(fixture({ candidate: java('// FIXME: broken\nvoid work() {}') }));
block(fixture({ candidate: java('Object work() { return null; // TODO\n}') }));

const REAL_EXECUTION_2009_TASKDTO = `package com.pfe.devsecops.dto;

import java.time.LocalDateTime;

/**
 * API-level representation of a task, fully decoupled from the persistence layer.
 * The task status is carried as a plain String using the canonical names
 * TODO, IN_PROGRESS, DONE and CANCELLED, and the owning user is referenced
 * only by its identifier.
 */
public class TaskDTO {
    private Long id;
    private String title;
    private String description;
    private String status;
    private Integer priority;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
    private Long userId;
    public TaskDTO() { // default constructor for JSON binding
    }
    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }
}
`;
pass(fixture({ candidate: REAL_EXECUTION_2009_TASKDTO }));

const inherited = java('// TODO: preserve legacy behavior\nint value() { return 1; }');
const inheritedModified = inherited.replace('return 1', 'return 2');
pass(fixture({ baseline: inherited, candidate: inheritedModified, operation: 'MODIFY' }));
block(fixture({ baseline: java('int value() { return 1; }'), candidate: java('// TODO: added by candidate\nint value() { return 2; }'), operation: 'MODIFY' }));

pass(fixture({ candidate: java('boolean isTodo(String status) { return status.equals("TODO"); }') }));
assert.equal(wf.nodes.length, 186);
assert.equal(new Set(wf.nodes.map(node => node.id)).size, 186);
assert.match(preflight.parameters.jsCode, /workMarkerOccurrences/);
assert.match(preflight.parameters.jsCode, /inheritedWorkMarkers/);
assert.doesNotMatch(preflight.parameters.jsCode, /\bnew\s+URL\s*\(/);

console.log('PASS placeholder marker context: real execution-2009 DTO accepted; real TODO/FIXME work markers blocked; inherited markers allowed; strings ignored; sandbox globals shadowed');
