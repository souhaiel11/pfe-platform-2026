// Adapte les vérifications de figement distant GitHub/n8n aux outils opérateur.
'use strict';
const {LegacyRemoteSettlement}=require('../../src/manual-remediation/legacy-remote-settlement');
// Transport-only extension. The qualified receipt, pagination, inventory,
// quiescence and settlement predicates remain entirely in the reused provider.
class OperatorRemoteSettlement extends LegacyRemoteSettlement {
  /** Récupère les données demandées. */
  async get(url,headers={}) {
    const parsed=new URL(url),token=process.env.GITHUB_TOKEN;
    if(parsed.origin==='https://api.github.com'&&token){
      if(/[\r\n\s]/.test(token))throw new Error('INVALID_GITHUB_CREDENTIAL');
      return super.get(url,{...headers,Authorization:'Bearer '+token});
    }
    return super.get(url,headers);
  }
}
module.exports={OperatorRemoteSettlement};
