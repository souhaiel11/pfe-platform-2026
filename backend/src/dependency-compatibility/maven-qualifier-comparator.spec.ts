// Teste le composant « maven-qualifier-comparator » et ses cas d’erreur.
import { strict as assert } from 'assert';
import { compareMavenVersions } from './maven-qualifier-comparator';

// Plain numeric ordering, unaffected.
assert.equal(compareMavenVersions('1.2.13', '1.3.0-RC1'), -1, '1.2.13 < 1.3.0-RC1 (numeric run decides first)');
assert.equal(compareMavenVersions('5.3.20', '6.0.8'), -1);
assert.equal(compareMavenVersions('1.29', '1.31'), -1);
console.log('1. plain numeric ordering: PASS');

// Trailing-zero / release-equivalent padding never changes ordering.
assert.equal(compareMavenVersions('1.0', '1.0.0'), 0, '1.0 == 1.0.0');
assert.equal(compareMavenVersions('1.0', '1.0.0.GA'), 0, 'trailing GA is release-equivalent');
console.log('2. trailing-zero/GA padding treated as equal: PASS');

// Known Maven qualifier ranking: alpha < beta < milestone < rc/cr < snapshot < release < sp.
assert.equal(compareMavenVersions('1.0-alpha', '1.0-beta'), -1);
assert.equal(compareMavenVersions('1.0-beta', '1.0-milestone'), -1, 'milestone ranks above beta -- a lexical "b" vs "m" compare would get this right by luck; this must be RANK-based');
assert.equal(compareMavenVersions('1.0-milestone', '1.0-rc'), -1);
assert.equal(compareMavenVersions('1.0-rc', '1.0-snapshot'), -1);
assert.equal(compareMavenVersions('1.0-snapshot', '1.0'), -1, 'a SNAPSHOT is older than the release itself');
assert.equal(compareMavenVersions('1.0', '1.0-sp'), -1, 'a service-pack release is newer than the plain release');
console.log('3. full known-qualifier rank ordering (alpha<beta<milestone<rc<snapshot<release<sp): PASS');

// A pre-release qualifier is older than the plain numeric release it decorates.
assert.equal(compareMavenVersions('1.0', '1.0-alpha'), 1, '1.0 (release) is newer than 1.0-alpha');
assert.equal(compareMavenVersions('1.0-rc', '1.0'), -1);
console.log('4. numeric-vs-pre-release-qualifier at the same position: PASS');

// The exact case this whole module exists to fix: a lexical/last-resort
// string compare would rank "beta" > "milestone" > "alpha" alphabetically,
// which is WRONG. Must be rank-based, never lexical.
{
  const lexicalOrder = ['alpha', 'beta', 'milestone'].slice().sort();
  assert.deepEqual(lexicalOrder, ['alpha', 'beta', 'milestone'], 'sanity: alphabetical happens to coincide here, so use a case where it does NOT');
  // "cr" vs "rc" are Maven-EQUIVALENT (same rank) but NOT lexically equal --
  // a naive lexical comparator would call them different/ordered; Maven treats them identically.
  assert.equal(compareMavenVersions('1.0-cr1', '1.0-rc1'), 0, 'cr and rc are Maven-equivalent qualifiers, never lexically compared');
}
console.log('5. cr/rc equivalence (proves rank-based, not lexical, comparison): PASS');

// Unrecognized qualifiers -> INCOMPARABLE, never guessed lexically.
assert.equal(compareMavenVersions('1.0-foo', '1.0-bar'), 'INCOMPARABLE', 'unrecognized qualifiers must never be silently lexically ordered');
assert.equal(compareMavenVersions('1.0-foo', '1.0-foo'), 0, 'identical unrecognized qualifiers are still safely equal');
console.log('6. unrecognized qualifiers -> INCOMPARABLE (never guessed), identical unknowns still equal: PASS');

// Unparseable input -> INCOMPARABLE, never a crash or a guessed 0.
assert.equal(compareMavenVersions('', '1.0'), 'INCOMPARABLE');
assert.equal(compareMavenVersions('not-a-version-at-all-@@@', '1.0'), 'INCOMPARABLE');
console.log('7. unparseable input -> INCOMPARABLE, never a crash: PASS');

console.log('maven-qualifier-comparator.spec.ts: ALL CHECKS PASS');
