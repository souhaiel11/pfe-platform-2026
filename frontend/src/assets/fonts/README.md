# Polices locales

Inter et JetBrains Mono : versions variables 400–700, alphabets latin et latin étendu, licences SIL Open Font License jointes.

Tabler Icons : version 2.47.0, licence MIT jointe. Le fichier WOFF2 a été réduit aux 43 glyphes référencés par les sources actuelles ; fonts.css en contient les règles. Cette police utilise les points de code et ne conserve pas les tables de ligatures.

Lors de l’ajout d’une nouvelle classe `ti-*`, mettre à jour à la fois la règle CSS et le sous-ensemble de glyphes à partir des fichiers originaux de `@tabler/icons-webfont@2.47.0` (CSS et `fonts/tabler-icons.woff2`). Conserver la licence. FontTools avec le support WOFF2 peut produire ce sous-ensemble ; seules les tables de formes des glyphes et les points de code sont nécessaires pour cette utilisation.

Les polices sont incluses par frontend/angular.json et leurs références sont hachées par Angular dans media/. Le produit ne dépend pas d’un CDN pour les télécharger.
