// Réduit la réponse IA à des corrections ciblées, puis reconstruit le fichier complet.
// Schéma JSON strict pris en charge par l’API Anthropic.
const text = {type:'string'};
const object = properties => ({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
export const analysisSchema = object({
  score:{type:'number'}, summary:text,
  issues:{type:'array',items:object({id:text,category:{type:'string',enum:['SECURITE','FIABILITE','PERFORMANCE','LISIBILITE','DEVSECOPS']},severity:{type:'string',enum:['CRITIQUE','ELEVE','MOYEN','FAIBLE']},title:text,problem:text,recommendation:text,lineHint:text,needsConfirmation:{type:'boolean'},confirmationNote:text})},
  edits:{type:'array',items:object({ref:text,before:text,after:text})},
});
export function patchWf4Analysis(source) {
  const workflow = structuredClone(source);
  const node = name => { const n = workflow.nodes.find(n => n.name === name); if (!n) throw Error(name); return n; };
  const prepare = node('Prepare - Optimizer Body');
  if (prepare.parameters.jsCode.includes('ANTI-FAUX-POSITIFS') && node('Parse - Optimizer Output').parameters.jsCode.includes('Reconstruit uniquement les remplacements exacts')) return workflow;
  const contract = "\\nCONTRAT DE SORTIE PRIORITAIRE : retourne uniquement un objet JSON avec score (0 à 100), summary (français), issues et edits. Maximum 8 issues vérifiables. Chaque issue contient id, category, severity, title, problem, recommendation, lineHint, needsConfirmation, confirmationNote. Chaque correction automatique contient {ref,before,after}, ref étant un id de issue. before doit être un extrait EXACT, non vide et UNIQUE du Jenkinsfile ORIGINAL ; after son remplacement complet. Petits changements uniquement : au maximum 10 corrections, before de 2000 caractères maximum et after de 4000 maximum. Les remplacements ne doivent pas se chevaucher. Si une correction ne peut pas être formulée ainsi, décris-la uniquement dans issues et ne fournis aucun edit pour elle. Ne fournis PAS optimizedJenkinsfile : il sera reconstruit et vérifié par le programme. Ne recopie pas le fichier complet. edits=[] si aucun changement automatique sûr. Conserve les stages, commandes, credentials et URLs ; respecte toutes les exclusions. Ne présente jamais une supposition externe comme un fait. N’invente pas de problème pour remplir la liste. Les règles du contexte projet restent obligatoires. Aucun Markdown." + "\nVÉRIFICATIONS ANTI-FAUX-POSITIFS : dans un GString Groovy, \\$VARIABLE ou \\${VARIABLE} empêche l’interpolation Groovy et laisse la variable au shell : ce n’est PAS une fuite. Un bloc sh triple-single-quotes ne fait pas d’interpolation Groovy. Ne signale pas comme vulnérabilité un secret déjà transmis ainsi sous withCredentials. Un set +e suivi de la capture du code de retour puis d’un test de ce code est un traitement explicite des erreurs, pas une absence de contrôle. Ne signale jamais un problème que ton explication reconnaît déjà conforme. summary doit refléter exactement issues, sans contradiction, et rester sous 700 caractères. Pour épingler une image externe, ne propose pas de numéro de version inventé ou non vérifié ; demande une version validée ou un digest, avec needsConfirmation=true.";
  const needle = "return [{ json: { apiBody:";
  if (!prepare.parameters.jsCode.includes(needle)) throw Error('Unexpected prepare contract');
  prepare.parameters.jsCode = prepare.parameters.jsCode.replace('const systemPrompt =', 'let systemPrompt =');
  prepare.parameters.jsCode = prepare.parameters.jsCode.replace(needle, 'systemPrompt = systemPrompt.split("FORMAT EXACT :")[0] + ' + JSON.stringify(contract) + ';\n' + needle);
  prepare.parameters.jsCode = prepare.parameters.jsCode.replace('max_tokens:16000', 'max_tokens:6500');
  prepare.parameters.jsCode = prepare.parameters.jsCode.replace('apiBody: { model:', 'apiBody: { output_config:' + JSON.stringify({format:{type:'json_schema',schema:analysisSchema}}) + ', model:');
  prepare.parameters.jsCode = prepare.parameters.jsCode.replace('Le fichier optimisé doit être COMPLET et directement utilisable (pas de "..." ni de sections omises).', 'Les remplacements doivent être complets, sans sections omises. Le programme conserve le reste du fichier.');
  const context = node('Build Project Context');
  context.parameters.jsCode = context.parameters.jsCode.replace(/SORTIE — ajoute ces 2 lignes en commentaire,[\s\S]*?ou "aucune">/, 'SORTIE : indique les changements et avertissements dans summary et issues, sans ajouter de commentaires au fichier.');
  const parser = node('Parse - Optimizer Output');
  parser.parameters.jsCode = parser.parameters.jsCode.replace("const content = response.content?.[0]?.text || '';", "if (response.stop_reason === 'max_tokens') return fail('Réponse IA tronquée : aucune correction appliquée.', 'max_tokens');\nconst content = (response.content || []).filter(b => b.type === 'text').map(b => b.text).join('\\n');");
  const target = "  if (!p.optimizedJenkinsfile";
  const at = parser.parameters.jsCode.indexOf(target); if (at < 0) throw Error('Unexpected parser contract');
  const expand = `  // Reconstruit uniquement les remplacements exacts, uniques et disjoints.
  const original = String($('Webhook - Optimize').first().json.body.jenkinsfile || '').trim();
  if (!Number.isFinite(p.score) || p.score < 0 || p.score > 100 || typeof p.summary !== 'string' || !p.summary.trim() || !Array.isArray(p.issues) || !Array.isArray(p.edits) || p.issues.length > 8 || p.edits.length > 10) return fail('Contrat d’analyse IA invalide', '');
  const refs = new Set();
  for (const issue of p.issues) {
    if (!issue || typeof issue.id !== 'string' || refs.has(issue.id) || !['CRITIQUE','ELEVE','MOYEN','FAIBLE'].includes(issue.severity) || !['SECURITE','FIABILITE','PERFORMANCE','LISIBILITE','DEVSECOPS'].includes(issue.category) || !['title','problem','recommendation','lineHint'].every(k => typeof issue[k] === 'string') || !issue.title.trim() || typeof issue.needsConfirmation !== 'boolean' || typeof issue.confirmationNote !== 'string') return fail('Constat IA invalide', '');
    refs.add(issue.id);
  }
  const ranges = [];
  for (const edit of p.edits) {
    if (!edit || !refs.has(edit.ref) || typeof edit.before !== 'string' || !edit.before.length || edit.before.length > 2000 || typeof edit.after !== 'string' || edit.after.length > 4000) return fail('Correction ciblée invalide', '');
    const issue = p.issues.find(i => i.id === edit.ref);
    if (issue.needsConfirmation) return fail('Une correction non confirmée ne peut pas être appliquée automatiquement', '');
    const start = original.indexOf(edit.before);
    if (start < 0 || original.indexOf(edit.before, start + 1) !== -1) return fail('Extrait de correction absent ou ambigu : ' + edit.ref, '');
    ranges.push({start, end:start + edit.before.length, after:edit.after, ref:edit.ref});
  }
  ranges.sort((a,b) => a.start-b.start);
  for (let i=1;i<ranges.length;i++) if (ranges[i].start < ranges[i-1].end) return fail('Corrections qui se chevauchent', '');
  let rebuilt = original;
  for (const edit of [...ranges].reverse()) rebuilt = rebuilt.slice(0,edit.start) + edit.after + rebuilt.slice(edit.end);
  p.optimizedJenkinsfile = rebuilt;
  p.changes = ranges.map(e => ({ref:e.ref, description:p.issues.find(i => i.id === e.ref).recommendation}));
  delete p.edits;
`;
  parser.parameters.jsCode = parser.parameters.jsCode.slice(0, at)+expand+parser.parameters.jsCode.slice(at);
  const agent = node('Jenkinsfile Optimizer Agent');
  agent.parameters.options.timeout = 240000;
  agent.retryOnFail = false;
  return workflow;
}
