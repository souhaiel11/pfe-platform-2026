// Politique de robustesse des mots de passe, appliquée à la création de compte et au changement de mot de passe.
const KNOWN_DEFAULTS = new Set(['admin@123', 'dev@123', 'password', 'password123', 'changeme', 'admin', 'admin123']);

/** Renvoie la liste des règles non respectées (vide si le mot de passe est acceptable). */
export function passwordPolicyViolations(password: unknown, email?: string): string[] {
  const value = typeof password === 'string' ? password : '';
  const violations: string[] = [];
  if (value.length < 12) violations.push('au moins 12 caractères');
  if (!/[a-z]/.test(value)) violations.push('une minuscule');
  if (!/[A-Z]/.test(value)) violations.push('une majuscule');
  if (!/\d/.test(value)) violations.push('un chiffre');
  if (!/[^A-Za-z0-9]/.test(value)) violations.push('un caractère spécial');
  if (KNOWN_DEFAULTS.has(value.toLowerCase())) violations.push('pas un mot de passe par défaut connu');
  const local = String(email || '').split('@')[0].toLowerCase();
  if (local.length >= 3 && value.toLowerCase().includes(local)) violations.push('ne pas contenir l’identifiant du compte');
  return violations;
}
