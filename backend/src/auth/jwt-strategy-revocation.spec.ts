// Teste le composant « jwt-strategy-revocation » et ses cas d’erreur.
import * as assert from 'node:assert/strict';
import { JwtStrategy } from './jwt.strategy';
import { UserRole } from './user.entity';

const fakeConfig = { 
/** Récupère les données demandées. */
get: (_k: string, d?: any) => d ?? 'test-secret' } as any;
/** Prépare les données nécessaires à ce scénario. */
const repoOf = (rows: any[]) => ({
  /** Recherche l’élément correspondant à l’identifiant. */
  findOne: async ({ where }: any) => rows.find(r => r.id === where.id) || null,
}) as any;

const ACTIVE_ADMIN = { id: 'u-admin', email: 'admin@x', role: UserRole.ADMIN, isActive: true };
const DEMOTED = { id: 'u-demoted', email: 'demoted@x', role: UserRole.VIEWER, isActive: true };
const DISABLED = { id: 'u-off', email: 'off@x', role: UserRole.ADMIN, isActive: false };

/** Exécute les étapes principales de ce programme. */
async function main() {
  {
    const s = new JwtStrategy(fakeConfig, repoOf([ACTIVE_ADMIN]));
    const r = await s.validate({ sub: 'u-admin', email: 'admin@x', role: 'admin' });
    assert.deepEqual(r, { id: 'u-admin', email: 'admin@x', role: 'admin' });
    console.log('J1 compte actif -> accepté avec son rôle réel: PASS');
  }
  {
    // LE défaut : l'utilisateur n'existe plus en base, son token est encore
    // valide cryptographiquement. Doit être refusé.
    const s = new JwtStrategy(fakeConfig, repoOf([]));
    await assert.rejects(
      () => s.validate({ sub: 'u-supprime', email: 'gone@x', role: 'admin' }),
      /introuvable/i,
      'le jeton d\'un compte supprimé doit être refusé',
    );
    console.log('J2 compte supprimé -> jeton refusé (défaut D-4 fermé): PASS');
  }
  {
    const s = new JwtStrategy(fakeConfig, repoOf([DISABLED]));
    await assert.rejects(() => s.validate({ sub: 'u-off', email: 'off@x', role: 'admin' }), /désactivé/i);
    console.log('J3 compte désactivé (isActive=false) -> jeton refusé: PASS');
  }
  {
    // Rétrogradation : le token dit encore "admin", la base dit "viewer".
    // La base gagne, toujours — sinon la rétrogradation est inopérante 7 jours.
    const s = new JwtStrategy(fakeConfig, repoOf([DEMOTED]));
    const r = await s.validate({ sub: 'u-demoted', email: 'demoted@x', role: 'admin' });
    assert.equal(r.role, 'viewer', 'le rôle doit venir de la base, jamais du token');
    assert.notEqual(r.role, 'admin');
    console.log('J4 rôle rétrogradé en base -> le token "admin" ne confère plus admin: PASS');
  }
  {
    // Fail-closed sur un payload dégénéré.
    const s = new JwtStrategy(fakeConfig, repoOf([ACTIVE_ADMIN]));
    for (const bad of [{}, { sub: null }, { sub: 42 }, { sub: '' }]) {
      await assert.rejects(() => s.validate(bad as any), /sujet/i, `payload ${JSON.stringify(bad)}`);
    }
    console.log('J5 payload sans sujet exploitable -> refusé (fail-closed): PASS');
  }
  console.log('jwt-strategy-revocation.spec: ALL PASS');
}

main().catch(e => { console.error(e); process.exitCode = 1; });
