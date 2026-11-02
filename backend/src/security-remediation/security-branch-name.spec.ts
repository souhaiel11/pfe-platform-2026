// Teste le composant « security-branch-name » et ses cas d’erreur.
import * as assert from 'node:assert/strict';
import { computeSecurityBranchName } from './security-branch-name';

const FP = 'a37e178f7ce1805b0b1b0e8ac2d41d20333041c26b4e88490f8af4e9885b7cf2'.slice(0, 64).padEnd(64, '0');
const CI = '1ebe4cecc872dea657218031000f817a0e6a7b68aa53dd71d84eacdd87c86e4'.padEnd(64, '8');

// Deterministic, safe-git-ref-characters shape.
{
  const name = computeSecurityBranchName(FP, CI);
  assert.equal(name, `security/fix/${FP.slice(0, 12)}-${CI.slice(0, 12)}`);
  assert.match(name, /^[a-z0-9/-]+$/, 'only safe git ref characters');
  assert.equal(name, computeSecurityBranchName(FP, CI), 'deterministic -- identical inputs always produce the identical name');
}
console.log('security-branch-name) deterministic, safe-character branch name: PASS');

// Different candidateIdentity (e.g. a new eligible version appears later) -> different branch.
{
  const a = computeSecurityBranchName(FP, CI);
  const otherCI = (CI[0] === '0' ? '1' : '0') + CI.slice(1);
  const b = computeSecurityBranchName(FP, otherCI);
  assert.notEqual(a, b, 'a changed candidateIdentity must produce a different branch name');
}
console.log('security-branch-name) changed candidateIdentity -> different branch name: PASS');

// Fail closed on malformed (non-hash, potentially caller-influenced) input -- never silently sanitize arbitrary text into a branch name.
for (const bad of ['not-a-hash', '', 'a'.repeat(63), 'A'.repeat(64), '../../etc/passwd', 'main; rm -rf /']) {
  assert.throws(() => computeSecurityBranchName(bad, CI), /must be a 64-hex sha256 digest/, `malformed findingFingerprint ${JSON.stringify(bad)} must throw, never be sanitized into a branch name`);
  assert.throws(() => computeSecurityBranchName(FP, bad), /must be a 64-hex sha256 digest/, `malformed candidateIdentity ${JSON.stringify(bad)} must throw`);
}
console.log('security-branch-name) malformed/injection-shaped input -> throws, never silently accepted: PASS');

console.log('security-branch-name.spec.ts: ALL CHECKS PASS');

// Le commit de base change le préfixe candidat, sans changer le format ni le préfixe finding.
{
  const f = 'a'.repeat(64), c = 'b'.repeat(64);
  const n1 = computeSecurityBranchName(f, c, '1'.repeat(40));
  const n2 = computeSecurityBranchName(f, c, '2'.repeat(40));
  if (!/^security\/fix\/[a-f0-9]{12}-[a-f0-9]{12}$/.test(n1) || n1 === n2 || !n1.startsWith('security/fix/aaaaaaaaaaaa-')) throw new Error('baseSha branch name');
  if (computeSecurityBranchName(f, c, null) !== computeSecurityBranchName(f, c)) throw new Error('baseSha null must keep legacy name');
  if (n1 !== computeSecurityBranchName(f, c, '1'.repeat(40))) throw new Error('baseSha branch name must be deterministic');
  console.log('PASS baseSha binds the candidate prefix');
}

// Chaque lancement WF6 (lot) obtient sa propre branche ; toutes les étapes d'un même lot gardent le même nom.
{
  const f = 'a'.repeat(64), c = 'b'.repeat(64), base = '1'.repeat(40);
  const l1 = computeSecurityBranchName(f, c, base, 'sec-batch-1'), l2 = computeSecurityBranchName(f, c, base, 'sec-batch-2');
  if (l1 === l2 || l1 === computeSecurityBranchName(f, c, base)) throw new Error('launchId must change the branch');
  if (l1 !== computeSecurityBranchName(f, c, base, 'sec-batch-1')) throw new Error('same launch must keep the branch');
  if (!/^security\/fix\/aaaaaaaaaaaa-[a-f0-9]{12}$/.test(l1)) throw new Error('format');
  console.log('PASS launchId gives each WF6 launch its own branch');
}
