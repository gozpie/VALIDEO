import { CSRF_HEADER, createApiClient, type ApiClient, type UploadedAsset } from '@ass/api-client';
import { API_URL } from '@/lib/config';

/** Client unique du navigateur : il porte le jeton CSRF de la session courante. */
export const api: ApiClient = createApiClient({ baseUrl: API_URL });

/** Message lisible d'une erreur API (« problem details ») ou d'une erreur réseau. */
export function errorMessage(error: unknown, fallback = 'Une erreur est survenue'): string {
  if (typeof error === 'object' && error !== null) {
    const problem = error as { detail?: unknown; errors?: unknown };
    if (Array.isArray(problem.errors) && problem.errors.length > 0) {
      const first = problem.errors[0] as { message?: unknown };
      if (typeof first.message === 'string') return first.message;
    }
    if (typeof problem.detail === 'string' && problem.detail.length > 0) return problem.detail;
  }
  if (error instanceof TypeError) return 'API injoignable';
  return fallback;
}

/** Exécute un appel du client et renvoie ses données, ou lève une erreur au message lisible. */
export async function call<T>(
  request: Promise<{ data?: T; error?: unknown; response: Response }>,
): Promise<T> {
  let result: { data?: T; error?: unknown; response: Response };
  try {
    result = await request;
  } catch (error) {
    throw new Error(errorMessage(error), { cause: error });
  }
  if (result.error !== undefined || !result.response.ok) {
    throw new Error(errorMessage(result.error));
  }
  return result.data as T;
}

/** Média conservé avec le projet (vidéo, image, son), en multipart ; cookie et CSRF inclus. */
export async function uploadProjectMedia(projectId: string, file: File): Promise<UploadedAsset> {
  const form = new FormData();
  form.append('file', file);
  let response: Response;
  try {
    response = await fetch(`${API_URL}/projects/${projectId}/edit/media`, {
      method: 'POST',
      body: form,
      credentials: 'include',
      headers: api.csrfToken ? { [CSRF_HEADER]: api.csrfToken } : {},
    });
  } catch (error) {
    throw new Error(errorMessage(error), { cause: error });
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(errorMessage(body, 'Envoi impossible'));
  return body as UploadedAsset;
}

/** Envoi d'un fichier en multipart (le client typé ne gère que le JSON) ; cookie et CSRF inclus. */
export async function uploadAsset(workspaceId: string, file: File): Promise<UploadedAsset> {
  const form = new FormData();
  form.append('file', file);
  let response: Response;
  try {
    response = await fetch(`${API_URL}/workspaces/${workspaceId}/assets`, {
      method: 'POST',
      body: form,
      credentials: 'include',
      headers: api.csrfToken ? { [CSRF_HEADER]: api.csrfToken } : {},
    });
  } catch (error) {
    throw new Error(errorMessage(error), { cause: error });
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(errorMessage(body, 'Import impossible'));
  return body as UploadedAsset;
}
