// Teste le composant « build-detail-normalization » et ses cas d’erreur.
import * as assert from 'node:assert/strict';
import {
  normalizeJenkinsBuildDetail, unavailableBuildDetail, tailConsoleLines, repoSlug,
} from '../common/jenkins-build-detail';


const SUCCESS_BUILD = {
  actions: [
    { _class: 'hudson.model.ParametersAction', parameters: [
      { _class: 'hudson.model.BooleanParameterValue', name: 'JENKINS_HARD_GATE', value: false },
      { _class: 'hudson.model.StringParameterValue', name: 'CVSS_FAIL_THRESHOLD', value: '9.0' },
      { _class: 'hudson.model.StringParameterValue', name: 'SONAR_TOKEN', value: 'squ_real_secret' },
    ] },
    { _class: 'hudson.model.CauseAction', causes: [
      { _class: 'hudson.model.Cause$UserIdCause', shortDescription: 'Started by user souhaiel', userId: 'souhaiel', userName: 'souhaiel' },
    ] },
    { _class: 'hudson.plugins.git.util.BuildData',
      remoteUrls: ['https://github.com/souhaiel11/pfe-devsecops-shared-library.git'],
      lastBuiltRevision: { SHA1: 'a2427f82bd657a112be020637762ff5af9385182', branch: [{ name: 'main' }] } },
    { _class: 'hudson.plugins.git.util.BuildData',
      remoteUrls: ['https://github.com/souhaiel11/pfe-app-test.git'],
      lastBuiltRevision: { SHA1: '010990b8026df8b4a9bdeaf84b7bd81bae9faf58', branch: [{ name: 'refs/remotes/origin/main' }] } },
    { _class: 'hudson.tasks.junit.TestResultAction', failCount: 0, skipCount: 0, totalCount: 18 },
  ],
  artifacts: [],
  building: false,
  description: null,
  displayName: '#156',
  duration: 198746,
  estimatedDuration: 203111,
  number: 156,
  queueId: 11292,
  result: 'SUCCESS',
  timestamp: 1791748241456,
  url: 'http://172.31.172.61:8082/job/pfe-app-test/156/',
  changeSets: [{ _class: 'hudson.plugins.git.GitChangeSetList', items: [{
    commitId: '010990b8026df8b4a9bdeaf84b7bd81bae9faf58',
    msg: 'ci(tests): execute the 18 unit tests in the main pipeline',
    date: '2026-10-11 18:35:13 +0200',
    author: { fullName: 'amrisouhail96' },
    affectedPaths: ['Jenkinsfile'],
  }] }],
  previousBuild: { number: 155 },
  nextBuild: null,
};

const SUCCESS_WORKFLOW = {
  id: '156', name: '#156', status: 'SUCCESS',
  startTimeMillis: 1791748241462, durationMillis: 198746, queueDurationMillis: 6,
  stages: [
    { id: '11', name: 'Init', status: 'SUCCESS', startTimeMillis: 1791748244992, durationMillis: 366 },
    { id: '26', name: 'Build', status: 'SUCCESS', startTimeMillis: 1791748247028, durationMillis: 15360 },
    { id: '131', name: 'ZAP DAST Scan', status: 'SUCCESS', startTimeMillis: 1791748339950, durationMillis: 96601 },
  ],
};

const HISTORY = { builds: [
  { number: 156, result: 'SUCCESS', building: false, timestamp: 1791748241456 },
  { number: 155, result: 'SUCCESS', building: false, timestamp: 1791733893396 },
  { number: 0, result: 'SUCCESS', building: false, timestamp: 1 },
] };

