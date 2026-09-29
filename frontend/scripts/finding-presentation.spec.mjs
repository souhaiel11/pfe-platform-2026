import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');

// Charge le module PARTAGÉ réel (finding-presentation.ts) -- pas une
// réimplémentation dans ce fichier de test, pour prouver le comportement
// effectif du code livré.
const moduleSource = read('../src/app/shared/finding-presentation.ts');
const moduleExports = {};
vm.runInNewContext(
  ts.transpileModule(moduleSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
  { exports: moduleExports, require: () => ({}), console },
);
const {
  findingDescriptionText,
  findingEvidenceText,
  findingWhyImportantText,
  findingRecommendationText,
  findingResponsibleText,
  findingEligibilityText,
} = moduleExports;

// Charge aussi le VRAI composant (ProjectDetailComponent) pour prouver que
// son câblage (sonarFindingSummary / findingEvidence / findingWhyImportant /
// findingRecommendationLabel / findingResponsibleLabel / findingEligibilityLabel)
// délègue effectivement au module partagé, pas une logique dupliquée/divergente.
const statusLabelsSource = read('../src/app/shared/status-labels.ts');
const statusLabelsExports = {};
vm.runInNewContext(
  ts.transpileModule(statusLabelsSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
  { exports: statusLabelsExports, require: () => ({}), console },
);
const componentSource = read('../src/app/features/projects/project-detail.component.ts');
const componentTemplate = read('../src/app/features/projects/project-detail.component.html');
const componentExports = {};
const componentCode = ts.transpileModule(componentSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true },
}).outputText;
vm.runInNewContext(componentCode, {
  exports: componentExports,
  require: (spec) => {
    if (spec.endsWith('status-labels')) return statusLabelsExports;
    if (spec.endsWith('finding-presentation')) return moduleExports;
    return new Proxy({}, { get: () => () => () => {} });
  },
  setTimeout: () => 0, console,
});
const component = Object.create(componentExports.ProjectDetailComponent.prototype);

// ============================================================================
// 1) Cas avec description technique brute SEULEMENT (aucune reformulation
// fournie par la source) -- prouve la reformulation générique (casse,
// ponctuation), sans jamais inventer de contenu, et sans hardcoding sur une
// règle Sonar précise (java:S3305 n'apparaît nulle part dans le module).
// ============================================================================
{
  const s3305Finding = { rule: 'java:S3305', message: 'inject this field value directly into "filterChain", the only method that uses it' };
  const out = findingDescriptionText(s3305Finding);
  assert.equal(out, 'Inject this field value directly into "filterChain", the only method that uses it.', '1: raw message is capitalized and punctuated, never altered in substance');
  assert.doesNotMatch(moduleSource, /S3305/, '1: the shared module contains no rule-specific literal for S3305 (generic only)');

  // Le composant réel délègue bien à ce module pour tout rule non spécial-casé.
  assert.equal(component.sonarFindingSummary(s3305Finding), out, '1: ProjectDetailComponent.sonarFindingSummary delegates to the generic module for an unlisted rule (e.g. S3305)');

  // Les 2 cas déjà spécial-casés (S1068/S125, pré-existants) restent inchangés
  // -- portée minimale, aucune régression sur un comportement déjà en place.
  assert.equal(component.sonarFindingSummary({ rule: 'java:S1068', message: 'Remove this unused "userRepository" private field.' }), 'Supprimer le champ privé « userRepository » inutilisé.', '1: pre-existing S1068 special case untouched');
  assert.equal(component.sonarFindingSummary({ rule: 'java:S125' }), 'Supprimer ce bloc de code commenté devenu inutile.', '1: pre-existing S125 special case untouched');

  // Ni description ni message ni title -> aveu honnête, jamais "Description non disponible".
  assert.equal(findingDescriptionText({}), "Aucune description détaillée n'est fournie par la source d'analyse.", '1: no raw text at all -> honest fallback, not "Non disponible"');
}
console.log('finding-presentation 1) description brute reformulée: PASS');

