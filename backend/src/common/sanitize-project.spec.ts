// Tests pour sanitize-project.ts — même style assert/ts-node que
// report-normalizer.spec.ts (pas de framework de test installé).
//   npx ts-node src/common/sanitize-project.spec.ts
import * as assert from 'assert';
import { sanitizeProject, sanitizeEntityProject } from './sanitize-project';

let passed = 0;
function check(label: string, condition: boolean) {
  assert.ok(condition, `ÉCHEC: ${label}`);
  passed++;
  console.log(`  ✓ ${label}`);
}

// Test PAR VALEUR, pas par nom de champ : `sonarqubeKey` (identifiant public
// SonarQube, pas un secret) matche pourtant /key/i par son NOM — un check par
// nom donnerait un faux positif dessus. Tester que la VALEUR marquée LEAK_
// n'apparaît jamais dans la sortie teste ce qui compte réellement, sans ce
// piège, et sans jamais affaiblir la deny-list pour faire taire une alerte.
const fakeProject = {
  id: 'p1', name: 'demo', status: 'healthy', securityScore: 90,
  jenkinsUrl: 'http://jenkins.local', jenkinsJobName: 'demo-job',
  jenkinsToken: 'user:LEAK_jenkins_token_value',
  sonarqubeUrl: 'http://sonar.local',
  sonarqubeKey: 'public-project-key', // public, pas un secret — voir note ci-dessus
  sonarqubeToken: 'squ_LEAK_sonar_token_value',
  githubRepo: 'org/repo',
  githubToken: 'ghp_LEAK_github_token_value',
  slackChannel: '#alerts',
  slackToken: 'xoxb_LEAK_slack_token_value',
};

console.log('Test 1 — sanitizeProject : aucune VALEUR secrète ne fuit');
{
  const clean: any = sanitizeProject(fakeProject);
  const serialized = JSON.stringify(clean);
  check('aucune valeur marquée "LEAK_" dans la sortie assainie', !serialized.includes('LEAK_'));
  check(
    'champs publics préservés (name/status/securityScore/sonarqubeKey)',
    clean.name === 'demo' && clean.status === 'healthy' && clean.securityScore === 90 && clean.sonarqubeKey === 'public-project-key',
  );
}

console.log('Test 2 — sanitizeEntityProject sur une entité (report/incident/bug simulé)');
{
  const fakeReport = { id: 'r1', securityScore: 10, riskLevel: 'CRITICAL', project: fakeProject };
  const clean: any = sanitizeEntityProject(fakeReport);
  const serialized = JSON.stringify(clean.project);
  check('entité (id/securityScore/riskLevel) intacte', clean.id === 'r1' && clean.securityScore === 10 && clean.riskLevel === 'CRITICAL');
  check('aucune valeur marquée "LEAK_" dans entity.project', !serialized.includes('LEAK_'));
}

console.log('Test 3 — robustesse null/undefined (ne doit jamais planter)');
{
  check('sanitizeProject(null) = null', sanitizeProject(null) === null);
  check('sanitizeProject(undefined) = undefined', sanitizeProject(undefined) === undefined);
  check("sanitizeEntityProject sans project renvoie l'entité telle quelle",
    (sanitizeEntityProject({ id: 'x' } as any) as any).id === 'x');
}

// ── 4. Documente la limite connue de la deny-list ───────────────────────
// Si tu ajoutes un NOUVEAU champ sensible à Project (ex: apiKey, webhookSecret),
// ce test doit être mis à jour EN MÊME TEMPS que sanitizeProject : ajoute le
// champ ci-dessous ET dans SENSITIVE_PROJECT_FIELDS. Tant que ce n'est fait
// qu'ici (fixture) et pas dans sanitizeProject, ce test le prouve : la valeur
// fuit toujours. C'est la limite structurelle d'une deny-list — une allow-list
// n'aurait pas ce problème (elle bloquerait tout par défaut).
console.log('Test 4 — démonstration de la fragilité de la deny-list (champ non listé)');
{
  const projectWithForgottenSecret = { ...fakeProject, futureApiKey: 'LEAK_forgotten_secret_value' };
  const clean: any = sanitizeProject(projectWithForgottenSecret);
  check(
    'une valeur sensible non ajoutée à SENSITIVE_PROJECT_FIELDS fuit toujours (limite connue, pas un bug)',
    JSON.stringify(clean).includes('LEAK_forgotten_secret_value'),
  );
}

console.log(`\n${passed} assertions passées.`);