(async () => {
  // ── 1. Build termine : chaque fait vient de la source, aucun calcul invente ──
  const ok = normalizeJenkinsBuildDetail({
    build: SUCCESS_BUILD, workflow: SUCCESS_WORKFLOW, history: HISTORY,
    jobName: 'pfe-app-test', repoHint: 'souhaiel11/pfe-app-test',
  });
  assert.equal(ok.available, true);
  assert.equal(ok.number, 156);
  assert.equal(ok.status, 'SUCCESS', 'un build termine presente son resultat reel');
  assert.equal(ok.durationMs, 198746);
  assert.equal(ok.queueDurationMs, 6);
  assert.equal(ok.queueId, 11292);
  assert.equal(ok.previousBuildNumber, 155);
  assert.equal(ok.nextBuildNumber, null, 'aucun build suivant : null, pas 0');

  // ── 2. Declencheur ──
  assert.equal(ok.trigger?.description, 'Started by user souhaiel');
  assert.equal(ok.trigger?.userName, 'souhaiel');
  assert.equal(ok.trigger?.type, 'UserIdCause');

  // ── 3. LE piege : deux checkouts, le commit du PROJET doit gagner ──
  assert.equal(ok.checkouts.length, 2, 'les deux checkouts restent visibles');
  assert.equal(ok.commit?.sha, '010990b8026df8b4a9bdeaf84b7bd81bae9faf58',
    'le commit designe est celui du depot applicatif, pas celui de la bibliotheque partagee');
  assert.equal(ok.commit?.branch, 'main', 'refs/remotes/origin/main est rendu lisible');
  assert.equal(ok.commit?.shortSha, '010990b8026d');
  assert.equal(ok.commitReason, null);

  // ── 4. Depot du projet non renseigne / non trouve : AUCUN commit elu ──
  const noHint = normalizeJenkinsBuildDetail({ build: SUCCESS_BUILD, jobName: 'pfe-app-test' });
  assert.equal(noHint.commit, null, 'sans depot de reference, aucun commit n’est designe');
  assert.equal(noHint.commitReason, 'PROJECT_REPO_NOT_MATCHED');
  assert.equal(noHint.checkouts.length, 2, 'les checkouts restent listes malgre l’ambiguite');

  // ── 5. Ambiguite : deux checkouts du MEME depot => echec ferme ──
  const ambiguous = normalizeJenkinsBuildDetail({
    build: { ...SUCCESS_BUILD, actions: [
      { _class: 'hudson.plugins.git.util.BuildData', remoteUrls: ['https://github.com/souhaiel11/pfe-app-test.git'],
        lastBuiltRevision: { SHA1: '1111111111111111111111111111111111111111', branch: [{ name: 'main' }] } },
      { _class: 'hudson.plugins.git.util.BuildData', remoteUrls: ['git@github.com:souhaiel11/pfe-app-test.git'],
        lastBuiltRevision: { SHA1: '2222222222222222222222222222222222222222', branch: [{ name: 'main' }] } },
    ] },
    repoHint: 'https://github.com/souhaiel11/pfe-app-test',
  });
  assert.equal(ambiguous.commit, null);
  assert.equal(ambiguous.commitReason, 'AMBIGUOUS_PROJECT_CHECKOUT');

  // ── 6. Tests : lus de l'action JUnit, reussis derives seulement si complet ──
  assert.deepEqual(ok.tests, { total: 18, failed: 0, skipped: 0, passed: 18 });
  const partialTests = normalizeJenkinsBuildDetail({ build: { actions: [
    { _class: 'hudson.tasks.junit.TestResultAction', totalCount: 18 },
  ] } });
  assert.equal(partialTests.tests?.passed, null, 'un total sans echecs ne prouve aucun succes');
  assert.equal(normalizeJenkinsBuildDetail({ build: { actions: [] } }).tests, null,
    'pas de rapport de tests publie => null, jamais 0 test');

  // ── 7. Secrets : un parametre qui sent le secret n'est jamais rendu ──
  assert.deepEqual(ok.parameters, [
    { name: 'JENKINS_HARD_GATE', value: 'false', masked: false },
    { name: 'CVSS_FAIL_THRESHOLD', value: '9.0', masked: false },
    { name: 'SONAR_TOKEN', value: '•••••', masked: true },
  ]);

  // ── 8. Changements ──
  assert.equal(ok.changes.length, 1);
  assert.equal(ok.changes[0].author, 'amrisouhail96');
  assert.equal(ok.changes[0].shortSha, '010990b8026d');
  assert.deepEqual(ok.changes[0].affectedPaths, ['Jenkinsfile']);

  // ── 9. Etages ──
  assert.deepEqual(ok.stages.map(s => s.name), ['Init', 'Build', 'ZAP DAST Scan']);
  assert.equal(ok.stagesReason, null);
  assert.equal(ok.stages[1].durationMs, 15360);

  // ── 10. Build EN COURS : ni resultat ni duree fabriques ──
  const running = normalizeJenkinsBuildDetail({
    build: { number: 157, building: true, result: null, duration: 0, timestamp: 1791748241456, estimatedDuration: 203111 },
    workflow: { stages: [{ id: '11', name: 'Build', status: 'IN_PROGRESS', startTimeMillis: 1791748244992, durationMillis: 4000 }] },
    jobName: 'pfe-app-test',
  });
  assert.equal(running.status, 'RUNNING');
  assert.equal(running.result, null, 'un build en cours n’a pas de resultat');
  assert.equal(running.durationMs, null, 'duration=0 pendant l’execution n’est jamais presente comme 0 s');
  assert.equal(running.estimatedDurationMs, 203111, 'la duree ESTIMEE, elle, est un fait publie');

  // ── 11. Etage en echec : le message d'erreur exact est conserve ──
  const failed = normalizeJenkinsBuildDetail({
    build: { number: 11, result: 'FAILURE', building: false, duration: 30284, timestamp: 1791756811764 },
    workflow: { status: 'FAILED', queueDurationMillis: 10, stages: [
      { id: '66', name: 'Docker Build', status: 'SUCCESS', startTimeMillis: 1791756835035, durationMillis: 3063 },
      { id: '79', name: 'Publish Image (ACR)', status: 'FAILED', startTimeMillis: 1791756838124, durationMillis: 543,
        error: { message: 'script returned exit code 6', type: 'hudson.AbortException' } },
    ] },
    jobName: 'app-test-pfe-vermeg',
  });
  assert.equal(failed.status, 'FAILURE');
  assert.equal(failed.stages[1].error, 'script returned exit code 6');
  assert.equal(failed.stages[0].error, null, 'un etage reussi ne porte aucune erreur');

  // ── 12. Stage View muette : motif explicite, jamais une liste vide muette ──
  const noStages = normalizeJenkinsBuildDetail({ build: SUCCESS_BUILD, workflow: null });
  assert.deepEqual(noStages.stages, []);
  assert.equal(noStages.stagesReason, 'STAGE_VIEW_UNAVAILABLE');
  assert.equal(normalizeJenkinsBuildDetail({ build: SUCCESS_BUILD, workflow: { stages: [] } }).stagesReason, 'NO_STAGE_RECORDED');

  // ── 13. Builds voisins : un numero invalide est ecarte, pas corrige ──
  assert.deepEqual(ok.neighbours.map(b => b.number), [156, 155]);

  // ── 14. Etat degrade : forme STABLE, tout a null ──
  const down = unavailableBuildDetail('pfe-app-test', 'JENKINS_UNREACHABLE', 'Jenkins est injoignable');
  assert.equal(down.available, false);
  assert.equal(down.reason, 'JENKINS_UNREACHABLE');
  assert.equal(down.jobName, 'pfe-app-test');
  for (const key of ['number', 'status', 'result', 'durationMs', 'commit', 'tests', 'url'] as const) {
    assert.equal((down as any)[key], null, `${key} doit rester null dans un etat degrade`);
  }
  assert.deepEqual(down.stages, []);

  // ── 15. repoSlug : formes git/https/.git/slug nu ──
  assert.equal(repoSlug('https://github.com/souhaiel11/pfe-app-test.git'), 'souhaiel11/pfe-app-test');
  assert.equal(repoSlug('git@github.com:souhaiel11/pfe-app-test.git'), 'souhaiel11/pfe-app-test');
  assert.equal(repoSlug('souhaiel11/pfe-app-test'), 'souhaiel11/pfe-app-test');
  assert.equal(repoSlug('pfe-app-test'), null, 'un nom seul ne designe pas un depot');
  assert.equal(repoSlug(''), null);

  // ── 16. Journal de console : fenetre de fin, jamais une ligne coupee ──
  const log = tailConsoleLines('a\nb\nc\nd\n', 2);
  assert.deepEqual(log.lines, ['c', 'd']);
  assert.equal(log.truncated, true);
  assert.equal(log.totalLines, 4, 'le saut de ligne final ne compte pas pour une ligne');
  const shortLog = tailConsoleLines('a\nb', 10);
  assert.deepEqual(shortLog.lines, ['a', 'b']);
  assert.equal(shortLog.truncated, false);
  assert.deepEqual(tailConsoleLines('', 10), { lines: [], truncated: false, totalLines: 0 });
  assert.deepEqual(tailConsoleLines('x\r\ny', 10).lines, ['x', 'y'], 'les fins de ligne Windows sont normalisees');

  console.log('✓ build-detail-normalization: 16 groupes verifies');
})();
