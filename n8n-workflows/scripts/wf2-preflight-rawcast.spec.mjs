// Teste le composant « wf2-preflight-rawcast » et ses cas d’erreur.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const wf = JSON.parse(readFileSync(new URL('../pending-live-update/wf2-git-patch-pr-u3eeMwTuhCsetfcS.PROMOTION-TARGET.json', import.meta.url)))[0];
const node = wf.nodes.find(n => n.name === 'Generic Candidate Preflight');
const code = node.parameters.jsCode;

// ── Static contract: old bare regex removed, new guard-aware logic present ─
assert.doesNotMatch(code, /\[\/\\b\(\?:Object\|Map[^,]*,'OBVIOUS_RAW_CAST_WORKAROUND'\]/,
  'the old unguarded structural regex must no longer be a plain array entry');
assert.match(code, /rawCastMatch/, 'guard-aware raw-cast detection must be present');
assert.match(code, /instanceof/, 'the detector must consult instanceof guards');
assert.match(code, /'OBVIOUS_RAW_CAST_WORKAROUND'/, 'the violation label itself must be preserved unchanged');

// ── Extract the exact deployed detector logic and execute it directly ──────
const startMarker = 'const rawCastMatch=code.match(';
const start = code.indexOf(startMarker);
assert.ok(start > 0, 'rawCastMatch detector must be present in the deployed node');
const end = code.indexOf("if(/placeholder", start);
const detectorSrc = code.slice(start, end);
/** Prépare les données nécessaires à ce scénario. */
function detect(candidateCode) {
  const fn = new Function('code', `let violations=[];
    ${detectorSrc}
    return violations.includes('OBVIOUS_RAW_CAST_WORKAROUND');`);
  return fn(candidateCode);
}

// ── E. Safe equals()/instanceof cast no longer triggers preflight ──────────
const safeEquals = `
package com.pfe.devsecops.dto;

public class TaskDTO {
    private Long id;

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof TaskDTO)) return false;
        TaskDTO taskDTO = (TaskDTO) o;
        return java.util.Objects.equals(id, taskDTO.id);
    }
}
`;
assert.equal(detect(safeEquals), false, 'instanceof-guarded equals() cast must NOT be flagged');

// ── E (real file). The exact real generated TaskDTO.java from execution 1986
const realGeneratedFile = readFileSync(new URL('./__fixtures__/taskdto-real-execution-1986.java', import.meta.url), 'utf8');
assert.equal(detect(realGeneratedFile), false, 'the exact real generated file that caused the false positive must now pass');

// ── F. A genuinely unguarded raw cast is still blocked ──────────────────────
const unsafeRawCast = `
Object value = source.get("x");
DangerousType x = (DangerousType) value;
`;
assert.equal(detect(unsafeRawCast), true, 'an unguarded raw cast must still be flagged');

console.log('WF2 Generic Candidate Preflight raw-cast detector, cases E-F (incl. real execution-1986 file): PASS');
