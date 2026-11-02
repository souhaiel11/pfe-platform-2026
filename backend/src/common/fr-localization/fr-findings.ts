/** Francisation des constats de scanners (Trivy, OWASP, ZAP, SonarQube) avant leur affichage : titres, descriptions et recommandations lisibles, jamais un mélange d'anglais et de français. */
// Les données stockées ne sont pas modifiées : seules les réponses destinées à l'interface sont
// traduites (intercepteur HTTP et passerelle WebSocket). n8n et les workflows continuent donc de
// recevoir le texte d'origine des scanners, sur lequel s'appuient leurs prompts et leurs contrôles.
import { CVE_FR } from './cve-fr.data';

const CVE_ID = /^(CVE-\d{4}-\d{4,}|GHSA(-[0-9a-z]{4}){3})$/i;
const SONAR_RULE = /^[a-z]+:S\d+$/i;
const SEVERITY_FR: Record<string, string> = {
  CRITICAL: 'critique', HIGH: 'élevée', MEDIUM: 'moyenne', MODERATE: 'moyenne', LOW: 'faible', INFO: 'informative',
};

const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const quoted = (value: string) => `« ${value} »`;

/** Messages SonarQube : traduction fidèle du message de la règle, paramètres réels conservés (nom du champ, de la variable…). */
const SONAR_FR: Array<[rule: string, pattern: RegExp | null, render: (m: RegExpMatchArray) => string]> = [
  ['S100', /regular expression '([^']+)'/, m => `Renommer cette méthode pour respecter la convention de nommage ${quoted(m[1])}.`],
  ['S106', null, () => 'Remplacer cet usage de System.out par un logger.'],
  ['S1066', null, () => 'Fusionner cette instruction if avec le if qui l’englobe.'],
  ['S1068', /unused "([^"]+)"/, m => `Supprimer le champ privé ${quoted(m[1])}, qui n’est jamais utilisé.`],
  ['S107', /^(Constructor|Method) has (\d+) parameters, which is greater than (\d+)/, m =>
    `${m[1] === 'Constructor' ? 'Ce constructeur' : 'Cette méthode'} a ${m[2]} paramètres, au-delà des ${m[3]} autorisés.`],
  ['S108', null, () => 'Supprimer ce bloc vide, le compléter, ou ajouter un commentaire expliquant pourquoi il est vide.'],
  ['S1104', /^Make (\S+) a static final/, m => `Rendre ${quoted(m[1])} constant (static final) ou non public, avec des accesseurs si nécessaire.`],
  ['S112', null, () => 'Remplacer les exceptions génériques par des exceptions spécifiques ou par une exception dédiée.'],
  ['S1130', /exception '([^']+)'/, m => `Retirer la déclaration de l’exception ${quoted(m[1])} : le corps de la méthode ne peut pas la lever.`],
  ['S1135', null, () => 'Terminer la tâche associée à ce commentaire TODO.'],
  ['S1172', /parameter "([^"]+)"/, m => `Supprimer le paramètre ${quoted(m[1])}, qui n’est jamais utilisé.`],
  ['S1186', null, () => 'Ajouter un commentaire expliquant pourquoi cette méthode est vide, lever une UnsupportedOperationException, ou compléter son implémentation.'],
  ['S1192', /literal "([^"]*)" (\d+) times/, m => `Définir une constante au lieu de répéter ${m[2]} fois le littéral ${quoted(m[1])}.`],
  ['S125', null, () => 'Supprimer ce bloc de code laissé en commentaire.'],
  ['S1444', /"public static ([^"]+)"/, m => `Déclarer final le champ public statique ${quoted(m[1])}.`],
  ['S1481', /unused "([^"]+)"/, m => `Supprimer la variable locale ${quoted(m[1])}, qui n’est jamais utilisée.`],
  ['S1764', /operator "([^"]+)"/, m => `Corriger l’une des deux sous-expressions identiques de part et d’autre de l’opérateur ${quoted(m[1])}.`],
  ['S1854', /variable "([^"]+)"/, m => `Supprimer cette affectation inutile à la variable locale ${quoted(m[1])}.`],
  ['S1874', /use of "([^"]+)"/, m => `Remplacer l’usage de ${quoted(m[1])}, qui est obsolète.`],
  ['S2068', /^'([^']+)' detected/, m => `${quoted(m[1])} détecté dans cette expression : vérifier ce mot de passe potentiellement écrit en dur dans le code.`],
  ['S2095', /close this "([^"]+)"/, m => `Utiliser try-with-resources ou fermer ${quoted(m[1])} dans un bloc finally : la ressource n’est jamais libérée.`],
  ['S2119', null, () => 'Créer une seule fois cet objet « Random » et le réutiliser, au lieu d’en créer un à chaque appel.'],
  ['S2386', null, () => 'Rendre ce membre « protected ».'],
  ['S2589', /evaluates to "([^"]+)"/, m => `Supprimer cette expression, qui vaut toujours ${quoted(m[1])}.`],
  ['S3305', /directly into "([^"]+)"/, m => `Injecter cette valeur directement dans ${quoted(m[1])}, la seule méthode qui l’utilise.`],
  ['S3400', null, () => 'Supprimer cette méthode et déclarer une constante pour cette valeur.'],
  ['S3776', /from (\d+) to the (\d+) allowed/, m => `Restructurer cette méthode pour ramener sa complexité cognitive de ${m[1]} au maximum autorisé de ${m[2]}.`],
  ['S4684', null, () => 'Remplacer cette entité persistante par un simple objet de transfert (POJO ou DTO).'],
  ['S4973', null, () => 'Comparer les chaînes et les types encapsulés avec equals(), et non avec ==.'],
  ['S5542', null, () => 'Utiliser un mode de chiffrement sûr (par exemple GCM) au lieu d’un mode faible comme ECB.'],
  ['S5547', null, () => 'Utiliser un algorithme de chiffrement robuste (par exemple AES) au lieu d’un algorithme faible comme DES.'],
  ['S5778', null, () => 'Restructurer la lambda pour qu’une seule invocation puisse lever une exception d’exécution.'],
  ['S5785', null, () => 'Utiliser assertNotEquals à la place.'],
  ['S6204', /usage of '([^']+)' with '([^']+)'/, m => `Remplacer ${quoted(m[1])} par ${quoted(m[2])}, en s’assurant que la liste n’est pas modifiée.`],
  ['S6206', /to use '([^']+)'/, m => `Transformer cette classe en record : ${quoted(m[1])}.`],
  ['S6813', null, () => 'Supprimer cette injection par champ et utiliser l’injection par constructeur.'],
];

