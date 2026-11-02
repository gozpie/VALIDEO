import type { HealthStatus } from '@ass/shared-types';

export type ApiHealthState =
  | { kind: 'loading' }
  | { kind: 'ready'; health: HealthStatus }
  | { kind: 'unavailable'; health: HealthStatus }
  | { kind: 'unreachable'; message: string };

function isHealthStatus(value: unknown): value is HealthStatus {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['status'] === 'string' &&
    typeof candidate['version'] === 'string' &&
    typeof candidate['checks'] === 'object' &&
    candidate['checks'] !== null
  );
}

/** Interroge /health/ready ; 503 est une réponse attendue (dépendance indisponible). */
export async function fetchApiHealth(
  apiUrl: string,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<ApiHealthState> {
  try {
    const response = await fetchImpl(`${apiUrl}/health/ready`, {
      cache: 'no-store',
      ...(signal ? { signal } : {}),
    });
    const body: unknown = await response.json();
    if (!isHealthStatus(body)) {
      return { kind: 'unreachable', message: 'Réponse inattendue de l’API' };
    }
    return response.ok ? { kind: 'ready', health: body } : { kind: 'unavailable', health: body };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    return { kind: 'unreachable', message: 'API injoignable' };
  }
}
