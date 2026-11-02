/** Enveloppe d'erreur unique renvoyée par l'API (RFC 9457 « problem details » simplifié). */
export interface ApiError {
  type: string;
  title: string;
  status: number;
  detail: string;
  /** Identifiant de corrélation à rapprocher des logs serveur. */
  requestId: string;
  errors?: { path: string; message: string }[];
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface HealthStatus {
  status: 'ok' | 'degraded' | 'error';
  version: string;
  checks: Record<string, { status: 'ok' | 'error'; detail?: string }>;
}