/** Alertes ZAP (DAST), par identifiant de règle ZAP. */
const ZAP_FR: Record<string, [titre: string, description: string, recommandation: string]> = {
  '10010': ['Cookie sans attribut HttpOnly', 'Un cookie est envoyé sans l’attribut HttpOnly : un script exécuté dans la page peut le lire, ce qui facilite le vol de session en cas de XSS.', 'Ajouter l’attribut HttpOnly à tous les cookies qui n’ont pas besoin d’être lus par JavaScript.'],
  '10011': ['Cookie sans attribut Secure', 'Un cookie est envoyé sans l’attribut Secure : il peut être transmis en clair sur une connexion HTTP.', 'Ajouter l’attribut Secure à tous les cookies sensibles et servir le site en HTTPS.'],
  '10020': ['En-tête anti-clickjacking absent', 'La réponse ne protège pas contre le clickjacking : elle devrait contenir la directive Content-Security-Policy « frame-ancestors » ou l’en-tête X-Frame-Options. Une page malveillante peut sinon l’afficher dans un cadre invisible et piéger les clics de l’utilisateur.', 'Envoyer Content-Security-Policy avec « frame-ancestors », ou X-Frame-Options à DENY ou SAMEORIGIN, sur toutes les pages.'],
  '10021': ['En-tête X-Content-Type-Options absent', 'L’en-tête X-Content-Type-Options n’est pas fixé à « nosniff » : certains navigateurs peuvent interpréter une réponse comme un autre type de contenu que celui déclaré, et exécuter un contenu inattendu.', 'Définir correctement l’en-tête Content-Type et ajouter « X-Content-Type-Options: nosniff » sur toutes les réponses.'],
  '10027': ['Commentaires suspects dans la page', 'La page contient des commentaires qui peuvent révéler des informations utiles à un attaquant.', 'Retirer des pages livrées les commentaires qui contiennent des informations techniques.'],
  '10035': ['En-tête Strict-Transport-Security absent', 'Le site HTTPS n’envoie pas l’en-tête HSTS : un navigateur peut encore être ramené vers une connexion HTTP non chiffrée.', 'Envoyer l’en-tête Strict-Transport-Security sur toutes les réponses HTTPS.'],
  '10036': ['Version du serveur révélée', 'L’en-tête Server indique le logiciel et sa version, ce qui aide un attaquant à cibler des vulnérabilités connues.', 'Supprimer ou rendre générique l’en-tête Server.'],
  '10037': ['Technologie révélée par X-Powered-By', 'L’en-tête X-Powered-By indique la technologie utilisée par le serveur, ce qui aide un attaquant à cibler ses attaques.', 'Supprimer l’en-tête X-Powered-By des réponses.'],
  '10038': ['En-tête Content Security Policy (CSP) absent', 'Aucune politique de sécurité du contenu n’est envoyée : le navigateur ne peut pas limiter les sources de scripts et de contenus, ce qui facilite le script intersite (XSS) et l’injection de contenu.', 'Configurer le serveur web, le serveur d’application ou le répartiteur de charge pour envoyer l’en-tête Content-Security-Policy.'],
  '10054': ['Cookie sans attribut SameSite', 'Un cookie est envoyé sans l’attribut SameSite : il peut accompagner des requêtes provenant d’autres sites, ce qui facilite les attaques CSRF.', 'Ajouter l’attribut SameSite (Lax ou Strict) aux cookies.'],
  '10063': ['En-tête Permissions-Policy absent', 'Aucune politique n’encadre l’accès de la page aux fonctions du navigateur (caméra, géolocalisation…).', 'Envoyer un en-tête Permissions-Policy adapté à l’application.'],
  '10096': ['Horodatage révélé', 'La réponse contient un horodatage technique qui peut renseigner un attaquant sur le système.', 'Vérifier que l’horodatage ne révèle pas d’information sensible.'],
  '10098': ['Configuration CORS trop permissive', 'Le serveur autorise des requêtes inter-origines trop larges : d’autres sites peuvent lire ses réponses.', 'Limiter Access-Control-Allow-Origin aux origines de confiance.'],
  '10105': ['Méthode d’authentification faible', 'Une authentification HTTP Basic, Digest ou NTLM est utilisée sur une connexion non chiffrée : les identifiants peuvent être lus ou rejoués.', 'Protéger la connexion par HTTPS ou utiliser un mécanisme d’authentification plus robuste.'],
  '10106': ['Site servi uniquement en HTTP', 'Le site est servi uniquement en HTTP, sans HTTPS : les échanges circulent en clair et peuvent être lus ou modifiés sur le réseau.', 'Configurer le serveur web ou applicatif pour utiliser TLS (HTTPS).'],
  '10202': ['Absence de jeton anti-CSRF', 'Un formulaire ne contient pas de jeton anti-CSRF : un site malveillant peut faire soumettre ce formulaire à l’insu de l’utilisateur.', 'Ajouter un jeton anti-CSRF imprévisible à chaque formulaire.'],
  '40012': ['Script intersite réfléchi (XSS)', 'Une donnée fournie dans la requête est renvoyée dans la page sans être neutralisée : un lien piégé peut exécuter du JavaScript dans le navigateur de la victime.', 'Encoder toutes les données renvoyées dans la page selon leur contexte (HTML, attribut, JavaScript).'],
  '40018': ['Injection SQL', 'Un paramètre de la requête est inséré dans une requête SQL sans protection : un attaquant peut lire ou modifier la base de données.', 'Utiliser des requêtes préparées (paramétrées) pour toutes les requêtes SQL.'],
  '40042': ['Fuite d’informations via Spring Actuator', 'Des points d’accès Spring Actuator sont exposés : ils peuvent révéler la configuration, les variables d’environnement ou l’état interne de l’application.', 'Désactiver les points d’accès Actuator inutiles et protéger les autres par une authentification.'],
  '90022': ['Message d’erreur applicative exposé', 'La page affiche un message d’erreur technique qui peut révéler des informations sur l’application.', 'Afficher des messages d’erreur génériques et journaliser le détail côté serveur.'],
};

