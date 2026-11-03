/** Chemin de retour après connexion : uniquement un chemin interne (pas de redirection ouverte). */
export function safeNextPath(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) {
    return '/workspaces';
  }
  return value;
}