// ============================================================================
// 2) Cas avec "why important" (impact) ABSENT -- fallback générique dérivé
// des SEULS champs factuels disponibles, jamais une affirmation inventée.
// ============================================================================
{
  const finding = { severity: 'CRITICAL', type: 'VULNERABILITY', rule: 'java:S3305', source: 'SONARQUBE' };
  const out = findingWhyImportantText(finding);
  assert.match(out, /sévérité critical/, '2: derived text cites the real severity');
  assert.match(out, /type vulnerability/, '2: derived text cites the real type');
  assert.match(out, /règle java:S3305/, '2: derived text cites the real rule');
  assert.match(out, /source SONARQUBE/, '2: derived text cites the real source');
  assert.doesNotMatch(out, /\bmust\b|\bshould\b|toujours|jamais critique pour la sécurité/i, '2: never asserts an unproven severity claim beyond restating the known fields');

  // Rien d'exploitable du tout -> aveu honnête générique, jamais un contenu inventé.
  assert.equal(findingWhyImportantText({}), "Cette information n'est pas transmise par la source d'analyse.", '2: nothing available at all -> honest generic admission');

  // Câblage réel du composant.
  assert.equal(component.findingWhyImportant(finding), out, '2: ProjectDetailComponent.findingWhyImportant delegates to the shared module');
  assert.match(componentTemplate, /findingWhyImportant\(selectedSonarFinding\)/, '2: template wired to the new generic method, not the old raw findingValue(...impact)');
}
console.log('finding-presentation 2) why-important absent: PASS');