/** Anciens constats ZAP sans numéro de règle (l'identifiant est le titre ZAP officiel, en anglais). */
const ZAP_ID_BY_TITLE: Record<string, string> = {
  'cookie no httponly flag': '10010', 'cookie without secure flag': '10011', 'missing anti-clickjacking header': '10020',
  'x-content-type-options header missing': '10021', 'information disclosure - suspicious comments': '10027',
  'strict-transport-security header not set': '10035', 'server leaks version information via "server" http response header field': '10036',
  'server leaks information via "x-powered-by" http response header field(s)': '10037', 'content security policy (csp) header not set': '10038',
  'cookie without samesite attribute': '10054', 'permissions policy header not set': '10063', 'timestamp disclosure - unix': '10096',
  'cross-domain misconfiguration': '10098', 'weak authentication method': '10105', 'http only site': '10106',
  'absence of anti-csrf tokens': '10202', 'cross site scripting (reflected)': '40012', 'sql injection': '40018',
  'spring actuator information leak': '40042', 'application error disclosure': '90022',
};

/** Message SonarQube en français, ou une formulation neutre si la règle n’est pas encore traduite. */
export function sonarMessageFr(rule: string, message: string): string {
  const key = String(rule).split(':').pop()!.toUpperCase();
  for (const [ruleKey, pattern, render] of SONAR_FR) {
    if (ruleKey !== key) continue;
    if (!pattern) return render([] as unknown as RegExpMatchArray);
    const match = message.match(pattern);
    if (match) return render(match);
  }
  return `Problème de qualité de code détecté par SonarQube (règle ${rule}). Consultez la règle dans SonarQube pour la correction attendue.`;
}

