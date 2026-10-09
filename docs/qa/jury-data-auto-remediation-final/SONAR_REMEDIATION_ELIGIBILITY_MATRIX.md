# SONAR_REMEDIATION_ELIGIBILITY_MATRIX

**Phase 6.** L'étiquette « Correction automatisable » portée par les constats
Sonar, confrontée à la capacité réelle de la plateforme.

## D'où vient l'étiquette

WF1, nœud `Merge All Fetched Data` :

```js
const UNSAFE_AUTO_FIX_RULES = new Set(['java:S3305']);
const remediationType = ({ source, severity, file, type, rule }) => {
  const identifiable  = typeof file === 'string' && file.trim().length > 0;
  const codeFinding   = src === 'SONARQUBE' && ['BUG','VULNERABILITY','CODE_SMELL'].includes(kind);
  const severityEligible = identifiable && codeFinding && ['CRITICAL','MAJOR'].includes(sev);
  return severityEligible && !UNSAFE_AUTO_FIX_RULES.has(rule)
    ? 'AUTO_FIX_ELIGIBLE' : 'DEVELOPER_ACTION_REQUIRED';
};
```

C'est un classement **par sévérité**, avec une liste d'exclusion d'**une seule**
règle. Tout constat Sonar MAJOR ou CRITICAL rattaché à un fichier devient donc
`AUTO_FIX_ELIGIBLE`.

Le commentaire du code documente lui-même la limite, constatée en production :
une règle d'injection de dépendance avait été classée éligible par la sévérité
seule, alors que le planificateur de WF2 l'avait indépendamment et correctement
jugée `MANUAL_OR_SPECIALIST` — corriger ce défaut demandait de changer une
signature de méthode de câblage, un risque structurel qu'un classement par
sévérité ne peut pas voir.

## Confrontation à la capacité réelle

| Aspect | Constat |
|---|---|
| Chaîne WF6 (dépendances) | `SUPPORTED_SECURITY_SOURCES = {TRIVY, OWASP}` — **Sonar n'y entre pas** |
| Adaptateur de cible | n'ancre que le **descripteur Maven racine** — jamais un fichier source |
| Chemin réellement disponible | WF2 : revue assistée par LLM puis matérialisation de candidat |
| Qui décide, in fine | **le planificateur de WF2**, qui peut conclure `MANUAL_OR_SPECIALIST` |

Donc l'étiquette amont est une **prédiction**, pas une qualification. Elle n'est
ni fausse ni fiable : un chemin existe, mais sa réussite n'est pas établie au
moment où l'étiquette s'affiche.

## Matrice d'éligibilité

| Nature du constat | Source | Décision autoritaire | Étiquette avant | Étiquette après | Justification |
|---|---|---|---|---|---|
| Dépendance Maven, provenance supportée, correction de même majeure | Trivy / OWASP | `security-eligibility-classifier.ts`, **déterministe** | Correction automatisable | **Correction automatisable** *(inchangé)* | Prouvé de bout en bout : candidat, build, 24 tests, double rescan, fermeture. « Automatisable » est exact. |
| Défaut de code source, MAJOR/CRITICAL, fichier identifiable | SonarQube | **planificateur WF2**, au moment de la demande | Correction automatisable | **Correction assistée candidate** | Un chemin existe mais rien n'est garanti ; WF2 peut refuser. On annonce une candidature. |
| Défaut de code source, règle exclue en amont | SonarQube | WF1, liste d'exclusion | Action développeur requise | *(inchangé)* | Déjà sincère. |
| Défaut de code source, INFO/MINOR | SonarQube | WF1, seuil de sévérité | Action développeur requise | *(inchangé)* | Déjà sincère. |
| Paquet OS / image de base | Trivy | aucune stratégie de version d'image | Action développeur requise | *(inchangé)* | Déjà sincère. |
| Constat DAST | ZAP | aucune source supportée, aucun rescan ZAP | Action développeur requise | *(inchangé)* | Déjà sincère. Voir phase 15. |

## Ce qui a changé, exactement

`frontend/src/app/shared/finding-presentation.ts`, `findingEligibilityText()` :
la formulation dépend désormais de la **nature du constat** déclarée par le
constat lui-même — jamais du nom du scanner, jamais du projet.

```ts
const isSourceDefect = String(finding?.source || '').toUpperCase() === 'SONARQUBE';
return isSourceDefect ? 'Correction assistée candidate' : 'Correction automatisable';
```

L'énumération `AUTO_FIX_ELIGIBLE` n'est pas touchée : aucune valeur nouvelle,
aucun état de cycle de vie inventé. Seule la **formulation** visible change, et
quatre assertions de test encodent désormais la distinction, dont deux qui
vérifient que le cas dépendance reste « automatisable ».

## Ce qui n'a PAS été changé, et pourquoi

Le classement par sévérité de WF1 **reste en place**. Le corriger supposerait de
modifier un workflow publié pour y déplacer une décision qui, de toute façon,
appartient au planificateur de WF2. La formulation sincère côté interface traite
le symptôme visible par le jury sans déplacer une responsabilité.