// ============================================================================
// 3) Cas avec correction (recommendation) ABSENTE -- message de repli utile,
// jamais "Non disponible" brut.
// ============================================================================
{
  assert.equal(findingRecommendationText({}), 'Aucune recommandation fournie par l’outil source.'.replace('’', "'"), '3: nothing at all -> generic clean fallback (matches the wording requested)');
  const withSourceAndRule = { source: 'TRIVY', rule: 'CVE-2024-0001' };
  const out = findingRecommendationText(withSourceAndRule);
  assert.match(out, /Aucune recommandation fournie par l'outil source \(TRIVY\)/, '3: fallback cites the real source when known');
  assert.match(out, /CVE-2024-0001/, '3: fallback cites the real rule/identifier when known');
  assert.doesNotMatch(out, /Non disponible/, '3: never the raw weak label');

  assert.equal(component.findingRecommendationLabel({}), findingRecommendationText({}), '3: ProjectDetailComponent.findingRecommendationLabel delegates to the shared module');
  assert.match(componentTemplate, /findingRecommendationLabel\(selectedSonarFinding\)/, '3: template wired to the new generic method');
  assert.doesNotMatch(componentTemplate.match(/Action recommandée<\/dt><dd>([^<]*)<\/dd>/)?.[1] || '', /findingValue/, '3: no longer routed through the raw findingValue(...) fallback');
}
console.log('finding-presentation 3) correction absente: PASS');

// ============================================================================
// 4) Cas avec responsable ABSENT -- jamais "Non assigné" brut, jamais un nom inventé.
// ============================================================================
{
  assert.equal(findingResponsibleText({}), 'Aucun responsable assigné pour le moment.', '4: no owner/responsible/assignee -> the exact requested honest wording');
  assert.equal(findingResponsibleText({ owner: 'alice' }), 'alice', '4: a real owner is shown verbatim, never overridden');
  assert.doesNotMatch(findingResponsibleText({}), /non assigné/i, '4: never the raw weak "Non assigné" label');

  assert.equal(component.findingResponsibleLabel({}), 'Aucun responsable assigné pour le moment.', '4: ProjectDetailComponent.findingResponsibleLabel delegates to the shared module');
  assert.match(componentTemplate, /findingResponsibleLabel\(selectedSonarFinding\)/, '4: template no longer interpolates `owner || \'UNASSIGNED\' | presentationLabel` directly');
  assert.doesNotMatch(componentTemplate, /'UNASSIGNED' \| presentationLabel/, '4: the old raw UNASSIGNED literal is gone from the drawer');
}
console.log('finding-presentation 4) responsable absent: PASS');

// ============================================================================
// 5) Sonar INFO / CRITICAL -- la logique reste correcte et cohérente aux deux
// extrêmes de sévérité (aucun hardcoding de seuil arbitraire).
// ============================================================================
{
  const infoFinding = { severity: 'INFO', rule: 'java:S1135', source: 'SONARQUBE' };
  const criticalFinding = { severity: 'CRITICAL', rule: 'java:S3305', source: 'SONARQUBE' };
  assert.match(findingWhyImportantText(infoFinding), /sévérité info/, '5: INFO severity correctly reflected');
  assert.match(findingWhyImportantText(criticalFinding), /sévérité critical/, '5: CRITICAL severity correctly reflected');
  // Éligibilité générique, indépendante de la sévérité -- dérivée uniquement de remediationType.
  assert.equal(findingEligibilityText({ ...infoFinding, remediationType: 'AUTO_FIX_ELIGIBLE' }), 'Correction automatisable', '5: INFO + AUTO_FIX_ELIGIBLE -> automatable');
  assert.equal(findingEligibilityText({ ...criticalFinding, remediationType: 'DEVELOPER_ACTION_REQUIRED' }), 'Nécessite une action humaine', '5: CRITICAL + DEVELOPER_ACTION_REQUIRED -> human action, never "Automatisation non disponible"');
  assert.match(componentTemplate, /findingEligibilityLabel\(selectedSonarFinding\)/, '5: template wired to the new generic eligibility method');
  assert.doesNotMatch(componentTemplate, /Automatisation non disponible/, '5: the old raw weak eligibility label is gone');
}
console.log('finding-presentation 5) Sonar INFO / CRITICAL: PASS');

// ============================================================================
// 6) Source NON Sonar (Trivy / générique) -- prouve que la logique est
// scanner-agnostique : aucun champ Sonar-only (rule/ruleKey) n'est requis,
// et le comportement est identique à un finding Sonar équivalent.
// ============================================================================
{
  const trivyFinding = { severity: 'HIGH', type: 'VULNERABILITY', source: 'TRIVY', message: 'CVE-2023-9999 affects package libfoo 1.2.3' };
  const description = findingDescriptionText(trivyFinding);
  assert.equal(description, 'CVE-2023-9999 affects package libfoo 1.2.3.', '6: Trivy finding description reformulated identically to a Sonar one');

  const why = findingWhyImportantText(trivyFinding);
  assert.match(why, /sévérité high/, '6: Trivy severity reflected');
  assert.match(why, /source TRIVY/, '6: Trivy source reflected, no Sonar-only field required');
  assert.doesNotMatch(why, /règle/, '6: no rule clause fabricated when the finding has no rule/ruleKey at all');

  const recommendation = findingRecommendationText(trivyFinding);
  assert.match(recommendation, /Aucune recommandation fournie par l'outil source \(TRIVY\)\.$/, '6: Trivy-sourced fallback, generic wording, no rule mentioned since none exists');

  const jenkinsFinding = { severity: 'MEDIUM', source: 'JENKINS', evidence: 'Build step "docker build" exited with code 1' };
  assert.equal(findingEvidenceText(jenkinsFinding), 'Build step "docker build" exited with code 1', '6: a THIRD, unrelated source (Jenkins) preserves raw evidence untouched -- traceability');
}
console.log('finding-presentation 6) source non-Sonar (Trivy/Jenkins) générique: PASS');

// ============================================================================
// Traçabilité : la preuve technique brute reste EXACTEMENT préservée quand
// elle existe (jamais reformulée), et un repli propre seulement en son absence.
// ============================================================================
{
  const withRealEvidence = { evidence: 'stack trace: NullPointerException at line 42', id: 'abc' };
  assert.equal(findingEvidenceText(withRealEvidence), 'stack trace: NullPointerException at line 42', 'evidence: real evidence text is never rewritten');
  assert.equal(component.findingEvidence(withRealEvidence), 'stack trace: NullPointerException at line 42', 'evidence: ProjectDetailComponent.findingEvidence preserves real evidence unchanged');

  // evidence identique à l'id (bruit technique), ou UUID -> repli sur message, comportement pré-existant préservé.
  const idLikeEvidence = { evidence: 'abc-123', id: 'abc-123', message: 'real message' };
  assert.equal(findingEvidenceText(idLikeEvidence), 'real message', 'evidence: id-shaped evidence still falls back to message (pre-existing behavior preserved)');

  // Rien du tout -> message propre, jamais "Non disponible" brut, mais jamais
  // un bloc supprimé (la section reste visible avec ce message).
  assert.equal(component.findingEvidence({}), "Aucune preuve technique brute n'est fournie par la source d'analyse.", 'evidence: clean fallback replaces the old raw "Non disponible", block stays visible');
}
console.log('finding-presentation traçabilité (evidence never rewritten): PASS');

console.log('finding-presentation.spec.mjs: ALL CHECKS PASS');