/** « Upgrade to 1.2, 1.3 » → « Mettre à jour vers la version 1.2 ou 1.3. » ; sinon une recommandation française tirée de la version corrigée. */
export function recommendationFr(recommendation: string, fixedVersion?: string): string | null {
  const upgrade = recommendation.match(/^upgrade to (.+?)\.?$/i);
  if (upgrade) {
    const versions = upgrade[1].split(/\s*,\s*/).filter(Boolean);
    return `Mettre à jour vers la version ${versions.length > 1 ? `${versions.slice(0, -1).join(', ')} ou ${versions[versions.length - 1]}` : versions[0]}.`;
  }
  if (fixedVersion) return `Mettre à jour vers la version ${fixedVersion} ou une version ultérieure.`;
  return null;
}

/** Titre et description en français d'une vulnérabilité : le résumé rédigé s'il existe, sinon un texte construit à partir des données du constat. */
export function cveTextFr(id: string, finding: any): { titre: string; description: string } {
  const known = CVE_FR[id] || CVE_FR[id.toUpperCase()];
  if (known) return { titre: known[0], description: known[1] };
  const component = str(finding?.pkg) || str(finding?.component) || str(finding?.package) || str(finding?.dependency) || 'un composant';
  const installed = str(finding?.installedVersion) || str(finding?.currentVersion) || str(finding?.version);
  const fixed = str(finding?.fixedVersion);
  const severity = SEVERITY_FR[str(finding?.severity).toUpperCase()];
  return {
    titre: `Vulnérabilité ${id} dans ${component}`,
    description: `${component}${installed ? ` ${installed}` : ''} est concerné par la vulnérabilité ${id}`
      + `${severity ? `, de gravité ${severity}` : ''}. `
      + (fixed ? `Elle est corrigée à partir de la version ${fixed}. ` : 'Le scanner n’indique pas encore de version corrigée. ')
      + 'Le détail technique figure dans la fiche officielle de la CVE.',
  };
}

