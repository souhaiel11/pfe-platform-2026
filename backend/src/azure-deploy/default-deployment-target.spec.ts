// Teste le composant « default-deployment-target » et ses cas d’erreur.
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { buildDefaultAzureConfig, deriveDeploymentSlug, readPlatformDeploymentDefaults } from './default-deployment-target';
import { ProjectsService } from '../projects/projects.service';

/** Exécute les étapes principales de ce programme. */
async function main() {
  const defaults = { resourceGroup: 'rg-tests', registry: 'acrtests', ports: ['9090'] };
  assert.equal(deriveDeploymentSlug('École API !'), 'ecole-api');
  assert.equal(deriveDeploymentSlug('***'), null);
  assert.equal(deriveDeploymentSlug('a'.repeat(100))?.length, 59);
  assert.equal(buildDefaultAzureConfig({ projectName: 'API', defaults: {} }).ok, false);
  assert.deepEqual(readPlatformDeploymentDefaults({ AZURE_DEFAULT_PORTS: '9090, 8080' }).ports, ['9090', '8080']);
  const derived = buildDefaultAzureConfig({ projectName: 'API', defaults });
  assert.equal(derived.ok, true);
  if (derived.ok) {
    assert.equal(derived.azureConfig.targetName, 'aci-api');
    assert.equal(derived.azureConfig.healthCheck, undefined);
  }
  assert.equal(buildDefaultAzureConfig({ projectName: 'API', defaults, takenTargetNames: ['ACI-API'] }).ok, false);
  assert.equal(buildDefaultAzureConfig({ projectName: 'API', defaults, takenRepositories: ['api'] }).ok, false);

  const previous = { ...process.env };
  try {
    process.env.AZURE_DEFAULT_RESOURCE_GROUP = defaults.resourceGroup;
    process.env.AZURE_DEFAULT_REGISTRY = defaults.registry;
    process.env.AZURE_DEFAULT_PORTS = '9090';
    const projects: any[] = [];
    let locks = 0;
    const repository: any = {
      /** Recherche l’élément correspondant à l’identifiant. */
      findOne: async ({ where }) => projects.find(p => p.id === where.id),
      /** Recherche les éléments correspondants. */
      find: async () => projects,
      /** Crée et enregistre un nouvel élément. */
      create: p => p,
      /** Enregistre les données fournies. */
      save: async p => { const saved = { ...p, id: String(projects.length + 1) }; projects.push(saved); return saved; },
      /** Applique les modifications autorisées à l’élément. */
      update: async (id, p) => Object.assign(projects.find(p => p.id === id), p),
    };
    repository.manager = { 
    /** Exécute les opérations dans le cadre transactionnel prévu. */
    transaction: async fn => fn({ 
    /** Renvoie les termes de recherche courants. */
    query: async () => { locks++; }, 
    /** Simule la lecture des données demandées par le composant. */
    getRepository: () => repository }) };
    const service = new ProjectsService(repository, {} as any, {} as any);
    const first = await service.create({ name: 'École API' } as any);
    assert.equal(first.azureConfig.targetName, 'aci-ecole-api');
    assert.deepEqual(first.azureConfig.ports, ['9090']);
    await assert.rejects(service.create({ name: 'ecole-api' } as any), /appartient déjà/);
    const second = await service.create({ name: 'other', azureConfig: null } as any);
    assert.equal(second.azureConfig, null);
    await assert.rejects(service.update(second.id, { azureConfig: first.azureConfig } as any), /appartient déjà/);
    await service.update(first.id, { azureConfig: first.azureConfig } as any);
    assert.equal(locks, 5);
    assert.equal(projects.length, 2);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  }
  console.log('Default Azure target derivation and service allocation: PASS');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
