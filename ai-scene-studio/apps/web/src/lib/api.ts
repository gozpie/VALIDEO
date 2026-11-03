import { createApiClient, type ApiClient } from '@ass/api-client';
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