/** Remplace les champs texte présents d'un objet (sans en créer de nouveaux). */
function assignPresent(target: any, fields: string[], value: string) {
  for (const field of fields) if (typeof target[field] === 'string' && target[field].trim()) target[field] = value;
}

/** Messages techniques d'étape remontés tels quels par n8n (rapport de scanner absent, etc.). */
const STAGE_MESSAGE_FR: Array<[RegExp, string]> = [
  [/expects the node's input data to contain a binary file/i,
    'Le rapport de ce scanner n’a pas pu être lu : le pipeline n’a transmis aucun fichier de rapport pour ce build.'],
];

/** Francise un constat isolé (objet déjà copié), selon son type : règle Sonar, alerte ZAP ou vulnérabilité de dépendance. */
function localizeOne(o: any): any {
  if (typeof o.message === 'string') {
    const technical = STAGE_MESSAGE_FR.find(([pattern]) => pattern.test(o.message));
    if (technical) o.message = technical[1];
  }
  const rule = str(o.rule) || str(o.ruleKey);
  if (SONAR_RULE.test(rule)) {
    const original = str(o.message) || str(o.title) || str(o.description);
    if (original) assignPresent(o, ['message', 'title', 'description'], sonarMessageFr(rule, original));
    return o;
  }
  // Identifiant de règle ZAP : toujours numérique (l'`id` d'une tâche de correction est un UUID, à ignorer).
  const isZap = str(o.source).toUpperCase() === 'ZAP' || o.pluginId !== undefined || o.pluginid !== undefined;
  const pluginId = [o.pluginId, o.pluginid, o.ruleOrCve, o.id].map(str).find(value => /^\d+$/.test(value))
    || [o.ruleOrCve, o.title, o.name, o.alert].map(value => ZAP_ID_BY_TITLE[str(value).toLowerCase()]).find(Boolean)
    || (isZap && str(o.title || o.name || o.alert) ? 'inconnue' : '');
  if (isZap && pluginId) {
    const fr = ZAP_FR[pluginId];
    const titre = fr?.[0] || (pluginId === 'inconnue' ? 'Alerte de sécurité ZAP' : `Alerte de sécurité ZAP (règle ${pluginId})`);
    assignPresent(o, ['title', 'name', 'alert'], titre);
    assignPresent(o, ['description', 'message', 'desc'], fr?.[1] || 'Alerte relevée par le scan dynamique ZAP. Le détail figure dans le rapport ZAP.');
    assignPresent(o, ['recommendation', 'solution'], fr?.[2] || 'Consulter le rapport ZAP pour la correction recommandée.');
    return o;
  }
  const id = [o.cve, o.ruleOrCve, o.vulnerabilityId, o.id, o.title].map(str).find(value => CVE_ID.test(value));
  if (id && (o.description !== undefined || o.title !== undefined || o.findingSnapshot !== undefined)) {
    const snapshot = o.findingSnapshot && typeof o.findingSnapshot === 'object' ? o.findingSnapshot : o;
    const text = cveTextFr(id, snapshot);
    if (typeof o.title === 'string') o.title = text.titre;
    assignPresent(o, ['description', 'message'], text.description);
    if (typeof o.recommendation === 'string' && o.recommendation.trim() && !/^Mettre à jour/.test(o.recommendation)) {
      o.recommendation = recommendationFr(o.recommendation, str(snapshot.fixedVersion)) || o.recommendation;
    }
  }
  return o;
}

/** Copie profonde d'une réponse dans laquelle chaque constat de scanner est francisé ; la valeur d'origine n'est jamais modifiée. */
export function localizeFindingsFr<T>(value: T, depth = 0): T {
  if (value === null || typeof value !== 'object' || depth > 60) return value;
  if (value instanceof Date || Buffer.isBuffer(value)) return value;
  if (Array.isArray(value)) return value.map(item => localizeFindingsFr(item, depth + 1)) as unknown as T;
  const copy: any = {};
  for (const [key, item] of Object.entries(value as any)) copy[key] = localizeFindingsFr(item, depth + 1);
  return localizeOne(copy);
}
